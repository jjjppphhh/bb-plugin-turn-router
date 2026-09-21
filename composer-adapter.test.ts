// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {bindComposer,findComposer} from './composer-adapter';
let cleanup=()=>{};
beforeEach(()=>{document.body.innerHTML='<form data-promptbox><div contenteditable="true"></div><button type="button" data-promptbox-submit-action aria-label="Send"></button><button type="button" aria-haspopup="dialog">Model</button><span id="anchor"></span></form>';});
afterEach(()=>{cleanup();document.body.innerHTML='';});
function fixture(){
 const form=document.querySelector('form')!,state={on:true,busy:false,running:false};
 const submit=vi.fn(async()=>{}),manual=vi.fn(()=>{state.on=false;});
 cleanup=bindComposer(form,{enabled:()=>state.on,busy:()=>state.busy,running:()=>state.running,toggle:()=>{state.on=!state.on;},manual,submit});
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
it('puts Auto at the right of model search, honours manual selection and cleans up',async()=>{
 const f=fixture();f.form.dispatchEvent(new Event('focusin',{bubbles:true}));
 const popup=document.createElement('div');popup.setAttribute('role','dialog');popup.innerHTML='<div><div class="relative"><input aria-label="Search models"></div></div><button role="option">Astra</button>';document.body.append(popup);
 await new Promise(r=>setTimeout(r,0));
 const toggle=popup.querySelector<HTMLButtonElement>('[data-turn-router-toggle]')!;expect(toggle.textContent).toBe('Auto on');expect(toggle.parentElement).toBe(popup.querySelector('input')!.parentElement);
 toggle.click();expect(f.state.on).toBe(false);toggle.click();expect(f.state.on).toBe(true);
 popup.querySelector<HTMLButtonElement>('[role=option]')!.click();expect(f.manual).toHaveBeenCalledOnce();expect(f.state.on).toBe(false);
 cleanup();expect(document.querySelector('[data-turn-router-toggle]')).toBeNull();expect(popup.querySelector('input')!.style.paddingRight).toBe('');
});
it('does not route when Auto is off, and releases handlers on reload',()=>{
 const f=fixture();f.state.on=false;f.send.dispatchEvent(new MouseEvent('click',{bubbles:true}));expect(f.submit).not.toHaveBeenCalled();
 f.state.on=true;cleanup();f.send.dispatchEvent(new MouseEvent('click',{bubbles:true}));expect(f.submit).not.toHaveBeenCalled();
});
