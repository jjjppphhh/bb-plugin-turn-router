/** Minimal DOM bridge for the picker header; model mutation/submission stay on BB's SDK. */
export interface ComposerBinding {
  enabled(): boolean; busy(): boolean; running(): boolean;
  selectAuto(): void; manual(): void; submit(): Promise<void>;
}
let activeForm: HTMLFormElement | null = null;
export function findComposer(anchor: Element): HTMLFormElement | null {
  let node: Element | null=anchor;
  while(node && node!==document.body) {
    const form=node.matches('form[data-promptbox]')?node:node.querySelector('form[data-promptbox]');
    if(form)return form as HTMLFormElement;
    node=node.parentElement;
  }
  return null;
}
export function bindComposer(form: HTMLFormElement,binding: ComposerBinding):()=>void {
  const doc=form.ownerDocument;
  let toggle:HTMLButtonElement|null=null, popup:HTMLElement|null=null, header:HTMLElement|null=null;
  let pending=false,disposed=false;
  const cleanupButton=()=>{toggle?.remove();toggle=null;header?.classList.remove('turn-router-header');header=null;popup=null;};
  const sync=()=>{
    if(disposed)return;
    if(activeForm!==form){cleanupButton();return;}
    // Radix links the native trigger to its portal, with or without model search.
    const trigger=form.querySelector<HTMLElement>('[aria-label^="Provider, model and reasoning"][aria-expanded="true"]');
    const id=trigger?.getAttribute('aria-controls');
    const next=id?doc.getElementById(id):null;
    const model=next?.querySelector<HTMLElement>('button[id*="-opt-"]');
    const modelHeading=model?.parentElement?.firstElementChild as HTMLElement|null;
    const providerHeader=Array.from(next?.children??[]).find(child=>child.querySelector(':scope > button[title]')) as HTMLElement|undefined;
    const nextHeader=providerHeader??modelHeading;
    if(!next||!nextHeader){cleanupButton();return;}
    if(popup!==next||header!==nextHeader||!toggle?.isConnected){
      cleanupButton();popup=next;header=nextHeader;header.classList.add('turn-router-header');
      toggle=doc.createElement('button');toggle.type='button';toggle.className='turn-router-toggle';toggle.dataset.turnRouterToggle='';
      toggle.addEventListener('pointerdown',e=>e.stopPropagation());
      // Auto is a selection, not an independent switch. Native selections leave it.
      toggle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();binding.selectAuto();sync();});
      header.append(toggle);
    }
    const enabled=binding.enabled();
    const label=binding.busy()?'Rating…':enabled?'Auto ✓':'Auto';
    if(toggle!.textContent!==label)toggle!.textContent=label;
    toggle!.setAttribute('aria-pressed',String(enabled));
    toggle!.setAttribute('aria-label','Auto: choose model and reasoning for each turn');
    toggle!.title='Select Auto, or choose a model below to use it manually.';
  };
  const observer=new MutationObserver(sync);observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-expanded','aria-controls']});
  const submit=()=>{
    if(pending||binding.busy()||disposed)return;
    pending=true;void binding.submit().finally(()=>{pending=false;sync();});
  };
  const canRoute=()=>binding.enabled()&&!binding.running();
  const stop=(e:Event)=>{e.preventDefault();e.stopImmediatePropagation();};
  const isSubmit=(target:EventTarget|null)=>{
    const button=target instanceof Element?target.closest<HTMLElement>('[data-promptbox-submit-action]'):null;
    return button&&form.contains(button)&&!button.hasAttribute('disabled')&&!/Stop run|voice input/i.test(button.getAttribute('aria-label')??'');
  };
  const pointer=(e:Event)=>{
    if(form.contains(e.target as Node)){activeForm=form;sync();}
    if(e instanceof MouseEvent&&(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey))return;
    if(canRoute()&&isSubmit(e.target))stop(e); // Prevent native pointer/touch submit before rating.
  };
  const click=(e:Event)=>{if(e instanceof MouseEvent&&(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey))return;if(canRoute()&&isSubmit(e.target)){stop(e);submit();}};
  const formSubmit=(e:Event)=>{if(canRoute()){stop(e);submit();}};
  const key=(e:KeyboardEvent)=>{
    if(form.contains(e.target as Node)){activeForm=form;sync();}
    const target=e.target instanceof Element?e.target:null;
    if(!canRoute()||e.key!=='Enter'||e.shiftKey||e.altKey||e.ctrlKey||e.metaKey||e.isComposing||!target?.closest('[contenteditable="true"]'))return;
    // Enter may accept an @mention/slash-command or IME suggestion rather than send.
    if(target.getAttribute('enterkeyhint')==='enter'||target.getAttribute('aria-activedescendant')||doc.querySelector('[role="listbox"], [data-mention-menu]'))return;
    stop(e);submit();
  };
  const manual=(e:Event)=>{
    if(activeForm!==form||!popup||!binding.enabled())return;
    const target=e.target instanceof Element?e.target:null;
    if(!target||target.closest('[data-turn-router-toggle]')||!popup.contains(target))return;
    const button=target.closest<HTMLElement>('button');
    if(button?.hasAttribute('disabled')||button?.getAttribute('aria-disabled')==='true')return;
    const isModel=button?.matches('[id*="-opt-"], [role="option"], [role="menuitem"]')&&!button.hasAttribute('aria-expanded');
    const isReasoning=button?.closest('[aria-label="Reasoning"]')||button?.matches('[role="radio"]');
    if(e instanceof KeyboardEvent){
      const search=target.closest('input[aria-label="Search models"]');
      const selected=doc.getElementById(search?.getAttribute('aria-activedescendant')??'');
      if(e.key==='Enter'&&selected?.matches('button[role="option"]'))binding.manual();
      else if((e.key==='Enter'||e.key===' ')&&(isModel||isReasoning))binding.manual();
      else if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&(!search||(search as HTMLInputElement).value==='')&&popup.querySelector('[aria-label="Reasoning"]'))binding.manual();
    }else if(isModel||isReasoning)binding.manual();
    sync();
  };
  form.addEventListener('pointerdown',pointer,true);form.addEventListener('click',click,true);
  form.addEventListener('keydown',key,true);form.addEventListener('submit',formSubmit,true);
  doc.addEventListener('click',manual,true);doc.addEventListener('keydown',manual,true);
  const focus=()=>{activeForm=form;sync();};form.addEventListener('focusin',focus);
  return ()=>{disposed=true;observer.disconnect();cleanupButton();if(activeForm===form)activeForm=null;
    form.removeEventListener('pointerdown',pointer,true);form.removeEventListener('click',click,true);
    form.removeEventListener('keydown',key,true);form.removeEventListener('submit',formSubmit,true);
    doc.removeEventListener('click',manual,true);doc.removeEventListener('keydown',manual,true);form.removeEventListener('focusin',focus);
  };
}

// DOM adapters are owned by BB's content-script lifecycle; composer slots supply
// the scope-bound SDK callbacks. Reload/unload removes all DOM work atomically.
const registrations = new Set<{ form: HTMLFormElement; binding: ComposerBinding; dispose?: () => void }>();
let scriptsMounted = false;
export function registerComposer(form: HTMLFormElement, binding: ComposerBinding): () => void {
  const entry = { form, binding, dispose: undefined as (() => void) | undefined };
  registrations.add(entry);
  if (scriptsMounted) entry.dispose = bindComposer(form, binding);
  return () => { entry.dispose?.(); registrations.delete(entry); };
}
export function mountComposerScripts(): () => void {
  scriptsMounted = true;
  for (const entry of registrations) entry.dispose = bindComposer(entry.form, entry.binding);
  return () => { scriptsMounted = false; for (const entry of registrations) { entry.dispose?.(); entry.dispose = undefined; } };
}
