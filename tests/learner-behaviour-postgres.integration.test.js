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
      INSERT INTO teacher_assignments VALUES(3,1,1),(4,2,2);
      INSERT INTO parent_students VALUES(10,501),(10,503),(11,502);
      INSERT INTO invoices VALUES(1,501,2350,2350);INSERT INTO payment_transactions VALUES(1,501,2350);`);
    for(const actor of [1,2,3,4,10,11,501]){
      const session=key();if([10,11].includes(actor))await db.query('INSERT INTO parent_sessions(id,user_id) VALUES($1,$2)',[session,actor]);
      tokens[actor]=jwt.sign({id:actor,...([10,11].includes(actor)?{session_id:session}:{})},process.env.JWT_SECRET,{expiresIn:'10m'});
    }
    const app=express();app.use(express.json({limit:'32kb'}));app.use('/api/behaviour',require('../routes/behaviour'));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const request=async(path,{actor=1,method='GET',body,mime='application/json'}={})=>{
      const r=await fetch(`http://127.0.0.1:${server.address().port}/api/behaviour${path}`,{method,headers:{'Content-Type':mime,...(actor?{Authorization:`Bearer ${tokens[actor]}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
      return {status:r.status,data:await r.json(),headers:r.headers};
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
      await db.query('UPDATE teacher_assignments SET is_active=false WHERE teacher_id=3');
      assert.equal((await request('/learners?q=TEST',{actor:3})).data.learners.length,0);
      assert.equal((await request('/records?student_id=501',{actor:3})).status,404);
      assert.equal((await request('/records',{actor:3,method:'POST',body:draft(merit)})).status,404);
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
      await db.query(`CREATE FUNCTION fail_behaviour_audit() RETURNS TRIGGER AS $$ BEGIN
        IF NEW.action='behaviour_record_created' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_behaviour_audit();`);
      assert.equal((await request('/records',{actor:3,method:'POST',body:draft(merit)})).status,500);
      assert.equal((await rows('behaviour_records')).length,before);
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
