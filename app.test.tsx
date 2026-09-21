// @vitest-environment jsdom
import React from 'react';
import {render,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({api:null as any,view:null as any,route:vi.fn(),toThread:vi.fn()}));
vi.mock('@get-bb/plugin-sdk/app',()=>({definePluginApp:()=>({}),useComposer:()=>mock.api,useComposerView:()=>mock.view,useRpc:()=>({call:mock.route}),useBbNavigate:()=>({toThread:mock.toThread})}));
import {RoutingControl,CostTable} from './app';
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
function mount(){return render(<form data-promptbox><div contentEditable data-testid="editor"/><button type="submit" data-promptbox-submit-action aria-label="Send">Send</button><button type="button" aria-label="Provider, model and reasoning" aria-expanded="true" aria-controls="test-picker">Model</button><div id="test-picker" role="dialog"><div><div>Model</div><button type="button" id="test-opt-0">Luna</button></div></div><RoutingControl/></form>);}
it('applies a same-provider selection before submitting through the native composer',async()=>{
 const ui=mount();fireEvent.click(ui.getByLabelText('Send'));await waitFor(()=>expect(mock.api.experimental_submit).toHaveBeenCalledOnce());
 expect(mock.route).toHaveBeenCalledWith('route',expect.objectContaining({threadId:'thread',text:'Change the button label.',providerId:'codex'}));
 expect(mock.api.experimental_setSelection.mock.calls).toContainEqual([{model:'gpt-5.6-luna',reasoningLevel:'medium'}]);
 const applied=mock.api.experimental_setSelection.mock.calls.findIndex((call:any[])=>call[0]?.model==='gpt-5.6-luna');
 expect(mock.api.experimental_submit.mock.invocationCallOrder[0]).toBeGreaterThan(mock.api.experimental_setSelection.mock.invocationCallOrder[applied]);
 expect(ui.getByRole('status').textContent).toBe('Auto · 5.6-Luna · Medium');
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

it('persists manual selection across remount and only resumes routing after selecting Auto',async()=>{
 const ui=mount();fireEvent.focus(ui.getByTestId('editor'));
 await waitFor(()=>expect(ui.getByLabelText('Auto: choose model and reasoning for each turn')).toBeTruthy());
 fireEvent.click(ui.getByText('Luna'));expect(localStorage.getItem('turn-router:thread')).toBe('off');
 ui.unmount();const remounted=mount();fireEvent.focus(remounted.getByTestId('editor'));
 await waitFor(()=>expect(remounted.getByLabelText('Auto: choose model and reasoning for each turn').getAttribute('aria-pressed')).toBe('false'));
 fireEvent.click(remounted.getByLabelText('Auto: choose model and reasoning for each turn'));
 expect(localStorage.getItem('turn-router:thread')).toBe('on');
 fireEvent.click(remounted.getByLabelText('Send'));await waitFor(()=>expect(mock.api.experimental_submit).toHaveBeenCalledOnce());
});
it('does not overwrite a manual selection made while classification is pending',async()=>{
 let finish!:(value:any)=>void;mock.route.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const ui=mount();fireEvent.focus(ui.getByTestId('editor'));
 await waitFor(()=>expect(ui.getByLabelText('Auto: choose model and reasoning for each turn')).toBeTruthy());
 fireEvent.click(ui.getByLabelText('Send'));await waitFor(()=>expect(mock.route).toHaveBeenCalled());
 fireEvent.click(ui.getByText('Luna'));finish({model:'gpt-6-astra',reasoningLevel:'max'});
 await waitFor(()=>expect(ui.getByRole('status').textContent).toContain('Manual selection kept'));
 expect(mock.api.experimental_setSelection.mock.calls.some((call:any[])=>call[0]?.model==='gpt-6-astra')).toBe(false);expect(mock.api.experimental_submit).not.toHaveBeenCalled();
});
it('offers a lower-model side thread without sending or changing the main thread',async()=>{
 mock.route.mockResolvedValueOnce({model:'gpt-6-astra',reasoningLevel:'high',reason:'Keep context.',source:'retained',score:51,estimatedCost:1.73,delegate:{model:'gpt-5.6-luna',reasoningLevel:'low',reason:'Bounded task.'}});
 const ui=mount();fireEvent.click(ui.getByLabelText('Send'));
 const open=await ui.findByRole('button',{name:'Open in 5.6-Luna · Low'});
 expect(mock.api.experimental_submit).not.toHaveBeenCalled();
 mock.route.mockResolvedValueOnce({threadId:'side-thread'});fireEvent.click(open);fireEvent.click(open);
 await waitFor(()=>expect(mock.toThread).toHaveBeenCalledWith('side-thread'));
 expect(mock.route.mock.calls.filter(([method])=>method==='openSideThread')).toHaveLength(1);
});
it('applies the main-thread reasoning choice before keeping delegated work here',async()=>{
 mock.route.mockResolvedValueOnce({model:'gpt-6-astra',reasoningLevel:'medium',reason:'Keep context.',source:'retained',score:50,estimatedCost:1.54,delegate:{model:'gpt-5.6-luna',reasoningLevel:'low',reason:'Bounded task.'}});
 const ui=mount();fireEvent.click(ui.getByLabelText('Send'));fireEvent.click(await ui.findByRole('button',{name:'Keep in This Thread'}));
 await waitFor(()=>expect(mock.api.experimental_submit).toHaveBeenCalledOnce());
 expect(mock.api.experimental_setSelection.mock.calls).toContainEqual([{model:'gpt-6-astra',reasoningLevel:'medium'}]);
});
it('withdraws a side-thread offer after a manual picker selection',async()=>{
 mock.route.mockResolvedValueOnce({model:'gpt-6-astra',reasoningLevel:'high',reason:'Keep context.',source:'retained',score:51,estimatedCost:1.73,delegate:{model:'gpt-5.6-luna',reasoningLevel:'low',reason:'Bounded task.'}});
 const ui=mount();fireEvent.focus(ui.getByTestId('editor'));fireEvent.click(ui.getByLabelText('Send'));await ui.findByRole('button',{name:'Open in 5.6-Luna · Low'});
 fireEvent.click(ui.getByText('Luna'));await waitFor(()=>expect(ui.queryByRole('button',{name:'Open in 5.6-Luna · Low'})).toBeNull());
});
it('shows Astra and its measured costs in the settings cost table',()=>{
 const ui=render(<CostTable/>);expect(ui.getByRole('columnheader',{name:'6-Astra'})).toBeTruthy();
 expect(ui.getByText('$0.82')).toBeTruthy();expect(ui.getByText('$3.26')).toBeTruthy();
});
