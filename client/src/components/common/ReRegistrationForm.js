import React from 'react';
import definition from '../../data/reRegistration2027.json';
import './ReRegistration.css';

export function StatusBadge({ registration }) {
  return <span className={`rr-status rr-status-${registration.status}`}>{registration.status_label}</span>;
}
export const visibleField = (field,form) => !field.when || form.returning===field.when;
export const requiredField = (field,form) => field.required || field.requiredWhen===form.returning;
export function FormSection({section,form,onChange,grades=[],disabled=false}) {
  return <section className="rr-card"><h2>{section.title}</h2><div className="rr-fields">{section.fields.filter(field=>visibleField(field,form)).map(field=>{
    const choices=field.type==='grade' ? grades.map(g=>g.name) : field.choices;
    const props={id:`rr-${field.key}`,value:form[field.key] || '',disabled:disabled || field.readonly,
      onChange:event=>onChange(field.key,event.target.value),maxLength:field.type==='textarea' ? 1500 : 160,'aria-required':!!requiredField(field,form)};
    return <div className={field.type==='textarea' ? 'rr-field rr-field-wide' : 'rr-field'} key={field.key}>
      <label htmlFor={props.id}>{field.label}{requiredField(field,form) && ' *'}</label>
      {choices ? <select {...props}><option value="">Choose…</option>{choices.map(value=><option key={value}>{value}</option>)}</select>
        : field.type==='textarea' ? <textarea {...props} rows={2}/> : <input {...props} type={field.type==='date' ? 'date' : 'text'}/>}
    </div>;
  })}</div></section>;
}
export function FeesUndertaking({form}) {
  if (form.returning!=='Yes') return null;
  const primary=/^Grade\s*[1-7]$/i.test(form.grade_applied_for || '');
  return <section className="rr-card"><h2>Fees undertaking for 2027</h2>
    {!form.grade_applied_for ? <p>Choose the grade requested for 2027 to see the applicable fee.</p> : primary ? <>
      <div className="rr-notice"><strong>R500 non-refundable re-registration deposit</strong>Pay on or before <b>11 January 2027</b>. Use your child’s <b>HAR reference number</b>.</div>
      <p>Day scholars: <b>R2,350 per month</b>. Boarders: <b>R3,950 per month</b>.</p></> : <>
      <div className="rr-notice"><strong>No re-registration fee for Preschool, Baby Class or Grade R.</strong></div>
      <p>Baby Class: R1,900 per month. Preschool / Grade R: R1,850 per month. Boarding: R3,650 per month.</p></>}
    <p><b>NO FEE INCREASE FOR 2027.</b></p><p>Uniform must be complete on the first school day. <b>NO UNIFORM, NO ENTRY.</b></p>
    <p>Complete re-registration by 11 January 2027. Late re-registration may result in the place being offered to a learner on the waiting list.</p>
  </section>;
}
export function FormReview({ form }) {
  return <div className="rr-review">{definition.sections.map(section => {
    const fields = section.fields.filter(field => visibleField(field,form) && form[field.key]);
    if (!fields.length) return null;
    return <section className="rr-card" key={section.title}><h3>{section.title}</h3><dl>{fields.map(field => <div key={field.key}>
      <dt>{field.label}</dt><dd>{form[field.key]}</dd></div>)}</dl></section>;
  })}<section className="rr-card"><h3>Declaration</h3><p>{definition.declaration}</p><p className="rr-muted">Name: {form.declared_name || 'Not entered'} · {form.declaration_accepted ? 'Accepted' : 'Not accepted'}</p></section></div>;
}
export function FormDownloads({download,busy,category='primary'}) {
  const [choice,setChoice]=React.useState(category);
  React.useEffect(()=>setChoice(category),[category]);
  return <section className="rr-card rr-downloads"><h2>Prefer a paper form?</h2>
    <p>Download the one-page form, print and sign it. Hand it to the school office, or send a clear copy privately to WhatsApp <b>071 167 9620</b>. You can also collect a copy at school.</p>
    <label htmlFor="rr-download-category">Form for the grade requested in 2027</label>
    <select id="rr-download-category" value={choice} disabled={busy} onChange={event=>setChoice(event.target.value)}>
      <option value="primary">Grades 1–7</option><option value="preschool">Baby Class, Preschool and Grade R</option></select>
    <div className="rr-button-row"><button className="rr-button rr-secondary" type="button" disabled={busy} onClick={()=>download(choice)}>Download form</button></div>
  </section>;
}
export function EmailUpdates({ updates = [] }) {
  if (!updates.length) return null;
  const labels = { queued: 'Queued', sending: 'Sending', accepted: 'Accepted by email provider', skipped: 'Portal confirmation only', failed: 'Email needs attention', check_required: 'Check email provider before retrying' };
  return <div className="rr-email"><h3>Email updates</h3>{updates.map(event => <p key={event.kind}>{event.kind === 'received' ? 'Received confirmation' : 'Approval confirmation'}: {labels[event.status] || event.status}</p>)}
    <p className="rr-muted">Email goes to the submitting account’s verified email, if available. The portal status is the main confirmation.</p></div>;
}
