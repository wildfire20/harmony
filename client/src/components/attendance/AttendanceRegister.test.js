import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from 'react-query';
import {useAuth} from '../../contexts/AuthContext';
import {attendanceAPI,classesAPI,usersAPI} from '../../services/api';
import AttendanceRegister from './AttendanceRegister';
jest.mock('../../contexts/AuthContext',()=>({useAuth:jest.fn()}));
jest.mock('../common/ThemeProvider',()=>({useTheme:()=>({theme:'light'})}));
jest.mock('../../services/api',()=>({attendanceAPI:{getClassAttendance:jest.fn(),submitAttendance:jest.fn()},classesAPI:{getClasses:jest.fn()},usersAPI:{getTeacherAssignments:jest.fn()}}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let root,container,client;
const roster={data:{students:[{student_id:501,first_name:'Synthetic',last_name:'Learner',student_number:'TEST501',status:'present'}]}};
beforeEach(()=>{jest.clearAllMocks();container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);client=new QueryClient({defaultOptions:{queries:{retry:false,cacheTime:0}}});
 useAuth.mockReturnValue({user:{id:1,role:'admin',assignments:[]}});classesAPI.getClasses.mockResolvedValue({data:{classes:[{id:52,name:'Class B',grade_id:5,grade_name:'Grade 5'}]}});
 usersAPI.getTeacherAssignments.mockResolvedValue({data:{assignments:[{class_id:52,class_name:'Class B',grade_id:5,grade_name:'Grade 5'}]}});attendanceAPI.getClassAttendance.mockResolvedValue(roster);
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();container.remove();});
const settle=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,40)));
const render=async()=>{await act(async()=>root.render(<QueryClientProvider client={client}><AttendanceRegister/></QueryClientProvider>));await settle();};
const choose=async()=>{await act(async()=>{const select=container.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'5-52');select.dispatchEvent(new Event('change',{bubbles:true}));});await settle();};
test('Admin loads all current classes even with no login assignments and displays Grade 5 B learners',async()=>{
 await render();expect(classesAPI.getClasses).toHaveBeenCalled();expect(container.textContent).toContain('Grade 5 - Class B');await choose();expect(container.textContent).toContain('TEST501');
});
test('teachers refresh their current assignments rather than using a stale login list',async()=>{
 useAuth.mockReturnValue({user:{id:3,role:'teacher',assignments:[{grade_id:2,class_id:2,grade_name:'Grade 2',class_name:'Class B'}]}});
 await render();expect(usersAPI.getTeacherAssignments).toHaveBeenCalled();expect(classesAPI.getClasses).not.toHaveBeenCalled();await choose();expect(container.textContent).toContain('TEST501');
});
test('a failed class read shows the server message and does not look like an empty successful register',async()=>{
 attendanceAPI.getClassAttendance.mockRejectedValue({response:{data:{message:'Access denied. You are not assigned to this class.'}}});
 await render();await choose();expect(container.querySelector('[role="alert"]').textContent).toContain('Access denied');
 expect([...container.querySelectorAll('button')].find(n=>n.textContent==='Retry')).toBeTruthy();expect(attendanceAPI.submitAttendance).not.toHaveBeenCalled();
});
