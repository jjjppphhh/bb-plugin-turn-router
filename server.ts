import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { BENCHMARK, chooseRoute, type Route } from './benchmarks';
import { settingsSchema, defaults } from './settings';
import { obviousRating, explicitSelection } from './router';
import { classify } from './classifier';
import { compactContext,hasPriorAssistantResponse } from './context';
const selectionSchema=z.object({model:z.string().max(150),reasoningLevel:z.string().max(30)}).strict();
const delegateSchema=selectionSchema.extend({reason:z.string().min(1).max(400)}).strict();
const routeSchema=selectionSchema.extend({reason:z.string(),source:z.string(),score:z.number().nullable(),estimatedCost:z.number().nullable(),delegate:delegateSchema.optional()});
type RoutedRoute=Route&{delegate?:z.infer<typeof delegateSchema>};
export const inputSchema=z.object({
  text:z.string().min(1).max(30000),threadId:z.string().nullable(),environmentId:z.string().nullable(),hostId:z.string().nullable(),
  current:selectionSchema,providerId:z.literal('codex'),attachments:z.number().int().min(0).max(100),
}).strict();
export const rpcContract=defineRpcContract({
  getSettings:{input:z.null(),output:settingsSchema},
  updateSettings:{input:settingsSchema,output:settingsSchema},
  route:{input:inputSchema,output:routeSchema},
  openSideThread:{input:z.object({parentThreadId:z.string().min(1).max(200),text:z.string().min(1).max(30000),selection:selectionSchema}).strict(),output:z.object({threadId:z.string()}).strict()},
});
export default async function plugin(bb:BbPluginApi) {
  const secrets=bb.settings.define({apiKey:{type:'string',label:'External classifier API key',secret:true}});
  const settings=async()=>settingsSchema.parse(await bb.storage.kv.get('settings') ?? defaults);
  const cache=new Map<string,{expires:number;route:RoutedRoute}>();
  let activeClassifiers=0;
  bb.rpc.register(rpcContract,{
    getSettings:settings,
    updateSettings:async next=>{await bb.storage.kv.set('settings',next);cache.clear();return next;},
    route:async input=>{
      const config=await settings();
      const retain=(reason:string):Route=>({...input.current,reason,source:'retained',score:null,estimatedCost:null});
      let environmentId=input.environmentId, hostId=input.hostId;
      let context={text:'',characters:0};
      let established=false;
      if (input.threadId) {
        const thread=await bb.sdk.threads.get({threadId:input.threadId});
        if (thread.providerId!=='codex') throw new Error('Turn Router only changes models within Codex.');
        if (thread.status==='active') return retain('Running turn; keeping its current model and effort.');
        environmentId=thread.environmentId;
        const timeline=await bb.sdk.threads.timeline({threadId:thread.id,segmentLimit:'8',includeNestedRows:'true'});
        context=compactContext(timeline.rows,thread.title ?? '',timeline.pendingTodos?.items.filter(t=>t.status!=='completed').map(t=>t.text));
        established=hasPriorAssistantResponse(timeline.rows);
      }
      const scope=environmentId?{environmentId}:hostId?{hostId}:{};
      const models=await bb.sdk.providers.models({...scope,providerId:'codex'});
      if (models.modelLoadError) throw new Error('Codex model catalog could not be loaded.');
      const candidates=models.models.filter(m=>!m.routeProviderId||m.routeProviderId==='codex').map(m=>({model:m.model,efforts:m.supportedReasoningEfforts.map(e=>e.reasoningEffort)}));
      const explicit=explicitSelection(input.text,candidates,input.current);
      if (explicit) return {...explicit,reason:'Your explicit model/effort request.',source:'explicit',score:null,estimatedCost:null};
      if (input.attachments) return retain('Attachments need the working model’s inspection; keeping your current selection.');
      const key=createHash('sha256').update(JSON.stringify({input,context,config,candidates})).digest('hex');
      const cached=cache.get(key);if(cached&&cached.expires>Date.now())return cached.route;
      let rating=obviousRating(input.text,context.text,input.attachments);
      if (!rating) {
        if (activeClassifiers>=2) return retain('Classifier busy; keeping your current selection.');
        activeClassifiers++;
        try { rating=await classify({text:input.text,context:context.text,attachments:input.attachments},config,(await secrets.get()).apiKey); }
        catch { return retain('Classifier unavailable; keeping your current model and effort.'); }
        finally {activeClassifiers--;}
      }
      const result=chooseRoute({candidates,rating,premium:config.premium,current:input.current,contextCharacters:context.characters,established});
      const delegated=established&&input.threadId&&rating.confidence>=.8&&['tweak','question'].includes(rating.kind)
        ? chooseRoute({candidates,rating,premium:config.premium}) : undefined;
      const currentScore=BENCHMARK.rows.find(row=>row.family===input.current.model&&row.reasoningLevel===input.current.reasoningLevel)?.score;
      const delegate=delegated&&currentScore!==undefined&&delegated.score!==null&&delegated.score<currentScore
        ? {...delegated,reason:`${delegated.reason} Open separately to keep this thread's working context intact.`} : undefined;
      const routed:RoutedRoute=delegate?{...result,delegate}:result;
      if (cache.size>100) cache.clear();cache.set(key,{expires:Date.now()+30000,route:routed});
      bb.log.info(`Route ${input.threadId??'new'} via ${config.classifier}: ${rating.kind} ${rating.complexity}/100 -> ${result.model}/${result.reasoningLevel}`);
      return routed;
    },
    openSideThread:async({parentThreadId,text,selection})=>{
      const parent=await bb.sdk.threads.get({threadId:parentThreadId});
      if(parent.providerId!=='codex'||!['idle','error'].includes(parent.status))throw new Error('Wait for the current thread to become idle before opening a side thread.');
      const models=await bb.sdk.providers.models(parent.environmentId?{providerId:'codex',environmentId:parent.environmentId}:{providerId:'codex'});
      const selected=models.models.find(model=>model.model===selection.model&&model.supportedReasoningEfforts.some(effort=>effort.reasoningEffort===selection.reasoningLevel));
      if(!selected)throw new Error('That side-thread model is no longer available.');
      const timeline=await bb.sdk.threads.timeline({threadId:parentThreadId,segmentLimit:'8',includeNestedRows:'true'});
      const brief=compactContext(timeline.rows,parent.title ?? '',timeline.pendingTodos?.items.filter(todo=>todo.status!=='completed').map(todo=>todo.text)).text.slice(-4000);
      const thread=await bb.sdk.threads.spawn({projectId:parent.projectId,parentThreadId,environment:parent.environmentId?{type:'reuse',environmentId:parent.environmentId}:{type:'project-default'},providerId:'codex',model:selection.model,reasoningLevel:selection.reasoningLevel as 'low'|'medium'|'high'|'xhigh'|'max'|'ultra',visibility:'visible',title:`Side task · ${text.replace(/\s+/g,' ').slice(0,72)}`,prompt:`Work only on this bounded task in a separate side thread. Return a concise result here; do not try to merge it into the parent thread.\n\nTask:\n${text}\n\nCompact parent context (reference only):\n${brief}`});
      bb.log.info(`Opened side thread ${thread.id} from ${parentThreadId} with ${selection.model}/${selection.reasoningLevel}`);
      return {threadId:thread.id};
    },
  });
  bb.cli.register({name:'turn-router',summary:'Inspect per-turn Codex routing',commands:[{name:'status',summary:'Show policy and benchmark provenance',usage:'bb turn-router status'}],async run(argv){
    if(argv[0]&&argv[0]!=='status')return {exitCode:1,stderr:'Usage: bb turn-router status\n'};
    return {exitCode:0,stdout:JSON.stringify({settings:await settings(),benchmark:BENCHMARK.benchmark,retrievedAt:BENCHMARK.retrievedAt,measuredOptions:BENCHMARK.rows.length})+'\n'};
  }});
  bb.log.info('Turn Router loaded');
}
