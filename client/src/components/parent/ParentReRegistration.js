import React, { useEffect, useRef, useState } from 'react';
import { parentApi, refreshParentAccess } from './ParentPortal';
import definition from '../../data/reRegistration2027.json';
import { StatusBadge, FormSection, FormReview, FormDownloads, EmailUpdates } from '../common/ReRegistrationForm';
import { downloadReRegistration } from '../common/reRegistrationDownload';

async function getBlob(url) {
  const request = () => fetch(url, { credentials: 'include', headers: { Authorization: `Bearer ${sessionStorage.getItem('parentToken') || ''}` } });
  let response = await request();
  if (response.status === 401) { await refreshParentAccess(); response = await request(); }
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Please sign in again to download this form.');
  return response.blob();
}
export default function ParentReRegistration({ child }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const currentChild = useRef(child?.id); currentChild.current = child?.id;
  const top = useRef(null);
  const hydrate = result => { setData(result); setForm(result.registration.form || {}); setDirty(false); };
  useEffect(() => {
    let active = true;
    setLoading(true); setData(null); setError(''); setNotice(''); setStep(0); setDirty(false); setShowForm(false);
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
  const go = index => { setStep(index); top.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); };
  const save = async submit => {
    setError(''); setNotice('');
    if (submit) {
      const missing = definition.sections.flatMap(section => section.fields).find(field => field.required && !String(form[field.key] || '').trim());
      if (missing) { go(definition.sections.findIndex(section => section.fields.includes(missing))); setError(`Please complete ${missing.label}.`); return; }
      if (!form.declaration_accepted || !String(form.declared_name || '').trim()) { setError('Please enter your name and accept the declaration.'); return; }
    }
    const childId = child.id;
    setBusy(true);
    try {
      const result = await parentApi(`/re-registration/${submit ? 'submit' : 'draft'}?child_id=${childId}`, { method: 'POST',
        body: JSON.stringify({ form, version: data.registration.version, request_key: crypto.randomUUID() }) });
      if (currentChild.current === childId) { hydrate(result); setNotice(submit ? 'Your re-registration has been received. Admin will review it. You can check its status here.' : 'Draft saved. You can return and continue later.'); }
    } catch (err) { if (currentChild.current === childId) setError(err.message); }
    finally { setBusy(false); }
  };
  const download = async document => { setBusy(true); setError(''); try { await downloadReRegistration(document, getBlob); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  const registration = data?.registration;
  return <div className="rr-shell">
    <header className="rr-heading"><div><p className="rr-eyebrow">Returning learners · 2027</p><h1>Re-registration</h1><p className="rr-muted">Keep your child’s place for next year. Complete one form for each child already at Harmony.</p></div>
      {registration && <StatusBadge registration={registration} />}</header>
    {!child?.id && <div className="rr-notice">No child is linked to your account. Please contact the school office.</div>}
    {loading && <p role="status">Loading your form…</p>}
    {error && <div role="alert" className="rr-notice rr-error">{error}</div>}
    {notice && <div role="status" className="rr-notice rr-success">{notice}</div>}
    {data && <><div className="rr-notice"><strong>{data.child.first_name} {data.child.last_name}</strong>{data.child.student_number} · {data.child.grade_name}
      {registration.reference && <p>Re-registration reference: <strong style={{ display: 'inline', fontSize: 'inherit' }}>{registration.reference}</strong></p>}</div>
      {registration.review_note && <div className="rr-notice" style={{ marginTop: 16 }}><strong>Message from Admin</strong>{registration.review_note}</div>}
      {registration.read_only ? <section className="rr-card">
        <h2>{registration.status === 'approved' ? 'Re-registration approved' : registration.status === 'changes_needed' ? 'Please update your paper form' : 'Your form is with the school office'}</h2>
        <p>{registration.status === 'approved' ? 'Admin has approved re-registration for 2027. Your current account and history stay in place.'
          : registration.source === 'paper' ? 'Admin has recorded your paper form. Contact the office if you need to make changes.' : 'There is already a form for this child. Admin will review it. Please contact the office if you need a correction.'}</p>
        {registration.form && registration.source === 'portal' && <button className="rr-button rr-secondary" onClick={() => setShowForm(!showForm)}>{showForm ? 'Hide submitted form' : 'View submitted form'}</button>}
        <EmailUpdates updates={data.email_updates} />
      </section> : <><div ref={top}><nav className="rr-steps" aria-label="Form sections">{[...definition.sections.map(section => section.title), 'Review & submit'].map((title, index) =>
        <button type="button" key={title} disabled={busy} aria-current={step === index ? 'step' : undefined} onClick={() => go(index)}><span>{index + 1}</span>{title}</button>)}</nav></div>
        <p className="rr-muted">Fields marked * are required. Save your draft before leaving this page or changing child.</p>
        {step < definition.sections.length ? <FormSection section={definition.sections[step]} form={form} onChange={change} grades={data.grades} disabled={busy} />
          : <><FormReview form={form} /><section className="rr-card"><h2>Confirm and submit</h2><p>Check your details above. Submitting this form does not change your login email, password or current fees.</p>
            <label className="rr-checkbox"><input type="checkbox" checked={!!form.declaration_accepted} disabled={busy} onChange={event => change('declaration_accepted', event.target.checked)} /><span>{definition.declaration}</span></label>
            <label htmlFor="rr-declared_name">Your full name *</label><input id="rr-declared_name" value={form.declared_name || ''} maxLength={200} disabled={busy} onChange={event => change('declared_name', event.target.value)} />
          </section></>}
        <div className="rr-actions"><div className="rr-button-row">{step > 0 && <button className="rr-button rr-secondary" disabled={busy} onClick={() => go(step - 1)}>Back</button>}
          <button className="rr-button rr-secondary" disabled={busy} onClick={() => save(false)}>{busy ? 'Please wait…' : 'Save draft'}</button></div>
          {step < definition.sections.length ? <button className="rr-button" disabled={busy} onClick={() => go(step + 1)}>Next</button>
            : <button className="rr-button" disabled={busy} onClick={() => save(true)}>Submit re-registration</button>}</div>
      </>}
      {showForm && registration.form && <FormReview form={registration.form} />}
    </>}
    <FormDownloads download={download} busy={busy} />
    <p className="rr-muted">For a child joining Harmony for the first time, use “Apply for 2027” on the school website.</p>
  </div>;
}
