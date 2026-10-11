const crypto = require('node:crypto');
const db = require('../config/database');
const { logAudit } = require('../utils/auditLogger');
const { normalizePhone } = require('./parentAuth');

const LABELS = Object.freeze({ new: 'New', on_hold: 'On hold', done: 'Done' });
const fail = (status, message) => Object.assign(new Error(message), { status });
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reference = id => `ENQ-${String(id).padStart(6, '0')}`;
const admin = actor => ['admin', 'super_admin'].includes(actor?.role);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Count conversations, not individual messages; closing an enquiry clears its alert.
const ADMIN_UNREAD = `e.status <> 'done' AND EXISTS (
  SELECT 1 FROM parent_enquiry_messages m
  WHERE m.enquiry_id=e.id AND m.kind='message' AND m.author_role IN ('parent','guest')
    AND m.id > COALESCE((SELECT r.last_read_message_id FROM parent_enquiry_admin_reads r
      WHERE r.enquiry_id=e.id AND r.admin_id=$1),0)
)`;

function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw fail(400, `${label} is required and must be no longer than ${max} characters.`);
  }
  return value.trim();
}
function input(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !allowed.includes(key))) throw fail(400, 'Invalid enquiry details.');
  if (!UUID.test(body.request_key || '')) throw fail(400, 'Please refresh the form and try again.');
  return body;
}
function integer(value, label, max = 2147483647) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) ||
      Number(value) < 1 || Number(value) > max) throw fail(400, `Invalid ${label}.`);
  return Number(value);
}
function projection(row, isAdmin = false) {
  const result = {
    id: row.id, reference: reference(row.id), subject: row.subject, status: row.status,
    version: row.version, created_at: row.created_at, updated_at: row.updated_at,
  };
  if (isAdmin) Object.assign(result, {
    source: row.source, contact_name: row.contact_name, contact_phone: row.contact_phone,
    parent_id: row.parent_id,
  });
  if (isAdmin && Object.hasOwn(row, 'unread')) result.unread = row.unread;
  return result;
}
async function transaction(operation) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
async function owned(client, id, actor, lock = false) {
  const result = await client.query(
    `SELECT * FROM parent_enquiries WHERE id=$1${admin(actor) ? '' : ' AND parent_id=$2'}${lock ? ' FOR UPDATE' : ''}`,
    admin(actor) ? [integer(id, 'enquiry')] : [integer(id, 'enquiry'), actor.id],
  );
  if (!result.rows.length) throw fail(404, 'Enquiry not found.');
  return result.rows[0];
}
async function audit(client, actor, action, enquiry, details) {
  await logAudit({ executor: client, required: true, userId: actor.id,
    userName: `${actor.first_name || ''} ${actor.last_name || ''}`.trim(), userRole: actor.role,
    action, entityType: 'parent_enquiry', entityId: enquiry.id, details });
}

async function createEnquiry(body, actor = null) {
  const guest = !actor;
  input(body, guest
    ? ['subject', 'message', 'contact_name', 'contact_phone', 'request_key']
    : ['subject', 'message', 'request_key']);
  const subject = text(body.subject, 'Subject', 160);
  const message = text(body.message, 'Message', 2000);
  let contactName;
  let contactPhone;
  if (guest) {
    contactName = text(body.contact_name, 'Your name', 200);
    contactPhone = normalizePhone(text(body.contact_phone, 'Mobile number', 32));
    if (!contactPhone) throw fail(400, 'Please enter a valid South African mobile number.');
  }
  const requestHash = hash({ source: guest ? 'login_help' : 'portal', parent: actor?.id || null,
    subject, message, ...(guest ? { contactName, contactPhone } : {}) });
  return transaction(async client => {
    if (!guest) {
      const parent = await client.query(
        `SELECT first_name,last_name,phone_number FROM users WHERE id=$1 AND role='parent' AND is_active=true`,
        [actor.id],
      );
      if (!parent.rows.length) throw fail(403, 'An active Parent account is required.');
      contactName = `${parent.rows[0].first_name || ''} ${parent.rows[0].last_name || ''}`.trim() || 'Parent';
      contactPhone = String(parent.rows[0].phone_number || '').slice(0, 32);
    }
    const inserted = await client.query(
      `INSERT INTO parent_enquiries (parent_id,source,contact_name,contact_phone,subject,request_key,request_hash)
       VALUES ($1,$2,$3,$4,$5,$6::uuid,$7) ON CONFLICT (request_key) DO NOTHING RETURNING *`,
      [actor?.id || null, guest ? 'login_help' : 'portal', contactName, contactPhone, subject, body.request_key, requestHash],
    );
    let row = inserted.rows[0];
    const duplicate = !row;
    if (duplicate) {
      row = (await client.query('SELECT * FROM parent_enquiries WHERE request_key=$1::uuid', [body.request_key])).rows[0];
      if (!row || row.request_hash !== requestHash) throw fail(409, 'This form has changed. Please submit a new enquiry.');
    } else {
      await client.query(
        `INSERT INTO parent_enquiry_messages (enquiry_id,author_id,author_role,body,request_key,request_hash)
         VALUES ($1,$2,$3,$4,$5::uuid,$6)`,
        [row.id, actor?.id || null, guest ? 'guest' : 'parent', message, body.request_key, requestHash],
      );
    }
    // A public submission never looks up or confirms an existing Parent account.
    return { enquiry: guest ? { reference: reference(row.id), status: row.status } : projection(row), duplicate };
  });
}

async function listEnquiries(actor, query = {}) {
  const isAdmin = admin(actor);
  const page = query.page === undefined ? 1 : integer(query.page, 'page', 10000);
  const limit = 25;
  const values = [actor.id];
  const clauses = isAdmin ? ['TRUE'] : ['parent_id=$1'];
  if (query.status && query.status !== 'all') {
    if (typeof query.status !== 'string' || !Object.hasOwn(LABELS, query.status)) throw fail(400, 'Invalid enquiry status.');
    values.push(query.status); clauses.push(`status=$${values.length}`);
  }
  if (query.q) {
    if (!isAdmin) throw fail(400, 'Search is available to Admin only.');
    const search = text(query.q, 'Search', 100);
    values.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    clauses.push(`(subject ILIKE $${values.length} OR contact_name ILIKE $${values.length}
      OR contact_phone ILIKE $${values.length} OR ('ENQ-' || lpad(id::text,6,'0')) ILIKE $${values.length})`);
  }
  const where = clauses.join(' AND ');
  const rows = await db.query(`SELECT e.*${isAdmin ? `, (${ADMIN_UNREAD}) AS unread` : ''} FROM parent_enquiries e WHERE ${where}
    ORDER BY updated_at DESC,id DESC LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}`, values);
  return { enquiries: rows.rows.slice(0, limit).map(row => projection(row, isAdmin)),
    page, has_more: rows.rows.length > limit };
}
async function getAdminUnreadCount(actor) {
  if (!admin(actor)) throw fail(403, 'Only Admin can view enquiry alerts.');
  const result = await db.query(`SELECT count(*)::integer AS count FROM parent_enquiries e WHERE ${ADMIN_UNREAD}`, [actor.id]);
  return { count: result.rows[0].count };
}
async function markEnquiryRead(id, actor, body) {
  if (!admin(actor)) throw fail(403, 'Only Admin can mark enquiries as read.');
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => key !== 'last_message_id')) throw fail(400, 'Invalid read details.');
  const messageId = integer(body.last_message_id, 'message');
  return transaction(async client => {
    const row = await owned(client, id, actor, true);
    const message = await client.query('SELECT id FROM parent_enquiry_messages WHERE enquiry_id=$1 AND id=$2', [row.id, messageId]);
    if (!message.rows.length) throw fail(400, 'The read position must belong to this enquiry.');
    await client.query(`INSERT INTO parent_enquiry_admin_reads (enquiry_id,admin_id,last_read_message_id)
      VALUES ($1,$2,$3) ON CONFLICT (enquiry_id,admin_id) DO UPDATE
      SET last_read_message_id=GREATEST(parent_enquiry_admin_reads.last_read_message_id,EXCLUDED.last_read_message_id),read_at=NOW()`,
    [row.id, actor.id, messageId]);
    return { read: true };
  });
}
async function getEnquiry(id, actor) {
  return transaction(async client => {
    const row = await owned(client, id, actor);
    const messages = await client.query(
      `SELECT id,author_role,kind,body,created_at FROM parent_enquiry_messages WHERE enquiry_id=$1 ORDER BY id`, [row.id],
    );
    return { enquiry: projection(row, admin(actor)), messages: messages.rows };
  });
}
async function changeEnquiry(id, actor, body, changeStatus = false) {
  input(body, changeStatus ? ['status', 'version', 'request_key'] : ['message', 'request_key']);
  if (changeStatus && !admin(actor)) throw fail(403, 'Only Admin can change enquiry status.');
  if (changeStatus && !Object.hasOwn(LABELS, body.status)) throw fail(400, 'Invalid enquiry status.');
  const content = changeStatus ? `Status changed to ${LABELS[body.status]}.` : text(body.message, 'Reply', 2000);
  const expectedVersion = changeStatus ? integer(body.version, 'version') : null;
  const requestHash = hash({ id: integer(id, 'enquiry'), actor: actor.id, content,
    kind: changeStatus ? 'status' : 'message', expectedVersion });
  return transaction(async client => {
    const row = await owned(client, id, actor, true);
    const existing = (await client.query('SELECT request_hash FROM parent_enquiry_messages WHERE request_key=$1::uuid', [body.request_key])).rows[0];
    if (existing) {
      if (existing.request_hash !== requestHash) throw fail(409, 'This request has changed. Please try again.');
      return { enquiry: projection(row, admin(actor)), duplicate: true };
    }
    if (changeStatus && row.version !== expectedVersion) throw fail(409, 'This enquiry has changed. Select Refresh before updating its status.');
    if (!changeStatus && row.status === 'done') throw fail(409, 'This enquiry is Done. Admin can reopen it, or you can send a new enquiry.');
    if (!changeStatus && row.source === 'login_help') throw fail(409, 'Contact this parent using the mobile number provided. Replies cannot be read before login.');
    if (changeStatus && row.status === body.status) return { enquiry: projection(row, true), duplicate: true };
    const inserted = await client.query(
      `INSERT INTO parent_enquiry_messages (enquiry_id,author_id,author_role,kind,body,request_key,request_hash)
       VALUES ($1,$2,$3,$4,$5,$6::uuid,$7) RETURNING id`,
      [row.id, actor.id, admin(actor) ? 'admin' : 'parent', changeStatus ? 'status' : 'message', content, body.request_key, requestHash],
    );
    const updated = (await client.query(
      `UPDATE parent_enquiries SET status=$1,version=version+1,updated_at=NOW() WHERE id=$2 RETURNING *`,
      [changeStatus ? body.status : row.status, row.id],
    )).rows[0];
    if (admin(actor)) await audit(client, actor, changeStatus ? 'parent_enquiry_status_changed' : 'parent_enquiry_replied', row,
      changeStatus ? { previous_status: row.status, status: body.status } : { message_id: inserted.rows[0].id });
    return { enquiry: projection(updated, admin(actor)), duplicate: false };
  });
}

const SCHEMA = {
  parent_enquiries: ['id', 'parent_id', 'source', 'contact_name', 'contact_phone', 'subject', 'status',
    'request_key', 'request_hash', 'version', 'created_at', 'updated_at'],
  parent_enquiry_messages: ['id', 'enquiry_id', 'author_id', 'author_role', 'kind', 'body', 'request_key', 'request_hash', 'created_at'],
  parent_enquiry_admin_reads: ['enquiry_id', 'admin_id', 'last_read_message_id', 'read_at'],
};
async function checkEnquirySchema(executor) {
  const { rows } = await executor.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name=ANY($1::text[])`, [Object.keys(SCHEMA)]);
  const missing = Object.entries(SCHEMA).flatMap(([table, columns]) => columns
    .filter(column => !rows.some(row => row.table_name === table && row.column_name === column))
    .map(column => `${table}.${column}`));
  if (missing.length) throw new Error(`Enquiry schema is incomplete: ${missing.join(', ')}`);
}
module.exports = { createEnquiry, listEnquiries, getEnquiry, changeEnquiry, getAdminUnreadCount, markEnquiryRead, checkEnquirySchema };
