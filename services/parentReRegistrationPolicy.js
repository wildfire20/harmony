const definition = require('../client/src/data/reRegistration2027.json');
const primary = grade => /^Grade\s*[1-7]$/i.test(grade || '');
const preschool = grade => /^(Baby|Toddler|Preschool|Pre-school|Grade\s*R)/i.test(grade || '');
const visibleField = (field, form) => !field.when || form.returning === field.when;
const requiredField = (field, form) => field.required || field.requiredWhen === form.returning;
const feeTerms = form => ({ required: form.returning === 'Yes' && primary(form.grade_applied_for),
  amount: form.returning === 'Yes' && primary(form.grade_applied_for) ? definition.depositAmount : 0,
  deadline: definition.deadline });
module.exports = { primary, preschool, visibleField, requiredField, feeTerms };
