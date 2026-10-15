import React from 'react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import BehaviourWorkspace from '../common/BehaviourWorkspace';
const request=async(path,opts={})=>{
  try{return (await api({url:`/behaviour${path}`,method:opts.method||'GET',data:opts.body})).data;}
  catch(e){throw new Error(e.response?.data?.message||'Unable to load or save behaviour records.');}
};
export default function StaffBehaviour(){const {user}=useAuth();return <BehaviourWorkspace request={request} role={user?.role}/>;}
