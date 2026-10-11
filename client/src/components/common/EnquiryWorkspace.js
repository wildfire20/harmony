import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Plus, RefreshCw, ArrowLeft, Send } from 'lucide-react';
import { enquiryRequestKey } from './enquiryRequestKey';
import './Enquiries.css';

export const ENQUIRY_STATUSES = { new: 'New', on_hold: 'On hold', done: 'Done' };
const date = value => new Date(value).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
const badge = status => <span className={`enquiry-badge enquiry-badge-${status}`}>{ENQUIRY_STATUSES[status]}</span>;

export default function EnquiryWorkspace({ request, admin = false }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState({ subject: '', message: '' });
  const [reply, setReply] = useState('');
  const [statusDraft, setStatusDraft] = useState('new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const createKey = useRef(null);
  const replyKey = useRef(null);
  const statusKey = useRef(null);
  const selected = useRef(null);
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const loadList = useCallback(async () => {
    const sequence = ++listSequence.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({ status: filter, page: String(page) });
      if (admin && search) query.set('q', search);
      const result = await request(`?${query}`);
      if (mounted.current && sequence === listSequence.current) {
        setRows(result.enquiries); setHasMore(result.has_more);
      }
    } catch (e) {
      if (mounted.current && sequence === listSequence.current) setError(e.message);
    } finally {
      if (mounted.current && sequence === listSequence.current) setLoading(false);
    }
  }, [request, filter, page, search, admin]);
  useEffect(() => { loadList(); }, [loadList]);

  const loadThread = async (id, clearReply = false) => {
    const sequence = ++detailSequence.current;
    selected.current = id; setSelectedId(id); setDetailLoading(true);
    if (clearReply) { setDetail(null); setReply(''); replyKey.current = null; statusKey.current = null; }
    try {
      const result = await request(`/${id}`);
      if (mounted.current && sequence === detailSequence.current && selected.current === id) {
        setDetail(result); setStatusDraft(result.enquiry.status);
      }
    } catch (e) {
      if (mounted.current && sequence === detailSequence.current) setError(e.message);
    } finally {
      if (mounted.current && sequence === detailSequence.current) setDetailLoading(false);
    }
  };
  const refresh = async () => {
    setError('');
    await Promise.all([loadList(), selected.current ? loadThread(selected.current) : Promise.resolve()]);
  };
  const sendEnquiry = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      createKey.current ||= enquiryRequestKey();
      const result = await request('', { method: 'POST', body: JSON.stringify({ ...draft, request_key: createKey.current }) });
      setSuccess(`Your enquiry has been sent. Reference: ${result.enquiry.reference}. Replies will appear here.`);
      setDraft({ subject: '', message: '' }); createKey.current = null; setComposing(false);
      await Promise.all([loadList(), loadThread(result.enquiry.id, true)]);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const sendReply = async event => {
    event.preventDefault();
    if (busy || !detail) return;
    setBusy(true); setError(''); setSuccess('');
    const id = detail.enquiry.id;
    try {
      replyKey.current ||= enquiryRequestKey();
      const result = await request(`/${id}/replies`, { method: 'POST', body: JSON.stringify({ message: reply, request_key: replyKey.current }) });
      setDetail(previous => ({ ...previous, enquiry: result.enquiry }));
      setSuccess('Reply sent.'); setReply(''); replyKey.current = null;
      await Promise.all([loadList(), loadThread(id)]);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const saveStatus = async event => {
    event.preventDefault();
    if (busy || !detail) return;
    setBusy(true); setError(''); setSuccess('');
    const id = detail.enquiry.id;
    try {
      statusKey.current ||= enquiryRequestKey();
      const result = await request(`/${id}/status`, { method: 'PATCH', body: JSON.stringify({
        status: statusDraft, version: detail.enquiry.version, request_key: statusKey.current,
      }) });
      setDetail(previous => ({ ...previous, enquiry: result.enquiry }));
      setSuccess(`Status updated to ${ENQUIRY_STATUSES[result.enquiry.status]}.`); statusKey.current = null;
      await Promise.all([loadList(), loadThread(id)]);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const startEnquiry = () => { setComposing(true); setError(''); setSuccess(''); };

  return (
    <div className={`enquiry-shell ${admin ? 'enquiry-admin' : ''}`}>
      <header className="enquiry-heading">
        <div><p className="enquiry-eyebrow">{admin ? 'Parent support' : 'School office'}</p>
          <h1>{admin ? 'Enquiries' : 'Enquiry'}</h1>
          <p>{admin ? 'Read parent questions, reply and track progress.' : 'Ask a question about the Parent Portal or your child’s account.'}</p>
        </div>
        <div className="enquiry-actions">
          <button className="enquiry-btn enquiry-secondary" onClick={refresh} disabled={busy || loading || detailLoading}><RefreshCw size={17} />Refresh</button>
          {!admin && <button className="enquiry-btn" onClick={startEnquiry} disabled={busy}><Plus size={18} />New enquiry</button>}
        </div>
      </header>
      {error && <p className="enquiry-alert enquiry-error" role="alert">{error}</p>}
      {success && <p className="enquiry-alert enquiry-success" role="status">{success}</p>}
      {!admin && composing && <section className="enquiry-card enquiry-compose" aria-labelledby="new-enquiry-heading">
        <h2 id="new-enquiry-heading">New enquiry</h2>
        <p>Do not include passwords, verification codes or banking passwords.</p>
        <form onSubmit={sendEnquiry}>
          <label htmlFor="enquiry-subject">Subject</label>
          <input id="enquiry-subject" required maxLength={160} value={draft.subject} disabled={busy}
            placeholder="What do you need help with?" onChange={e => { setDraft({ ...draft, subject: e.target.value }); createKey.current = null; }} />
          <label htmlFor="enquiry-message">Message</label>
          <textarea id="enquiry-message" required maxLength={2000} rows={4} value={draft.message} disabled={busy}
            placeholder="Tell the school office what happened." onChange={e => { setDraft({ ...draft, message: e.target.value }); createKey.current = null; }} />
          <div className="enquiry-actions"><button className="enquiry-btn" disabled={busy || !draft.subject.trim() || !draft.message.trim()}><Send size={17} />{busy ? 'Sending…' : 'Send enquiry'}</button>
            <button type="button" className="enquiry-btn enquiry-secondary" disabled={busy} onClick={() => setComposing(false)}>Close</button></div>
        </form>
      </section>}
      <div className={`enquiry-workspace ${selectedId ? 'enquiry-has-selection' : ''}`}>
        <section className="enquiry-card enquiry-inbox" aria-label={admin ? 'Enquiries inbox' : 'Your enquiries'}>
          <h2>{admin ? 'Enquiries inbox' : 'Your enquiries'}</h2>
          <label htmlFor="enquiry-filter">Status</label>
          <select id="enquiry-filter" value={filter} disabled={busy} onChange={e => { setFilter(e.target.value); setPage(1); setError(''); }}>
            <option value="all">All</option>{Object.entries(ENQUIRY_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          {admin && <form className="enquiry-search" onSubmit={e => { e.preventDefault(); setSearch(searchDraft.trim()); setPage(1); setError(''); }}>
            <label htmlFor="enquiry-search">Search enquiries</label>
            <input id="enquiry-search" value={searchDraft} maxLength={100} disabled={busy} placeholder="Name, mobile, subject or reference" onChange={e => setSearchDraft(e.target.value)} />
            <button className="enquiry-btn enquiry-secondary" disabled={busy}>Search</button>
          </form>}
          {loading ? <p role="status" className="enquiry-empty">Loading enquiries…</p> : rows.length === 0 ? <div className="enquiry-empty"><MessageSquare size={28} /><p>{admin ? 'No enquiries match this view.' : 'No enquiries in this view. Select New enquiry to ask for help.'}</p></div> :
            <ul className="enquiry-list">{rows.map(row => <li key={row.id}><button className={`enquiry-row ${row.id === selectedId ? 'enquiry-row-selected' : ''}`} disabled={busy} onClick={() => { setError(''); setSuccess(''); loadThread(row.id, true); }} aria-current={row.id === selectedId ? 'true' : undefined}>
              <div className="enquiry-row-top"><small>{row.reference}</small>{badge(row.status)}</div>
              <strong>{row.subject}</strong>{admin && <span>{row.contact_name}{row.source === 'login_help' ? ' · Login help' : ''}</span>}
              <small>Updated {date(row.updated_at)}</small>
            </button></li>)}</ul>}
          <div className="enquiry-pagination"><button className="enquiry-btn enquiry-secondary" disabled={busy || loading || page === 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page}</span><button className="enquiry-btn enquiry-secondary" disabled={busy || loading || !hasMore} onClick={() => setPage(page + 1)}>Next</button></div>
        </section>
        <section className="enquiry-card enquiry-thread" aria-label="Enquiry conversation">
          {selectedId && <button className="enquiry-back enquiry-btn enquiry-secondary" disabled={busy} onClick={() => { selected.current = null; ++detailSequence.current; setSelectedId(null); setDetail(null); setDetailLoading(false); }}><ArrowLeft size={17} />Back to enquiries</button>}
          {detailLoading ? <p className="enquiry-empty" role="status">Loading conversation…</p> : !detail ? <div className="enquiry-empty"><MessageSquare size={32} /><h2>Select an enquiry</h2><p>{admin ? 'Choose a question from the inbox to view it.' : 'Choose a question to read replies and check its status.'}</p></div> : <>
            <div className="enquiry-thread-heading"><div><p className="enquiry-eyebrow">{detail.enquiry.reference}</p><h2>{detail.enquiry.subject}</h2><p>Sent {date(detail.enquiry.created_at)}</p></div>{badge(detail.enquiry.status)}</div>
            {admin && <div className="enquiry-contact"><strong>{detail.enquiry.contact_name}</strong><span>Mobile: {detail.enquiry.contact_phone || 'Not recorded'}</span>
              {detail.enquiry.source === 'login_help' && <p>Login help: contact details supplied by the requester. Confirm their identity before changing an account.</p>}
            </div>}
            {admin && <form className="enquiry-status-form" onSubmit={saveStatus}>
              <div><label htmlFor="enquiry-status">Enquiry status</label><select id="enquiry-status" value={statusDraft} disabled={busy} onChange={e => { setStatusDraft(e.target.value); statusKey.current = null; }}>{Object.entries(ENQUIRY_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
              <button className="enquiry-btn" disabled={busy || statusDraft === detail.enquiry.status}>Save status</button>
            </form>}
            <ol className="enquiry-messages">{detail.messages.map(message => <li key={message.id} className={`enquiry-message enquiry-message-${message.kind === 'status' ? 'status' : message.author_role}`}>
              <div><strong>{message.kind === 'status' ? 'Status update' : message.author_role === 'admin' ? 'School office' : message.author_role === 'guest' ? 'Requester' : 'Parent'}</strong><time dateTime={message.created_at}>{date(message.created_at)}</time></div><p>{message.body}</p>
            </li>)}</ol>
            {admin && detail.enquiry.source === 'login_help' ? <p className="enquiry-note">Contact this parent using the mobile number provided. Replies cannot be read before login.</p> : detail.enquiry.status === 'done' ? <div className="enquiry-note"><p>This enquiry is Done. {admin ? 'Choose New or On hold and select Save status to reopen it.' : 'Send a new enquiry if you still need help.'}</p>{!admin && <button className="enquiry-btn enquiry-secondary" onClick={startEnquiry}>New enquiry</button>}</div> : <form className="enquiry-reply" onSubmit={sendReply}>
              <label htmlFor="enquiry-reply">Your reply</label><textarea id="enquiry-reply" required maxLength={2000} rows={3} value={reply} disabled={busy} onChange={e => { setReply(e.target.value); replyKey.current = null; }} />
              <button className="enquiry-btn" disabled={busy || !reply.trim()}><Send size={17} />{busy ? 'Sending…' : 'Send reply'}</button>
              <p>Replies are saved here. No email is sent.</p>
            </form>}
          </>}
        </section>
      </div>
    </div>
  );
}
