import React, {useEffect,useState} from 'react';
import {useQuery} from 'react-query';
import {Link} from 'react-router-dom';
import {useAuth} from '../../contexts/AuthContext';
import api from '../../services/api';
import '../common/BehaviourWorkspace.css';

export default function DemeritAlerts({onSelectLearner,year}) {
  const {user,isAdmin}=useAuth();
  const [page,setPage]=useState(1);
  const {data,error,refetch}=useQuery(['demerit-admin-alerts',user?.id,year || 'current',page],
    async()=>(await api.get('/behaviour/alerts',{params:{year,page}})).data,
    {enabled:!!isAdmin && !!user?.id,refetchInterval:30000,refetchOnWindowFocus:true});
  useEffect(()=>{const update=()=>refetch?.();window.addEventListener('behaviour-records-updated',update);return()=>window.removeEventListener('behaviour-records-updated',update);},[refetch]);
  if(!isAdmin || (!data?.count && !error && page===1))return null;
  return <section className="behaviour-workspace"><div className="behaviour-card" role="status">
    <h2>{error?'Behaviour alerts could not be refreshed':`${data?.count || 0} learner${data?.count===1?' needs':'s need'} suspension review`}</h2>
    <p>Each learner starts with 100 points per school year. Admin review is needed at 30 points remaining or below. Admin decides what action to take.</p>
    {onSelectLearner ? <><ul className="behaviour-search-results">{(data?.learners || []).map(student=><li key={student.id}><button type="button" onClick={()=>onSelectLearner(student)}>
      {student.first_name} {student.last_name} · {student.student_number} · {student.remaining} points remaining
    </button></li>)}</ul><div className="behaviour-actions"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous alerts</button>
      <span>Page {page}</span><button disabled={!data || page*50>=data.count} onClick={()=>setPage(p=>p+1)}>Next alerts</button></div></>
      : <Link to="/behaviour">View behaviour alerts</Link>}
  </div></section>;
}
