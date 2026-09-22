// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {bindComposer,findComposer} from './composer-adapter';
let cleanup=()=>{};
beforeEach(()=>{document.body.innerHTML='<form data-promptbox><div contenteditable="true"></div><button type="button" data-promptbox-submit-action aria-label="Send"></button><button type="button" aria-haspopup="dialog" aria-label="Provider, model and reasoning" aria-controls="picker" aria-expanded="false">Model</button><span id="anchor"></span></form>';});
afterEach(()=>{cleanup();document.body.innerHTML='';});
function fixture(){
 const form=document.querySelector('form')!,state={on:true,busy:false,running:false};
 const submit=vi.fn(async()=>{}),manual=vi.fn(()=>{state.on=false;});
 cleanup=bindComposer(form,{enabled:()=>state.on,busy:()=>state.busy,running:()=>state.running,selectAuto:()=>{state.on=true;},manual,submit});
 return {form,state,submit,manual,editor:form.querySelector('[contenteditable]')!,send:form.querySelector('[data-promptbox-submit-action]')!};
}
it('finds the correct composer from its mounted anchor',()=>{expect(findComposer(document.querySelector('#anchor')!)).toBe(document.querySelector('form'));});
it('intercepts Enter and send exactly once while classification is pending',async()=>{
 const f=fixture();f.editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));f.send.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
 expect(f.submit).toHaveBeenCalledTimes(1);
});
it('leaves newlines, IME and running-turn steering with BB',()=>{
 const f=fixture();for(const opts of [{shiftKey:true},{ctrlKey:true},{metaKey:true},{isComposing:true}])f.editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,...opts}));
 f.state.running=true;f.send.dispatchEvent(new MouseEvent('click',{bubbles:true}));expect(f.submit).not.toHaveBeenCalled();
});
it('never intercepts Stop or voice input',()=>{
 const f=fixture();for(const label of ['Stop run','Start voice input']){f.send.setAttribute('aria-label',label);f.send.dispatchEvent(new MouseEvent('click',{bubbles:true}));}expect(f.submit).not.toHaveBeenCalled();
});
async function openPicker(form:HTMLFormElement,search=false,providers=true){
 form.dispatchEvent(new Event('focusin',{bubbles:true}));
 form.querySelector('[aria-haspopup]')!.setAttribute('aria-expanded','true');
 const popup=document.createElement('div');popup.id='picker';popup.setAttribute('role','dialog');
 popup.innerHTML=`${providers?'<div class="providers"><button title="Codex">OpenAI</button><button title="Claude">Claude</button></div>':''}${search?'<div><input aria-label="Search models" aria-activedescendant="picker-opt-0"></div>':''}<div class="models"><div>Model</div><button id="picker-opt-0" ${search?'role="option"':''}>Astra</button><button id="picker-opt-1" ${search?'role="option"':''}>Luna</button><button id="picker-opt-2" aria-expanded="false">More models</button></div><div aria-label="Reasoning"><button aria-pressed="true">High</button><button>Low</button></div><button role="switch">Fast mode</button>`;
 document.body.append(popup);await new Promise(r=>setTimeout(r,0));return popup;
}
it.each([false,true])('offers Auto with search=%s; manual models override it and reopen stays manual',async(search)=>{
 const f=fixture(),popup=await openPicker(f.form,search);
 const auto=popup.querySelector<HTMLButtonElement>('[data-turn-router-toggle]')!;
 expect(auto.textContent).toBe('Auto');expect(auto.parentElement).toBe(popup.querySelector('.providers'));
 auto.click();expect(f.state.on).toBe(true); // Selecting Auto twice does not turn it off.
 popup.querySelector<HTMLButtonElement>('#picker-opt-1')!.click();expect(f.manual).toHaveBeenCalledOnce();expect(f.state.on).toBe(false);
 expect(auto.getAttribute('aria-pressed')).toBe('false');
 expect(f.form.querySelector('.turn-router-trigger-label')?.hasAttribute('hidden')).toBe(true);
 popup.remove();await new Promise(r=>setTimeout(r,0));
 const reopened=await openPicker(f.form,search);const again=reopened.querySelector<HTMLButtonElement>('[data-turn-router-toggle]')!;
 expect(again.getAttribute('aria-pressed')).toBe('false');again.click();expect(f.state.on).toBe(true);
 expect(f.form.querySelector('.turn-router-trigger-label')?.textContent).toBe('Auto');
 cleanup();expect(document.querySelector('[data-turn-router-toggle]')).toBeNull();expect(reopened.querySelector('.turn-router-header')).toBeNull();
});
it('supports one provider and manual reasoning without search',async()=>{
 const f=fixture(),popup=await openPicker(f.form,false,false);
 expect(popup.querySelector('[data-turn-router-toggle]')!.parentElement).toBe(popup.querySelector('.models > div'));
 popup.querySelector<HTMLButtonElement>('[aria-label="Reasoning"] button')!.click();expect(f.state.on).toBe(false);
});
it('does not leave Auto for More models, Fast mode, or provider previews',async()=>{
 const f=fixture(),popup=await openPicker(f.form);
 for(const selector of ['#picker-opt-2','[role=switch]','[title=Claude]'])popup.querySelector<HTMLButtonElement>(selector)!.click();
 expect(f.manual).not.toHaveBeenCalled();expect(f.state.on).toBe(true);
});
it('manual keyboard selections override Auto',async()=>{
 const f=fixture(),popup=await openPicker(f.form,true);
 popup.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));expect(f.state.on).toBe(false);
 f.state.on=true;popup.querySelector('[aria-label="Reasoning"] button')!.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));expect(f.state.on).toBe(false);
});
it('records a manual model choice after navigation even with generic picker markup',async()=>{
 const f=fixture(),popup=await openPicker(f.form);
 // A stale global active-form marker must not prevent the linked popup from
 // recording its own model selection.
 const other=f.form.cloneNode(true) as HTMLFormElement;document.body.append(other);
 const cleanupOther=bindComposer(other,{enabled:()=>true,busy:()=>false,running:()=>false,selectAuto:()=>{},manual:()=>{},submit:async()=>{}});
 other.dispatchEvent(new Event('focusin',{bubbles:true}));
 const generic=document.createElement('button');generic.textContent='Terra';popup.querySelector('.models')!.append(generic);
 generic.click();expect(f.manual).toHaveBeenCalledOnce();expect(f.state.on).toBe(false);
 cleanupOther();other.remove();
});
it('ignores unrelated dialogs and cleans up after closing the linked picker',async()=>{
 const f=fixture();f.form.dispatchEvent(new Event('focusin',{bubbles:true}));
 const unrelated=document.createElement('div');unrelated.innerHTML='<input aria-label="Search models">';document.body.append(unrelated);
 await new Promise(r=>setTimeout(r,0));expect(document.querySelector('[data-turn-router-toggle]')).toBeNull();
 const popup=await openPicker(f.form);expect(popup.querySelector('[data-turn-router-toggle]')).not.toBeNull();
 f.form.querySelector('[aria-haspopup]')!.setAttribute('aria-expanded','false');await new Promise(r=>setTimeout(r,0));expect(popup.querySelector('[data-turn-router-toggle]')).toBeNull();
});
it('does not route when Auto is off, and releases handlers on reload',()=>{
 const f=fixture();f.state.on=false;f.send.dispatchEvent(new MouseEvent('click',{bubbles:true}));expect(f.submit).not.toHaveBeenCalled();
 f.state.on=true;cleanup();f.send.dispatchEvent(new MouseEvent('click',{bubbles:true}));expect(f.submit).not.toHaveBeenCalled();
});
