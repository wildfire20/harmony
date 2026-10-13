import React, { useEffect, useState, useRef } from 'react';
import { useQueryClient } from 'react-query';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import definition from '../../data/reRegistration2027.json';
import AdminReRegistrationDeposit from './AdminReRegistrationDeposit';
import { reRegistrationAlertKey } from '../../hooks/useAdminReRegistrationAlerts';
import { StatusBadge, FormReview, FormDownloads, EmailUpdates, FormSection, FeesUndertaking } from '../common/ReRegistrationForm';
import { downloadReRegistration } from '../common/reRegistrationDownload';
const statuses = { all: 'All statuses', not_started: 'Not started', draft: 'Draft', submitted: 'Submitted', changes_needed: 'Changes needed', approved: 'Approved', recorded:'Not returning', waiting_list:'Waiting list' };
const request = async (path, body) => {
  try { return (await api.request({ url: `/parent/re-registration/admin${path}`, method: body ? 'POST' : 'GET', ...(body ? { data: body } : {}) })).data; }
  catch (error) { throw new Error(error.response?.data?.message || 'We could not load or save this form. Please try again.'); }
};
export default function ParentReRegistrationAdmin() {
  const [list, setList] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState('all');
  const [grade, setGrade] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [generation, setGeneration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [note, setNote] = useState('');
  const [parentId, setParentId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [signed, setSigned] = useState(false);
  const [paperForm,setPaperForm]=useState({}),[receivedDate,setReceivedDate]=useState(''),[history,setHistory]=useState(null);
  const selectedRef=useRef(selected);selectedRef.current=selected;
  const retry=useRef(null);
  const queryClient = useQueryClient(); const { user } = useAuth();
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    const params = new URLSearchParams({ status, page, ...(grade ? { grade_id: grade } : {}), ...(query ? { q: query } : {}) });
    request(`?${params}`).then(result => { if (active) setList(result); }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [status, grade, query, page, generation]);
  useEffect(() => {
    let active = true; setDetail(null); setNote(''); setParentId(''); setConfirmed(false); setSigned(false); setError(''); setHistory(null); setReceivedDate('');
    if (!selected) return undefined;
    request(`/${selected}`).then(result => { if (active) {setDetail(result);setPaperForm(result.registration.form || {});} }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [selected]);
  const review = async action => {
    const childId=selected;
    const payload={version:detail.registration.version,action,note,...(['approve','record_not_returning'].includes(action) ? {review_confirmed:confirmed} : {}),...(action==='paper' ? {parent_id:parentId ? Number(parentId) : null,paper_signed:signed,form:paperForm,received_date:receivedDate} : {})};
    const signature=JSON.stringify({childId,payload});if(retry.current?.signature!==signature) retry.current={signature,key:crypto.randomUUID()};
    setBusy(true); setError(''); setNotice('');
    try {
      const result=await request(`/${childId}/review`,{...payload,request_key:retry.current.key});
      if(selectedRef.current!==childId) return;retry.current=null;
      setDetail(result); setNote(''); setSigned(false); setConfirmed(false);
      setNotice(action === 'record_not_returning' ? 'Not-returning response recorded.' : action === 'waiting_list' ? 'Learner placed on the waiting list. The parent can see your reason.' : action === 'approve' ? 'Re-registration approved.' : action === 'paper' ? 'Signed paper form recorded. It is ready for review.' : 'Changes requested. The parent can see your message in the portal.');
      queryClient.invalidateQueries(reRegistrationAlertKey(user?.id)); setGeneration(value => value + 1);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const download = async document => { setBusy(true); setError(''); try {
    await downloadReRegistration(document, async url => (await api.get(url.replace(/^\/api/,''), { responseType: 'blob' })).data,selected);
  } catch { setError('The form download is unavailable. Please try again.'); } finally { setBusy(false); } };
  const visibleDetail=detail?.child.id===selected ? detail : null;
  const registration=visibleDetail?.registration;
  return <div className="rr-shell rr-admin">
    <header className="rr-heading"><div><p className="rr-eyebrow">School office · Returning learners</p><h1>Re-registration for 2027</h1><p className="rr-muted">Review online forms and record signed paper forms in one place.</p></div>
      <button className="rr-button rr-secondary" disabled={busy || loading} onClick={() => { setGeneration(value => value + 1); if (selected) request(`/${selected}`).then(setDetail).catch(err => setError(err.message)); }}>Refresh</button></header>
    {error && <div role="alert" className="rr-notice rr-error">{error}</div>}{notice && <div role="status" className="rr-notice rr-success">{notice}</div>}
    {selected ? <><button className="rr-button rr-secondary" disabled={busy} onClick={() => { setSelected(null); setNotice(''); }}>Back to list</button>
      {!detail && !error && <p role="status">Loading form…</p>}
      {visibleDetail && <><section className="rr-card"><div className="rr-heading"><div><h2>{detail.child.first_name} {detail.child.last_name}</h2><p className="rr-muted">{detail.child.student_number} · {detail.child.grade_name}</p></div><StatusBadge registration={registration} /></div>
        <p>{registration.reference || 'No form started'}{registration.source && ` · ${registration.source === 'paper' ? 'Paper form' : 'Parent Portal form'}`}</p>
        {registration.submitted_at && <p className="rr-muted">Received: {new Date(registration.submitted_at).toLocaleString('en-ZA')}</p>}
        {registration.review_note && <div className="rr-notice"><strong>Message visible to parents</strong>{registration.review_note}</div>}
        {registration.office_note && <p>Office note: {registration.office_note}</p>}
        <button className="rr-button rr-secondary" onClick={async()=>{try{setHistory(await request(`/${selected}/history`));}catch(err){setError(err.message);}}}>View previous versions</button>
        <EmailUpdates updates={detail.email_updates} />
      </section>
      {registration.form && <FormReview form={registration.form} />}
      {registration.source === 'paper' && <div className="rr-notice">Review the signed paper form held by the school office. The portal tracks its receipt and approval.</div>}
      {history && <section className="rr-card"><h2>Previous versions</h2>{history.versions.length ? history.versions.map(item=><details key={item.version}><summary>Version {item.version} · {item.source}</summary><pre className="rr-history">{JSON.stringify(item.form_data,null,2)}</pre></details>) : <p>No previous version.</p>}</section>}
      <AdminReRegistrationDeposit key={selected} data={detail} request={(path,body)=>request(`/${selected}${path}`,body)} getBlob={async url=>(await api.get(url.replace(/^\/api/,''),{responseType:'blob'})).data} onUpdate={result=>{if(selectedRef.current===selected){setDetail(result);setGeneration(v=>v+1);queryClient.invalidateQueries(reRegistrationAlertKey(user?.id));}}}/>
      {['submitted','waiting_list'].includes(registration.status) && <section className="rr-card"><h2>Review decision</h2><p className="rr-muted">Approval records the 2027 decision. Use the existing learner and Finance tools for any approved profile, grade or service changes.</p>
        <label htmlFor="rr-note">Message to the parent (required when asking for changes)</label><textarea id="rr-note" rows={3} maxLength={1500} value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
        <label className="rr-checkbox"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>I have reviewed the signed form and confirm this decision.</span></label>
        <div className="rr-button-row"><button className="rr-button" disabled={busy || !confirmed || registration.definition_version!==2 || registration.form?.returning!=='Yes' || !detail.deposit?.verified} onClick={() => review('approve')}>Approve re-registration</button>
          {registration.form?.returning==='No' && <button className="rr-button" disabled={busy || !confirmed} onClick={()=>review('record_not_returning')}>Record not returning</button>}
          {registration.form?.returning==='Yes' && <button className="rr-button rr-secondary" disabled={busy || !note.trim()} onClick={()=>review('waiting_list')}>Put on waiting list</button>}
          <button className="rr-button rr-secondary" disabled={busy || !note.trim()} onClick={() => review('request_changes')}>Request changes</button></div></section>}
      {['not_started','draft','changes_needed'].includes(registration.status) && <section className="rr-card"><h2>Record paper form</h2><p className="rr-muted">Use this when the signed form was handed to the office. It will enter the same review list. An existing draft will be retained as history.</p>
        <label htmlFor="rr-parent">Parent / guardian who handed in the form</label><select id="rr-parent" value={parentId} disabled={busy} onChange={event=>{setParentId(event.target.value);const parent=detail.parents.find(p=>p.id===Number(event.target.value));if(parent) setPaperForm(f=>({...f,parent_full_name:`${parent.first_name} ${parent.last_name}`,parent_mobile:parent.phone_number || '',parent_whatsapp:parent.phone_number || ''}));}}><option value="">Not linked to a Parent account</option>{detail.parents.map(parent => <option value={parent.id} key={parent.id}>{parent.first_name} {parent.last_name}</option>)}</select>
        <label htmlFor="rr-paper-note" style={{ marginTop: 18 }}>Office note (optional; visible to Admin only)</label><textarea id="rr-paper-note" value={note} maxLength={1500} rows={3} disabled={busy} onChange={event => setNote(event.target.value)} />
        {definition.sections.map(section=><FormSection key={section.title} section={section} form={paperForm} onChange={(key,value)=>setPaperForm(f=>({...f,[key]:value}))} grades={detail.grades} disabled={busy}/>)}<FeesUndertaking form={paperForm}/>
        <label htmlFor="rr-paper-name">Name on the signed declaration</label><input id="rr-paper-name" value={paperForm.declared_name || ''} onChange={e=>setPaperForm(f=>({...f,declared_name:e.target.value}))}/>
        <label htmlFor="rr-received-date">Date received</label><input id="rr-received-date" type="date" value={receivedDate} onChange={e=>setReceivedDate(e.target.value)}/>
        <label className="rr-checkbox"><input type="checkbox" checked={signed} disabled={busy} onChange={event=>{setSigned(event.target.checked);setPaperForm(f=>({...f,declaration_accepted:event.target.checked}));}} /><span>The signed paper form has been received and is kept at the school office.</span></label>
        <button className="rr-button" disabled={busy || !signed} onClick={() => review('paper')}>Record paper form</button></section>}
      </>}
    </> : <>
      {list && <div className="rr-counts">{Object.keys(statuses).filter(key => key !== 'all').map(key => <span key={key}>{statuses[key]} <strong>{list.counts[key] || 0}</strong></span>)}</div>}
      <form className="rr-filters" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search); }}>
        <div><label htmlFor="rr-status-filter">Status</label><select id="rr-status-filter" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>{Object.entries(statuses).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        <div><label htmlFor="rr-grade-filter">Current grade</label><select id="rr-grade-filter" value={grade} onChange={event => { setGrade(event.target.value); setPage(1); }}><option value="">All grades</option>{list?.grades.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>
        <div><label htmlFor="rr-search">Learner name / reference</label><input id="rr-search" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} /></div><button className="rr-button" type="submit">Search</button>
      </form>
      {loading && <p role="status">Loading re-registrations…</p>}
      {list && !loading && <><p className="rr-muted">{list.total} learners in this view</p><div className="rr-list">{!list.registrations.length && <div className="rr-card">No learners match these filters.</div>}
        {list.registrations.map(row => <button className="rr-list-row" key={row.id} onClick={() => { setSelected(row.id); setNotice(''); }}><div><strong>{row.first_name} {row.last_name}</strong><p>{row.student_number} · {row.grade_name}</p><p>{row.reference || 'No form started'}{row.source === 'paper' ? ' · Paper form' : ''}</p></div><StatusBadge registration={row} /></button>)}</div>
        <div className="rr-pagination"><button className="rr-button rr-secondary" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button className="rr-button rr-secondary" disabled={!list.has_more} onClick={() => setPage(value => value + 1)}>Next</button></div></>}
      <FormDownloads download={download} busy={busy} />
      <p className="rr-muted">This list is for existing learners. New-learner applications remain in Enrollments.</p>
    </>}
  </div>;
}
