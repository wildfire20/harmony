import React from 'react';
import ReactDOM from 'react-dom/client';
import {act} from 'react-dom/test-utils';
import api from '../../services/api';
import CompletedReRegistrationActions from './CompletedReRegistrationActions';
jest.mock('../../services/api',()=>({__esModule:true,default:{get:jest.fn()}}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let container,root,open,anchorClick;
const registration={source:'portal',submitted_at:'2026-11-20T10:00:00Z',version:3,reference:'RR-2027-000001'};
const render=async(props={})=>act(async()=>root.render(<CompletedReRegistrationActions childId={501} registration={registration} {...props}/>));
const button=name=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent===name);
const click=async name=>act(async()=>button(name).click());
beforeEach(()=>{container=document.createElement('div');document.body.appendChild(container);root=ReactDOM.createRoot(container);
 api.get.mockReset();api.get.mockResolvedValue({data:new Blob(['%PDF-1.4'],{type:'application/pdf'})});
 URL.createObjectURL=jest.fn(()=> 'blob:synthetic-completed-form');URL.revokeObjectURL=jest.fn();
 open=jest.spyOn(window,'open');anchorClick=jest.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();jest.restoreAllMocks();});
test('downloads the exact learner and viewed version as a completed PDF',async()=>{
 await render();await click('Download completed form');
 expect(api.get).toHaveBeenCalledWith('/parent/re-registration/admin/501/completed-form?version=3',{responseType:'blob'});
 expect(anchorClick).toHaveBeenCalledTimes(1);expect(open).not.toHaveBeenCalled();expect(container.textContent).toContain('Completed form downloaded');
});
test('print opens the completed PDF and never prints the dashboard window',async()=>{
 const target={opener:{},closed:false,location:{replace:jest.fn()},addEventListener:jest.fn(),focus:jest.fn(),print:jest.fn(),close:jest.fn()};open.mockReturnValue(target);
 const pagePrint=jest.spyOn(window,'print').mockImplementation(()=>{});
 await render();await click('Print completed form');expect(target.location.replace).toHaveBeenCalledWith('blob:synthetic-completed-form');
 const onLoad=target.addEventListener.mock.calls[0][1];onLoad();expect(target.print).toHaveBeenCalledTimes(1);expect(pagePrint).not.toHaveBeenCalled();expect(target.opener).toBe(null);
});
test('blocked print tabs have a clear download alternative',async()=>{
 open.mockReturnValue(null);await render();await click('Print completed form');expect(api.get).not.toHaveBeenCalled();expect(container.querySelector('[role="alert"]').textContent).toContain('Allow pop-ups');
});
test('a delayed previous learner response cannot download or expose the wrong form',async()=>{
 let finish;api.get.mockReturnValue(new Promise(resolve=>{finish=resolve;}));await render();await click('Download completed form');
 await render({childId:502,registration:{...registration,reference:'RR-2027-000002'}});
 await act(async()=>finish({data:new Blob(['%PDF'],{type:'application/pdf'})}));expect(anchorClick).not.toHaveBeenCalled();expect(URL.createObjectURL).not.toHaveBeenCalled();
});
test('drafts and paper receipts do not offer a completed online download',async()=>{
 await render({registration:{...registration,submitted_at:null}});expect(container.querySelector('button')).toBe(null);
 await render({registration:{...registration,source:'paper'}});expect(container.querySelector('button')).toBe(null);
});
test('failed downloads show the server refresh instruction and close an empty print tab',async()=>{
 const target={closed:false,close:jest.fn()};open.mockReturnValue(target);
 api.get.mockRejectedValue(new Error('This form has changed. Refresh the learner before downloading.'));
 await render();await click('Print completed form');expect(target.close).toHaveBeenCalled();expect(container.querySelector('[role="alert"]').textContent).toContain('Refresh the learner');
});
