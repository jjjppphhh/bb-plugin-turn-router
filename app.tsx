import { useEffect,useRef,useState } from 'react';
import { definePluginApp,useBbNavigate,useComposer,useComposerView,useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server';
import { registerComposer,mountComposerScripts,findComposer } from './composer-adapter';
import { defaults,type Settings } from './shared-settings';
import { BENCHMARK,EFFORTS } from './benchmarks';
import './autorouter.css';
const formatModel=(model:string)=>model.replace('gpt-','').replace(/(^|-)([a-z])/g,(_match,prefix:string,letter:string)=>`${prefix}${letter.toUpperCase()}`);
const formatEffort=(effort:string)=>({low:'Low',medium:'Medium',high:'High',xhigh:'Extra High',max:'Max',ultra:'Ultra'}[effort]??effort);
export function CostTable(){
  const families=[...new Set(BENCHMARK.rows.map(row=>row.family))];
  return <section className="turn-router-costs" aria-label="Benchmark cost table">
    <p>Estimated cost per benchmark task · Artificial Analysis Intelligence Index v4.3.2 · snapshot 21 Sep 2026</p>
    <div className="turn-router-costs-scroll"><table><thead><tr><th>Model</th>{EFFORTS.map(effort=><th key={effort}>{formatEffort(effort)}</th>)}</tr></thead>
      <tbody>{families.map(family=><tr key={family}><th>{formatModel(family)}</th>{EFFORTS.map(effort=>{
        const row=BENCHMARK.rows.find(item=>item.family===family&&item.reasoningLevel===effort);
        return <td key={effort} title={row?`Index score ${row.score}`:'Not measured'}>{row?`$${row.costPerTask.toFixed(2)}`:'—'}</td>;
      })}</tr>)}</tbody></table></div>
  </section>;
}
export function RoutingControl(){
  const composer=useComposer(),view=useComposerView(),rpc=useRpc<typeof rpcContract>(),navigate=useBbNavigate();
  const key=`turn-router:${view.scope.kind==='thread'?view.scope.threadId:'new'}`;
  const [enabled,setEnabled]=useState(()=>localStorage.getItem(key)!=='off');
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [selection,setSelection]=useState<{model:string;reasoningLevel:string}|null>(null);
  const [delegate,setDelegate]=useState<{model:string;reasoningLevel:string;reason:string;text:string;parentThreadId:string;main:{model:string;reasoningLevel:string}}|null>(null);
  const [sideBusy,setSideBusy]=useState(false);
  const anchor=useRef<HTMLDivElement>(null),live=useRef({composer,view,enabled,busy}),epoch=useRef(0),sideAction=useRef(false),previousKey=useRef(key);
  live.current={composer,view,enabled,busy};
  useEffect(()=>{
    const prior=previousKey.current;
    let stored=localStorage.getItem(key);
    // BB reuses this composer when a submitted new-thread draft becomes its
    // real thread. Carry the user's Auto/manual choice into that new scope.
    if(stored===null&&prior==='turn-router:new'&&key.startsWith('turn-router:')){
      stored=localStorage.getItem(prior)??(live.current.enabled?'on':'off');
      localStorage.setItem(key,stored);
    }
    previousKey.current=key;setEnabled(stored!=='off');setNotice('');setDelegate(null);
  },[key]);
  useEffect(()=>{if(delegate&&view.draft.text!==delegate.text){setDelegate(null);setNotice('');}},[view.draft.text,delegate?.text]);
  useEffect(()=>{
    const generation=++epoch.current;
    const form=anchor.current&&findComposer(anchor.current);if(!form)return;
    let mounted=true;
    const mode=(next:boolean)=>{live.current.enabled=next;setEnabled(next);localStorage.setItem(key,next?'on':'off');};
    const refreshSelection=async()=>{
      try { const selected=await live.current.composer.experimental_setSelection({});
        if(mounted&&selected.model&&selected.reasoningLevel)setSelection({model:selected.model,reasoningLevel:selected.reasoningLevel});
      } catch { /* The native picker will continue to show its own selection. */ }
    };
    void refreshSelection();
    const release=registerComposer(form,{
      enabled:()=>live.current.enabled,busy:()=>live.current.busy,running:()=>live.current.view.run.isRunning,
      selectAuto:()=>{mode(true);setNotice('');void refreshSelection();},manual:()=>{mode(false);setNotice('');setDelegate(null);requestAnimationFrame(()=>void refreshSelection());},
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
          if(route.delegate&&snapshot.scope.kind==='thread'){
            api.setInputLock(false);setDelegate({...route.delegate,text:originalText,parentThreadId:snapshot.scope.threadId,main:{model:route.model,reasoningLevel:route.reasoningLevel}});
            setNotice('This bounded follow-up can run separately without changing the main thread.');return;
          }
          if(live.current.view.run.isRunning)throw new Error('A turn started while rating. Send again to steer its existing model.');
          if(live.current.composer.text!==originalText)throw new Error('The draft changed while rating. Send again to rate the updated message.');
          const applied=await api.experimental_setSelection({model:route.model,reasoningLevel:route.reasoningLevel as typeof selected.reasoningLevel});
          if(!valid())return;
          if(applied.model!==route.model||applied.reasoningLevel!==route.reasoningLevel)throw new Error('BB could not apply that route. Review the model picker and send again.');
          setSelection({model:route.model,reasoningLevel:route.reasoningLevel});setNotice('');
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
  const selectedLabel=selection&&`${formatModel(selection.model)} · ${formatEffort(selection.reasoningLevel)}`;
  const openSideThread=async()=>{
    const offer=delegate;if(!offer||sideAction.current)return;
    if(composer.text!==offer.text){setDelegate(null);setNotice('The draft changed. Send again to reassess it.');return;}
    sideAction.current=true;setSideBusy(true);composer.setInputLock(true);
    try{const opened=await rpc.call('openSideThread',{parentThreadId:offer.parentThreadId,text:offer.text,selection:{model:offer.model,reasoningLevel:offer.reasoningLevel}});setDelegate(null);navigate.toThread(opened.threadId);}
    catch{setNotice('Could not open the side thread. Your draft is unchanged.');}
    finally{sideAction.current=false;setSideBusy(false);composer.setInputLock(false);}
  };
  const keepInThread=async()=>{
    const offer=delegate;if(!offer||sideAction.current)return;
    if(!live.current.enabled||composer.text!==offer.text){setDelegate(null);setNotice('The selection or draft changed. Send again to reassess it.');return;}
    sideAction.current=true;setSideBusy(true);composer.setInputLock(true);
    try{
      const applied=await composer.experimental_setSelection({model:offer.main.model,reasoningLevel:offer.main.reasoningLevel as 'low'|'medium'|'high'|'xhigh'|'max'|'ultra'});
      if(applied.model!==offer.main.model||applied.reasoningLevel!==offer.main.reasoningLevel)throw new Error('BB could not apply the selected route.');
      if(composer.text!==offer.text)throw new Error('The draft changed. Send again to reassess it.');
      setSelection(offer.main);setDelegate(null);setNotice('');composer.setInputLock(false);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      await composer.experimental_submit({experimental_data:{routed:true,delegated:false,model:offer.main.model,reasoningLevel:offer.main.reasoningLevel}});
    }catch(error){setNotice(error instanceof Error?error.message:'Could not send this turn. Your draft is unchanged.');}
    finally{sideAction.current=false;setSideBusy(false);composer.setInputLock(false);}
  };
  return <div ref={anchor} className="turn-router-status" role="status" aria-live="polite">
    <span>{busy?'Choosing model and reasoning…':notice||(enabled?`Auto · ${selectedLabel??'model and reasoning adapt each turn'}`:selectedLabel??'')}</span>
    {delegate&&<span className="turn-router-delegate"><button type="button" disabled={sideBusy} onClick={openSideThread}>{sideBusy?'Opening…':`Open in ${formatModel(delegate.model)} · ${formatEffort(delegate.reasoningLevel)}`}</button><button type="button" disabled={sideBusy} onClick={keepInThread}>Keep in This Thread</button></span>}
  </div>;
}
function RouterSettings(){
  const rpc=useRpc<typeof rpcContract>();const [value,setValue]=useState<Settings>(defaults),[status,setStatus]=useState('');
  useEffect(()=>{void rpc.call('getSettings').then(setValue).catch(()=>setStatus('Unable to load settings.'));},[]);
  return <form className="turn-router-settings" onSubmit={async e=>{e.preventDefault();try{setValue(await rpc.call('updateSettings',value));setStatus('Saved');}catch{setStatus('Could not save settings.');}}}>
    <p>Codex only. Auto appears in the model picker. The first substantive turn chooses a model; later turns keep that family and adapt reasoning effort. Auto only promotes to a stronger family when the current one cannot meet the task.</p>
    <label>Classifier<select value={value.classifier} onChange={e=>setValue({...value,classifier:e.target.value as Settings['classifier']})}><option value="luna">Luna · existing Codex sign-in</option><option value="compatible-api">Compatible API · DeepSeek, Kimi or another provider</option></select></label>
    {value.classifier==='luna'?<label>Codex executable<input value={value.codexBinary} onChange={e=>setValue({...value,codexBinary:e.target.value})}/></label>:<><p>Your selected provider receives the draft and a short recent conversation excerpt. Add its key in the secure field above.</p><label>HTTPS API base URL<input value={value.apiBaseUrl} placeholder="https://provider.example/v1" onChange={e=>setValue({...value,apiBaseUrl:e.target.value})}/></label><label>Classifier model ID<input value={value.classifierModel} onChange={e=>setValue({...value,classifierModel:e.target.value})}/></label></>}
    <label>Capability preference: {value.premium}<input type="range" min="0" max="100" value={value.premium} onChange={e=>setValue({...value,premium:Number(e.target.value)})}/></label>
    <CostTable/>
    <p>Artificial Analysis Intelligence Index v4.3.2, retrieved 21 September 2026. Scores compare general capability; costs are benchmark estimates, not subscription charges. Ultra is available through an explicit request or manual selection only.</p>
    <button type="submit">Save settings</button><span role="status">{status}</span>
  </form>;
}
export default definePluginApp(app=>{
  app.contentScripts.register({id:'model-picker-routing',mount:()=>mountComposerScripts()});
  app.composer.customize({id:'turn-routing',scopes:['thread','new-thread'],banners:[{id:'turn-routing-control',chrome:'bare',component:RoutingControl}]});
  app.slots.settingsSection({id:'routing-policy',title:'Turn Router',component:RouterSettings});
});
