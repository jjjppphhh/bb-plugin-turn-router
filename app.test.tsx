// @vitest-environment jsdom
import React from 'react';
import {render,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({api:null as any,view:null as any,route:vi.fn()}));
vi.mock('@get-bb/plugin-sdk/app',()=>({definePluginApp:()=>({}),useComposer:()=>mock.api,useComposerView:()=>mock.view,useRpc:()=>({call:mock.route})}));
import {RoutingControl} from './app';
import {mountComposerScripts} from './composer-adapter';
let release=()=>{};
beforeEach(()=>{
 localStorage.clear();vi.clearAllMocks();
 vi.stubGlobal('requestAnimationFrame',(cb:()=>void)=>setTimeout(cb,0));
 const original={providerId:'codex',model:'gpt-6-astra',reasoningLevel:'high',environment:{type:'reuse',environmentId:'env'},serviceTier:'default',permissionMode:'auto'};
 mock.api={text:'Change the button label.',setInputLock:vi.fn(),experimental_setSelection:vi.fn(async(patch:object)=>({...original,...patch})),experimental_submit:vi.fn(async()=>{})};
 mock.view={scope:{kind:'thread',threadId:'thread'},draft:{text:mock.api.text,isEmpty:false,attachmentCount:0},run:{isRunning:false,isSubmitting:false},layout:'expanded'};
 mock.route.mockResolvedValue({model:'gpt-5.6-luna',reasoningLevel:'medium',reason:'Small tweak.',source:'measured',score:25,estimatedCost:.02});
 release=mountComposerScripts();
});
afterEach(()=>{cleanup();release();vi.unstubAllGlobals();});
function mount(){return render(<form data-promptbox><div contentEditable data-testid="editor"/><button type="submit" data-promptbox-submit-action aria-label="Send">Send</button><RoutingControl/></form>);}
it('applies a same-provider selection before submitting through the native composer',async()=>{
 const ui=mount();fireEvent.click(ui.getByLabelText('Send'));await waitFor(()=>expect(mock.api.experimental_submit).toHaveBeenCalledOnce());
 expect(mock.route).toHaveBeenCalledWith('route',expect.objectContaining({threadId:'thread',text:'Change the button label.',providerId:'codex'}));
 expect(mock.api.experimental_setSelection.mock.calls).toEqual([[{}],[{model:'gpt-5.6-luna',reasoningLevel:'medium'}]]);
 expect(mock.api.experimental_submit.mock.invocationCallOrder[0]).toBeGreaterThan(mock.api.experimental_setSelection.mock.invocationCallOrder[1]);
 expect(mock.api.setInputLock).toHaveBeenLastCalledWith(false);
});
it('leaves the draft intact if classification fails',async()=>{
 mock.route.mockRejectedValue(new Error('No catalog'));const ui=mount();fireEvent.click(ui.getByLabelText('Send'));
 await waitFor(()=>expect(ui.getByRole('status').textContent).toBe('No catalog'));
 expect(mock.api.experimental_submit).not.toHaveBeenCalled();expect(mock.api.text).toBe('Change the button label.');expect(mock.api.setInputLock).toHaveBeenLastCalledWith(false);
});
it('does not silently accept a reconciled model that differs from the route',async()=>{
 mock.api.experimental_setSelection.mockImplementation(async()=>({providerId:'codex',model:'gpt-6-astra',reasoningLevel:'high'}));
 const ui=mount();fireEvent.click(ui.getByLabelText('Send'));await waitFor(()=>expect(ui.getByRole('status').textContent).toContain('could not apply'));
 expect(mock.api.experimental_submit).not.toHaveBeenCalled();
});
it('cancels pending submission when the composer unmounts',async()=>{
 let finish!:(value:any)=>void;mock.route.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const ui=mount();fireEvent.click(ui.getByLabelText('Send'));await waitFor(()=>expect(mock.route).toHaveBeenCalled());ui.unmount();
 finish({model:'gpt-5.6-luna',reasoningLevel:'medium'});await new Promise(r=>setTimeout(r,0));expect(mock.api.experimental_submit).not.toHaveBeenCalled();
});
