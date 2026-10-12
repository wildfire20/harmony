/* Real HTTP auth and PostgreSQL, synthetic identities, mocked outbound email only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const url = process.env.FINANCE_TEST_DATABASE_URL;
test('Returning-learner re-registration and durable email confirmations', {
  skip: url ? false : 'Requires explicit disposable FINANCE_TEST_DATABASE_URL', timeout: 120000,
}, async t => {
  const schema = `rereg_${crypto.randomBytes(8).toString('hex')}`;
  const control = new Pool({ connectionString: url, max: 1, ssl: process.env.FINANCE_TEST_DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false });
  const savedSecret = process.env.JWT_SECRET;
  let db; let server;
  const tokens = {}; const key = () => crypto.randomUUID(); const sent = [];
  const complete = (extra = {}) => ({ grade_applied_for: 'Grade 3', surname: 'Learner', first_name: 'Synthetic',
    date_of_birth: '2018-05-12', physical_address: '123 Synthetic Street', city_suburb: 'Synthetic Town',
    emergency_telephone: '0731234569', boarder: 'No', parent_first_name: 'Synthetic', parent_surname: 'Parent',
    parent_mobile: '0731234567', relationship: 'Mother', declared_name: 'Synthetic Parent', declaration_accepted: true, ...extra });
  try {
    await control.query(`CREATE SCHEMA "${schema}"`);
    const scoped = new URL(url); scoped.searchParams.set('options', `-csearch_path=${schema}`);
    db = require('../config/database');
    assert.equal(db.pool.totalCount, 0);
    db.pool.options.connectionString = scoped.toString(); db.pool.options.ssl = control.options.ssl;
    db.pool.options.max = 5; db.pool.options.connectionTimeoutMillis = 10000; db.pool.options.query_timeout = 15000;
    process.env.JWT_SECRET = 'synthetic-returning-learner-test-secret';
    await db.query(`
      CREATE TABLE grades(id INTEGER PRIMARY KEY,name TEXT,is_active BOOLEAN DEFAULT true);
      CREATE TABLE classes(id INTEGER PRIMARY KEY,name TEXT);
      CREATE TABLE users(id INTEGER PRIMARY KEY,first_name TEXT,last_name TEXT,student_number TEXT,role TEXT,email TEXT,
        email_verified_at TIMESTAMPTZ,phone_number TEXT,password TEXT DEFAULT 'unchanged',is_active BOOLEAN DEFAULT true,
        grade_id INTEGER,class_id INTEGER,auth_revoked_at TIMESTAMPTZ,date_of_birth DATE,is_boarder BOOLEAN DEFAULT false);
      CREATE TABLE parent_students(parent_id INTEGER,student_id INTEGER,PRIMARY KEY(parent_id,student_id));
      CREATE TABLE parent_sessions(id UUID PRIMARY KEY,user_id INTEGER,created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ DEFAULT NOW()+interval '1 hour',family_expires_at TIMESTAMPTZ DEFAULT NOW()+interval '1 hour',revoked_at TIMESTAMPTZ);
      CREATE TABLE audit_logs(id SERIAL PRIMARY KEY,user_id INTEGER,user_name TEXT,user_role TEXT,action TEXT,entity_type TEXT,entity_id INTEGER,details JSONB,ip_address TEXT);
      CREATE TABLE invoices(id INTEGER PRIMARY KEY,student_id INTEGER,amount_due NUMERIC,amount_paid NUMERIC,status TEXT);
      CREATE TABLE payments(id INTEGER PRIMARY KEY,student_id INTEGER,amount NUMERIC,reverses_payment_id INTEGER);
      CREATE TABLE payment_allocations(id INTEGER PRIMARY KEY,payment_id INTEGER,invoice_id INTEGER,amount NUMERIC);
      CREATE TABLE finance_service_enrollments(id INTEGER PRIMARY KEY,student_id INTEGER,service TEXT,start_date DATE);
      INSERT INTO grades VALUES(2,'Grade 2',true),(3,'Grade 3',true);
      INSERT INTO users(id,first_name,last_name,role,email,email_verified_at,phone_number) VALUES
        (1,'Synthetic','Office','super_admin',NULL,NULL,NULL),(2,'Synthetic','Admin','admin',NULL,NULL,NULL),(3,'Synthetic','Teacher','teacher',NULL,NULL,NULL),
        (10,'Synthetic','First','parent','first@example.test',NOW(),'27731234567'),
        (11,'Synthetic','Other','parent','other@example.test',NOW(),'27731234568'),
        (12,'Synthetic','Disabled','parent',NULL,NULL,'27731234569'),
        (13,'Synthetic','Revoked','parent',NULL,NULL,'27731234560'),
        (14,'Synthetic','Unverified','parent','unverified@example.test',NULL,'27731234561'),
        (15,'Synthetic','No-email','parent',NULL,NULL,'27731234562');
      UPDATE users SET is_active=false WHERE id=12;
      INSERT INTO users(id,first_name,last_name,role,student_number,grade_id,date_of_birth) VALUES
        (501,'Synthetic','Learner','student','SYN501',2,'2018-05-12'),(502,'Synthetic','No-mail','student','SYN502',2,'2018-05-12'),
        (503,'Synthetic','Unverified','student','SYN503',2,'2018-05-12'),(504,'Synthetic','Unlinked','student','SYN504',2,'2018-05-12'),
        (505,'Synthetic','Paper','student','SYN505',2,'2018-05-12'),(506,'Synthetic','Rollback','student','SYN506',2,'2018-05-12'),
        (507,'Synthetic','Retry','student','SYN507',2,'2018-05-12'),(508,'Synthetic','Stale','student','SYN508',2,'2018-05-12');
      INSERT INTO parent_students VALUES(10,501),(11,501),(15,502),(14,503),(11,505),(10,506),(11,506),(10,507),(10,508);
      INSERT INTO invoices VALUES(11091,501,2350,0,'Unpaid');
      INSERT INTO payments VALUES(1,501,2350,NULL),(2,501,-1,3),(3,501,1,NULL);
      INSERT INTO payment_allocations VALUES(1,1,11091,2350);
      INSERT INTO finance_service_enrollments VALUES(1,501,'tuition','2026-10-01');
    `);
    for (const id of [1,2,3,10,11,12,13,14,15,501]) {
      const session = key();
      if (id >= 10 && id <= 15) await db.query('INSERT INTO parent_sessions(id,user_id,revoked_at) VALUES($1,$2,$3)', [session,id,id===13 ? new Date() : null]);
      tokens[id] = jwt.sign({ id, ...(id>=10 && id<=15 ? { session_id: session } : {}) },process.env.JWT_SECRET,{ expiresIn:'10m' });
    }
    const app = express(); app.use(express.json({ limit:'32kb' })); app.use('/api/parent/re-registration',require('../routes/parentReRegistration'));
    server = await new Promise(resolve => { const listener = app.listen(0,'127.0.0.1',()=>resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}/api/parent/re-registration`;
    const req = async (path='',{ actor=10,body,contentType='application/json' }={}) => {
      const response = await fetch(base+path,{ method:body ? 'POST':'GET',headers:{ ...(actor ? { Authorization:`Bearer ${tokens[actor]}` } : {}),'Content-Type':contentType }, ...(body ? { body:JSON.stringify(body) } : {}) });
      if (response.headers.get('content-type')?.includes('application/pdf')) return { status:response.status,bytes:Buffer.from(await response.arrayBuffer()),headers:response.headers };
      return { status:response.status,data:await response.json(),headers:response.headers };
    };
    const get = async (id,actor=10) => req(actor<10 ? `/admin/${id}` : `?child_id=${id}`,{ actor });
    const post = (id,form,version=0,request_key=key(),submit=true,actor=10) => req(`/${submit?'submit':'draft'}?child_id=${id}`,{ actor,body:{ form,version,request_key } });
    const review = (id,action,version,note='',extra={},request_key=key()) => req(`/admin/${id}/review`,{ actor:1,body:{ action,version,note,request_key,...extra } });
    const rows = async table => (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    const snapshot = {};
    for (const table of ['users','invoices','payments','payment_allocations','finance_service_enrollments']) snapshot[table]=await rows(table);
    snapshot.links=(await db.query('SELECT * FROM parent_students ORDER BY parent_id,student_id')).rows;
    const outbox = require('../services/parentReRegistrationEmails');
    const send = async (...args) => { sent.push(args); return { success:true,messageId:'synthetic-provider-id' }; };
    const work = (sender=send,environment={}) => outbox.processOne({ database:db,send:sender,ready:true,environment });
    let registration;

    await t.test('additive migration is repeatable and missing schema fails with a useful message',async()=>{
      assert.equal((await get(501)).status,503);
      const migration=require('../scripts/run-parent-reregistration-migration');await migration.run(db);await migration.run(db);
      assert.equal((await rows('parent_reregistrations')).length,0);
      assert.deepEqual(await rows('users'),snapshot.users);
    });
    await t.test('real sessions, roles and learner links protect forms and blank PDF downloads',async()=>{
      for (const actor of [null,12,13]) assert.equal((await get(501,actor)).status,401);
      assert.equal((await get(501,3)).status,403);assert.equal((await req('/admin',{actor:10})).status,403);
      assert.equal((await get(504)).status,404);assert.equal((await get('501 OR true')).status,400);
      const pdf=await req('/forms/complete');assert.equal(pdf.status,200);assert.equal(pdf.bytes.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.bytes.length>70000);
      assert.equal(pdf.headers.get('cache-control'),'no-store');assert.equal((await req('/forms/complete',{actor:null})).status,401);assert.equal((await req('/forms/unknown')).status,404);
      assert.equal((await req('/draft?child_id=501',{body:{},contentType:'text/plain'})).status,415);
    });
    await t.test('prefills are allowlisted; the requested next-year grade is an intentional choice',async()=>{
      const result=await get(501);assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
      assert.equal(result.data.registration.form.first_name,'Synthetic');assert.equal(result.data.registration.form.date_of_birth,'2018-05-12');
      assert.equal(result.data.registration.form.parent_email,'first@example.test');assert.equal(result.data.registration.form.grade_applied_for,undefined);
      assert.ok(!JSON.stringify(result.data).includes('password'));assert.ok(!JSON.stringify(result.data).includes('email_verified_at'));
    });
    await t.test('drafts resume, stale edits fail, and another linked parent cannot read private form fields',async()=>{
      const body={first_name:'Synthetic',parent_id_passport:'PRIVATE-SYNTHETIC-ID'};const requestKey=key();
      const a=await post(501,body,0,requestKey,false);assert.equal(a.status,200);assert.equal(a.data.registration.status,'draft');
      assert.equal((await post(501,body,0,requestKey,false)).data.duplicate,true);
      const shared=await get(501,11);assert.equal(shared.status,200);assert.equal(shared.data.registration.form,null);assert.equal(shared.data.registration.read_only,true);
      assert.ok(!JSON.stringify(shared.data).includes('PRIVATE-SYNTHETIC-ID'));
      assert.equal((await post(501,body,1,key(),false,11)).status,409);
      assert.equal((await post(501,body,0,key(),false)).status,409);
    });
    await t.test('submission rejects missing declarations, unknown fields and invalid grades or dates',async()=>{
      for (const form of [complete({ declaration_accepted:false }),complete({ password:'spoof' }),complete({ grade_applied_for:'Grade 99' }),complete({ date_of_birth:'2018-02-31' }),complete({ parent_mobile:'123' })]) {
        assert.equal((await post(501,form,1)).status,400);
      }
      assert.equal((await rows('parent_reregistration_emails')).length,0);
    });
    await t.test('concurrent submission retries create exactly one receipt email and one action',async()=>{
      const requestKey=key();const results=await Promise.all([post(501,complete({medical_condition:'PRIVATE-HEALTH'}),1,requestKey),post(501,complete({medical_condition:'PRIVATE-HEALTH'}),1,requestKey)]);
      assert.deepEqual(results.map(result=>result.status),[200,200]);registration=results[0].data.registration;
      assert.equal(registration.status,'submitted');assert.equal(registration.version,2);
      assert.equal((await rows('parent_reregistration_emails')).length,1);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM parent_reregistration_actions WHERE request_key=$1',[requestKey])).rows[0].n,1);
      assert.ok(!JSON.stringify(results[0].data.email_updates).includes('@'));
    });
    await t.test('Admin gets pending counts, grade/status filters and not-started learners',async()=>{
      assert.equal((await req('/admin/pending-count',{actor:1})).data.count,1);
      const list=await req('/admin?status=not_started&grade_id=2',{actor:1});assert.equal(list.status,200);assert.equal(list.data.registrations.length,7);
      assert.equal(list.data.counts.submitted,1);assert.equal((await req('/admin?status=made_up',{actor:1})).status,400);
      assert.equal((await req('/admin?q=SYN501',{actor:1})).data.total,1);
    });
    await t.test('approval is guarded, terminal and audited without changing current fees or learner profiles',async()=>{
      assert.equal((await review(501,'approve',2)).status,400);
      const requestKey=key();const result=await review(501,'approve',2,'Welcome back.',{review_confirmed:true},requestKey);
      assert.equal(result.status,200);assert.equal(result.data.registration.status,'approved');assert.equal(result.data.registration.version,3);
      assert.equal((await review(501,'approve',2,'Welcome back.',{review_confirmed:true},requestKey)).data.duplicate,true);
      assert.equal((await review(501,'request_changes',3,'Change this.')).status,409);
      assert.equal((await post(501,complete(),3)).status,409);
      assert.equal((await rows('parent_reregistration_emails')).length,2);
      assert.equal((await req('/admin/pending-count',{actor:1})).data.count,0);
      assert.equal((await get(501,11)).data.registration.status,'approved');
    });
    await t.test('email-free and unverified-email parents still submit and get portal confirmation',async()=>{
      const noEmail=await post(502,complete(),0,key(),true,15);assert.equal(noEmail.status,200);assert.equal(noEmail.data.email_updates[0].status,'skipped');
      const unverified=await post(503,complete(),0,key(),true,14);assert.equal(unverified.status,200);assert.equal(unverified.data.email_updates[0].status,'skipped');
      assert.equal((await rows('parent_reregistration_emails')).filter(row=>row.status==='queued').length,2);
    });
    await t.test('changes can be corrected and resubmitted without another receipt email',async()=>{
      assert.equal((await review(503,'request_changes',1)).status,400);
      const changes=await review(503,'request_changes',1,'Please check the contact number.');assert.equal(changes.status,200);
      const result=await post(503,complete({parent_mobile:'0731234568'}),2,key(),true,14);assert.equal(result.status,200);assert.equal(result.data.registration.status,'submitted');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM parent_reregistration_emails WHERE registration_id=$1 AND kind='received'",[result.data.registration.id])).rows[0].n,1);
    });
    await t.test('a signed paper form uses the same review list and only a linked parent can receive its email',async()=>{
      assert.equal((await review(505,'paper',0,'',{parent_id:10,paper_signed:true})).status,400);
      assert.equal((await review(505,'paper',0,'',{parent_id:11,paper_signed:false})).status,400);
      const result=await review(505,'paper',0,'Signed form stored at office.',{parent_id:11,paper_signed:true});assert.equal(result.status,200);assert.equal(result.data.registration.source,'paper');
      assert.equal((await get(505,11)).data.registration.read_only,true);assert.ok(!JSON.stringify((await get(505,11)).data).includes('Signed form stored at office'));
      assert.equal((await review(505,'approve',1,'',{review_confirmed:true})).status,200);
    });
    await t.test('a required audit failure rolls back form, email queue and request action atomically',async()=>{
      const before={ forms:(await rows('parent_reregistrations')).length,emails:(await rows('parent_reregistration_emails')).length };
      await db.query("ALTER TABLE audit_logs ADD CONSTRAINT inject_rereg_failure CHECK(action <> 'reregistration_submit') NOT VALID");
      try { assert.equal((await post(506,complete())).status,500); }
      finally { await db.query('ALTER TABLE audit_logs DROP CONSTRAINT inject_rereg_failure'); }
      assert.equal((await rows('parent_reregistrations')).length,before.forms);assert.equal((await rows('parent_reregistration_emails')).length,before.emails);
    });
    await t.test('queue workers serialize and send the two event emails without private health or ID details',async()=>{
      const results=await Promise.all([work(),work()]);assert.equal(results.filter(r=>r.accepted).length,1);assert.equal(sent.length,1);
      await work();assert.equal(sent.length,2);assert.ok(sent[0][1].includes('received'));assert.ok(sent[1][1].includes('approved'));
      assert.ok(!sent.some(args=>args[2].includes('PRIVATE-HEALTH')||args[2].includes('PRIVATE-SYNTHETIC-ID')));
      assert.notEqual(sent[0][3].idempotencyKey,sent[1][3].idempotencyKey);
      await work();await work();assert.equal(sent.length,4);assert.equal((await work()).empty,true);
    });
    await t.test('recording paper from another guardian keeps a prior private draft visible to Admin only',async()=>{
      assert.equal((await post(506,{first_name:'Synthetic',parent_id_passport:'PRIVATE-ORIGINAL-GUARDIAN'},0,key(),false)).status,200);
      assert.equal((await review(506,'paper',1,'Signed paper received.',{parent_id:11,paper_signed:true})).status,200);
      for(const actor of [10,11])assert.equal((await get(506,actor)).data.registration.form,null);
      assert.equal((await get(506,1)).data.registration.form.parent_id_passport,'PRIVATE-ORIGINAL-GUARDIAN');
      await work();assert.equal((await work()).empty,true);
    });
    await t.test('daily email budget defers mail without losing the submission or blocking approval',async()=>{
      assert.equal((await post(507,complete())).status,200);
      const before=sent.length;assert.equal((await work(send,{PARENT_REREGISTRATION_EMAIL_DAILY_LIMIT:'1'})).daily_limit,true);assert.equal(sent.length,before);
      assert.equal((await get(507)).data.registration.status,'submitted');
    });
    await t.test('provider failure is retried with the same content and key; a successful event is never resent',async()=>{
      let first;
      assert.equal((await work(async(...args)=>{first=args;return{success:false,error:'EMAIL_API_TIMEOUT'};})).deferred,true);
      await db.query("UPDATE parent_reregistration_emails SET next_attempt_at=NOW() WHERE status='queued'");
      assert.equal((await work()).accepted,true);const last=sent.at(-1);assert.deepEqual(last,first);
      assert.equal((await work()).empty,true);
    });
    await t.test('crash recovery outside the provider key window requires a check instead of risking a duplicate',async()=>{
      await post(508,complete());await db.query("UPDATE parent_reregistration_emails SET status='sending',first_attempt_at=NOW()-interval '25 hours' WHERE status='queued'");
      const before=sent.length;assert.equal((await work()).check_required,true);assert.equal(sent.length,before);assert.equal((await work()).empty,true);
    });
    await t.test('an email address change or removed learner link prevents sending to an old recipient',async()=>{
      await review(507,'approve',1,'',{review_confirmed:true});
      await db.query('UPDATE users SET email=$1 WHERE id=10',['changed@example.test']);
      try { assert.equal((await work()).skipped,true); }
      finally { await db.query('UPDATE users SET email=$1 WHERE id=10',['first@example.test']); }
    });
    await t.test('a later quota rejection cannot erase uncertainty from an earlier timed-out send',async()=>{
      assert.equal((await review(506,'approve',2,'',{review_confirmed:true})).status,200);
      await work(async()=>({success:false,error:'EMAIL_API_TIMEOUT'}));
      const pending=(await db.query("SELECT * FROM parent_reregistration_emails WHERE status='queued'")).rows[0];assert.ok(pending.first_attempt_at);
      await db.query('UPDATE parent_reregistration_emails SET next_attempt_at=NOW() WHERE id=$1',[pending.id]);
      await work(async()=>({success:false,error:'EMAIL_RATE_LIMITED'}));
      const again=(await db.query('SELECT * FROM parent_reregistration_emails WHERE id=$1',[pending.id])).rows[0];assert.deepEqual(again.first_attempt_at,pending.first_attempt_at);
      await db.query("UPDATE parent_reregistration_emails SET first_attempt_at=NOW()-interval '25 hours',next_attempt_at=NOW() WHERE id=$1",[pending.id]);
      const before=sent.length;assert.equal((await work()).check_required,true);assert.equal(sent.length,before);
    });
    await t.test('all learner, account, payment, reversal, allocation and Finance service rows remain unchanged',async()=>{
      for(const table of ['users','invoices','payments','payment_allocations','finance_service_enrollments']) assert.deepEqual(await rows(table),snapshot[table],table);
      assert.deepEqual((await db.query('SELECT * FROM parent_students ORDER BY parent_id,student_id')).rows,snapshot.links);
      const audits=await rows('audit_logs');assert.ok(audits.some(row=>row.action==='reregistration_approve'));
      assert.ok(!JSON.stringify(audits).includes('PRIVATE-HEALTH'));
    });
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    if(db) await db.pool.end();
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(()=>{});await control.end();
    if(savedSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=savedSecret;
  }
});
