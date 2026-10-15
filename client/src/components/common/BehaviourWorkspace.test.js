import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import BehaviourWorkspace from './BehaviourWorkspace';
const child={id:501,first_name:'Synthetic',last_name:'Learner',student_number:'TEST501',grade_name:'Grade 2'};
const types=[{id:1,code:'M001',kind:'merit',label:'Helped clean the classroom',category:null,points:null,is_active:true,version:1},
  {id:2,code:'1001',kind:'demerit',label:'Homework incomplete',category:1,points:2,is_active:true,version:1},
  {id:3,code:'4002',kind:'demerit',label:'Serious assault',category:4,points:20,is_active:true,version:1},
  {id:4,code:'M002',kind:'merit',label:'Inactive test type',category:null,points:null,is_active:false,version:1}];
const record={id:9,type_code:'1001',kind:'demerit',label:'Homework incomplete',category:1,points:2,event_date:'2026-10-14',notes:'Bring the completed work tomorrow.',status:'active',recorded_by_name:'Synthetic Teacher',can_void:true};
const result=records=>({learner:child,summary:{merits:3,demerits:1,demerit_points:2},records:records||[record],page:1,has_more:false});
let container,root,request;
global.IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  let next=0;Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=>`00000000-0000-4000-8000-${String(++next).padStart(12,'0')}`}});
  request=jest.fn(async(path,opts)=>path==='/catalogue'?{types}:path.startsWith('/learners')?{learners:[child]}:opts?.method?{id:10}:result());
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const render=async props=>act(async()=>root.render(<BehaviourWorkspace request={request} {...props}/>));
const button=label=>[...container.querySelectorAll('button')].find(b=>b.textContent===label);
const click=async node=>act(async()=>node.click());
const change=async(selector,value)=>act(async()=>{
  const element=container.querySelector(selector);const proto=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));
});
const chooseLearner=async()=>{
  await change('input[type="search"]','TEST501');await act(async()=>new Promise(resolve=>setTimeout(resolve,330)));
  await click([...container.querySelectorAll('.behaviour-search-results button')][0]);
};
const submit=async()=>act(async()=>container.querySelector('form.behaviour-card').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
test('parents see their selected child and separate totals, with no editing controls',async()=>{
  await render({readOnly:true,parentChild:child});
  expect(request.mock.calls[0][0]).toContain('student_id=501');expect(container.textContent).toContain('TEST501');
  expect(container.querySelectorAll('.behaviour-summary strong')[0].textContent).toBe('3');
  expect(container.querySelectorAll('.behaviour-summary strong')[2].textContent).toBe('2');
  expect(button('Manage types')).toBeUndefined();expect(button('Save record')).toBeUndefined();expect(button('Correct entry')).toBeUndefined();
  expect(container.textContent).toContain('Synthetic Teacher');expect(container.textContent).toContain(record.notes);
});
test('a Parent account with no selected child makes no learner request',async()=>{
  await render({readOnly:true,parentChild:null});expect(request).not.toHaveBeenCalled();expect(container.textContent).toContain('Select a linked child');
});
test('late responses from a previous child are ignored',async()=>{
  let resolveOld;request.mockImplementation(path=>path.includes('student_id=501')?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve(result([{...record,label:'Second child record'}])));
  await render({readOnly:true,parentChild:child});await render({readOnly:true,parentChild:{...child,id:503,first_name:'Sibling'}});
  expect(container.textContent).toContain('Second child record');
  await act(async()=>resolveOld(result([{...record,label:'Old child secret'}])));
  expect(container.textContent).not.toContain('Old child secret');expect(container.textContent).toContain('Second child record');
});
test('teachers have learner search and record forms, but no catalogue management',async()=>{
  await render({role:'teacher'});await chooseLearner();
  expect(button('Manage types')).toBeUndefined();expect(button('Save record')).toBeTruthy();
  expect([...container.querySelectorAll('option')].some(n=>n.textContent.includes('Inactive test type'))).toBe(false);
});
test('a double submit sends a single record with exact learner and selected type, not client points',async()=>{
  await render({role:'teacher'});await chooseLearner();await change('form.behaviour-card select[required]','1');
  await change('form.behaviour-card textarea','A useful positive classroom contribution.');
  await act(async()=>{const f=container.querySelector('form.behaviour-card');f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  const posts=request.mock.calls.filter(([,opts])=>opts?.method==='POST');expect(posts).toHaveLength(1);
  expect(posts[0][1].body).toMatchObject({student_id:501,type_id:1,notes:'A useful positive classroom contribution.'});
  expect(posts[0][1].body.points).toBeUndefined();expect(container.textContent).toContain('Record saved');
});
test('an uncertain save can be retried with the same request key',async()=>{
  const original=request.getMockImplementation();let first=true;
  request.mockImplementation((path,opts)=>{if(opts?.method==='POST'&&first){first=false;return Promise.reject(new Error('Connection interrupted'));}return original(path,opts);});
  await render({role:'teacher'});await chooseLearner();await change('form.behaviour-card select[required]','1');
  await submit();expect(container.textContent).toContain('Connection interrupted');await submit();
  const posts=request.mock.calls.filter(([,opts])=>opts?.method==='POST');expect(posts).toHaveLength(2);expect(posts[0][1].body.request_key).toBe(posts[1][1].body.request_key);
});
test('serious incidents show an Admin review notice without an automatic punishment action',async()=>{
  await render({role:'teacher'});await chooseLearner();await change('form.behaviour-card select:not([required])','demerit');await change('form.behaviour-card select[required]','3');
  expect(container.textContent).toContain('serious incident requiring Admin review');expect(container.textContent).not.toContain('Expel learner');
});
test('Admin can manage types while existing learner records keep their snapshot descriptions',async()=>{
  await render({role:'admin'});await click(button('Manage types'));await click(button('Edit type 1001'));
  expect(container.textContent).toContain('School behaviour types');expect(container.textContent).toContain('Changes apply to future records');expect(button('Save type')).toBeTruthy();
});
test('corrected records remain visible and are clearly excluded from totals',async()=>{
  request.mockResolvedValue(result([{...record,status:'voided',void_reason:'The original selection was incorrect.'}]));
  await render({readOnly:true,parentChild:child});expect(container.textContent).toContain('excluded from totals');expect(container.textContent).toContain('The original selection was incorrect.');
});
test('empty history and failed reads have clear feedback and a refresh action',async()=>{
  request.mockResolvedValue(result([]));await render({readOnly:true,parentChild:child});expect(container.textContent).toContain('No records for this selection.');
  request.mockRejectedValue(new Error('Merits & Demerits is not available yet.'));await render({readOnly:true,parentChild:{...child,id:503}});
  expect(container.querySelector('[role="alert"]').textContent).toContain('not available yet');
  request.mockResolvedValue(result([]));await click(button('Refresh'));expect(container.querySelector('[role="alert"]')).toBeNull();
});
