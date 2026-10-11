import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Send } from 'lucide-react';
import { enquiryRequestKey } from '../common/enquiryRequestKey';
import '../common/Enquiries.css';

export default function ParentHelp() {
  const [draft, setDraft] = useState({ contact_name: '', contact_phone: '', subject: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const requestKey = useRef(null);
  const change = (key, value) => { setDraft(previous => ({ ...previous, [key]: value })); requestKey.current = null; };
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      requestKey.current ||= enquiryRequestKey();
      const response = await fetch('/api/parent/enquiries/help', { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, request_key: requestKey.current }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.enquiry?.reference) throw new Error(result.message || 'We could not send your enquiry. Please try again.');
      setReference(result.enquiry.reference); setDraft({ contact_name: '', contact_phone: '', subject: '', message: '' });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <div className="enquiry-help-page"><div className="enquiry-shell">
    <Link className="enquiry-help-return" to="/parent/login"><ArrowLeft size={17} />Back to sign in</Link>
    <div className="enquiry-help-brand"><img src="/images/harmony-logo.png" alt="" /><div><strong>Harmony Learning</strong><p>PARENT PORTAL</p></div></div>
    <section className="enquiry-card enquiry-compose">
      {reference ? <div className="enquiry-help-success" role="status"><CheckCircle size={44} /><h1>Your enquiry has been sent</h1><p>Your reference</p><strong>{reference}</strong><p>The school office will contact you using the mobile number you provided.</p><Link to="/parent/login" className="enquiry-btn">Back to sign in</Link></div> : <>
        <p className="enquiry-eyebrow">School office</p><h1>Get Help</h1><p>Cannot sign in or activate your account? Send a question to the school office. You do not need an email address.</p>
        {error && <p className="enquiry-alert enquiry-error" role="alert">{error}</p>}
        <form onSubmit={submit}>
          <label htmlFor="help-name">Your name and surname</label><input id="help-name" required maxLength={200} autoComplete="name" value={draft.contact_name} disabled={busy} onChange={e => change('contact_name', e.target.value)} />
          <label htmlFor="help-phone">Mobile number</label><input id="help-phone" type="tel" required maxLength={32} autoComplete="tel" placeholder="e.g. 073 123 4567" value={draft.contact_phone} disabled={busy} onChange={e => change('contact_phone', e.target.value)} /><p className="enquiry-note">Use the number where the school can contact you.</p>
          <label htmlFor="help-subject">Subject</label><input id="help-subject" required maxLength={160} placeholder="What do you need help with?" value={draft.subject} disabled={busy} onChange={e => change('subject', e.target.value)} />
          <label htmlFor="help-message">Message</label><textarea id="help-message" required maxLength={2000} rows={4} placeholder="Tell us what happened." value={draft.message} disabled={busy} onChange={e => change('message', e.target.value)} />
          <p className="enquiry-note">Do not include passwords, verification codes or banking passwords.</p>
          <button className="enquiry-btn" disabled={busy || Object.values(draft).some(value => !value.trim())}><Send size={17} />{busy ? 'Sending…' : 'Send enquiry'}</button>
        </form>
      </>}
    </section>
  </div></div>;
}
