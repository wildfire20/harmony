import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {useQuery} from 'react-query';
import {useAuth} from '../../contexts/AuthContext';
import DemeritAlerts from './DemeritAlerts';
jest.mock('react-query',()=>({useQuery:jest.fn()}));
jest.mock('../../contexts/AuthContext',()=>({useAuth:jest.fn()}));
jest.mock('react-router-dom',()=>({Link:({children,to})=><a href={to}>{children}</a>}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let root,container;
beforeEach(()=>{container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);useAuth.mockReturnValue({user:{id:1},isAdmin:true});useQuery.mockReturnValue({data:{count:1,learners:[{id:501,first_name:'Synthetic',last_name:'Learner',student_number:'TEST501',remaining:30}]}});});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
test('Admin gets a current review warning and can open the flagged learner',async()=>{
 const select=jest.fn();await act(async()=>root.render(<DemeritAlerts onSelectLearner={select} year={2026}/>));
 expect(container.textContent).toContain('1 learner needs suspension review');expect(container.textContent).toContain('30 points remaining');
 const button=[...container.querySelectorAll('button')].find(n=>n.textContent.includes('TEST501'));await act(async()=>button.click());expect(select).toHaveBeenCalledWith(expect.objectContaining({id:501}));
 expect(container.textContent).toContain('Admin decides');
});
test('the dashboard warning links to the behaviour workspace',async()=>{await act(async()=>root.render(<DemeritAlerts/>));expect(container.querySelector('a').getAttribute('href')).toBe('/behaviour');});
test('teachers and parents never fetch or see school-wide warnings',async()=>{
 useAuth.mockReturnValue({user:{id:3},isAdmin:false});await act(async()=>root.render(<DemeritAlerts/>));
 expect(useQuery.mock.calls.at(-1)[2].enabled).toBe(false);expect(container.textContent).toBe('');
});
test('the warning disappears when corrected points no longer meet the threshold',async()=>{
 useQuery.mockReturnValue({data:{count:0,learners:[]}});await act(async()=>root.render(<DemeritAlerts/>));expect(container.textContent).toBe('');
});
