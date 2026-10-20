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
const form={learner_full_name:'Synthetic Learner',learner_reference:'SYN501',current_grade:'Grade 2',grade_applied_for:'Grade 3',date_of_birth:'2018-05-12',gender:'Male',parent_full_name:'Synthetic Parent',parent_mobile:'0731234567',parent_whatsapp:'0731234567',physical_address:'123 Synthetic Street',returning:'Yes',declared_name:'Synthetic Parent',declaration_accepted:true};
const fixture=(registration={})=>({school_year:2027,deposit:{required:false,verified:true,proofs:[]},child,grades:[{id:3,name:'Grade 3'}],parents:[{id:10,first_name:'Synthetic',last_name:'Parent'}],registration:{definition_version:2,source:'portal',status:'not_started',status_label:'Not started',version:0,reference:null,form,read_only:false,...registration},email_updates:[]});
let container,root;
global.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(()=>{
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  jest.clearAllMocks();Object.defineProperty(global,'crypto',{configurable:true,value:{ randomUUID:()=> 'f1a714f8-19bd-4c18-a855-070cf9404edf' }});
  parentApi.mockResolvedValue(fixture());
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const render=async(component=<ParentReRegistration child={child}/>)=>{await act(async()=>root.render(component));const start=Array.from(container.querySelectorAll('button')).find(n=>n.textContent==='Re-register online');if(start) await act(async()=>start.click());};
const button=text=>Array.from(container.querySelectorAll('button')).find(node=>node.textContent===text||node.textContent.endsWith(text));
const click=async node=>act(async()=>node.click());
const change=async(selector,value)=>act(async()=>{
  const element=container.querySelector(selector);const prototype=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,value);element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));
});
test('shows clear returning-learner instructions, the real child reference and one-page download',async()=>{
  await render();expect(container.textContent).toContain('Keep your child’s place for next year');expect(container.textContent).toContain('SYN501');
  expect(button('Download form')).toBeTruthy();expect(container.textContent).toContain('For a child joining Harmony for the first time');
  expect(container.querySelector('#rr-learner_full_name').value).toBe('Synthetic Learner');expect(container.querySelector('#rr-learner_full_name').disabled).toBe(true);expect(container.querySelector('#rr-other_names')).toBeNull();
});
test('Save draft submits edits with the displayed version and does not submit for review',async()=>{
  parentApi.mockImplementation((path,options)=>Promise.resolve(options?fixture({status:'draft',status_label:'Draft',version:1,form:{...form,parent_mobile:'0731234568'}}):fixture()));
  await render();await change('#rr-parent_mobile','0731234568');await click(button('Save draft'));
  const [path,options]=parentApi.mock.calls.find(([,options])=>options);
  expect(path).toContain('/draft?child_id=501');expect(JSON.parse(options.body).form.parent_mobile).toBe('0731234568');expect(JSON.parse(options.body).version).toBe(0);
  expect(container.textContent).toContain('Draft saved');
});
test('Review & submit requires missing learner details before sending a request',async()=>{
  parentApi.mockResolvedValue(fixture({form:{}}));await render();await click(button('Submit re-registration'));
  expect(container.querySelector('[role="alert"]').textContent).toContain('Learner full name');expect(parentApi).toHaveBeenCalledTimes(1);
});
test('a successful submission shows receipt and status without claiming approval or delivered email',async()=>{
  parentApi.mockImplementation((path,options)=>Promise.resolve(options?{...fixture({status:'submitted',status_label:'Submitted',version:1,read_only:true,reference:'RR-2027-000001'}),email_updates:[{kind:'received',status:'queued'}]}:fixture()));
  await render();await click(button('Submit re-registration'));
  expect(container.textContent).toContain('Your re-registration has been received');expect(container.textContent).toContain('Queued');expect(container.textContent).toContain('Admin will review it');
  expect(button('Save draft')).toBeUndefined();expect(button('View submitted form')).toBeTruthy();
});
test('the declaration label toggles the real checkbox and unchecked forms cannot be submitted',async()=>{
  parentApi.mockResolvedValue(fixture({form:{...form,declaration_accepted:false}}));
  await render();const checkbox=container.querySelector('.rr-checkbox input[type="checkbox"]');
  expect(checkbox.checked).toBe(false);await click(button('Submit re-registration'));
  expect(container.querySelector('[role="alert"]').textContent).toContain('declaration');
  expect(parentApi.mock.calls.some(([,options])=>options)).toBe(false);
  await click(checkbox.closest('label').querySelector('span'));expect(checkbox.checked).toBe(true);
  await click(checkbox.closest('label').querySelector('span'));expect(checkbox.checked).toBe(false);
});
test('a parent without email sees the same confirmation and a changes-needed message can be corrected',async()=>{
  parentApi.mockResolvedValue({...fixture({status:'changes_needed',status_label:'Changes needed',version:2,review_note:'Please check the address.'}),email_updates:[{kind:'received',status:'skipped'}]});
  await render();expect(container.textContent).toContain('Please check the address.');expect(button('Save draft')).toBeTruthy();
});
test('another linked parent sees status without the private submitted form',async()=>{
  parentApi.mockResolvedValue(fixture({status:'submitted',status_label:'Submitted',form:null,read_only:true}));await render();
  expect(button('View submitted form')).toBeUndefined();expect(container.textContent).toContain('There is already a form for this child');expect(container.querySelector('#rr-learner_full_name')).toBeNull();
});
test('a server error retains edits and gives the parent a visible next step',async()=>{
  parentApi.mockImplementation((path,options)=>options?Promise.reject(new Error('Reload it before making changes.')):Promise.resolve(fixture()));
  await render();await change('#rr-parent_mobile','0731111111');await click(button('Save draft'));
  expect(container.querySelector('#rr-parent_mobile').value).toBe('0731111111');expect(container.querySelector('[role="alert"]').textContent).toContain('Reload');
});
test('a slow load for a previous child cannot reveal it after switching',async()=>{
  let finish;parentApi.mockImplementation(path=>path.endsWith('501')?new Promise(resolve=>{finish=resolve;}):Promise.resolve({...fixture(),child:{...child,id:502},registration:{...fixture().registration,form:{...form,learner_full_name:'Second child'}}}));
  await render();await render(<ParentReRegistration child={{...child,id:502}}/>);await act(async()=>finish(fixture()));
  expect(container.querySelector('#rr-learner_full_name').value).toBe('Second child');
});
const adminList={school_year:2027,counts:{submitted:1},total:1,page:1,has_more:false,grades:[{id:2,name:'Grade 2'}],registrations:[{...child,status:'submitted',status_label:'Submitted',reference:'RR-2027-000001'}]};
const adminFixture=()=>fixture({status:'submitted',status_label:'Submitted',version:1,read_only:true});
test('Admin list shows pending counts and approval requires explicit review confirmation',async()=>{
  api.request.mockImplementation(options=>Promise.resolve({data:options.url.includes('?')?adminList:adminFixture()}));
  await render(<ParentReRegistrationAdmin/>);expect(container.textContent).toContain('Submitted 1');await click(container.querySelector('.rr-list-row'));
  expect(button('Approve re-registration').disabled).toBe(true);await click(Array.from(container.querySelectorAll('input[type="checkbox"]')).at(-1));expect(button('Approve re-registration').disabled).toBe(false);
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
  expect(container.querySelector('#rr-parent').textContent).toContain('Synthetic Parent');await click(Array.from(container.querySelectorAll('input[type="checkbox"]')).at(-1));expect(button('Record paper form').disabled).toBe(false);
});

test('No response hides requested grade and payment undertaking',async()=>{
  await render();await change('#rr-returning','No');expect(container.querySelector('#rr-grade_applied_for')).toBeNull();expect(container.querySelector('#rr-nonreturn_reason')).toBeTruthy();expect(container.textContent).not.toContain('R500 non-refundable');
});
test('Admin cannot approve an unpaid registration even after reviewing the form',async()=>{
  api.request.mockImplementation(options=>Promise.resolve({data:options.url.includes('?')?adminList:{...adminFixture(),deposit:{required:true,verified:false,invoice_id:800,outstanding:500,amount_paid:0,pending_amount:0,proofs:[]}}}));
  await render(<ParentReRegistrationAdmin/>);await click(container.querySelector('.rr-list-row'));await click(Array.from(container.querySelectorAll('input[type="checkbox"]')).at(-1));expect(button('Approve re-registration').disabled).toBe(true);expect(button('Record deposit received')).toBeTruthy();
});
test('Parent sees bank reference and upload when a deposit is due',async()=>{
  parentApi.mockResolvedValue({...fixture({status:'submitted',status_label:'Awaiting deposit verification',read_only:true}),deposit:{required:true,verified:false,invoice_id:800,outstanding:500,amount_paid:0,pending_amount:0,proofs:[],bank:{bank:'FNB',holder:'Harmony Learning Institute',account:'63035320265',branch:'250655'}}});
  await render();expect(container.textContent).toContain('63035320265');expect(container.textContent).toContain('SYN501');await click(button('Upload proof of payment'));await click(button('Submit Proof of Payment'));expect(container.querySelector('[role="alert"]').textContent).toContain('Upload a PDF');
});

test.each(['not_open','closed'])('online forms cannot be edited when the registration window is %s',async phase=>{
  parentApi.mockResolvedValue({...fixture(),window:{is_open:false,phase,message:'11 December 2026 to 8 January 2027'}});
  await render();expect(button('Re-register online')).toBeUndefined();expect(button('Save draft')).toBeUndefined();expect(button('Submit re-registration')).toBeUndefined();
  expect(container.textContent).toContain('11 December 2026 to 8 January 2027');expect(button('Download form')).toBeTruthy();
});
