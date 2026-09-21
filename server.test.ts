import {describe,it,expect,vi,beforeEach} from 'vitest';
import plugin from './server';
import {classify,lunaArgs} from './classifier';
vi.mock('./classifier',async original=>({...await original<typeof import('./classifier')>(),classify:vi.fn()}));
function harness(){
 let handlers:any;const kv=new Map();const logs:string[]=[];
 const model=(name:string)=>({model:name,supportedReasoningEfforts:['low','medium','high','xhigh','max'].map(reasoningEffort=>({reasoningEffort}))});
 const bb:any={settings:{define:()=>({get:async()=>({})})},storage:{kv:{get:async(k:string)=>kv.get(k),set:async(k:string,v:any)=>kv.set(k,v)}},rpc:{register:(_:unknown,h:unknown)=>{handlers=h;}},cli:{register:()=>{}},log:{info:(s:string)=>logs.push(s)},sdk:{
 threads:{get:vi.fn(async()=>({id:'thread',providerId:'codex',status:'idle',environmentId:'env',title:'Existing task'})),timeline:vi.fn(async()=>({rows:[],pendingTodos:null}))},
 providers:{models:vi.fn(async()=>({modelLoadError:null,models:['gpt-6-astra','gpt-5.6-sol','gpt-5.6-luna'].map(model)}))},
 }};
 return {bb,logs,start:async()=>{await plugin(bb);return handlers;}};
}
const input={text:'Review the overall architecture critically.',threadId:'thread',environmentId:'env',hostId:null,providerId:'codex',current:{model:'gpt-5.6-sol',reasoningLevel:'medium'},attachments:0};
beforeEach(()=>vi.clearAllMocks());
describe('server routing boundaries',()=>{
 it('uses current thread context without spawning or sending a thread',async()=>{
  const h=harness();vi.mocked(classify).mockResolvedValue({kind:'review',complexity:90,uncertainty:90,risk:90,confidence:.95,reason:'Critical architectural review.'});
  const api=await h.start();expect((await api.route(input)).model).toBe('gpt-6-astra');expect(h.bb.sdk.threads.timeline).toHaveBeenCalled();expect(h.logs.join()).not.toContain(input.text);
 });
 it('keeps in-flight turns and attachments on their existing model',async()=>{
  const h=harness(),api=await h.start();h.bb.sdk.threads.get.mockResolvedValue({providerId:'codex',status:'active'});
  expect(await api.route(input)).toMatchObject(input.current);expect(classify).not.toHaveBeenCalled();
 });
 it('keeps an established thread on its model family for a small follow-up',async()=>{
  const h=harness(),api=await h.start();
  h.bb.sdk.threads.timeline.mockResolvedValue({rows:[{kind:'conversation',role:'assistant',text:'The implementation is complete.'}],pendingTodos:null});
  const result=await api.route({...input,text:'Fix the typo in that heading.'});
  expect(result).toMatchObject({model:'gpt-5.6-sol'});
 });
 it('fails back safely on timeout or missing authentication',async()=>{
  const api=await harness().start();vi.mocked(classify).mockRejectedValue(new Error('timeout'));expect(await api.route(input)).toMatchObject({...input.current,source:'retained'});
 });
 it('reuses a rating for duplicate requests but not a changed draft',async()=>{
  const api=await harness().start();vi.mocked(classify).mockResolvedValue({kind:'review',complexity:75,uncertainty:70,risk:50,confidence:.9,reason:'Review.'});
  await api.route(input);await api.route(input);expect(classify).toHaveBeenCalledTimes(1);await api.route({...input,text:'A different request'});expect(classify).toHaveBeenCalledTimes(2);
 });
 it('disables shell, subagents and project instructions in the isolated Luna process',()=>{
  const args=lunaArgs('/tmp/rating');expect(args).toContain('--ignore-user-config');expect(args).toContain('read-only');expect(args).toContain('shell_tool');expect(args).toContain('multi_agent');expect(args).toContain('project_doc_max_bytes=0');
 });
});
