import React, { useEffect, useRef, useState } from 'react';
import api from '../../services/api';

export default function CompletedReRegistrationActions({childId,registration}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const generation=useRef(0),urls=useRef([]);
  useEffect(()=>{generation.current+=1;setBusy(false);setError('');setNotice('');
    return ()=>{generation.current+=1;urls.current.forEach(url=>URL.revokeObjectURL(url));urls.current=[];};
  },[childId,registration.version]);
  if (registration.source!=='portal' || !registration.submitted_at) return null;
  const run=async print=>{
    const requestGeneration=generation.current;
    // Open synchronously so browser popup controls can identify the user's click.
    const printWindow=print ? window.open('about:blank','_blank') : null;
    if(print && !printWindow){setError('Your browser blocked the print tab. Allow pop-ups for this website, or download the form and print the PDF.');return;}
    if(printWindow)printWindow.opener=null;
    setBusy(true);setError('');setNotice('');
    try {
      const response=await api.get(`/parent/re-registration/admin/${childId}/completed-form?version=${registration.version}`,{responseType:'blob'});
      if(generation.current!==requestGeneration){if(printWindow)printWindow.close();return;}
      const blob=response.data;
      if(!blob?.type?.includes('application/pdf'))throw new Error('The completed form is unavailable. Please refresh and try again.');
      const url=URL.createObjectURL(blob);urls.current.push(url);
      if(print){
        if(printWindow.closed)return;
        printWindow.addEventListener('load',()=>{try{printWindow.focus();printWindow.print();}catch{/* The PDF viewer also has its own Print control. */}},{once:true});
        printWindow.location.replace(url);
        setNotice('The completed PDF is open in a new tab. If the print dialog does not open, use the printer icon in that PDF.');
      }else{
        const anchor=document.createElement('a');anchor.href=url;anchor.download=`${registration.reference}-Completed-Form.pdf`;
        document.body.appendChild(anchor);anchor.click();anchor.remove();
        setNotice('Completed form downloaded. Open the PDF to view or print it.');
      }
    }catch(err){
      if(printWindow && !printWindow.closed)printWindow.close();
      if(generation.current!==requestGeneration)return;
      let message=err.message;
      if(err.response?.data instanceof Blob){try{message=JSON.parse(await err.response.data.text()).message;}catch{/* Use the safe fallback below. */}}
      if(generation.current!==requestGeneration)return;
      setError(message && !/^Request failed|Network Error/.test(message) ? message : 'We could not prepare the completed form. Refresh the learner and try again.');
    }finally{if(generation.current===requestGeneration)setBusy(false);}
  };
  return <section className="rr-card"><h2>Completed online form</h2>
    <p>Download or print the last submitted form with the parent’s saved answers and declaration. Later draft changes are not included.</p>
    <div className="rr-button-row"><button className="rr-button" disabled={busy} onClick={()=>run(false)}>Download completed form</button>
      <button className="rr-button rr-secondary" disabled={busy} onClick={()=>run(true)}>Print completed form</button></div>
    {busy && <p role="status">Preparing completed form…</p>}{error && <p role="alert" className="rr-notice rr-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
