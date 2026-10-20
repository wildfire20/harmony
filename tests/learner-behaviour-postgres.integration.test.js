const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const express=require('express');
const jwt=require('jsonwebtoken');
const {Pool}=require('pg');
const url=process.env.FINANCE_TEST_DATABASE_URL;
test('Merits and Demerits enforce portal permissions and preserve history',{
  skip:!url,timeout:90000,
},async t=>{
  const schema='behaviour_'+crypto.randomBytes(8).toString('hex');
  const control=new Pool({connectionString:url,ssl:process.env.FINANCE_TEST_DATABASE_SSL==='true'?{rejectUnauthorized:false}:false});
  let db,server;const tokens={};const previousSecret=process.env.JWT_SECRET;
  const key=()=>crypto.randomUUID();
  try{
    await control.query(`CREATE SCHEMA "${schema}"`);
    db=require('../config/database');assert.equal(db.pool.totalCount,0);
    const scoped=new URL(url);scoped.searchParams.set('options',`-csearch_path=${schema}`);
    db.pool.options.connectionString=scoped.toString();db.pool.options.ssl=process.env.FINANCE_TEST_DATABASE_SSL==='true'?{rejectUnauthorized:false}:false;
    db.pool.options.max=5;process.env.JWT_SECRET='synthetic-behaviour-test-secret';
    await db.query(`CREATE TABLE grades(id INTEGER PRIMARY KEY,name TEXT);
      CREATE TABLE classes(id INTEGER PRIMARY KEY,name TEXT);
      CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,student_number TEXT,email TEXT,first_name TEXT,last_name TEXT,
        grade_id INTEGER,class_id INTEGER,is_active BOOLEAN DEFAULT true,auth_revoked_at TIMESTAMPTZ);
      CREATE TABLE teacher_assignments(teacher_id INTEGER,grade_id INTEGER,class_id INTEGER,is_active BOOLEAN DEFAULT true);
      CREATE TABLE parent_students(parent_id INTEGER,student_id INTEGER);
      CREATE TABLE parent_sessions(id UUID PRIMARY KEY,user_id INTEGER,created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ DEFAULT NOW()+interval '1 hour',family_expires_at TIMESTAMPTZ DEFAULT NOW()+interval '1 hour',revoked_at TIMESTAMPTZ);
      CREATE TABLE audit_logs(id SERIAL PRIMARY KEY,user_id INTEGER,user_name TEXT,user_role TEXT,action TEXT,entity_type TEXT,entity_id INTEGER,details JSONB,ip_address TEXT);
      CREATE TABLE invoices(id INTEGER,student_id INTEGER,amount_due NUMERIC,amount_paid NUMERIC);
      CREATE TABLE payment_transactions(id INTEGER,student_id INTEGER,amount NUMERIC);
      INSERT INTO grades VALUES(1,'Grade 2'),(2,'Grade 3');INSERT INTO classes VALUES(1,'A'),(2,'B');
      INSERT INTO users(id,role,first_name,last_name,grade_id,class_id,student_number) VALUES
      (1,'super_admin','Synthetic','Office',NULL,NULL,NULL),(2,'admin','Synthetic','Admin',NULL,NULL,NULL),
      (3,'teacher','Synthetic','Teacher',NULL,NULL,NULL),(4,'teacher','Other','Teacher',NULL,NULL,NULL),
      (10,'parent','Synthetic','Parent',NULL,NULL,NULL),(11,'parent','Other','Parent',NULL,NULL,NULL),
      (501,'student','First','Learner',1,1,'TEST501'),(502,'student','Second','Learner',2,2,'TEST502'),(503,'student','Sibling','Learner',2,2,'TEST503');
      INSERT INTO users(id,role,first_name,last_name,email,is_active) VALUES
      (12,'parent','No email','Parent',NULL,true),(13,'parent','Inactive','Parent','inactive@example.test',false),
      (14,'parent','Second linked','Parent','second@example.test',true);
      UPDATE users SET email='parent@example.test' WHERE id=10;
      INSERT INTO teacher_assignments VALUES(3,1,1),(4,2,2);
      INSERT INTO parent_students VALUES(10,501),(10,503),(11,502),(12,501),(13,501),(14,501);
      INSERT INTO invoices VALUES(1,501,2350,2350);INSERT INTO payment_transactions VALUES(1,501,2350);`);
    for(const actor of [1,2,3,4,10,11,501]){
      const session=key();if([10,11].includes(actor))await db.query('INSERT INTO parent_sessions(id,user_id) VALUES($1,$2)',[session,actor]);
      tokens[actor]=jwt.sign({id:actor,...([10,11].includes(actor)?{session_id:session}:{})},process.env.JWT_SECRET,{expiresIn:'10m'});
    }
    const app=express();app.use(express.json({limit:'32kb'}));app.use('/api/behaviour',require('../routes/behaviour'));app.use('/api/parent',require('../routes/parent'));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const request=async(path,{actor=1,method='GET',body,mime='application/json'}={})=>{
      const r=await fetch(`http://127.0.0.1:${server.address().port}/api/behaviour${path}`,{method,headers:{'Content-Type':mime,...(actor?{Authorization:`Bearer ${tokens[actor]}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
      return {status:r.status,data:await r.json(),headers:r.headers};
    };
    const parentRequest=async(path,actor=10)=>{
      const r=await fetch(`http://127.0.0.1:${server.address().port}/api/parent${path}`,{headers:{Authorization:`Bearer ${tokens[actor]}`}});
      return {status:r.status,data:await r.json()};
    };
    const rows=async table=>(await db.query(`SELECT * FROM ${table} ORDER BY 1,2`)).rows;
    const protectedBefore={users:await rows('users'),links:await rows('parent_students'),invoices:await rows('invoices'),payments:await rows('payment_transactions')};
    const date=new Date().toISOString().slice(0,10);
    const draft=(type,student=501)=>({student_id:student,type_id:type.id,event_date:date,notes:'Synthetic classroom observation.',request_key:key()});
    let merit,demerit,recordId;
    await t.test('missing schema returns 503; migration is additive and repeatable',async()=>{
      assert.equal((await request('/records?student_id=501')).status,503);
      const {run}=require('../scripts/run-learner-behaviour-migration');await run(db);await run(db);
      const types=(await request('/catalogue')).data.types;
      assert.equal(types.length,45);assert.equal(types.filter(x=>x.kind==='merit').length,6);
      for(const expected of require('../data/behaviourCatalogue.json')){
        const actual=types.find(x=>x.code===expected.code);for(const k of ['code','kind','label','category','points'])assert.deepEqual(actual[k],expected[k]);
      }
      merit=types.find(x=>x.code==='M001');demerit=types.find(x=>x.code==='1001');
      assert.equal(types.find(x=>x.code==='2001').points,6);assert.equal(types.some(x=>x.code==='3001'),false);
      assert.equal((await rows('behaviour_records')).length,0);
    });
    await t.test('Admin can find every learner, teachers only assigned classes, parents cannot browse learners',async()=>{
      assert.deepEqual((await request('/learners?q=TEST',{actor:3})).data.learners.map(x=>x.id),[501]);
      assert.equal((await request('/learners?q=TEST',{actor:2})).data.learners.length,3);
      assert.equal((await request('/learners',{actor:10})).status,403);
      assert.equal((await request('/catalogue',{actor:10})).status,403);
      assert.equal((await request('/records?student_id=502',{actor:3})).status,404);
      assert.equal((await request('/records?student_id=502',{actor:10})).status,404);
      assert.equal((await request('/records?student_id=503',{actor:10})).status,200);
      assert.equal((await request('/records',{actor:10})).status,400);
      assert.equal((await request('/catalogue',{actor:null})).status,401);
    });
    await t.test('teacher records use server catalogue snapshots and linked parents have read-only access',async()=>{
      const created=await request('/records',{actor:3,method:'POST',body:draft(demerit)});assert.equal(created.status,201);recordId=created.data.id;
      assert.equal((await request('/records',{actor:10,method:'POST',body:draft(merit)})).status,403);
      assert.equal((await request(`/records/${recordId}/void`,{actor:10,method:'POST',body:{reason:'Parent cannot change records'}})).status,403);
      const view=await request(`/records?student_id=501&year=${date.slice(0,4)}`,{actor:10});
      assert.equal(view.headers.get('cache-control'),'no-store');assert.equal(view.data.records[0].can_void,false);
      assert.equal(view.data.records[0].points,2);assert.equal(view.data.records[0].recorded_by_name,'Synthetic Teacher');
      assert.deepEqual(view.data.summary,{merits:0,demerits:1,demerit_points:2});
      assert.equal((await request('/records',{actor:3,method:'POST',body:{...draft(demerit),points:0}})).status,400);
    });
    await t.test('inactive teacher assignments cannot search, read or add learner records',async()=>{
      for(const active of [false,null]){
        await db.query('UPDATE teacher_assignments SET is_active=$1 WHERE teacher_id=3',[active]);
        assert.equal((await request('/learners?q=TEST',{actor:3})).data.learners.length,0);
        assert.equal((await request('/records?student_id=501',{actor:3})).status,404);
        assert.equal((await request('/records',{actor:3,method:'POST',body:draft(merit)})).status,404);
      }
      await db.query('UPDATE teacher_assignments SET is_active=true WHERE teacher_id=3');
    });
    await t.test('concurrent retries create one award and one audit; changed payload cannot reuse its key',async()=>{
      const body=draft(merit);const result=await Promise.all([1,2,3].map(()=>request('/records',{actor:3,method:'POST',body})));
      assert.deepEqual(result.map(r=>r.status).sort(),[200,200,201]);assert.equal(new Set(result.map(r=>r.data.id)).size,1);
      assert.equal((await request('/records',{actor:3,method:'POST',body:{...body,notes:'Changed request'}})).status,409);
      assert.equal((await db.query("SELECT * FROM audit_logs WHERE action='behaviour_record_created'")).rowCount,2);
    });
    await t.test('Admin can record outside teacher classes while teachers cannot',async()=>{
      assert.equal((await request('/records',{actor:2,method:'POST',body:draft(merit,502)})).status,201);
      assert.equal((await request('/records',{actor:3,method:'POST',body:draft(merit,502)})).status,404);
    });
    await t.test('validation rejects impossible/future dates, forged identity and malformed filters',async()=>{
      for(const patch of [{event_date:'2026-02-30'},{event_date:'2099-01-01'},{recorded_by:1},{type_id:-2},{request_key:'bad'},{notes:'x'.repeat(1001)}])
        assert.equal((await request('/records',{actor:3,method:'POST',body:{...draft(merit),...patch}})).status,400);
      for(const suffix of ['student_id=-1','student_id=501&year=bad','student_id=501&kind=bad','student_id=501&page=10001'])assert.equal((await request('/records?'+suffix)).status,400);
      assert.equal((await request('/records',{actor:3,method:'POST',mime:'text/plain',body:draft(merit)})).status,415);
    });
    await t.test('catalogue edits affect future entries only and have optimistic concurrency',async()=>{
      const body={label:'Updated school description',category:1,points:3,is_active:true,version:demerit.version};
      assert.equal((await request(`/catalogue/${demerit.id}`,{actor:3,method:'PATCH',body})).status,403);
      assert.equal((await request(`/catalogue/${demerit.id}`,{method:'PATCH',body})).status,200);
      assert.equal((await request(`/catalogue/${demerit.id}`,{method:'PATCH',body})).status,409);
      const existing=(await rows('behaviour_records')).find(x=>x.id===recordId);assert.equal(existing.points,2);assert.equal(existing.label,demerit.label);
      assert.equal((await request('/catalogue',{method:'POST',body:{code:'M007',kind:'merit',label:'Extra positive behaviour',category:null,points:5}})).status,400);
      const count=(await rows('behaviour_types')).length;await require('../scripts/run-learner-behaviour-migration').run(db);
      assert.equal((await rows('behaviour_types')).length,count);assert.equal((await db.query('SELECT points FROM behaviour_types WHERE id=$1',[demerit.id])).rows[0].points,3);
    });
    await t.test('deactivated types cannot receive new records but existing records remain visible',async()=>{
      const current=(await request('/catalogue')).data.types.find(x=>x.id===demerit.id);
      assert.equal((await request(`/catalogue/${demerit.id}`,{method:'PATCH',body:{label:current.label,category:1,points:3,is_active:false,version:current.version}})).status,200);
      assert.equal((await request('/records',{actor:3,method:'POST',body:draft(demerit)})).status,409);
      assert.equal((await request('/catalogue',{actor:3})).data.types.some(x=>x.id===demerit.id),false);
      assert.ok((await request('/records?student_id=501',{actor:10})).data.records.some(x=>x.id===recordId));
    });
    await t.test('staff corrections preserve original history and remove only the corrected points',async()=>{
      const adminRecord=(await request('/records',{actor:1,method:'POST',body:draft(merit)})).data.id;
      await assert.rejects(db.query("UPDATE behaviour_records SET status='voided',voided_by=1,voided_at=NOW(),void_reason=NULL WHERE id=$1",[adminRecord]),{code:'23514'});
      assert.equal((await request(`/records/${adminRecord}/void`,{actor:3,method:'POST',body:{reason:'Cannot change another staff entry'}})).status,403);
      const body={reason:'Incorrect learner entry confirmed by teacher.'};
      assert.equal((await request(`/records/${recordId}/void`,{actor:3,method:'POST',body})).status,200);
      assert.equal((await request(`/records/${recordId}/void`,{actor:3,method:'POST',body})).data.duplicate,true);
      const view=(await request('/records?student_id=501',{actor:10})).data;
      assert.equal(view.summary.demerit_points,0);assert.equal(view.summary.merits,2);
      assert.equal(view.records.find(x=>x.id===recordId).status,'voided');
      await assert.rejects(db.query("UPDATE behaviour_records SET notes='Changed history' WHERE id=$1",[recordId]),/immutable/);
      await assert.rejects(db.query('DELETE FROM behaviour_records WHERE id=$1',[recordId]),/cannot be deleted/);
    });
    await t.test('required audit failure rolls back the new record',async()=>{
      const before=(await rows('behaviour_records')).length;
      const notificationsBefore=await rows('parent_notifications'),emailsBefore=await rows('behaviour_parent_emails');
      await db.query(`CREATE FUNCTION fail_behaviour_audit() RETURNS TRIGGER AS $$ BEGIN
        IF NEW.action='behaviour_record_created' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_behaviour_audit();`);
      assert.equal((await request('/records',{actor:3,method:'POST',body:draft({id:(await db.query("SELECT id FROM behaviour_types WHERE code='2002'")).rows[0].id})})).status,500);
      assert.equal((await rows('behaviour_records')).length,before);
      assert.deepEqual(await rows('parent_notifications'),notificationsBefore);
      assert.deepEqual(await rows('behaviour_parent_emails'),emailsBefore);
      await db.query('DROP TRIGGER test_audit_failure ON audit_logs');
    });
    await t.test('disabled, revoked and sessionless Parent tokens are rejected',async()=>{
      await db.query('UPDATE users SET is_active=false WHERE id=11');assert.equal((await request('/records?student_id=502',{actor:11})).status,401);
      await db.query('UPDATE users SET is_active=true WHERE id=11');await db.query('UPDATE parent_sessions SET revoked_at=NOW() WHERE user_id=11');
      assert.equal((await request('/records?student_id=502',{actor:11})).status,401);
      tokens[11]=jwt.sign({id:11},process.env.JWT_SECRET);assert.equal((await request('/records?student_id=502',{actor:11})).status,401);
    });
    await t.test('pagination is bounded and parent links are rechecked on every request',async()=>{
      for(let i=0;i<51;i++)await db.query(`INSERT INTO behaviour_records(student_id,type_id,type_code,kind,label,event_date,recorded_by,request_key,request_hash)
        VALUES(503,$1,'M001','merit','Synthetic award',$2,1,$3,$4)`,[merit.id,date,key(),'a'.repeat(64)]);
      const first=(await request('/records?student_id=503',{actor:10})).data;assert.equal(first.records.length,50);assert.equal(first.has_more,true);
      assert.equal((await request('/records?student_id=503&page=2',{actor:10})).data.records.length,1);
      await db.query('DELETE FROM parent_students WHERE parent_id=10 AND student_id=503');
      assert.equal((await request('/records?student_id=503',{actor:10})).status,404);
      await db.query('INSERT INTO parent_students VALUES(10,503)');
    });
    await t.test('standard assignments without is_active retain teacher scope and allow records and corrections',async()=>{
      await db.query('ALTER TABLE teacher_assignments DROP COLUMN is_active');
      try{
        const search=await request('/learners?q=TEST',{actor:3});
        assert.equal(search.status,200);assert.deepEqual(search.data.learners.map(row=>row.id),[501]);
        assert.equal((await request('/records?student_id=501',{actor:3})).status,200);
        assert.equal((await request('/records?student_id=502',{actor:3})).status,404);
        assert.equal((await request('/records',{actor:3,method:'POST',body:draft(merit,502)})).status,404);
        const created=await request('/records',{actor:3,method:'POST',body:draft(merit)});
        assert.equal(created.status,201);
        assert.ok((await request('/records?student_id=501',{actor:10})).data.records.some(row=>row.id===created.data.id));
        assert.equal((await request(`/records/${created.data.id}/void`,{actor:3,method:'POST',body:{reason:'Synthetic compatibility correction.'}})).status,200);
        await db.query('DELETE FROM teacher_assignments WHERE teacher_id=3');
        assert.equal((await request('/records?student_id=501',{actor:3})).status,404);
        assert.equal((await request('/records',{actor:3,method:'POST',body:draft(merit)})).status,404);
        assert.equal((await request('/learners?q=TEST',{actor:2})).data.learners.length,3);
      }finally{
        if(!(await db.query('SELECT 1 FROM teacher_assignments WHERE teacher_id=3')).rowCount)await db.query('INSERT INTO teacher_assignments VALUES(3,1,1)');
        await db.query('ALTER TABLE teacher_assignments ADD COLUMN is_active BOOLEAN DEFAULT true');
      }
    });
    const alertType=(await db.query("SELECT * FROM behaviour_types WHERE code='2002'")).rows[0];
    const {processOne}=require('../services/behaviourParentAlerts');
    const emailJob=async()=>{
      const created=await request('/records',{actor:3,method:'POST',body:draft(alertType)});
      assert.equal(created.status,201);
      await db.query("UPDATE behaviour_parent_emails SET next_attempt_at=NOW()+interval '2 days' WHERE status IN ('queued','sending')");
      const job=(await db.query('SELECT * FROM behaviour_parent_emails WHERE record_id=$1 AND parent_id=10',[created.data.id])).rows[0];
      await db.query('UPDATE behaviour_parent_emails SET next_attempt_at=NOW() WHERE id=$1',[job.id]);
      return job;
    };
    await t.test('every new demerit alerts all active linked parents exactly once; merits do not alert',async()=>{
      const body=draft(alertType);
      const responses=await Promise.all([1,2,3].map(()=>request('/records',{actor:3,method:'POST',body})));
      assert.deepEqual(responses.map(r=>r.status).sort(),[200,200,201]);
      const record=responses[0].data.id;
      const alerts=(await db.query('SELECT * FROM parent_notifications WHERE dedupe_key=$1 ORDER BY parent_id',[`behaviour-demerit:${record}`])).rows;
      assert.deepEqual(alerts.map(n=>n.parent_id),[10,12,14]);
      assert.ok(alerts.every(n=>n.deep_link==='/parent/behaviour'&&n.important&&n.event_type==='behaviour_demerit_recorded'));
      const emails=(await db.query('SELECT * FROM behaviour_parent_emails WHERE record_id=$1 ORDER BY parent_id',[record])).rows;
      assert.deepEqual(emails.map(e=>[e.parent_id,e.status]),[[10,'queued'],[12,'skipped'],[14,'queued']]);
      assert.equal(emails[1].error_category,'NO_VALID_PARENT_EMAIL');
      const before=(await rows('parent_notifications')).length;
      assert.equal((await request('/records',{actor:2,method:'POST',body:draft(merit)})).status,201);
      assert.equal((await rows('parent_notifications')).length,before);
      const inbox=await parentRequest('/notifications');assert.equal(inbox.status,200);
      const alert=inbox.data.notifications.find(n=>n.dedupe_key===`behaviour-demerit:${record}`||String(n.id)===String(alerts[0].id));
      assert.ok(alert);assert.equal(alert.category,'behaviour');assert.equal(alert.action,'behaviour');assert.equal(alert.learner_id,501);
      assert.ok((await parentRequest('/notifications/unread-count')).data.count>0);
      await db.query('DELETE FROM parent_students WHERE parent_id=10 AND student_id=501');
      assert.equal((await parentRequest('/notifications')).data.notifications.some(n=>String(n.id)===String(alert.id)),false);
      await db.query('INSERT INTO parent_students VALUES(10,501)');
    });
    await t.test('alert persistence failure rolls back the incident, notifications, outbox and audit together',async()=>{
      const before={records:await rows('behaviour_records'),alerts:await rows('parent_notifications'),emails:await rows('behaviour_parent_emails'),audit:await rows('audit_logs')};
      await db.query(`CREATE FUNCTION fail_alert_outbox() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'injected outbox failure'; END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER test_alert_failure BEFORE INSERT ON behaviour_parent_emails FOR EACH ROW EXECUTE FUNCTION fail_alert_outbox();`);
      assert.equal((await request('/records',{actor:3,method:'POST',body:draft(alertType)})).status,500);
      assert.deepEqual(await rows('behaviour_records'),before.records);assert.deepEqual(await rows('parent_notifications'),before.alerts);
      assert.deepEqual(await rows('behaviour_parent_emails'),before.emails);assert.deepEqual(await rows('audit_logs'),before.audit);
      await db.query('DROP TRIGGER test_alert_failure ON behaviour_parent_emails');
    });
    await t.test('Resend acceptance uses a stable key, private body and only one concurrent worker',async()=>{
      const job=await emailJob();let release,started;
      const began=new Promise(resolve=>{started=resolve;});const gate=new Promise(resolve=>{release=resolve;});const calls=[];
      const send=async(...args)=>{calls.push(args);started();await gate;return {success:true};};
      const first=processOne({database:db,ready:true,send});await began;
      assert.deepEqual(await processOne({database:db,ready:true,send}),{busy:true});release();
      assert.deepEqual(await first,{accepted:true});assert.equal(calls.length,1);
      assert.equal(calls[0][0],'parent@example.test');assert.equal(calls[0][3].idempotencyKey,`harmony-demerit-${job.record_id}-10`);
      assert.match(calls[0][2],/https:\/\/www.harmonylearning.co.za\/parent\/behaviour/);
      for(const privateText of ['TEST501','First Learner','Synthetic classroom observation','Disrespecting Student Council'])assert.ok(!calls[0][2].includes(privateText));
      assert.equal((await db.query('SELECT status FROM behaviour_parent_emails WHERE id=$1',[job.id])).rows[0].status,'accepted');
    });
    await t.test('timeout retry reuses the same email payload and key; definitive failures stay safe',async()=>{
      const job=await emailJob(),calls=[];
      const send=async(...args)=>{calls.push(args);return calls.length===1?{success:false,error:'EMAIL_API_TIMEOUT'}:{success:true};};
      assert.equal((await processOne({database:db,ready:true,send})).deferred,true);
      assert.ok((await db.query('SELECT first_attempt_at FROM behaviour_parent_emails WHERE id=$1',[job.id])).rows[0].first_attempt_at);
      await db.query('UPDATE behaviour_parent_emails SET next_attempt_at=NOW() WHERE id=$1',[job.id]);
      assert.deepEqual(await processOne({database:db,ready:true,send}),{accepted:true});assert.deepEqual(calls[0],calls[1]);
      const rejected=await emailJob();assert.equal((await processOne({database:db,ready:true,send:async()=>({success:false,error:'EMAIL_AUTH_FAILED'})})).deferred,true);
      assert.equal((await db.query('SELECT first_attempt_at FROM behaviour_parent_emails WHERE id=$1',[rejected.id])).rows[0].first_attempt_at,null);
    });
    await t.test('a crash after provider acceptance retries the durable attempt with the same key',async()=>{
      const job=await emailJob();const calls=[];
      const send=async(...args)=>{calls.push(args);return {success:true};};
      const failDatabase={pool:{connect:async()=>{
        const c=await db.pool.connect();return {release:()=>c.release(),query:async(sql,args)=>{
          if(sql.includes("SET status='accepted'"))throw new Error('Synthetic connection loss after send');return c.query(sql,args);
        }};
      }}};
      await assert.rejects(processOne({database:failDatabase,ready:true,send}),/Synthetic connection loss/);
      assert.equal((await db.query('SELECT status FROM behaviour_parent_emails WHERE id=$1',[job.id])).rows[0].status,'sending');
      assert.deepEqual(await processOne({database:db,ready:true,send}),{accepted:true});assert.deepEqual(calls[0],calls[1]);
    });
    await t.test('uncertain old sends require review; provider outages do not erase portal alerts',async()=>{
      const job=await emailJob();let calls=0;const send=async()=>{calls++;return {success:true};};
      await db.query("UPDATE behaviour_parent_emails SET first_attempt_at=NOW()-interval '24 hours' WHERE id=$1",[job.id]);
      assert.deepEqual(await processOne({database:db,ready:true,send}),{check_required:true});assert.equal(calls,0);
      assert.deepEqual(await processOne({database:db,ready:false,send}),{waiting_for_configuration:true});
      assert.ok((await db.query('SELECT 1 FROM parent_notifications WHERE id=$1',[job.notification_id])).rowCount);
    });
    await t.test('removed links, changed email, disabled accounts and corrected incidents cannot trigger queued emails',async()=>{
      for(const change of ['unlink','email','parent','learner','void']){
        const job=await emailJob();let calls=0;
        if(change==='unlink')await db.query('DELETE FROM parent_students WHERE parent_id=10 AND student_id=501');
        if(change==='email')await db.query("UPDATE users SET email='changed@example.test' WHERE id=10");
        if(change==='parent')await db.query('UPDATE users SET is_active=false WHERE id=10');
        if(change==='learner')await db.query('UPDATE users SET is_active=false WHERE id=501');
        if(change==='void')assert.equal((await request(`/records/${job.record_id}/void`,{actor:3,method:'POST',body:{reason:'Incorrect incident selected, corrected by teacher.'}})).status,200);
        const outcome=await processOne({database:db,ready:true,send:async()=>{calls++;return {success:true};}});
        assert.equal(calls,0);assert.ok(change==='void'?outcome.empty:outcome.skipped);
        assert.equal((await db.query('SELECT status FROM behaviour_parent_emails WHERE id=$1',[job.id])).rows[0].status,'skipped');
        if(change==='unlink')await db.query('INSERT INTO parent_students VALUES(10,501)');
        await db.query("UPDATE users SET email='parent@example.test',is_active=true WHERE id=10");await db.query('UPDATE users SET is_active=true WHERE id=501');
        if(change==='void')assert.equal((await db.query('SELECT title FROM parent_notifications WHERE id=$1',[job.notification_id])).rows[0].title,'Demerit entry corrected');
      }
    });
    await t.test('repeated migrations preserve inbox reads, queued messages and behaviour history without backfill',async()=>{
      const n=(await rows('parent_notifications'))[0];await db.query('INSERT INTO parent_notification_reads(notification_id,parent_id) VALUES($1,$2)',[n.id,n.parent_id]);
      const before={alerts:await rows('parent_notifications'),reads:await rows('parent_notification_reads'),emails:await rows('behaviour_parent_emails'),records:await rows('behaviour_records')};
      await require('../scripts/run-learner-behaviour-migration').run(db);
      assert.deepEqual(await rows('parent_notifications'),before.alerts);assert.deepEqual(await rows('parent_notification_reads'),before.reads);
      assert.deepEqual(await rows('behaviour_parent_emails'),before.emails);assert.deepEqual(await rows('behaviour_records'),before.records);
    });
    await t.test('100-point balances and Admin review alerts use active demerits only and recover after corrections',async()=>{
      const current=(await request('/records?student_id=501',{actor:10})).data;
      assert.equal(current.points_balance.remaining,100-current.summary.demerit_points);
      const alerts=await request('/alerts',{actor:1});assert.equal(alerts.status,200);
      assert.ok(alerts.data.learners.some(r=>r.id===501&&r.remaining<=30));
      for(const actor of [3,10])assert.equal((await request('/alerts',{actor})).status,403);
      for(const kind of ['year=bad','year=2101','page=10001'])assert.equal((await request('/alerts?'+kind)).status,400);
      const before=await rows('users');const records=(await db.query("SELECT id FROM behaviour_records WHERE student_id=501 AND kind='demerit' AND status='active'")).rows;
      for(const r of records)assert.equal((await request(`/records/${r.id}/void`,{actor:1,method:'POST',body:{reason:'Synthetic correction of threshold test incidents.'}})).status,200);
      assert.equal((await request('/records?student_id=501',{actor:10})).data.points_balance.remaining,100);
      assert.equal((await request('/alerts')).data.learners.some(r=>r.id===501),false);
      assert.deepEqual(await rows('users'),before);
    });
    await t.test('legacy cross-grade class links resolve only within the learner grade; primary teachers are scoped',async()=>{
      await db.query('ALTER TABLE classes ADD COLUMN grade_id INTEGER,ADD COLUMN teacher_id INTEGER');
      try{
        await db.query("UPDATE classes SET grade_id=id;INSERT INTO grades VALUES(5,'Grade 5');INSERT INTO classes VALUES(51,'A',5,3),(52,'B',5,4);UPDATE users SET grade_id=5,class_id=2 WHERE id=501");
        // Class 2 is the legacy reference for B; Grade 5 B resolves to 52.
        assert.equal((await request('/records?student_id=501',{actor:4})).status,200);
        assert.equal((await request('/records?student_id=501',{actor:3})).status,404);
        await db.query('INSERT INTO teacher_assignments(teacher_id,grade_id,class_id) VALUES(3,5,2)');
        assert.equal((await request('/records?student_id=501',{actor:3})).status,200);
        assert.equal((await request('/records?student_id=502',{actor:3})).status,404);
        await db.query('UPDATE teacher_assignments SET is_active=false WHERE teacher_id=3 AND grade_id=5');
        assert.equal((await request('/records?student_id=501',{actor:3})).status,404);
        await db.query("INSERT INTO classes VALUES(53,' B ',5,NULL)");
        assert.equal((await request('/records?student_id=501',{actor:4})).status,404,'ambiguous B labels must not grant access');
      }finally{
        await db.query('UPDATE users SET grade_id=1,class_id=1 WHERE id=501;DELETE FROM teacher_assignments WHERE grade_id=5;DELETE FROM classes WHERE id>=51;DELETE FROM grades WHERE id=5;ALTER TABLE classes DROP COLUMN grade_id,DROP COLUMN teacher_id');
      }
    });
    await t.test('users, Parent links and financial data are unchanged',async()=>{
      assert.deepEqual(await rows('users'),protectedBefore.users);assert.deepEqual(await rows('parent_students'),protectedBefore.links);
      assert.deepEqual(await rows('invoices'),protectedBefore.invoices);assert.deepEqual(await rows('payment_transactions'),protectedBefore.payments);
    });
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.pool.end();
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await control.end();
    if(previousSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previousSecret;
  }
});
