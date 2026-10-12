import React from 'react';
import definition from '../../data/reRegistration2027.json';
import './ReRegistration.css';

export function StatusBadge({ registration }) {
  return <span className={`rr-status rr-status-${registration.status}`}>{registration.status_label}</span>;
}
export function FormSection({ section, form, onChange, grades = [], disabled = false }) {
  const primaryKeys = {
    Learner: ['home_language'],
    'School & services': ['school_transport','transport_mode','aftercare'],
    'Health & documents': ['medical_condition','special_counselling','document_immunisation','document_birth_certificate','document_progress_report','document_transfer_letter'],
    'Parent / guardian': ['parent_email','parent_address','parent_city','parent_postal_code'],
  };
  const primary = section.fields.filter(field => field.required || section.title === 'Family' || primaryKeys[section.title]?.includes(field.key));
  const additional = section.fields.filter(field => !primary.includes(field));
  const renderField = field => {
    const props = { id: `rr-${field.key}`, name: field.key, value: form[field.key] || '', disabled,
      onChange: event => onChange(field.key, event.target.value), maxLength: field.type === 'textarea' ? 1500 : 160,
      'aria-required': !!field.required };
    const choices = field.type === 'grade' ? grades.map(grade => grade.name) : field.choices;
    return <div className={field.type === 'textarea' ? 'rr-field rr-field-wide' : 'rr-field'} key={field.key}>
      <label htmlFor={props.id}>{field.label}{field.required && <span aria-label="required"> *</span>}</label>
      {choices ? <select {...props}><option value="">Choose…</option>{choices.map(value => <option key={value}>{value}</option>)}</select>
        : field.type === 'textarea' ? <textarea {...props} rows={3} /> : <input {...props} type={field.type === 'date' || field.type === 'email' ? field.type : 'text'} />}
    </div>;
  };
  return <section className="rr-card"><h2>{section.title}</h2><p className="rr-muted">{section.description}</p>
    <div className="rr-fields">{primary.map(renderField)}</div>
    {additional.length > 0 && <details className="rr-additional"><summary>More details from the paper form (optional)</summary><p className="rr-muted">Complete any that apply. Existing values are included in your saved form.</p><div className="rr-fields">{additional.map(renderField)}</div></details>}
  </section>;
}
export function FormReview({ form }) {
  return <div className="rr-review">{definition.sections.map(section => {
    const fields = section.fields.filter(field => form[field.key]);
    if (!fields.length) return null;
    return <section className="rr-card" key={section.title}><h3>{section.title}</h3><dl>{fields.map(field => <div key={field.key}>
      <dt>{field.label}</dt><dd>{form[field.key]}</dd></div>)}</dl></section>;
  })}<section className="rr-card"><h3>Declaration</h3><p>{definition.declaration}</p><p className="rr-muted">Name: {form.declared_name || 'Not entered'} · {form.declaration_accepted ? 'Accepted' : 'Not accepted'}</p></section></div>;
}
export function FormDownloads({ download, busy }) {
  return <section className="rr-card rr-downloads"><div><h2>Prefer a paper form?</h2><p className="rr-muted">Download, print and complete both pages. Hand the signed form to the school office. You can also collect a copy at school.</p></div>
    <div className="rr-button-row"><button type="button" className="rr-button rr-secondary" disabled={busy} onClick={() => download('complete')}>Download both pages</button>
      <button type="button" className="rr-button rr-text" disabled={busy} onClick={() => download('page1')}>Page 1</button>
      <button type="button" className="rr-button rr-text" disabled={busy} onClick={() => download('page2')}>Page 2</button></div></section>;
}
export function EmailUpdates({ updates = [] }) {
  if (!updates.length) return null;
  const labels = { queued: 'Queued', sending: 'Sending', accepted: 'Accepted by email provider', skipped: 'Portal confirmation only', failed: 'Email needs attention', check_required: 'Check email provider before retrying' };
  return <div className="rr-email"><h3>Email updates</h3>{updates.map(event => <p key={event.kind}>{event.kind === 'received' ? 'Received confirmation' : 'Approval confirmation'}: {labels[event.status] || event.status}</p>)}
    <p className="rr-muted">Email goes to the submitting account’s verified email, if available. The portal status is the main confirmation.</p></div>;
}
