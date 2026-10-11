/* Real HTTP authentication and real PostgreSQL, using synthetic accounts only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const databaseUrl = process.env.FINANCE_TEST_DATABASE_URL;
test('Parent enquiries preserve privacy, persist replies and enforce Admin workflow', {
  skip: databaseUrl ? false : 'Requires explicit disposable FINANCE_TEST_DATABASE_URL', timeout: 120000,
}, async t => {
  const schema = `parent_enquiries_${crypto.randomBytes(8).toString('hex')}`;
  const control = new Pool({ connectionString: databaseUrl, max: 1,
    ssl: process.env.FINANCE_TEST_DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false });
  const savedSecret = process.env.JWT_SECRET;
  const mail = [];
  let db;
  let server;
  let portalId;
  let publicId;
  const tokens = {};
  const key = () => crypto.randomUUID();
  try {
    await control.query(`CREATE SCHEMA "${schema}"`);
    const scoped = new URL(databaseUrl);
    scoped.searchParams.set('options', `-csearch_path=${schema}`);
    db = require('../config/database');
    assert.equal(db.pool.totalCount, 0);
    db.pool.options.connectionString = scoped.toString();
    db.pool.options.ssl = process.env.FINANCE_TEST_DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false;
    db.pool.options.max = 4;
    db.pool.options.connectionTimeoutMillis = 10000;
    db.pool.options.query_timeout = 15000;
    process.env.JWT_SECRET = 'synthetic-enquiry-regression-secret';
    const mailPath = require.resolve('../services/gmailService');
    require.cache[mailPath] = { id: mailPath, filename: mailPath, loaded: true, exports: {
      sendEmail: async (...args) => { mail.push(args); return { success: true }; }, escapeHtml: String,
    } };
    await db.query(`
      CREATE TABLE grades (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE classes (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE users (
        id SERIAL PRIMARY KEY, email TEXT, password TEXT, role TEXT, first_name TEXT,
        last_name TEXT, phone_number TEXT, student_number TEXT, is_active BOOLEAN DEFAULT true,
        auth_revoked_at TIMESTAMPTZ, grade_id INTEGER, class_id INTEGER
      );
      CREATE TABLE parent_sessions (
        id UUID PRIMARY KEY, user_id INTEGER, created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ DEFAULT NOW() + interval '1 hour',
        family_expires_at TIMESTAMPTZ DEFAULT NOW() + interval '1 hour', revoked_at TIMESTAMPTZ
      );
      CREATE TABLE parent_students (parent_id INTEGER, student_id INTEGER);
      CREATE TABLE payments (id INTEGER PRIMARY KEY, student_id INTEGER, amount NUMERIC);
      CREATE TABLE audit_logs (
        id SERIAL PRIMARY KEY, user_id INTEGER, user_name TEXT, user_role TEXT,
        action TEXT NOT NULL, entity_type TEXT, entity_id INTEGER, details JSONB, ip_address TEXT
      );
      INSERT INTO users (id,role,first_name,last_name,phone_number,email,password,is_active) VALUES
        (1,'super_admin','Synthetic','Office',NULL,NULL,'unchanged',true),
        (2,'admin','Synthetic','Admin',NULL,NULL,'unchanged',true),
        (3,'teacher','Synthetic','Teacher',NULL,NULL,'unchanged',true),
        (10,'parent','Synthetic','First','27731234567',NULL,'unchanged',true),
        (11,'parent','Synthetic','Second','27731234568','second@example.test','unchanged',true),
        (12,'parent','Synthetic','Disabled','27731234569',NULL,'unchanged',false),
        (13,'parent','Synthetic','Revoked','27731234560',NULL,'unchanged',true),
        (501,'student','Synthetic','Learner',NULL,NULL,'unchanged',true);
      INSERT INTO parent_students VALUES (10,501),(11,501);
      INSERT INTO payments VALUES (1,501,2350);
    `);
    for (const id of [1, 2, 3, 10, 11, 12, 13, 501]) {
      const sessionId = key();
      if (id >= 10 && id < 500) await db.query('INSERT INTO parent_sessions(id,user_id,revoked_at) VALUES($1,$2,$3)', [sessionId, id, id === 13 ? new Date() : null]);
      tokens[id] = jwt.sign({ id, ...(id >= 10 && id < 500 ? { session_id: sessionId } : {}) }, process.env.JWT_SECRET, { expiresIn: '5m' });
    }
    const app = express(); app.use(express.json({ limit: '32kb' }));
    app.use('/api/parent', require('../routes/parent'));
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}/api/parent/enquiries`;
    const request = async (path = '', { actor = 10, method = 'GET', body, contentType = 'application/json' } = {}) => {
      const response = await fetch(`${base}${path}`, { method,
        headers: { ...(actor ? { Authorization: `Bearer ${tokens[actor]}` } : {}), 'Content-Type': contentType },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json().catch(() => ({})), headers: response.headers };
    };
    const post = (path, body, actor = 10) => request(path, { actor, method: 'POST', body });
    const status = (id, value, version, requestKey = key(), actor = 1) => request(`/admin/${id}/status`, {
      actor, method: 'PATCH', body: { status: value, version, request_key: requestKey },
    });
    const detail = async (id, actor = 10) => (await request(`${actor < 10 ? '/admin' : ''}/${id}`, { actor })).data;
    const rows = async table => (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    const protectedSnapshot = { users: await rows('users'), payments: await rows('payments'),
      links: (await db.query('SELECT * FROM parent_students ORDER BY parent_id')).rows };

    await t.test('missing migration fails cleanly and the additive migration is repeatable', async () => {
      const before = await request();
      assert.equal(before.status, 503); assert.match(before.data.message, /not available yet/);
      const { run } = require('../scripts/run-parent-enquiries-migration');
      await run(db); await run(db);
      assert.equal((await request()).status, 200);
      assert.deepEqual(await rows('users'), protectedSnapshot.users);
      assert.deepEqual(await rows('payments'), protectedSnapshot.payments);
    });

    await t.test('a parent without email can submit; concurrent retries create one private enquiry', async () => {
      const body = { subject: 'Cannot see attendance', message: 'Please help me find the Attendance page.', request_key: key() };
      const results = await Promise.all([post('', body), post('', body)]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
      portalId = results[0].data.enquiry.id;
      assert.equal(results[1].data.enquiry.id, portalId);
      assert.equal((await rows('parent_enquiries')).length, 1);
      assert.equal((await rows('parent_enquiry_messages')).length, 1);
      const list = await request();
      assert.equal(list.headers.get('cache-control'), 'no-store');
      assert.equal(list.data.enquiries.length, 1);
      assert.deepEqual(Object.keys(list.data.enquiries[0]).sort(), ['id','reference','subject','status','version','created_at','updated_at'].sort());
      const thread = await detail(portalId);
      assert.equal(thread.messages[0].body, body.message);
      assert.equal(thread.messages[0].request_hash, undefined);
      assert.equal((await post('', { ...body, message: 'Different content' })).status, 409);
    });

    await t.test('ownership, active sessions and Admin-only permissions are enforced on real routes', async () => {
      assert.equal((await request('', { actor: 11 })).data.enquiries.length, 0);
      assert.equal((await request(`/${portalId}`, { actor: 11 })).status, 404);
      assert.equal((await post(`/${portalId}/replies`, { message: 'Spoofed', request_key: key() }, 11)).status, 404);
      assert.equal((await request('/admin', { actor: 10 })).status, 403);
      assert.equal((await status(portalId, 'done', 1, key(), 10)).status, 403);
      for (const actor of [3, 501]) {
        assert.equal((await request('/admin', { actor })).status, 403);
        assert.equal((await request('', { actor })).status, 403);
      }
      for (const actor of [0, 12, 13]) assert.equal((await request('', { actor })).status, 401);
      const legacyToken = tokens[10];
      tokens[10] = jwt.sign({ id: 10 }, process.env.JWT_SECRET, { expiresIn: '5m' });
      assert.equal((await request()).status, 401); tokens[10] = legacyToken;
      const adminThread = await detail(portalId, 2);
      assert.equal(adminThread.enquiry.contact_phone, '27731234567');
      assert.equal(adminThread.enquiry.parent_id, 10);
    });

    await t.test('the alert migration upgrades an existing enquiry installation without changing conversations', async () => {
      const before = { enquiries: await rows('parent_enquiries'), messages: await rows('parent_enquiry_messages') };
      await db.query('DROP TABLE parent_enquiry_admin_reads');
      assert.equal((await request()).status, 200);
      assert.equal((await request('/admin/unread-count', { actor: 1 })).status, 503);
      await require('../scripts/run-parent-enquiries-migration').run(db);
      assert.deepEqual(await rows('parent_enquiries'), before.enquiries);
      assert.deepEqual(await rows('parent_enquiry_messages'), before.messages);
      assert.deepEqual((await request('/admin/unread-count', { actor: 1 })).data, { count: 1 });
    });

    await t.test('public login help does not link, activate or disclose an existing account', async () => {
      const body = { contact_name: 'Synthetic Requester', contact_phone: '073 123 4567',
        subject: 'I cannot sign in', message: 'Please call me about my account.', request_key: key() };
      const created = await post('/help', body, 0);
      assert.equal(created.status, 201);
      assert.deepEqual(Object.keys(created.data.enquiry).sort(), ['reference','status']);
      assert.equal((await post('/help', body, 0)).status, 200);
      publicId = (await rows('parent_enquiries')).find(r => r.source === 'login_help').id;
      const adminThread = await detail(publicId, 1);
      assert.equal(adminThread.enquiry.parent_id, null);
      assert.equal(adminThread.enquiry.contact_phone, '27731234567');
      for (const path of ['', `/${publicId}`, '/admin', '/help']) assert.equal((await request(path, { actor: 0 })).status, 401);
      assert.equal((await request(`/${publicId}`, { actor: 10 })).status, 404);
      assert.equal((await post(`/admin/${publicId}/replies`, { message: 'Cannot be read', request_key: key() }, 1)).status, 409);
      assert.equal((await post('/help', { ...body, request_key: key(), contact_phone: '123' }, 0)).status, 400);
      assert.deepEqual(await rows('users'), protectedSnapshot.users);
      assert.deepEqual((await db.query('SELECT * FROM parent_students ORDER BY parent_id')).rows, protectedSnapshot.links);
    });

    await t.test('input validation, fixed projections and bound searches reject tampering', async () => {
      const baseBody = { subject: 'Valid', message: 'Valid', request_key: key() };
      for (const extra of [{ parent_id: 11 }, { status: 'done' }, { author_id: 1 }]) assert.equal((await post('', { ...baseBody, ...extra, request_key: key() })).status, 400);
      for (const change of [{ message: 'x'.repeat(2001) }, { subject: ' ' }, { request_key: 'not-a-uuid' }, { message: {} }]) assert.equal((await post('', { ...baseBody, ...change })).status, 400);
      assert.equal((await request('?status=toString')).status, 400);
      assert.equal((await request('?page=-1')).status, 400);
      assert.equal((await request('?q=private')).status, 400);
      assert.equal((await request('/admin?q=%25_%27%20OR%201%3D1', { actor: 1 })).data.enquiries.length, 0);
      assert.equal((await request('/admin?q=Attendance', { actor: 1 })).data.enquiries.length, 1);
      assert.equal((await request('', { method: 'POST', body: baseBody, contentType: 'text/plain' })).status, 415);
    });

    await t.test('Admin and Parent replies persist once, with atomic metadata-only audit', async () => {
      const parentReply = { message: 'The page is empty.\nThank you.', request_key: key() };
      assert.equal((await post(`/${portalId}/replies`, parentReply)).status, 200);
      const officeReply = { message: 'Select Attendance from the menu.', request_key: key() };
      const results = await Promise.all([post(`/admin/${portalId}/replies`, officeReply, 1), post(`/admin/${portalId}/replies`, officeReply, 1)]);
      assert.ok(results.every(result => result.status === 200));
      assert.deepEqual(results.map(result => result.data.duplicate).sort(), [false, true]);
      const thread = await detail(portalId);
      assert.deepEqual(thread.messages.map(message => message.author_role), ['parent','parent','admin']);
      assert.equal(thread.enquiry.version, 3);
      const audits = await rows('audit_logs');
      assert.equal(audits.length, 1); assert.equal(audits[0].action, 'parent_enquiry_replied');
      assert.equal(audits[0].user_id, 1);
      assert.deepEqual(Object.keys(audits[0].details), ['message_id']);
      assert.equal((await post(`/admin/${portalId}/replies`, { ...officeReply, message: 'Changed' }, 1)).status, 409);
    });

    await t.test('On hold, Done, reopening and stale status updates are consistent', async () => {
      const hold = await status(portalId, 'on_hold', 3);
      assert.equal(hold.status, 200); assert.equal(hold.data.enquiry.status, 'on_hold');
      const requestKey = key();
      const done = await status(portalId, 'done', 4, requestKey);
      assert.equal(done.status, 200);
      assert.equal((await status(portalId, 'done', 4, requestKey)).data.duplicate, true);
      assert.equal((await status(portalId, 'new', 3)).status, 409);
      for (const actor of [1, 10]) assert.equal((await post(`${actor === 1 ? '/admin' : ''}/${portalId}/replies`, { message: 'Closed reply', request_key: key() }, actor)).status, 409);
      assert.equal((await request('?status=done')).data.enquiries.length, 1);
      assert.equal((await status(portalId, 'new', 5)).status, 200);
      assert.equal((await post(`/${portalId}/replies`, { message: 'Now I can read it.', request_key: key() })).status, 200);
      const thread = await detail(portalId);
      assert.equal(thread.enquiry.status, 'new');
      assert.deepEqual(thread.messages.filter(message => message.kind === 'status').map(message => message.body), [
        'Status changed to On hold.', 'Status changed to Done.', 'Status changed to New.',
      ]);
      const publicVersion = (await detail(publicId, 1)).enquiry.version;
      assert.equal((await status(publicId, 'done', publicVersion, key(), 2)).status, 200);
    });

    await t.test('a failed Admin audit rolls back both reply and status including thread version', async () => {
      const before = { enquiries: await rows('parent_enquiries'), messages: await rows('parent_enquiry_messages'), audits: await rows('audit_logs') };
      await db.query(`CREATE FUNCTION reject_enquiry_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.entity_type='parent_enquiry' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$;
        CREATE TRIGGER reject_enquiry_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_enquiry_audit();`);
      assert.equal((await post(`/admin/${portalId}/replies`, { message: 'Must roll back', request_key: key() }, 1)).status, 500);
      assert.equal((await status(portalId, 'done', (await detail(portalId)).enquiry.version)).status, 500);
      assert.deepEqual(await rows('parent_enquiries'), before.enquiries);
      assert.deepEqual(await rows('parent_enquiry_messages'), before.messages);
      assert.deepEqual(await rows('audit_logs'), before.audits);
      await db.query('DROP TRIGGER reject_enquiry_audit ON audit_logs; DROP FUNCTION reject_enquiry_audit()');
    });

    await t.test('unread alerts track new questions, follow-ups and separate administrators without hiding unseen replies', async () => {
      const count = async actor => (await request('/admin/unread-count', { actor })).data.count;
      const mark = (id, messageId, actor = 1) => post(`/admin/${id}/read`, { last_message_id: messageId }, actor);
      const baseline = await count(1);
      const otherBaseline = await count(2);
      const created = await post('', { subject: 'Alert regression', message: 'First question', request_key: key() }, 11);
      assert.equal(created.status, 201);
      const id = created.data.enquiry.id;
      const first = (await detail(id, 1)).messages[0].id;
      assert.equal(await count(1), baseline + 1);
      assert.equal(await count(2), otherBaseline + 1);
      assert.equal((await request('/admin', { actor: 1 })).data.enquiries.find(row => row.id === id).unread, true);
      // GET requests do not change any administrator's read position.
      assert.equal(await count(1), baseline + 1);
      assert.equal((await mark(id, first)).status, 200);
      assert.equal(await count(1), baseline);
      assert.equal(await count(2), otherBaseline + 1);
      assert.equal((await request('/admin', { actor: 1 })).data.enquiries.find(row => row.id === id).unread, false);

      assert.equal((await post(`/${id}/replies`, { message: 'A later parent reply', request_key: key() }, 11)).status, 200);
      const second = (await detail(id, 1)).messages.at(-1).id;
      assert.equal((await mark(id, first)).status, 200);
      assert.equal(await count(1), baseline + 1);
      assert.equal((await mark(id, second)).status, 200);
      assert.equal(await count(1), baseline);
      assert.equal((await post(`/admin/${id}/replies`, { message: 'School office reply', request_key: key() }, 1)).status, 200);
      assert.equal(await count(1), baseline); // Admin messages do not create alerts.

      assert.equal((await post(`/${id}/replies`, { message: 'More information', request_key: key() }, 11)).status, 200);
      const latest = (await detail(id, 1)).messages.at(-1).id;
      await Promise.all([mark(id, latest), mark(id, first)]);
      assert.equal((await db.query('SELECT last_read_message_id FROM parent_enquiry_admin_reads WHERE enquiry_id=$1 AND admin_id=1', [id])).rows[0].last_read_message_id, latest);
      assert.equal(await count(1), baseline);
      assert.equal(await count(2), otherBaseline + 1);
      const version = (await detail(id, 1)).enquiry.version;
      assert.equal((await status(id, 'on_hold', version)).status, 200);
      assert.equal(await count(2), otherBaseline + 1);
      assert.equal((await status(id, 'done', version + 1)).status, 200);
      assert.equal(await count(2), otherBaseline);
      assert.equal((await status(id, 'new', version + 2)).status, 200);
      assert.equal(await count(2), otherBaseline + 1);

      const foreignMessage = (await detail(portalId, 1)).messages[0].id;
      assert.equal((await mark(id, foreignMessage)).status, 400);
      assert.equal((await mark(id, 2147483647)).status, 400);
      assert.equal((await post(`/admin/${id}/read`, { last_message_id: first, admin_id: 2 }, 1)).status, 400);
      for (const actor of [0, 3, 10, 11, 12, 13, 501]) {
        assert.ok([401, 403].includes((await request('/admin/unread-count', { actor })).status));
        assert.ok([401, 403].includes((await mark(id, first, actor)).status));
      }
      const parentProjection = (await request('', { actor: 11 })).data.enquiries.find(row => row.id === id);
      assert.equal(Object.hasOwn(parentProjection, 'unread'), false);
      assert.equal(Object.hasOwn((await detail(id, 11)).enquiry, 'unread'), false);
    });

    await t.test('public submissions are rate-limited without any public account lookup', async () => {
      let last;
      for (let index = 0; index < 10; index++) last = await post('/help', {
        contact_name: 'Synthetic Guest', contact_phone: '0731112222', subject: 'Login help',
        message: 'Synthetic rate limit check', request_key: key(),
      }, 0);
      assert.equal(last.status, 429); assert.match(last.data.message, /Too many/);
    });

    await t.test('rerunning the migration preserves messages, accounts and financial records; no emails sent', async () => {
      const before = { enquiries: await rows('parent_enquiries'), messages: await rows('parent_enquiry_messages'),
        reads: (await db.query('SELECT * FROM parent_enquiry_admin_reads ORDER BY enquiry_id,admin_id')).rows };
      await require('../scripts/run-parent-enquiries-migration').run(db);
      assert.deepEqual(await rows('parent_enquiries'), before.enquiries);
      assert.deepEqual(await rows('parent_enquiry_messages'), before.messages);
      assert.deepEqual((await db.query('SELECT * FROM parent_enquiry_admin_reads ORDER BY enquiry_id,admin_id')).rows, before.reads);
      assert.deepEqual(await rows('users'), protectedSnapshot.users);
      assert.deepEqual(await rows('payments'), protectedSnapshot.payments);
      assert.deepEqual(mail, []);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (db) await db.pool.end();
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await control.end();
    if (savedSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = savedSecret;
  }
});
