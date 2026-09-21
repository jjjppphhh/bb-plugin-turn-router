import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { BENCHMARK, chooseRoute, type Route } from './benchmarks';
import { settingsSchema, defaults } from './settings';
import { classifierPrompt, obviousRating, explicitSelection } from './router';
import { classify } from './classifier';
import { compactContext } from './context';
const selectionSchema=z.object({model:z.string().max(150),reasoningLevel:z.string().max(30)}).strict();
const routeSchema=selectionSchema.extend({reason:z.string(),source:z.string(),score:z.number().nullable(),estimatedCost:z.number().nullable()});
export const inputSchema=z.object({
  text:z.string().min(1).max(30000),threadId:z.string().nullable(),environmentId:z.string().nullable(),hostId:z.string().nullable(),
  current:selectionSchema,providerId:z.literal('codex'),attachments:z.number().int().min(0).max(100),
}).strict();
export const rpcContract=defineRpcContract({
  getSettings:{input:z.null(),output:settingsSchema},
  updateSettings:{input:settingsSchema,output:settingsSchema},
  route:{input:inputSchema,output:routeSchema},
});
export default async function plugin(bb:BbPluginApi) {
  const secrets=bb.settings.define({apiKey:{type:'string',label:'Optional classifier API key',secret:true}});
  const settings=async()=>settingsSchema.parse(await bb.storage.kv.get('settings') ?? defaults);
  const cache=new Map<string,{expires:number;route:Route}>();
  let activeClassifiers=0;
  bb.rpc.register(rpcContract,{
    getSettings:settings,
    updateSettings:async next=>{await bb.storage.kv.set('settings',next);cache.clear();return next;},
    route:async input=>{
      const config=await settings();
      const retain=(reason:string):Route=>({...input.current,reason,source:'retained',score:null,estimatedCost:null});
      let environmentId=input.environmentId, hostId=input.hostId;
      let context={text:'',characters:0};
      if (input.threadId) {
        const thread=await bb.sdk.threads.get({threadId:input.threadId});
        if (thread.providerId!=='codex') throw new Error('Turn Router only changes models within Codex.');
        if (thread.status==='active') return retain('Running turn; keeping its current model and effort.');
        environmentId=thread.environmentId;
        const timeline=await bb.sdk.threads.timeline({threadId:thread.id,segmentLimit:'8',includeNestedRows:'true'});
        context=compactContext(timeline.rows,thread.title ?? '',timeline.pendingTodos?.items.filter(t=>t.status!=='completed').map(t=>t.text));
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
        try { rating=await classify(classifierPrompt(input.text,context.text,input.attachments),config,(await secrets.get()).apiKey); }
        catch { return retain('Classifier unavailable; keeping your current model and effort.'); }
        finally {activeClassifiers--;}
      }
      const result=chooseRoute({candidates,rating,premium:config.premium,current:input.current,contextCharacters:context.characters});
      if (cache.size>100) cache.clear();cache.set(key,{expires:Date.now()+30000,route:result});
      bb.log.info(`Route ${input.threadId??'new'}: ${rating.kind} ${rating.complexity}/100 -> ${result.model}/${result.reasoningLevel}`);
      return result;
    },
  });
  bb.cli.register({name:'turn-router',summary:'Inspect per-turn Codex routing',commands:[{name:'status',summary:'Show policy and benchmark provenance',usage:'bb turn-router status'}],async run(argv){
    if(argv[0]&&argv[0]!=='status')return {exitCode:1,stderr:'Usage: bb turn-router status\n'};
    return {exitCode:0,stdout:JSON.stringify({settings:await settings(),benchmark:BENCHMARK.benchmark,retrievedAt:BENCHMARK.retrievedAt,measuredOptions:BENCHMARK.rows.length})+'\n'};
  }});
  bb.log.info('Turn Router loaded');
}
