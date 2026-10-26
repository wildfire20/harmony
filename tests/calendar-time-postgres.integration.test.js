const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const express=require('express'),jwt=require('jsonwebtoken'),{Pool}=require('pg');
const url=process.env.FINANCE_TEST_DATABASE_URL;
test('Calendar times survive save, reload and repeated edits in South African time',{skip:!url,timeout:90000},async t=>{
 const schema='calendar_time_'+crypto.randomBytes(8).toString('hex');const control=new Pool({connectionString:url,ssl:false});
 let db,server,originalNotify;const oldSecret=process.env.JWT_SECRET,tokens={};const notifications=[];
 try{
  await control.query(`CREATE SCHEMA "${schema}"`);db=require('../config/database');assert.equal(db.pool.totalCount,0);
  const scoped=new URL(url);scoped.searchParams.set('options',`-csearch_path=${schema} -ctimezone=UTC`);db.pool.options.connectionString=scoped.toString();db.pool.options.ssl=false;
  process.env.JWT_SECRET='synthetic-calendar-time-secret';
  await db.query(`CREATE TABLE grades(id INTEGER PRIMARY KEY,name TEXT);
   CREATE TABLE classes(id INTEGER PRIMARY KEY,name TEXT,grade_id INTEGER);
   CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,student_number TEXT,email TEXT,first_name TEXT,last_name TEXT,
    grade_id INTEGER,class_id INTEGER,is_active BOOLEAN DEFAULT true,auth_revoked_at TIMESTAMPTZ,
    is_boarder BOOLEAN DEFAULT false,uses_transport BOOLEAN DEFAULT false,uses_aftercare BOOLEAN DEFAULT false);
   CREATE TABLE teacher_assignments(teacher_id INTEGER,grade_id INTEGER,class_id INTEGER);
   CREATE TABLE parent_students(parent_id INTEGER,student_id INTEGER);
   CREATE TABLE parent_sessions(id UUID PRIMARY KEY,user_id INTEGER,created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW()+interval '1 hour',family_expires_at TIMESTAMPTZ DEFAULT NOW()+interval '1 hour',revoked_at TIMESTAMPTZ);
   CREATE TABLE tasks(id INTEGER PRIMARY KEY,title TEXT,due_date TIMESTAMP,task_type TEXT,grade_id INTEGER,class_id INTEGER,created_by INTEGER,is_active BOOLEAN DEFAULT true);
   INSERT INTO grades VALUES(1,'Grade 2'),(2,'Grade 3');INSERT INTO classes VALUES(1,'A',1),(2,'B',2);
   INSERT INTO users(id,role,first_name,last_name,grade_id,class_id,student_number) VALUES
    (1,'super_admin','Synthetic','Admin',NULL,NULL,NULL),(2,'teacher','Synthetic','Teacher',NULL,NULL,NULL),
    (10,'parent','Synthetic','Parent',NULL,NULL,NULL),(11,'parent','Other','Parent',NULL,NULL,NULL),
    (501,'student','First','Learner',1,1,'TEST501'),(502,'student','Other','Learner',2,2,'TEST502');
   INSERT INTO teacher_assignments VALUES(2,1,1);INSERT INTO parent_students VALUES(10,501),(11,502);`);
  const migrate=async()=>{const c=await db.pool.connect();try{await c.query('BEGIN');await c.query(fs.readFileSync(path.join(__dirname,'../migrations/calendar_school_time.sql'),'utf8'));await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
  await migrate();
  for(const id of [1,2,10,11]){const session=crypto.randomUUID();if(id>=10)await db.query('INSERT INTO parent_sessions(id,user_id) VALUES($1,$2)',[session,id]);tokens[id]=jwt.sign({id,...(id>=10?{session_id:session}:{})},process.env.JWT_SECRET,{expiresIn:'10m'});}
  const service=require('../services/parentNotificationService');originalNotify=service.notifyCalendarEvent;service.notifyCalendarEvent=async event=>{notifications.push(event);return{created:0};};
  const app=express();app.use(express.json());app.use('/api/calendar',require('../routes/calendar'));app.use('/api/parent',require('../routes/parent'));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const req=async(p,{method='GET',body,actor=1}={})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+p,{method,headers:{'Content-Type':'application/json',...(actor?{Authorization:'Bearer '+tokens[actor]}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};};
  const draft=extra=>({title:'Synthetic meeting',description:'Synthetic calendar QA',start_date:'2026-10-26T09:00:00+02:00',end_date:'2026-10-26T10:00:00+02:00',event_type:'meeting',target_audience:'all',parent_visible:true,grade_id:1,class_id:1,...extra});
  let event;
  await t.test('09:00 is returned as 09:00 with an explicit offset, not a server-local Date',async()=>{
   const result=await req('/api/calendar/events',{method:'POST',body:draft()});assert.equal(result.status,201);event=result.data.event;
   assert.equal(event.start_date,'2026-10-26T09:00:00.000+02:00');assert.equal(event.end_date,'2026-10-26T10:00:00.000+02:00');
   assert.equal((await db.query('SELECT start_date::text FROM school_events WHERE id=$1',[event.id])).rows[0].start_date,'2026-10-26 09:00:00');
   const reload=await req('/api/calendar?month=10&year=2026');assert.equal(reload.status,200);
   assert.equal(reload.data.events.find(e=>e.id===event.id).start_date,event.start_date);
   assert.equal(notifications[0].start_date,event.start_date);
  });
  await t.test('repeated edits keep the selected time; title-only edits leave time intact',async()=>{
   for(let i=0;i<3;i++){
    const result=await req('/api/calendar/events/'+event.id,{method:'PUT',body:draft({start_date:'2026-10-26T14:35:00+02:00',end_date:'2026-10-26T15:40:00+02:00'})});
    assert.equal(result.status,200);assert.equal(result.data.event.start_date,'2026-10-26T14:35:00.000+02:00');
    const reload=(await req('/api/calendar?month=10&year=2026')).data.events.find(e=>e.id===event.id);assert.equal(reload.start_date,result.data.event.start_date);
   }
   const title=await req('/api/calendar/events/'+event.id,{method:'PUT',body:{title:'Updated synthetic title'}});
   assert.equal(title.status,200);assert.equal(title.data.event.start_date,'2026-10-26T14:35:00.000+02:00');
  });
  await t.test('naive legacy requests are treated as school time; UTC inputs retain their instant',async()=>{
   const result=await req('/api/calendar/events/'+event.id,{method:'PUT',body:{start_date:'2026-10-26T08:15:00',end_date:'2026-10-26T07:15:00Z'}});
   assert.equal(result.status,200);assert.equal(result.data.event.start_date,'2026-10-26T08:15:00.000+02:00');assert.equal(result.data.event.end_date,'2026-10-26T09:15:00.000+02:00');
  });
  await t.test('end time can be removed and invalid ranges or dates roll back fully',async()=>{
   const result=await req('/api/calendar/events/'+event.id,{method:'PUT',body:{end_date:null}});assert.equal(result.status,200);assert.equal(result.data.event.end_date,null);
   const before=(await db.query('SELECT to_jsonb(e) AS row FROM school_events e ORDER BY id')).rows;
   for(const patch of [{end_date:'2026-10-25T23:00:00+02:00'},{start_date:'2026-02-30T09:00:00+02:00'},{start_date:'not-a-date'},{start_date:'2026-10-26T24:15:00+02:00'}])assert.equal((await req('/api/calendar/events/'+event.id,{method:'PUT',body:patch})).status,400);
   assert.deepEqual((await db.query('SELECT to_jsonb(e) AS row FROM school_events e ORDER BY id')).rows,before);
   assert.equal((await req('/api/calendar/events',{method:'POST',body:draft({end_date:'2026-10-25T10:00:00+02:00'})})).status,400);
  });
  await t.test('parents see the same published time and visibility/grade boundaries are retained',async()=>{
   const parent=await req('/api/parent/calendar?child_id=501&month=10&year=2026',{actor:10});assert.equal(parent.status,200);assert.equal(parent.data.events.find(e=>e.id===event.id).start_date,'2026-10-26T08:15:00.000+02:00');
   assert.equal((await req('/api/parent/calendar?child_id=502&month=10&year=2026',{actor:11})).data.events.length,0);
   assert.equal((await req('/api/parent/calendar?child_id=502&month=10&year=2026',{actor:10})).status,403);
   const privateEvent=await req('/api/calendar/events',{method:'POST',body:draft({title:'Internal only',parent_visible:false})});assert.equal(privateEvent.status,201);
   assert.equal((await req('/api/parent/calendar?child_id=501&month=10&year=2026',{actor:10})).data.events.some(e=>e.id===privateEvent.data.event.id),false);
   for(const actor of [2,10])for(const method of ['POST','PUT'])assert.equal((await req('/api/calendar/events'+(method==='PUT'?'/'+event.id:''),{actor,method,body:draft()})).status,403);
  });
  await t.test('timestamp-with-time-zone schemas retain the same school time and month at midnight',async()=>{
   await db.query("ALTER TABLE school_events ALTER COLUMN start_date TYPE timestamptz USING start_date AT TIME ZONE 'Africa/Johannesburg';ALTER TABLE school_events ALTER COLUMN end_date TYPE timestamptz USING end_date AT TIME ZONE 'Africa/Johannesburg'");
   const before=(await req('/api/calendar?month=10&year=2026')).data.events.find(e=>e.id===event.id);assert.equal(before.start_date,'2026-10-26T08:15:00.000+02:00');
   const result=await req('/api/calendar/events/'+event.id,{method:'PUT',body:{start_date:'2026-11-01T00:15:00+02:00',end_date:null}});assert.equal(result.status,200);assert.equal(result.data.event.start_date,'2026-11-01T00:15:00.000+02:00');
   assert.equal((await req('/api/calendar?month=10&year=2026')).data.events.some(e=>e.id===event.id),false);
   assert.equal((await req('/api/calendar?month=11&year=2026')).data.events.some(e=>e.id===event.id),true);
   assert.equal((await req('/api/parent/calendar?child_id=501&month=11&year=2026',{actor:10})).data.events.find(e=>e.id===event.id).start_date,'2026-11-01T00:15:00.000+02:00');
   await migrate();assert.equal((await req('/api/calendar?month=11&year=2026')).data.events.find(e=>e.id===event.id).start_date,result.data.event.start_date);
  });
  await t.test('legacy DATE promotion is repeatable and preserves dates, NULLs and every other field',async()=>{
   await db.query("ALTER TABLE school_events ALTER COLUMN start_date TYPE date USING (start_date AT TIME ZONE 'Africa/Johannesburg')::date;ALTER TABLE school_events ALTER COLUMN end_date TYPE date USING (end_date AT TIME ZONE 'Africa/Johannesburg')::date");
   const before=(await db.query("SELECT to_jsonb(e)-ARRAY['start_date','end_date'] AS other,start_date::text,end_date::text FROM school_events e ORDER BY id")).rows;
   await migrate();await migrate();
   const after=(await db.query("SELECT to_jsonb(e)-ARRAY['start_date','end_date'] AS other,to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date FROM school_events e ORDER BY id")).rows;
   assert.deepEqual(after,before);
   const changed=await req('/api/calendar/events/'+event.id,{method:'PUT',body:{start_date:'2026-11-01T23:45:00+02:00',end_date:null}});assert.equal(changed.status,200);assert.equal(changed.data.event.start_date,'2026-11-01T23:45:00.000+02:00');
  });
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));if(originalNotify)require('../services/parentNotificationService').notifyCalendarEvent=originalNotify;
  if(db)await db.pool.end();await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await control.end();
  if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
 }
});
