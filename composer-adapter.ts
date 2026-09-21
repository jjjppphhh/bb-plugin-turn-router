/** Minimal DOM bridge for the picker header; model mutation/submission stay on BB's SDK. */
export interface ComposerBinding {
  enabled(): boolean; busy(): boolean; running(): boolean;
  toggle(): void; manual(): void; submit(): Promise<void>;
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
  let toggle:HTMLButtonElement|null=null, search:HTMLInputElement|null=null, oldPadding='';
  let pending=false,disposed=false;
  const cleanupButton=()=>{toggle?.remove();toggle=null;if(search)search.style.paddingRight=oldPadding;search=null;};
  const sync=()=>{
    if(disposed||activeForm!==form)return;
    const next=doc.querySelector<HTMLInputElement>('input[aria-label="Search models"]');
    if(!next){cleanupButton();return;}
    if(search!==next){cleanupButton();search=next;oldPadding=next.style.paddingRight;next.style.paddingRight='88px';
      toggle=doc.createElement('button');toggle.type='button';toggle.className='turn-router-toggle';toggle.dataset.turnRouterToggle='';
      toggle.addEventListener('pointerdown',e=>e.stopPropagation());
      toggle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();binding.toggle();sync();});
      next.parentElement?.append(toggle);
    }
    const enabled=binding.enabled();
    const label=binding.busy()?'Rating…':enabled?'Auto on':'Auto off';
    // Avoid an observer feedback loop by changing DOM only when needed.
    if(toggle?.textContent!==label)toggle!.textContent=label;
    if(toggle?.getAttribute('aria-pressed')!==String(enabled))toggle!.setAttribute('aria-pressed',String(enabled));
    toggle?.setAttribute('aria-label','Automatically choose model and reasoning for each turn');
    toggle!.title='Turn Router · Codex only. A manual model selection turns Auto off.';
  };
  const observer=new MutationObserver(sync);observer.observe(doc.body,{subtree:true,childList:true});
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
    if(form.contains(e.target as Node))activeForm=form;
    if(e instanceof MouseEvent&&(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey))return;
    if(canRoute()&&isSubmit(e.target))stop(e); // Prevent native pointer/touch submit before rating.
  };
  const click=(e:Event)=>{if(e instanceof MouseEvent&&(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey))return;if(canRoute()&&isSubmit(e.target)){stop(e);submit();}};
  const formSubmit=(e:Event)=>{if(canRoute()){stop(e);submit();}};
  const key=(e:KeyboardEvent)=>{
    if(form.contains(e.target as Node))activeForm=form;
    const target=e.target instanceof Element?e.target:null;
    if(!canRoute()||e.key!=='Enter'||e.shiftKey||e.altKey||e.ctrlKey||e.metaKey||e.isComposing||!target?.closest('[contenteditable="true"]'))return;
    // Enter may accept an @mention/slash-command or IME suggestion rather than send.
    if(target.getAttribute('enterkeyhint')==='enter'||target.getAttribute('aria-activedescendant')||doc.querySelector('[role="listbox"], [data-mention-menu]'))return;
    stop(e);submit();
  };
  const manual=(e:Event)=>{
    if(activeForm!==form||!search||!binding.enabled())return;
    const target=e.target instanceof Element?e.target:null;
    if(target?.closest('[data-turn-router-toggle]'))return;
    const popup=search.closest('[role="dialog"]')??search.parentElement?.parentElement?.parentElement;
    if(!popup?.contains(target))return;
    if(e instanceof KeyboardEvent){if(e.key==='Enter'&&search.getAttribute('aria-activedescendant'))binding.manual();}
    else if(target?.closest('[role="option"], [role="menuitem"], [role="radio"]'))binding.manual();
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
