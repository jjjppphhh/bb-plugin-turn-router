import { useEffect,useRef,useState } from 'react';
import { definePluginApp,useComposer,useComposerView,useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server';
import { registerComposer,mountComposerScripts,findComposer } from './composer-adapter';
import { defaults,type Settings } from './shared-settings';
import './autorouter.css';
export function RoutingControl(){
  const composer=useComposer(),view=useComposerView(),rpc=useRpc<typeof rpcContract>();
  const key=`turn-router:${view.scope.kind==='thread'?view.scope.threadId:'new'}`;
  const [enabled,setEnabled]=useState(()=>localStorage.getItem(key)!=='off');
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const anchor=useRef<HTMLSpanElement>(null),live=useRef({composer,view,enabled,busy}),epoch=useRef(0);
  live.current={composer,view,enabled,busy};
  useEffect(()=>{setEnabled(localStorage.getItem(key)!=='off');setNotice('');},[key]);
  useEffect(()=>{
    const generation=++epoch.current;
    const form=anchor.current&&findComposer(anchor.current);if(!form)return;
    let mounted=true;
    const mode=(next:boolean)=>{live.current.enabled=next;setEnabled(next);localStorage.setItem(key,next?'on':'off');};
    const release=registerComposer(form,{
      enabled:()=>live.current.enabled,busy:()=>live.current.busy,running:()=>live.current.view.run.isRunning,
      selectAuto:()=>{mode(true);setNotice('');},manual:()=>{mode(false);setNotice('');},
      submit:async()=>{
        if(live.current.busy||live.current.view.draft.isEmpty)return;
        const api=live.current.composer,snapshot=live.current.view;
        live.current.busy=true;setBusy(true);api.setInputLock(true);setNotice('Choosing model and reasoning…');
        const valid=()=>mounted&&epoch.current===generation;
        try{
          const selected=await api.experimental_setSelection({});
          if(!valid())return;
          if(selected.providerId!=='codex'){
            api.setInputLock(false);mode(false);setNotice('Turn Router supports Codex. Your provider is unchanged.');
            await api.experimental_submit({experimental_data:{routed:false}});return;
          }
          if(!selected.model||!selected.reasoningLevel)throw new Error('Wait for the model picker to finish loading.');
          const originalText=api.text;
          const environment=selected.environment;
          const route=await rpc.call('route',{
            text:originalText||'[Attachments]',attachments:snapshot.draft.attachmentCount,
            threadId:snapshot.scope.kind==='thread'?snapshot.scope.threadId:null,
            environmentId:environment?.type==='reuse'?environment.environmentId:null,
            hostId:environment?.type==='host'?environment.hostId??null:null,
            providerId:'codex',current:{model:selected.model,reasoningLevel:selected.reasoningLevel},
          });
          if(!valid())return;
          if(!live.current.enabled)throw new Error('Manual selection kept. Send again to use your chosen model.');
          if(live.current.view.run.isRunning)throw new Error('A turn started while rating. Send again to steer its existing model.');
          if(live.current.composer.text!==originalText)throw new Error('The draft changed while rating. Send again to rate the updated message.');
          const applied=await api.experimental_setSelection({model:route.model,reasoningLevel:route.reasoningLevel as typeof selected.reasoningLevel});
          if(!valid())return;
          if(applied.model!==route.model||applied.reasoningLevel!==route.reasoningLevel)throw new Error('BB could not apply that route. Review the model picker and send again.');
          setNotice(`${route.model.replace('gpt-','')} · ${route.reasoningLevel} · ${route.reason}`);
          api.setInputLock(false);
          await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
          if(!valid())return;
          if(!live.current.enabled)throw new Error('Manual selection kept. Send again to use your chosen model.');
          await api.experimental_submit({experimental_data:{routed:true,model:route.model,reasoningLevel:route.reasoningLevel}});
        }catch(error){if(valid())setNotice(error instanceof Error?error.message:'Routing failed. Your draft is preserved.');}
        finally{api.setInputLock(false);if(valid()){live.current.busy=false;setBusy(false);}}
      },
    });
    return()=>{mounted=false;epoch.current++;release();};
  },[key]);
  return <span ref={anchor} className="turn-router-status" role="status" aria-live="polite">{busy?'Choosing model and reasoning…':notice||(enabled?'Auto · model and reasoning adapt each turn':'')}</span>;
}
function RouterSettings(){
  const rpc=useRpc<typeof rpcContract>();const [value,setValue]=useState<Settings>(defaults),[status,setStatus]=useState('');
  useEffect(()=>{void rpc.call('getSettings').then(setValue).catch(()=>setStatus('Unable to load settings.'));},[]);
  return <form className="turn-router-settings" onSubmit={async e=>{e.preventDefault();try{setValue(await rpc.call('updateSettings',value));setStatus('Saved');}catch{setStatus('Could not save settings.');}}}>
    <p>Codex only. Auto appears at the top right of the model dropdown. Manual model selection turns it off for that composer.</p>
    <label>Classifier<select value={value.classifier} onChange={e=>setValue({...value,classifier:e.target.value as Settings['classifier']})}><option value="luna">Luna · existing Codex sign-in</option><option value="compatible-api">Compatible API · DeepSeek, Kimi or another provider</option></select></label>
    {value.classifier==='luna'?<label>Codex executable<input value={value.codexBinary} onChange={e=>setValue({...value,codexBinary:e.target.value})}/></label>:<><p>Your selected provider receives the draft and a short recent conversation excerpt. Add its key in the secure field above.</p><label>HTTPS API base URL<input value={value.apiBaseUrl} placeholder="https://provider.example/v1" onChange={e=>setValue({...value,apiBaseUrl:e.target.value})}/></label><label>Classifier model ID<input value={value.classifierModel} onChange={e=>setValue({...value,classifierModel:e.target.value})}/></label></>}
    <label>Capability preference: {value.premium}<input type="range" min="0" max="100" value={value.premium} onChange={e=>setValue({...value,premium:Number(e.target.value)})}/></label>
    <p>Artificial Analysis Intelligence Index v4.3.2, retrieved 21 September 2026. Scores compare general capability; costs are benchmark estimates, not subscription charges. Ultra is available through an explicit request or manual selection only.</p>
    <button type="submit">Save settings</button><span role="status">{status}</span>
  </form>;
}
export default definePluginApp(app=>{
  app.contentScripts.register({id:'model-picker-routing',mount:()=>mountComposerScripts()});
  app.composer.customize({id:'turn-routing',scopes:['thread','new-thread'],banners:[{id:'turn-routing-control',chrome:'bare',component:RoutingControl}]});
  app.slots.settingsSection({id:'routing-policy',title:'Turn Router',component:RouterSettings});
});
