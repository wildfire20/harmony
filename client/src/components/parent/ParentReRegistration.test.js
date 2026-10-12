import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ParentReRegistration from './ParentReRegistration';
import ParentReRegistrationAdmin from '../admin/ParentReRegistrationAdmin';
import { parentApi } from './ParentPortal';
import api from '../../services/api';
jest.mock('./ParentPortal', () => ({ parentApi:jest.fn(),refreshParentAccess:jest.fn() }));
jest.mock('../../services/api',()=>({__esModule:true,default:{request:jest.fn(),get:jest.fn()}}));
jest.mock('../../contexts/AuthContext',()=>({useAuth:()=>({user:{id:1},isAdmin:true})}));
jest.mock('react-query',()=>({useQueryClient:()=>({invalidateQueries:jest.fn()})}));
const child={id:501,first_name:'Synthetic',last_name:'Learner',student_number:'SYN501',grade_name:'Grade 2'};
const form={grade_applied_for:'Grade 3',first_name:'Synthetic',surname:'Learner',date_of_birth:'2018-05-12',physical_address:'123 Synthetic Street',city_suburb:'Town',emergency_telephone:'0731234568',boarder:'No',parent_first_name:'Synthetic',parent_surname:'Parent',relationship:'Mother',parent_mobile:'0731234567',declared_name:'Synthetic Parent',declaration_accepted:true};
const fixture=(registration={})=>({school_year:2027,child,grades:[{id:3,name:'Grade 3'}],parents:[{id:10,first_name:'Synthetic',last_name:'Parent'}],registration:{source:'portal',status:'not_started',status_label:'Not started',version:0,reference:null,form,read_only:false,...registration},email_updates:[]});
let container,root;
global.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(()=>{
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  jest.clearAllMocks();Object.defineProperty(global,'crypto',{configurable:true,value:{ randomUUID:()=> 'f1a714f8-19bd-4c18-a855-070cf9404edf' }});
  parentApi.mockResolvedValue(fixture());
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const render=async(component=<ParentReRegistration child={child}/>)=>act(async()=>root.render(component));
const button=text=>Array.from(container.querySelectorAll('button')).find(node=>node.textContent===text||node.textContent.endsWith(text));
const click=async node=>act(async()=>node.click());
const change=async(selector,value)=>act(async()=>{
  const element=container.querySelector(selector);const prototype=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,value);element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));
});
test('shows clear returning-learner instructions, the real child reference and both-page download',async()=>{
  await render();expect(container.textContent).toContain('Keep your child’s place for next year');expect(container.textContent).toContain('SYN501');
  expect(button('Download both pages')).toBeTruthy();expect(container.textContent).toContain('For a child joining Harmony for the first time');
  expect(container.querySelector('#rr-first_name').value).toBe('Synthetic');
  expect(container.querySelector('details').open).toBe(false);expect(container.querySelector('details #rr-other_names')).toBeTruthy();
});
test('Save draft submits edits with the displayed version and does not submit for review',async()=>{
  parentApi.mockImplementation((path,options)=>Promise.resolve(options?fixture({status:'draft',status_label:'Draft',version:1,form:{...form,first_name:'Changed'}}):fixture()));
  await render();await change('#rr-first_name','Changed');await click(button('Save draft'));
  const [path,options]=parentApi.mock.calls.find(([,options])=>options);
  expect(path).toContain('/draft?child_id=501');expect(JSON.parse(options.body).form.first_name).toBe('Changed');expect(JSON.parse(options.body).version).toBe(0);
  expect(container.textContent).toContain('Draft saved');
});
test('Review & submit requires missing learner details before sending a request',async()=>{
  parentApi.mockResolvedValue(fixture({form:{}}));await render();await click(button('Review & submit'));await click(button('Submit re-registration'));
  expect(container.querySelector('[role="alert"]').textContent).toContain('Grade requested for 2027');expect(parentApi).toHaveBeenCalledTimes(1);
});
test('a successful submission shows receipt and status without claiming approval or delivered email',async()=>{
  parentApi.mockImplementation((path,options)=>Promise.resolve(options?{...fixture({status:'submitted',status_label:'Submitted',version:1,read_only:true,reference:'RR-2027-000001'}),email_updates:[{kind:'received',status:'queued'}]}:fixture()));
  await render();await click(button('Review & submit'));await click(button('Submit re-registration'));
  expect(container.textContent).toContain('Your re-registration has been received');expect(container.textContent).toContain('Queued');expect(container.textContent).toContain('Admin will review it');
  expect(button('Save draft')).toBeUndefined();expect(button('View submitted form')).toBeTruthy();
});
test('a parent without email sees the same confirmation and a changes-needed message can be corrected',async()=>{
  parentApi.mockResolvedValue({...fixture({status:'changes_needed',status_label:'Changes needed',version:2,review_note:'Please check the address.'}),email_updates:[{kind:'received',status:'skipped'}]});
  await render();expect(container.textContent).toContain('Please check the address.');expect(button('Save draft')).toBeTruthy();
});
test('another linked parent sees status without the private submitted form',async()=>{
  parentApi.mockResolvedValue(fixture({status:'submitted',status_label:'Submitted',form:null,read_only:true}));await render();
  expect(button('View submitted form')).toBeUndefined();expect(container.textContent).toContain('There is already a form for this child');expect(container.querySelector('#rr-first_name')).toBeNull();
});
test('a server error retains edits and gives the parent a visible next step',async()=>{
  parentApi.mockImplementation((path,options)=>options?Promise.reject(new Error('Reload it before making changes.')):Promise.resolve(fixture()));
  await render();await change('#rr-first_name','Unsaved');await click(button('Save draft'));
  expect(container.querySelector('#rr-first_name').value).toBe('Unsaved');expect(container.querySelector('[role="alert"]').textContent).toContain('Reload');
});
test('a slow load for a previous child cannot show that child’s private form after switching',async()=>{
  let finish;parentApi.mockImplementation(path=>path.endsWith('501')?new Promise(resolve=>{finish=resolve;}):Promise.resolve(fixture({form:{...form,first_name:'Second child'}})));
  await render();await render(<ParentReRegistration child={{...child,id:502}}/>);await act(async()=>finish(fixture()));
  expect(container.querySelector('#rr-first_name').value).toBe('Second child');
});
const adminList={school_year:2027,counts:{submitted:1},total:1,page:1,has_more:false,grades:[{id:2,name:'Grade 2'}],registrations:[{...child,status:'submitted',status_label:'Submitted',reference:'RR-2027-000001'}]};
const adminFixture=()=>fixture({status:'submitted',status_label:'Submitted',version:1,read_only:true});
test('Admin list shows pending counts and approval requires explicit review confirmation',async()=>{
  api.request.mockImplementation(options=>Promise.resolve({data:options.url.includes('?')?adminList:adminFixture()}));
  await render(<ParentReRegistrationAdmin/>);expect(container.textContent).toContain('Submitted 1');await click(container.querySelector('.rr-list-row'));
  expect(button('Approve re-registration').disabled).toBe(true);await click(container.querySelector('input[type="checkbox"]'));expect(button('Approve re-registration').disabled).toBe(false);
  api.request.mockImplementation(options=>Promise.resolve({data:options.method==='POST'?fixture({status:'approved',status_label:'Approved',version:2,read_only:true}):adminList}));
  await click(button('Approve re-registration'));const call=api.request.mock.calls.find(([options])=>options.method==='POST')[0];expect(call.data.review_confirmed).toBe(true);expect(call.data.action).toBe('approve');
  expect(container.textContent).toContain('Re-registration approved.');
});
test('Admin cannot request changes without a message explaining the correction',async()=>{
  api.request.mockImplementation(options=>Promise.resolve({data:options.url.includes('?')?adminList:adminFixture()}));await render(<ParentReRegistrationAdmin/>);await click(container.querySelector('.rr-list-row'));
  expect(button('Request changes').disabled).toBe(true);await change('#rr-note','Please check the mobile number.');expect(button('Request changes').disabled).toBe(false);
});
test('recording a paper form requires a signed-form confirmation and only lists linked parents',async()=>{
  api.request.mockImplementation(options=>Promise.resolve({data:options.url.includes('?')?{...adminList,registrations:[{...child,status:'not_started',status_label:'Not started'}]}:fixture({form:null})}));
  await render(<ParentReRegistrationAdmin/>);await click(container.querySelector('.rr-list-row'));expect(button('Record paper form').disabled).toBe(true);
  expect(container.querySelector('#rr-parent').textContent).toContain('Synthetic Parent');await click(container.querySelector('input[type="checkbox"]'));expect(button('Record paper form').disabled).toBe(false);
});
