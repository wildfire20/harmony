import React from 'react';
import {parentApi} from './ParentPortal';
import BehaviourWorkspace from '../common/BehaviourWorkspace';
const request=(path,opts={})=>parentApi(`/behaviour${path}`,{skipChildId:true,...opts,...(opts.body?{body:JSON.stringify(opts.body)}:{})});
export default function ParentBehaviour({child}){return <BehaviourWorkspace key={child?.id||'no-child'} readOnly parentChild={child} request={request}/>;}
