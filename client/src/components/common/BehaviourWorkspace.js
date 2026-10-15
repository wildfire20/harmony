import React, { useEffect, useRef, useState } from 'react';
import './BehaviourWorkspace.css';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const newEntry = () => ({ kind: 'merit', type_id: '', event_date: localToday(), notes: '', request_key: crypto.randomUUID() });
const emptyType = () => ({ code: '', kind: 'merit', label: '', category: null, points: null, is_active: true });
const name = learner => `${learner.first_name} ${learner.last_name}`;
const dateLabel = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' });

export default function BehaviourWorkspace({ request, readOnly = false, parentChild = null, role = '' }) {
  const admin = !readOnly && ['admin', 'super_admin'].includes(role);
  const [query, setQuery] = useState('');
  const [learners, setLearners] = useState([]);
  const [selected, setSelected] = useState(null);
  const learner = readOnly ? parentChild : selected;
  const learnerId = learner?.id;
  const [types, setTypes] = useState([]);
  const [year, setYear] = useState(Number(localToday().slice(0, 4)));
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [entry, setEntry] = useState(newEntry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [manage, setManage] = useState(false);
  const [typeForm, setTypeForm] = useState(emptyType);
  const [voiding, setVoiding] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const inFlight = useRef(false);

  useEffect(() => {
    if (readOnly) return undefined;
    let active = true;
    request('/catalogue').then(result => { if (active) setTypes(result.types || []); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [readOnly, request, reload]);
  useEffect(() => {
    if (readOnly || query.trim().length < 2) { setLearners([]); return undefined; }
    let active = true;
    const timer = setTimeout(() => request(`/learners?q=${encodeURIComponent(query.trim())}`)
      .then(result => { if (active) setLearners(result.learners || []); })
      .catch(e => { if (active) setError(e.message); }), 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query, readOnly, request, reload]);
  useEffect(() => {
    let active = true;
    setData(null); setError(''); setLoading(Boolean(learnerId));
    if (learnerId) request(`/records?student_id=${encodeURIComponent(learnerId)}&year=${year}&kind=${kind}&page=${page}`)
      .then(result => { if (active) setData(result); })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [learnerId, year, kind, page, reload, request]);

  const work = async operation => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); setReload(value => value + 1); }
    catch (e) { setError(e.message || 'Unable to save. Please try again.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const submitEntry = e => {
    e.preventDefault();
    if (!learnerId || !entry.type_id) { setError('Select a learner and a merit or demerit type.'); return; }
    work(async () => {
      await request('/records', { method: 'POST', body: {
        student_id: learnerId, type_id: Number(entry.type_id), event_date: entry.event_date,
        notes: entry.notes, request_key: entry.request_key,
      } });
      setEntry(newEntry()); setNotice('Record saved. It is now visible in the linked Parent Portal.');
    });
  };
  const submitType = e => {
    e.preventDefault();
    work(async () => {
      const body = { label: typeForm.label, category: typeForm.kind === 'merit' ? null : Number(typeForm.category), points: typeForm.kind === 'merit' ? null : Number(typeForm.points) };
      if (typeForm.id) Object.assign(body, { is_active: typeForm.is_active, version: typeForm.version });
      else Object.assign(body, { code: typeForm.code, kind: typeForm.kind });
      await request(typeForm.id ? `/catalogue/${typeForm.id}` : '/catalogue', { method: typeForm.id ? 'PATCH' : 'POST', body });
      setTypeForm(emptyType()); setNotice('Catalogue saved. Existing learner records retain their original details.');
    });
  };
  const selectLearner = student => {
    setSelected(student); setQuery(''); setLearners([]); setPage(1); setData(null);
    setEntry(newEntry()); setVoiding(null); setNotice(''); setError('');
  };
  const selectedType = types.find(t => t.id === Number(entry.type_id));
  const editEntry = changes => setEntry(current => ({ ...current, ...changes, request_key: crypto.randomUUID() }));

  return <section className="behaviour-workspace" aria-label="Merits and Demerits">
    <div className="behaviour-heading"><div><h1>Merits &amp; Demerits</h1>
      <p>{readOnly ? 'Celebrate achievements and stay informed about your child’s behaviour.' : admin ? 'Record and review behaviour for any learner in the school.' : 'Record and review behaviour for learners in your assigned classes.'}</p></div>
      {admin && <button type="button" aria-expanded={manage} onClick={() => setManage(!manage)}>Manage types</button>}
    </div>
    {error && <div role="alert" className="behaviour-error">{error}<button type="button" onClick={() => setReload(r => r + 1)}>Refresh</button></div>}
    {notice && <div role="status" className="behaviour-notice">{notice}</div>}

    {!readOnly && <div className="behaviour-card"><label>Find learner
      <input type="search" value={query} disabled={busy} onChange={e => setQuery(e.target.value)} placeholder="Search by name or HAR number" /></label>
      {learners.length > 0 && <ul className="behaviour-search-results">{learners.map(student => <li key={student.id}><button type="button" disabled={busy} onClick={() => selectLearner(student)}>{name(student)} · {student.student_number} · {student.grade_name} {student.class_name}</button></li>)}</ul>}
      {learner && <p className="behaviour-selected">Selected: <strong>{name(learner)}</strong> · {learner.student_number}</p>}
    </div>}
    {readOnly && learner && <p className="behaviour-selected"><strong>{name(learner)}</strong> · {learner.student_number} · {learner.grade_name}</p>}

    {learnerId ? <>
      <div className="behaviour-filters"><label>School year<input type="number" min="2000" max="2100" value={year} onChange={e => { setYear(e.target.value); setPage(1); }} /></label>
        <label>Show<select value={kind} onChange={e => { setKind(e.target.value); setPage(1); }}><option value="all">All records</option><option value="merit">Merits</option><option value="demerit">Demerits</option></select></label>
      </div>
      {loading && <p role="status">Loading behaviour records…</p>}
      {data && <div className="behaviour-summary">
        <div><strong>{data.summary.merits}</strong><span>Merits awarded</span></div>
        <div><strong>{data.summary.demerits}</strong><span>Demerits recorded</span></div>
        <div><strong>{data.summary.demerit_points}</strong><span>Demerit points</span></div>
      </div>}
      {!readOnly && <form onSubmit={submitEntry} className="behaviour-card">
        <h2>Add a record</h2><div className="behaviour-form-grid">
          <label>Record type<select disabled={busy} value={entry.kind} onChange={e => editEntry({ kind: e.target.value, type_id: '' })}><option value="merit">Merit</option><option value="demerit">Demerit</option></select></label>
          <label>Date<input required type="date" disabled={busy} max={localToday()} value={entry.event_date} onChange={e => editEntry({ event_date: e.target.value })} /></label>
          <label className="behaviour-full">Reason from school list<select required disabled={busy} value={entry.type_id} onChange={e => editEntry({ type_id: e.target.value })}>
            <option value="">Choose a {entry.kind}</option>{types.filter(t => t.is_active && t.kind === entry.kind).map(t => <option key={t.id} value={t.id}>{t.code} · {t.label}{t.kind === 'demerit' ? ` · Category ${t.category} · ${t.points} points` : ''}</option>)}
          </select></label>
          {selectedType?.category === 4 && <p className="behaviour-serious behaviour-full">Category 4: serious incident requiring Admin review. Recording this entry does not make an automatic disciplinary decision.</p>}
          <label className="behaviour-full">Notes visible to parents (optional)<textarea disabled={busy} maxLength="1000" rows="3" value={entry.notes} onChange={e => editEntry({ notes: e.target.value })} /></label>
        </div><button className="behaviour-primary" disabled={busy || !entry.type_id}>{busy ? 'Saving…' : 'Save record'}</button>
      </form>}
      {data && <div className="behaviour-card"><h2>Record history</h2>
        {!data.records.length && <p>No records for this selection.</p>}
        <div className="behaviour-records">{data.records.map(record => <article key={record.id} className={record.status === 'voided' ? 'behaviour-voided' : ''}>
          <div className="behaviour-record-top"><span className={`behaviour-badge ${record.kind}`}>{record.kind === 'merit' ? 'Merit' : `Demerit · ${record.points} points`}</span><time dateTime={record.event_date}>{dateLabel(record.event_date)}</time></div>
          <h3>{record.label}</h3><p className="behaviour-meta">{record.type_code}{record.category ? ` · Category ${record.category}` : ''} · Recorded by {record.recorded_by_name}</p>
          {record.category === 4 && <p className="behaviour-serious">Serious incident · Admin review required</p>}
          {record.notes && <p className="behaviour-notes">{record.notes}</p>}
          {record.status === 'voided' && <p className="behaviour-meta"><strong>Corrected entry · excluded from totals.</strong> {record.void_reason}</p>}
          {!readOnly && record.can_void && <button type="button" disabled={busy} onClick={() => { setVoiding(record.id); setVoidReason(''); }}>Correct entry</button>}
          {voiding === record.id && <form onSubmit={e => { e.preventDefault(); work(async () => {
            await request(`/records/${record.id}/void`, { method: 'POST', body: { reason: voidReason } });
            setVoiding(null); setNotice('Entry marked as corrected and excluded from totals. Add a replacement record if needed.');
          }); }}><p>The original entry stays in history. Add the correct record separately if needed.</p>
            <label>Reason for correction<textarea required minLength="10" maxLength="500" value={voidReason} onChange={e => setVoidReason(e.target.value)} /></label>
            <div className="behaviour-actions"><button disabled={busy || voidReason.trim().length < 10}>Confirm correction</button><button type="button" onClick={() => setVoiding(null)}>Cancel</button></div>
          </form>}
        </article>)}</div>
        <div className="behaviour-actions"><button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page}</span><button type="button" disabled={!data.has_more} onClick={() => setPage(p => p + 1)}>Next</button></div>
      </div>}
    </> : <p className="behaviour-card">{readOnly ? 'Select a linked child to view merits and demerits.' : 'Find and select a learner to view or add records.'}</p>}

    {admin && manage && <div className="behaviour-card"><h2>School behaviour types</h2><p>Changes apply to future records. Merits are counted as awards. Demerit points are kept separately.</p>
      <form onSubmit={submitType}><div className="behaviour-form-grid">
        <label>Code<input required pattern="[A-Z0-9_-]{2,12}" maxLength="12" disabled={busy || Boolean(typeForm.id)} value={typeForm.code} onChange={e => setTypeForm({ ...typeForm, code: e.target.value.toUpperCase() })} /></label>
        <label>Type<select disabled={busy || Boolean(typeForm.id)} value={typeForm.kind} onChange={e => setTypeForm({ ...typeForm, kind: e.target.value, category: e.target.value === 'demerit' ? 1 : null, points: e.target.value === 'demerit' ? 2 : null })}><option value="merit">Merit</option><option value="demerit">Demerit</option></select></label>
        <label className="behaviour-full">Description<input required minLength="3" maxLength="300" value={typeForm.label} disabled={busy} onChange={e => setTypeForm({ ...typeForm, label: e.target.value })} /></label>
        {typeForm.kind === 'demerit' && <><label>Category<select value={typeForm.category || 1} onChange={e => setTypeForm({ ...typeForm, category: Number(e.target.value) })}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select></label><label>Demerit points<input required type="number" min="1" max="100" value={typeForm.points ?? ''} onChange={e => setTypeForm({ ...typeForm, points: Number(e.target.value) })} /></label></>}
        {typeForm.id && <label>Available for new records<select value={String(typeForm.is_active)} onChange={e => setTypeForm({ ...typeForm, is_active: e.target.value === 'true' })}><option value="true">Yes</option><option value="false">No</option></select></label>}
      </div><div className="behaviour-actions"><button disabled={busy} className="behaviour-primary">{typeForm.id ? 'Save type' : 'Add type'}</button>{typeForm.id && <button type="button" onClick={() => setTypeForm(emptyType())}>Cancel edit</button>}</div></form>
      <ul className="behaviour-type-list">{types.map(type => <li key={type.id}><span><strong>{type.code}</strong> · {type.label}{type.points ? ` · ${type.points} points` : ''}{!type.is_active ? ' · Inactive' : ''}</span><button type="button" disabled={busy} onClick={() => setTypeForm({ ...type })}>Edit type {type.code}</button></li>)}</ul>
    </div>}
  </section>;
}
