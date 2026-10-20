const definition = require('../client/src/data/reRegistration2027.json');
const primary = grade => /^Grade\s*[1-7]$/i.test(grade || '');
const preschool = grade => /^(Baby|Toddler|Preschool|Pre-school|Grade\s*R)/i.test(grade || '');
const visibleField = (field, form) => !field.when || form.returning === field.when;
const requiredField = (field, form) => field.required || field.requiredWhen === form.returning;
const feeTerms = form => ({ required: form.returning === 'Yes' && primary(form.grade_applied_for),
  amount: form.returning === 'Yes' && primary(form.grade_applied_for) ? definition.depositAmount : 0,
  deadline: definition.deadline });
function registrationWindow(now=new Date()) {
  const opens=new Date(`${definition.opensOn}T00:00:00+02:00`);
  const closes=new Date(`${definition.closesOn}T23:59:59.999+02:00`);
  const phase=now<opens?'not_open':now>closes?'closed':'open';
  return {opens_on:definition.opensOn,closes_on:definition.closesOn,time_zone:'Africa/Johannesburg',
    phase,is_open:phase==='open',message:phase==='not_open'?'Online re-registration opens on 11 December 2026 and closes on 8 January 2027.'
      :phase==='closed'?'Online re-registration closed on 8 January 2027. Please contact the school office.'
      :'Online re-registration is open until the end of 8 January 2027.'};
}
module.exports = { registrationWindow, primary, preschool, visibleField, requiredField, feeTerms };
