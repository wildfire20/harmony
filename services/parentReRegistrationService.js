const crypto = require('node:crypto');
const db = require('../config/database');
const { logAudit } = require('../utils/auditLogger');
const { normalizePhone } = require('./parentAuth');
const { escapeHtml } = require('./gmailService');
const definition = require('../client/src/data/reRegistration2027.json');
const fields = definition.sections.flatMap(section => section.fields);
const YEAR = definition.schoolYear;
const LABELS = { not_started: 'Not started', draft: 'Draft', submitted: 'Submitted', changes_needed: 'Changes needed', approved: 'Approved' };
const fail = (status, message) => Object.assign(new Error(message), { status });
const isAdmin = actor => ['admin', 'super_admin'].includes(actor?.role);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reference = id => `RR-${YEAR}-${String(id).padStart(6, '0')}`;
function integer(value, label, zero = false) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < (zero ? 0 : 1)) throw fail(400, `Invalid ${label}.`);
  return Number(value);
}
function input(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key))) throw fail(400, 'Invalid form details.');
  if (!UUID.test(body.request_key || '')) throw fail(400, 'Please refresh this form and try again.');
}
function cleanText(value, label, max = 160, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (required && !value.trim())) throw fail(400, `Please check ${label}.`);
  return value.trim();
}
async function transaction(operation) {
  const client = await db.pool.connect();
  try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
async function learner(client, studentId, actor, lock = false) {
  const id = integer(studentId, 'learner');
  if (!isAdmin(actor)) {
    const link = await client.query(`SELECT ps.student_id FROM parent_students ps JOIN users p ON p.id=ps.parent_id
      WHERE ps.parent_id=$1 AND ps.student_id=$2 AND p.role='parent' AND p.is_active=true${lock ? ' FOR SHARE OF ps,p' : ''}`, [actor.id, id]);
    if (!link.rows.length) throw fail(404, 'Learner not found on your account.');
  }
  const result = await client.query(`SELECT u.id,u.first_name,u.last_name,u.student_number,u.grade_id,g.name AS grade_name,to_jsonb(u) AS profile
    FROM users u LEFT JOIN grades g ON g.id=u.grade_id WHERE u.id=$1 AND u.role='student' AND u.is_active=true${lock ? ' FOR UPDATE OF u' : ''}`, [id]);
  if (!result.rows.length) throw fail(404, 'Active learner not found.');
  return result.rows[0];
}
const getRow = async (client, id, lock = false) => (await client.query(
  `SELECT * FROM parent_reregistrations WHERE student_id=$1 AND school_year=$2${lock ? ' FOR UPDATE' : ''}`, [id, YEAR])).rows[0];
async function grades(client) {
  return (await client.query('SELECT id,name FROM grades WHERE is_active IS DISTINCT FROM false ORDER BY id')).rows;
}
async function validateForm(client, value, complete) {
  const allowed = [...fields.map(f => f.key), 'declared_name', 'declaration_accepted'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw fail(400, 'Invalid form fields.');
  const form = {};
  for (const field of fields) {
    const text = cleanText(value[field.key], field.label, field.type === 'textarea' ? 1500 : 160, complete && field.required);
    if (text && field.choices && !field.choices.includes(text)) throw fail(400, `Please check ${field.label}.`);
    if (text && field.type === 'email' && !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(text)) throw fail(400, `Please check ${field.label}.`);
    if (text && field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text)) || new Date(text).toISOString().slice(0,10) !== text || text > new Date().toISOString().slice(0,10))) throw fail(400, `Please check ${field.label}.`);
    if (text) form[field.key] = text;
  }
  if (form.grade_applied_for && !(await grades(client)).some(g => g.name === form.grade_applied_for)) throw fail(400, 'Please choose a grade offered by the school.');
  if (form.parent_mobile && !normalizePhone(form.parent_mobile)) throw fail(400, 'Please enter a valid South African parent / guardian mobile number.');
  form.declared_name = cleanText(value.declared_name, 'the name in the declaration', 200, complete);
  if (value.declaration_accepted !== undefined && typeof value.declaration_accepted !== 'boolean') throw fail(400, 'Please check the declaration.');
  form.declaration_accepted = value.declaration_accepted === true;
  if (complete && !form.declaration_accepted) throw fail(400, 'Please accept the declaration before submitting.');
  return form;
}
async function prefill(client, child, actor) {
  const profile = child.profile;
  const parent = (await client.query('SELECT first_name,last_name,phone_number,email FROM users WHERE id=$1', [actor.id])).rows[0] || {};
  const form = { first_name: child.first_name || '', surname: child.last_name || '',
    parent_first_name: parent.first_name || '', parent_surname: parent.last_name || '',
    parent_mobile: parent.phone_number || '', parent_email: parent.email || '', declaration_accepted: false };
  // Only known child attributes are copied. Auth/financial fields are never exposed.
  for (const key of ['date_of_birth','physical_address','city_suburb','postal_code','home_language','gender']) {
    if (typeof profile[key] === 'string') form[key] = key === 'date_of_birth' ? profile[key].slice(0,10) : profile[key].slice(0,160);
  }
  return form;
}
function projection(row, actor) {
  if (!row) return { status: 'not_started', status_label: LABELS.not_started, version: 0, reference: null, source: null, form: null, read_only: false };
  // A paper receipt can name another guardian. Retained draft data stays Admin-only.
  const canRead = isAdmin(actor) || (row.source === 'portal' && row.submitted_by === actor.id);
  return { id: row.id, reference: reference(row.id), source: row.source, status: row.status, status_label: LABELS[row.status],
    version: row.version, submitted_at: row.submitted_at, approved_at: row.approved_at, updated_at: row.updated_at,
    review_note: row.review_note, form: canRead ? row.form_data : null,
    read_only: row.source === 'paper' || !canRead || !['draft','changes_needed'].includes(row.status),
    ...(isAdmin(actor) ? { office_note: row.office_note, submitted_by: row.submitted_by } : {}) };
}
async function detail(client, child, row, actor) {
  const result = { school_year: YEAR, child: { id: child.id, first_name: child.first_name, last_name: child.last_name, student_number: child.student_number, grade_name: child.grade_name },
    registration: projection(row, actor), grades: await grades(client) };
  if (!row && !isAdmin(actor)) result.registration.form = await prefill(client, child, actor);
  if (row && (isAdmin(actor) || row.submitted_by === actor.id)) result.email_updates = (await client.query(
    'SELECT kind,status,error_category FROM parent_reregistration_emails WHERE registration_id=$1 ORDER BY id', [row.id])).rows;
  if (isAdmin(actor)) result.parents = (await client.query(`SELECT u.id,u.first_name,u.last_name FROM parent_students ps JOIN users u ON u.id=ps.parent_id
    WHERE ps.student_id=$1 AND u.role='parent' AND u.is_active=true ORDER BY u.id`, [child.id])).rows;
  return result;
}
async function getRegistration(studentId, actor) {
  const child = await learner(db, studentId, actor);
  return detail(db, child, await getRow(db, child.id), actor);
}
async function duplicate(client, body, actor, childId, action, hash) {
  const saved = (await client.query(`SELECT a.*,r.student_id FROM parent_reregistration_actions a JOIN parent_reregistrations r ON r.id=a.registration_id WHERE a.request_key=$1::uuid`, [body.request_key])).rows[0];
  if (!saved) return false;
  if (saved.actor_id !== actor.id || saved.student_id !== childId || saved.action !== action || saved.payload_hash !== hash) throw fail(409, 'This request has changed. Please refresh and try again.');
  return true;
}
async function recordAction(client, row, body, actor, action, hash) {
  await client.query('INSERT INTO parent_reregistration_actions(request_key,registration_id,actor_id,action,payload_hash) VALUES($1::uuid,$2,$3,$4,$5)', [body.request_key, row.id, actor.id, action, hash]);
  await logAudit({ executor: client, required: true, userId: actor.id,
    userName: `${actor.first_name || ''} ${actor.last_name || ''}`.trim(), userRole: actor.role,
    action: `reregistration_${action}`, entityType: 'parent_reregistration', entityId: row.id,
    details: { student_id: row.student_id, school_year: YEAR, status: row.status, version: row.version, source: row.source } });
}
async function queueEmail(client, row, child, kind) {
  const parent = row.submitted_by ? (await client.query(`SELECT u.id,u.email,(to_jsonb(u)->>'email_verified_at') AS email_verified_at
    FROM users u JOIN parent_students ps ON ps.parent_id=u.id AND ps.student_id=$2
    WHERE u.id=$1 AND u.role='parent' AND u.is_active=true`, [row.submitted_by, row.student_id])).rows[0] : null;
  const eligible = Boolean(parent?.email_verified_at && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(parent?.email || ''));
  const title = kind === 'received' ? 'Re-registration received' : 'Re-registration approved';
  const message = kind === 'received'
    ? 'We have received your re-registration for 2027. The school office will review it. This is a receipt, not approval.'
    : 'Your re-registration for 2027 has been approved by the school office. Please check the Parent Portal for the confirmation and any instructions from Admin.';
  const html = `<div style="font-family:Arial,sans-serif;color:#19324a;max-width:560px;margin:auto"><h2>${title}</h2><p>Dear Parent / Guardian,</p><p>${message}</p>
    <p><strong>Learner:</strong> ${escapeHtml(`${child.first_name} ${child.last_name}`)}<br><strong>Reference:</strong> ${reference(row.id)}</p>
    <p><a href="https://www.harmonylearning.co.za/parent/re-registration">View re-registration in the Parent Portal</a></p>
    <p>Harmony Learning Institute<br>Please contact the school office if you need help.</p></div>`;
  await client.query(`INSERT INTO parent_reregistration_emails(registration_id,kind,recipient_id,recipient_email,subject,html,status,error_category)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(registration_id,kind) DO NOTHING`,
    [row.id, kind, parent?.id || null, eligible ? parent.email : null, `${title} — Harmony 2027`, html, eligible ? 'queued' : 'skipped', eligible ? null : 'NO_VERIFIED_EMAIL']);
}
async function saveRegistration(studentId, actor, body, submit = false) {
  input(body, ['version','form','request_key']);
  const version = integer(body.version, 'form version', true);
  const action = submit ? 'submit' : 'save_draft';
  return transaction(async client => {
    const child = await learner(client, studentId, actor, true);
    if (isAdmin(actor)) throw fail(403, 'Online forms must be submitted by the linked parent / guardian.');
    const form = await validateForm(client, body.form, submit);
    const hash = crypto.createHash('sha256').update(JSON.stringify({ form, version })).digest('hex');
    let row = await getRow(client, child.id, true);
    if (await duplicate(client, body, actor, child.id, action, hash)) return { ...await detail(client, child, row, actor), duplicate: true };
    if (row && (row.submitted_by !== actor.id || row.source !== 'portal')) throw fail(409, 'A form already exists for this child. Please contact the school office.');
    if ((row?.version || 0) !== version) throw fail(409, 'This form has changed. Reload it before making changes.');
    if (row && !['draft','changes_needed'].includes(row.status)) throw fail(409, 'This form has already been submitted. Please contact the school office if a correction is needed.');
    if (!row) row = (await client.query(`INSERT INTO parent_reregistrations(school_year,student_id,submitted_by,source,form_data)
      VALUES($1,$2,$3,'portal',$4::jsonb) RETURNING *`, [YEAR, child.id, actor.id, JSON.stringify(form)])).rows[0];
    else row = (await client.query(`UPDATE parent_reregistrations SET form_data=$2::jsonb,version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *`, [row.id, JSON.stringify(form)])).rows[0];
    if (submit) {
      row = (await client.query(`UPDATE parent_reregistrations SET status='submitted',submitted_at=COALESCE(submitted_at,NOW()),review_note='',updated_at=NOW() WHERE id=$1 RETURNING *`, [row.id])).rows[0];
      await queueEmail(client, row, child, 'received');
    }
    await recordAction(client, row, body, actor, action, hash);
    return detail(client, child, row, actor);
  });
}
async function reviewRegistration(studentId, actor, body) {
  if (!isAdmin(actor)) throw fail(403, 'Admin access is required.');
  input(body, ['version','action','note','parent_id','paper_signed','review_confirmed','request_key']);
  const version = integer(body.version, 'form version', true);
  if (!['approve','request_changes','paper'].includes(body.action)) throw fail(400, 'Invalid review action.');
  const note = cleanText(body.note, 'review note', 1500, body.action === 'request_changes');
  const parentId = body.parent_id ? integer(body.parent_id, 'parent') : null;
  if (body.action !== 'paper' && (parentId || body.paper_signed !== undefined)) throw fail(400, 'Invalid review fields.');
  if (body.action === 'paper' && body.paper_signed !== true) throw fail(400, 'Confirm that the signed paper form was received.');
  if (body.action === 'approve' && body.review_confirmed !== true) throw fail(400, 'Confirm that you have reviewed the form and documents.');
  const hash = crypto.createHash('sha256').update(JSON.stringify({ version, action: body.action, note, parentId, paper_signed: body.paper_signed, review_confirmed: body.review_confirmed })).digest('hex');
  return transaction(async client => {
    const child = await learner(client, studentId, actor, true);
    let row = await getRow(client, child.id, true);
    if (await duplicate(client, body, actor, child.id, body.action, hash)) return { ...await detail(client, child, row, actor), duplicate: true };
    if ((row?.version || 0) !== version) throw fail(409, 'This form has changed. Reload it before reviewing.');
    if (body.action === 'paper') {
      if (row && !['draft','changes_needed'].includes(row.status)) throw fail(409, 'A submitted or approved form already exists for this child.');
      if (parentId && !(await client.query(`SELECT u.id FROM users u JOIN parent_students ps ON ps.parent_id=u.id
        WHERE u.id=$1 AND ps.student_id=$2 AND u.role='parent' AND u.is_active=true FOR SHARE OF ps,u`, [parentId, child.id])).rows.length) throw fail(400, 'Choose a parent linked to this learner.');
      if (!row) row = (await client.query(`INSERT INTO parent_reregistrations(school_year,student_id,submitted_by,source,status,submitted_at,office_note)
        VALUES($1,$2,$3,'paper','submitted',NOW(),$4) RETURNING *`, [YEAR, child.id, parentId, note])).rows[0];
      else row = (await client.query(`UPDATE parent_reregistrations SET source='paper',submitted_by=$2,status='submitted',office_note=$3,
        submitted_at=COALESCE(submitted_at,NOW()),review_note='',version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *`, [row.id, parentId, note])).rows[0];
      await queueEmail(client, row, child, 'received');
    } else {
      if (!row || row.status !== 'submitted') throw fail(409, 'Only a submitted form can be reviewed.');
      row = (await client.query(`UPDATE parent_reregistrations SET status=$2,review_note=$3,reviewed_by=$4,
        approved_at=CASE WHEN $2::text='approved' THEN NOW() ELSE NULL END,version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *`,
        [row.id, body.action === 'approve' ? 'approved' : 'changes_needed', note, actor.id])).rows[0];
      if (body.action === 'approve') await queueEmail(client, row, child, 'approved');
    }
    await recordAction(client, row, body, actor, body.action, hash);
    return detail(client, child, row, actor);
  });
}
async function listRegistrations(actor, query = {}) {
  if (!isAdmin(actor)) throw fail(403, 'Admin access is required.');
  const page = query.page === undefined ? 1 : integer(query.page, 'page');
  if (page > 10000) throw fail(400, 'Invalid page.');
  const values = [YEAR];
  const clauses = ["u.role='student'", 'u.is_active=true'];
  if (query.status && query.status !== 'all') {
    if (!Object.hasOwn(LABELS, query.status)) throw fail(400, 'Invalid status.');
    values.push(query.status); clauses.push(`COALESCE(r.status,'not_started')=$${values.length}`);
  }
  if (query.grade_id) { values.push(integer(query.grade_id, 'grade')); clauses.push(`u.grade_id=$${values.length}`); }
  if (query.q) {
    values.push(`%${cleanText(query.q, 'search', 100).replace(/[\\%_]/g, '\\$&')}%`);
    clauses.push(`(u.first_name ILIKE $${values.length} OR u.last_name ILIKE $${values.length} OR u.student_number ILIKE $${values.length})`);
  }
  const rows = (await db.query(`SELECT u.id,u.first_name,u.last_name,u.student_number,g.name AS grade_name,r.id AS registration_id,
    COALESCE(r.status,'not_started') AS status,r.source,r.updated_at,count(*) OVER()::integer AS total
    FROM users u LEFT JOIN grades g ON g.id=u.grade_id LEFT JOIN parent_reregistrations r ON r.student_id=u.id AND r.school_year=$1
    WHERE ${clauses.join(' AND ')} ORDER BY u.last_name,u.first_name,u.id LIMIT 25 OFFSET ${(page-1)*25}`, values)).rows;
  const counts = (await db.query(`SELECT COALESCE(r.status,'not_started') AS status,count(*)::integer AS count
    FROM users u LEFT JOIN parent_reregistrations r ON r.student_id=u.id AND r.school_year=$1
    WHERE u.role='student' AND u.is_active=true GROUP BY COALESCE(r.status,'not_started')`, [YEAR])).rows;
  return { school_year: YEAR, registrations: rows.map(({ total, ...row }) => ({ ...row, status_label: LABELS[row.status], reference: row.registration_id ? reference(row.registration_id) : null })),
    counts: Object.fromEntries(counts.map(row => [row.status,row.count])), page, total: rows[0]?.total || 0, has_more: rows[0]?.total > page*25, grades: await grades(db) };
}
async function pendingCount(actor) {
  if (!isAdmin(actor)) throw fail(403, 'Admin access is required.');
  const result = await db.query(`SELECT count(*)::integer AS count FROM parent_reregistrations r JOIN users u ON u.id=r.student_id
    WHERE r.school_year=$1 AND r.status='submitted' AND u.role='student' AND u.is_active=true`, [YEAR]);
  return result.rows[0];
}
module.exports = { YEAR, LABELS, getRegistration, saveRegistration, reviewRegistration, listRegistrations, pendingCount };
