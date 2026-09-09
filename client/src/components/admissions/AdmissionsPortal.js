import React, { useEffect, useMemo, useState } from 'react';
import { useMatch, useParams } from 'react-router-dom';
import { admissionsPortalApi, portalErrorMessage } from '../../services/admissionsPortalApi';
import HarmonyLogo from '../common/HarmonyLogo';
import './AdmissionsPortal.css';

const Field = ({ label, value, onChange, type = 'text', required, readOnly, hint, multiline }) => (
  <label className={`portal-field ${readOnly ? 'portal-readonly' : ''}`}>
    <span>{label}{required && <b aria-hidden="true"> *</b>}</span>
    {readOnly ? <strong>{value || 'Not provided'}</strong> : multiline
      ? <textarea value={value || ''} onChange={onChange} required={required} rows="5" />
      : <input type={type} value={value || ''} onChange={onChange} required={required} />}
    {hint && <small>{hint}</small>}
  </label>
);

const initialAddress = { addressLine1: '', addressLine2: '', suburb: '', city: '', province: '', postalCode: '' };
const initialEmergency = { fullName: '', relationship: '', phone: '' };
const friendlyItem = (item) => String(item || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export default function AdmissionsPortal() {
  const { token } = useParams();
  const registrationRoute = Boolean(useMatch('/registration/:token'));
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [fields, setFields] = useState({});
  const [choices, setChoices] = useState({});
  const [registration, setRegistration] = useState({ residentialAddress: initialAddress, postalAddress: initialAddress, emergencyContact: initialEmergency, serviceSelections: { boarding: false, transport: false, aftercare: false }, confirmed: false });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Secure admissions | Harmony Learning Institute';
    const metas = [
      ['robots', 'noindex, noarchive, nofollow'],
      ['referrer', 'no-referrer'],
    ];
    const created = metas.map(([name, content]) => {
      let node = document.querySelector(`meta[name="${name}"]`);
      const wasExisting = Boolean(node);
      const previousContent = node?.content;
      if (!node) { node = document.createElement('meta'); node.name = name; document.head.appendChild(node); }
      node.content = content;
      return { node, wasExisting, previousContent };
    });
    return () => {
      document.title = previousTitle;
      created.forEach(({ node, wasExisting, previousContent }) => {
        if (wasExisting) node.content = previousContent;
        else node.remove();
      });
    };
  }, []);

  const load = () => {
    setLoading(true); setError('');
    admissionsPortalApi.getSession(token).then(({ data }) => {
      const expectedMode = registrationRoute ? 'COMPLETE_REGISTRATION' : 'UPDATE_APPLICATION';
      if (data.mode !== expectedMode) {
        setSession(null);
        setError('This secure link is no longer available. Please contact Harmony Learning Institute for assistance.');
        return;
      }
      setSession(data);
      const app = data.application || {};
      setFields({ parentEmail: app.parent?.email || '', parentPhone: app.parent?.phone || '', previousSchool: app.previousSchool || '', additionalNotes: app.additionalNotes || '' });
      setChoices(Object.fromEntries((data.checklist || []).map((item) => [item.itemType, item.parentChoice || ''])));
      const r = data.registration || {};
      setRegistration((current) => ({ ...current, residentialAddress: { ...initialAddress, ...(r.residentialAddress || {}) }, postalAddress: { ...initialAddress, ...(r.postalAddress || {}) }, emergencyContact: { ...initialEmergency, ...(r.emergencyContact || {}) }, serviceSelections: { ...current.serviceSelections, ...(r.serviceSelections || {}) }, confirmed: Boolean(r.confirmedAt) }));
      setSubmitted(data.access === 'read_only' && (r.formStatus === 'SUBMITTED' || data.mode === 'UPDATE_APPLICATION' && data.application?.status === 'SUBMITTED'));
    }).catch((e) => setError(portalErrorMessage(e))).finally(() => setLoading(false));
  };
  useEffect(() => { if (token) load(); }, [token, registrationRoute]); // token comes only from the route and is never persisted

  const isRegistration = session?.mode === 'COMPLETE_REGISTRATION';
  const readOnly = session?.access === 'read_only' || submitted;
  const learnerName = useMemo(() => `${session?.application?.learner?.firstName || ''} ${session?.application?.learner?.lastName || ''}`.trim(), [session]);
  const requestedFields = session?.requestedFields || [];
  const completed = isRegistration
    ? ['addressLine1', 'city', 'emergency'].filter((key) => key === 'emergency' ? registration.emergencyContact.fullName && registration.emergencyContact.phone : registration.residentialAddress[key]).length
    : requestedFields.filter((key) => fields[key]).length + Object.values(choices).filter(Boolean).length;
  const total = isRegistration ? 3 : requestedFields.length + (session?.checklist || []).filter((x) => x.status !== 'RECEIVED').length;

  const updateAddress = (which, key, value) => setRegistration((r) => ({ ...r, [which]: { ...r[which], [key]: value } }));
  const persistDraft = async () => {
    if (isRegistration) {
      await admissionsPortalApi.saveRegistration(token, {
        residentialAddress: registration.residentialAddress,
        postalAddress: registration.postalAddress,
        emergencyContact: registration.emergencyContact,
        serviceSelections: registration.serviceSelections,
        confirmed: registration.confirmed,
      });
    } else {
        const editableItems = new Set((session?.checklist || [])
          .filter((item) => !['RECEIVED', 'NOT_APPLICABLE'].includes(item.status))
          .map((item) => item.itemType));
        const checklistChoices = Object.fromEntries(
          Object.entries(choices).filter(([itemType, choice]) => editableItems.has(itemType) && choice),
        );
        await admissionsPortalApi.saveApplication(token, {
          fields: Object.fromEntries(requestedFields.map((key) => [key, fields[key] || ''])),
          checklistChoices,
        });
    }
  };
  const save = async () => {
    setSaving(true); setError(''); setSaved('');
    try {
      await persistDraft();
      setSaved('Progress saved securely.');
      window.setTimeout(() => setSaved(''), 3500);
    } catch (e) { setError(portalErrorMessage(e)); } finally { setSaving(false); }
  };
  const validateForSubmission = () => {
    if (isRegistration) {
      if (!registration.residentialAddress.addressLine1.trim()
        || !registration.residentialAddress.city.trim()
        || (!registration.postalAddress.sameAsResidential
          && (!String(registration.postalAddress.addressLine1 || '').trim()
            || !String(registration.postalAddress.city || '').trim()))
        || !registration.emergencyContact.fullName.trim()
        || !registration.emergencyContact.relationship.trim()
        || !registration.emergencyContact.phone.trim()
        || !registration.confirmed) {
        return 'Please complete the required address and emergency contact details, then confirm the information before submitting.';
      }
      return '';
    }
    const missingField = requestedFields.some((key) => !String(fields[key] || '').trim());
    const missingChoice = (session?.checklist || []).some(
      (item) => !['RECEIVED', 'NOT_APPLICABLE'].includes(item.status) && !choices[item.itemType],
    );
    return missingField || missingChoice
      ? 'Please complete every requested field and choose how you will provide each requested document.'
      : '';
  };
  const submit = async () => {
    const validationMessage = validateForSubmission();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    setSaving(true); setError('');
    try {
      await persistDraft();
      await (isRegistration ? admissionsPortalApi.submitRegistration(token) : admissionsPortalApi.submitApplication(token));
      setSubmitted(true); setSaved(isRegistration ? 'Registration submitted for review.' : 'Your update has been sent to Harmony.');
    } catch (e) { setError(portalErrorMessage(e)); } finally { setSaving(false); }
  };

  if (loading) return <div className="portal-shell"><PortalHeader /><main className="portal-loading"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /></main></div>;
  if (error && !session) return <div className="portal-shell"><PortalHeader /><main className="portal-message"><h1>This secure link is unavailable</h1><p>{error}</p><ContactLinks /><button className="portal-button primary" onClick={load}>Try again</button></main><PortalFooter /></div>;

  return <div className="portal-shell">
    <PortalHeader />
    <main className="portal-main">
      <div className="portal-kicker"><span>Secure admissions</span><span className="portal-lock">Protected connection</span></div>
      <section className="portal-intro">
        <div><p className="portal-eyebrow">{isRegistration ? 'Registration' : 'Application update'}</p><h1>{submitted ? 'Thank you, {parent}'.replace('{parent}', session.application.parent.firstName) : isRegistration ? 'Complete registration with confidence.' : 'A few final details for Harmony.'}</h1><p className="portal-lede">{isRegistration ? 'Your application is already on file. We only need the practical details below to prepare for your learner’s next chapter.' : 'We have requested only the information that needs attention. Your application status will not change here.'}</p></div>
        <div className="portal-learner"><span>Learner</span><strong>{learnerName}</strong><small>Reference {session.application.reference}</small></div>
      </section>
      {readOnly && isRegistration ? <div className="portal-notice success"><p>Your registration has been submitted and is currently being reviewed by Harmony Learning Institute.</p></div> : null}
      {submitted && !isRegistration ? <div className="portal-notice success"><p>Your update has been submitted successfully. Harmony Learning Institute will review the information and contact you if anything else is needed.</p></div> : null}
      {error && <div className="portal-notice error" role="alert"><p>{error}</p></div>}
      {saved && <div className="portal-notice success" role="status"><p>{saved}</p></div>}
      {!readOnly && <div className="portal-progress"><div><span>Progress</span><strong>{Math.min(completed, total)} of {total} sections complete</strong></div><div className="portal-progress-track"><i style={{ width: `${total ? Math.min(100, completed / total * 100) : 0}%` }} /></div></div>}

      {isRegistration ? <RegistrationForm session={session} registration={registration} setRegistration={setRegistration} updateAddress={updateAddress} readOnly={readOnly} /> : <ApplicationForm session={session} fields={fields} setFields={setFields} choices={choices} setChoices={setChoices} readOnly={readOnly} />}
      {!readOnly && <div className="portal-actions"><button className="portal-button secondary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save progress'}</button><button className="portal-button primary" onClick={submit} disabled={saving}>{isRegistration ? 'Submit registration' : 'Submit update'}</button></div>}
    </main>
    <PortalFooter />
  </div>;
}

function PortalHeader() { return <header className="portal-header"><HarmonyLogo size={50} /><div className="portal-header-copy"><span>Parent admissions</span><strong>Your secure Harmony space</strong></div></header>; }
function ContactLinks() { return <div className="portal-contact-links"><a href="mailto:harmonylearninginstitute@gmail.com">harmonylearninginstitute@gmail.com</a><a href="tel:+27147631358">014 763 1358</a></div>; }
function PortalFooter() { return <footer className="portal-footer"><div><span>Need help?</span><ContactLinks /></div><a href="https://www.auto-m8.co.za/" target="_blank" rel="noreferrer">Powered by AutoM8</a></footer>; }

function ApplicationForm({ session, fields, setFields, choices, setChoices, readOnly }) {
  return <div className="portal-stack">
    <section className="portal-card"><div className="card-heading"><div><p className="portal-eyebrow">Requested information</p><h2>Let’s keep your application moving</h2></div><span className="card-number">01</span></div><p className="card-copy">Only fields specifically requested by Harmony appear here. Information already provided remains unchanged.</p>
      <div className="portal-form-grid">{(session.requestedFields || []).map((key) => <Field key={key} label={{ parentEmail: 'Parent email address', parentPhone: 'Parent phone number', previousSchool: 'Previous school', additionalNotes: 'Additional notes' }[key] || friendlyItem(key)} value={fields[key]} readOnly={readOnly} type={key === 'parentEmail' ? 'email' : key === 'parentPhone' ? 'tel' : 'text'} multiline={key === 'additionalNotes'} onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))} required hint={key === 'additionalNotes' ? 'Please share anything admissions should know.' : null} />)}</div>
    </section>
    <section className="portal-card"><div className="card-heading"><div><p className="portal-eyebrow">Sensitive documents</p><h2>Choose how you will provide each item</h2></div><span className="card-number">02</span></div><p className="card-copy">You are not required to submit sensitive documents online. Choose “Upload later” or bring them directly to Harmony Learning Institute.</p><address className="portal-address"><strong>Physical submission</strong><span>Harmony Learning Institute</span><span>2 Skilferdoring Street</span><span>Onverwacht, Lephalale</span></address>
      <div className="checklist">{(session.checklist || []).filter((item) => !['RECEIVED', 'NOT_APPLICABLE'].includes(item.status)).map((item) => <div className="check-item" key={item.itemType}><div><strong>{friendlyItem(item.itemType)}</strong><small>Requested by Harmony admissions</small></div><div className="choice-group">{['UPLOAD_LATER', 'BRING_IN_PERSON'].map((choice) => <button type="button" key={choice} disabled={readOnly} className={choices[item.itemType] === choice ? 'selected' : ''} onClick={() => setChoices((c) => ({ ...c, [item.itemType]: choice }))}>{choice === 'UPLOAD_LATER' ? 'Upload later' : 'Bring in person'}</button>)}</div></div>)}</div>
    </section>
  </div>;
}

function RegistrationForm({ session, registration, setRegistration, updateAddress, readOnly }) {
  const address = (which, title, required) => <div className="subsection"><h3>{title}</h3><div className="portal-form-grid">{[['addressLine1', 'Street address'], ['addressLine2', 'Address line 2'], ['suburb', 'Suburb'], ['city', 'City'], ['province', 'Province'], ['postalCode', 'Postal code']].map(([key, label]) => <Field key={key} label={label} value={registration[which][key]} readOnly={readOnly} required={required && ['addressLine1', 'city'].includes(key)} onChange={(e) => updateAddress(which, key, e.target.value)} />)}</div></div>;
  return <div className="portal-stack">
    <section className="portal-card read-only-summary"><div className="card-heading"><div><p className="portal-eyebrow">Already on file</p><h2>Application information</h2></div><span className="card-number">✓</span></div><p className="card-copy">We have carried these details across from the application so you do not need to enter them again. They are shown for review only.</p><div className="summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 16 }}>{[['Learner', `${session.application.learner.firstName} ${session.application.learner.lastName}`], ['Date of birth', session.application.learner.dateOfBirth || 'Not provided'], ['Grade applying for', session.application.learner.gradeApplying || 'Not provided'], ['Parent or guardian', `${session.application.parent.firstName} ${session.application.parent.lastName}`], ['Email address', session.application.parent.email || 'Not provided'], ['Application reference', session.application.reference]].map(([label, value]) => <div key={label} style={{ borderLeft: '2px solid #e8e2da', paddingLeft: 12 }}><span style={{ display: 'block', color: '#778494', fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</span><strong style={{ display: 'block', marginTop: 5, fontSize: 14 }}>{value}</strong></div>)}</div></section>
    <section className="portal-card"><div className="card-heading"><div><p className="portal-eyebrow">01 · Where you live</p><h2>Address details</h2></div></div><p className="card-copy">If you need to bring documents or speak with admissions, Harmony Learning Institute is at <strong>2 Skilferdoring Street, Onverwacht, Lephalale.</strong></p>{address('residentialAddress', 'Residential address', true)}<div className="subsection"><h3>Postal address</h3><label className="confirm-row compact"><input type="checkbox" checked={Boolean(registration.postalAddress.sameAsResidential)} disabled={readOnly} onChange={(e) => setRegistration((r) => ({ ...r, postalAddress: { ...r.postalAddress, sameAsResidential: e.target.checked } }))} /><span>My postal address is the same as my residential address.</span></label>{!registration.postalAddress.sameAsResidential && <div className="portal-form-grid">{[['addressLine1', 'Street address'], ['addressLine2', 'Address line 2'], ['suburb', 'Suburb'], ['city', 'City'], ['province', 'Province'], ['postalCode', 'Postal code']].map(([key, label]) => <Field key={key} label={label} value={registration.postalAddress[key]} readOnly={readOnly} required={['addressLine1', 'city'].includes(key)} onChange={(e) => updateAddress('postalAddress', key, e.target.value)} />)}</div>}</div></section>
    <section className="portal-card"><div className="card-heading"><div><p className="portal-eyebrow">02 · Someone we can reach</p><h2>Emergency contact</h2></div></div><div className="portal-form-grid">{[['fullName', 'Full name'], ['relationship', 'Relationship'], ['phone', 'Phone number']].map(([key, label]) => <Field key={key} label={label} value={registration.emergencyContact[key]} readOnly={readOnly} required onChange={(e) => setRegistration((r) => ({ ...r, emergencyContact: { ...r.emergencyContact, [key]: e.target.value } }))} />)}</div></section>
    <section className="portal-card"><div className="card-heading"><div><p className="portal-eyebrow">03 · Optional services</p><h2>Plan for their school day</h2></div></div><p className="card-copy">Tell us which services you would like Harmony to prepare for. These selections can be discussed with admissions.</p><div className="service-list">{[['boarding', 'Boarding', 'A structured home-away-from-home option.'], ['transport', 'School transport', 'Safe travel planning for the school day.'], ['aftercare', 'Aftercare', 'Additional supervised time after lessons.']].map(([key, title, detail]) => <label className={`service-option ${registration.serviceSelections[key] ? 'selected' : ''}`} key={key}><input type="checkbox" checked={registration.serviceSelections[key]} disabled={readOnly} onChange={(e) => setRegistration((r) => ({ ...r, serviceSelections: { ...r.serviceSelections, [key]: e.target.checked } }))} /><span><strong>{title}</strong><small>{detail}</small></span></label>)}</div><label className="confirm-row"><input type="checkbox" checked={registration.confirmed} disabled={readOnly} onChange={(e) => setRegistration((r) => ({ ...r, confirmed: e.target.checked }))} /><span>I confirm that the information above is correct and may be used by Harmony Learning Institute for registration.</span></label></section>
  </div>;
}