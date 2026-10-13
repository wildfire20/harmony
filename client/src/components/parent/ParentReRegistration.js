import React, { useEffect, useRef, useState } from 'react';
import { parentApi, refreshParentAccess } from './ParentPortal';
import ReRegistrationDeposit from '../common/ReRegistrationDeposit';
import definition from '../../data/reRegistration2027.json';
import { StatusBadge, FormSection, FormReview, FormDownloads, EmailUpdates, FeesUndertaking, requiredField, visibleField } from '../common/ReRegistrationForm';
import { downloadReRegistration } from '../common/reRegistrationDownload';

export async function getBlob(url) {
  const request = () => fetch(url, { credentials: 'include', headers: { Authorization: `Bearer ${sessionStorage.getItem('parentToken') || ''}` } });
  let response = await request();
  if (response.status === 401) { await refreshParentAccess(); response = await request(); }
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Please sign in again to download this form.');
  return response.blob();
}
export default function ParentReRegistration({ child }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const currentChild = useRef(child?.id); currentChild.current = child?.id;
  const retry = useRef(null);
  const hydrate = result => { setData(result); setForm(result.registration.form || {}); setDirty(false); };
  useEffect(() => {
    let active = true;
    setLoading(true); setData(null); setError(''); setNotice(''); setDirty(false); setShowForm(false);
    if (!child?.id) { setLoading(false); return undefined; }
    parentApi(`/re-registration?child_id=${child.id}`).then(result => { if (active) hydrate(result); })
      .catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [child?.id]);
  useEffect(() => {
    const beforeUnload = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  const change = (key, value) => { setForm(previous => ({ ...previous, [key]: value })); setDirty(true); setNotice(''); };
  const save = async submit => {
    setError(''); setNotice('');
    if (submit) {
      const missing = definition.sections.flatMap(section => section.fields).find(field => visibleField(field,form) && requiredField(field,form) && !String(form[field.key] || '').trim());
      if (missing) { setError(`Please complete ${missing.label}.`); return; }
      if (!form.declaration_accepted || !String(form.declared_name || '').trim()) { setError('Please enter your name and accept the declaration.'); return; }
    }
    const childId = child.id;
    const payload={form,version:data.registration.version};const signature=JSON.stringify({submit,...payload});
    if (retry.current?.signature!==signature) retry.current={signature,key:crypto.randomUUID()};
    setBusy(true);
    try {
      const result = await parentApi(`/re-registration/${submit ? 'submit' : 'draft'}?child_id=${childId}`, { method: 'POST',
        body: JSON.stringify({ ...payload, request_key: retry.current.key }) });
      if (currentChild.current === childId) { hydrate(result); retry.current=null; if(submit) setShowForm(false); setNotice(submit ? 'Your re-registration has been received. Admin will review it. You can check its status here.' : 'Draft saved. You can return and continue later.'); }
    } catch (err) { if (currentChild.current === childId) setError(err.message); }
    finally { setBusy(false); }
  };
  const download = async document => { setBusy(true); setError(''); try { await downloadReRegistration(document, getBlob,child.id); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  const visibleData=data?.child.id===child?.id ? data : null;
  const registration=visibleData?.registration;
  return <div className="rr-shell">
    <header className="rr-heading"><div><p className="rr-eyebrow">Returning learners · 2027</p><h1>Re-registration</h1><p className="rr-muted">Keep your child’s place for next year. Complete one form for each child already at Harmony.</p></div>
      {registration && <StatusBadge registration={registration} />}</header>
    {!child?.id && <div className="rr-notice">No child is linked to your account. Please contact the school office.</div>}
    {loading && <p role="status">Loading your form…</p>}
    {error && <div role="alert" className="rr-notice rr-error">{error}</div>}
    {notice && <div role="status" className="rr-notice rr-success">{notice}</div>}
    {visibleData && <><div className="rr-notice"><strong>{data.child.first_name} {data.child.last_name}</strong>{data.child.student_number} · {data.child.grade_name}
      {registration.reference && <p>Re-registration reference: <strong style={{ display: 'inline', fontSize: 'inherit' }}>{registration.reference}</strong></p>}</div>
      {registration.review_note && <div className="rr-notice" style={{ marginTop: 16 }}><strong>Message from Admin</strong>{registration.review_note}</div>}
      {registration.read_only ? <section className="rr-card">
        <h2>{registration.status_label === 'Approved' ? 'Re-registration approved' : registration.status === 'changes_needed' ? 'Please update your paper form' : 'Your form is with the school office'}</h2>
        <p>{registration.status_label === 'Approved' ? 'Admin has approved re-registration for 2027. Your current account and history stay in place.'
          : registration.source === 'paper' ? 'Admin has recorded your paper form. Contact the office if you need to make changes.' : 'There is already a form for this child. Admin will review it. Please contact the office if you need a correction.'}</p>
        {registration.form && registration.source === 'portal' && <button className="rr-button rr-secondary" onClick={() => setShowForm(!showForm)}>{showForm ? 'Hide submitted form' : 'View submitted form'}</button>}
        <EmailUpdates updates={data.email_updates} />
      </section> : <>{!showForm && registration.status==='not_started' ? <section className="rr-card"><h2>Re-register online</h2><p>Check the details we already have, confirm whether your child is returning, and sign the short form.</p><button className="rr-button" onClick={()=>setShowForm(true)}>Re-register online</button></section> : <>
        <p className="rr-muted">Fields marked * are required. Save your draft before leaving this page or changing child.</p>
        {definition.sections.map(section=><FormSection key={section.title} section={section} form={form} onChange={change} grades={data.grades} disabled={busy}/>)}
        <FeesUndertaking form={form}/><section className="rr-card"><h2>Confirm and submit</h2>
          <label htmlFor="rr-declared_name">Your full name *</label><input id="rr-declared_name" value={form.declared_name || ''} maxLength={200} disabled={busy} onChange={event=>change('declared_name',event.target.value)}/>
          <label className="rr-checkbox"><input type="checkbox" checked={!!form.declaration_accepted} disabled={busy} onChange={event=>change('declaration_accepted',event.target.checked)}/><span>{definition.declaration}</span></label>
          <div className="rr-button-row"><button className="rr-button rr-secondary" disabled={busy} onClick={()=>save(false)}>Save draft</button><button className="rr-button" disabled={busy} onClick={()=>save(true)}>{busy?'Please wait…':'Submit re-registration'}</button></div>
        </section></>}
      </>}
      <ReRegistrationDeposit key={child.id} data={data} childId={child.id} request={parentApi} getBlob={getBlob} onUpdate={result=>{if(currentChild.current===child.id) hydrate(result);}}/>
      {showForm && registration.read_only && registration.form && <FormReview form={registration.form} />}
    </>}
    {visibleData && <FormDownloads download={download} busy={busy} category={/^Grade\s*[1-7]$/i.test(form.grade_applied_for || data.child.grade_name) ? 'primary' : 'preschool'}/>}
    <p className="rr-muted">For a child joining Harmony for the first time, use “Apply for 2027” on the school website.</p>
  </div>;
}
