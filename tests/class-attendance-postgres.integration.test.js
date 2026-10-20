const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const express=require('express'),jwt=require('jsonwebtoken'),{Pool}=require('pg');
const url=process.env.FINANCE_TEST_DATABASE_URL;
test('Grade/class compatibility keeps attendance and teacher access consistent',{skip:!url,timeout:90000},async t=>{
 const schema='class_scope_'+crypto.randomBytes(8).toString('hex');const control=new Pool({connectionString:url,ssl:false});let db,server;
 const oldSecret=process.env.JWT_SECRET;
 try{
  await control.query(`CREATE SCHEMA "${schema}"`);db=require('../config/database');assert.equal(db.pool.totalCount,0);
  const scoped=new URL(url);scoped.searchParams.set('options',`-csearch_path=${schema}`);db.pool.options.connectionString=scoped.toString();db.pool.options.ssl=false;
  process.env.JWT_SECRET='synthetic-class-scope-secret';
  await db.query(`CREATE TABLE grades(id INTEGER PRIMARY KEY,name TEXT);
   CREATE TABLE classes(id INTEGER PRIMARY KEY,name TEXT,grade_id INTEGER,teacher_id INTEGER,is_active BOOLEAN DEFAULT true);
   CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,student_number TEXT,email TEXT,first_name TEXT,last_name TEXT,
    grade_id INTEGER,class_id INTEGER,is_active BOOLEAN DEFAULT true,auth_revoked_at TIMESTAMPTZ);
   CREATE TABLE teacher_assignments(id SERIAL PRIMARY KEY,teacher_id INTEGER,grade_id INTEGER,class_id INTEGER,is_active BOOLEAN DEFAULT true);
   CREATE TABLE attendance(student_id INTEGER,class_id INTEGER,grade_id INTEGER,date DATE,status TEXT,time_in TIMESTAMPTZ,
    notes TEXT,recorded_by INTEGER,recorded_at TIMESTAMPTZ DEFAULT NOW());
   INSERT INTO grades VALUES(2,'Grade 2'),(5,'Grade 5');
   INSERT INTO classes(id,name,grade_id,teacher_id) VALUES(2,'Class B',2,NULL),(51,'Class A',5,5),(52,'Class B',5,4);
   INSERT INTO users(id,role,first_name,last_name,grade_id,class_id,student_number) VALUES
    (1,'admin','Synthetic','Admin',NULL,NULL,NULL),(3,'teacher','Assigned','Teacher',NULL,NULL,NULL),
    (4,'teacher','Primary','Teacher',NULL,NULL,NULL),(5,'teacher','Other','Teacher',NULL,NULL,NULL),
    (501,'student','Legacy','Learner',5,2,'TEST501'),(502,'student','Current','Learner',5,52,'TEST502'),
    (503,'student','Other grade','Learner',2,2,'TEST503'),(504,'student','Unassigned','Learner',5,NULL,'TEST504');
   INSERT INTO teacher_assignments(teacher_id,grade_id,class_id) VALUES(3,5,2);
   INSERT INTO attendance(student_id,class_id,grade_id,date,status,recorded_by) VALUES(503,2,2,'2026-10-19','absent',1);`);
  const app=express();app.use(express.json());app.use('/api/attendance',require('../routes/attendance'));app.use('/api/users',require('../routes/users'));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
  const request=async(path,actor=1,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+jwt.sign({id:actor},process.env.JWT_SECRET,{expiresIn:'10m'}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
  const roster=actor=>request('/api/attendance/class/52/2026-10-19',actor);
  const snapshot=async(table,order='id')=>(await db.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;
  const before={users:await snapshot('users'),assignments:await snapshot('teacher_assignments'),classes:await snapshot('classes')};
  await t.test('Admin and assigned teachers get both Grade 5 B learners and no other grade',async()=>{
   for(const actor of [1,3,4]){const r=await roster(actor);assert.equal(r.status,200);assert.deepEqual(r.data.students.map(s=>s.student_id).sort(),[501,502]);}
   assert.equal((await roster(5)).status,403);
   const fresh=await request('/api/users/teacher/assignments',3);assert.equal(fresh.status,200);assert.deepEqual(fresh.data.assignments.map(c=>[c.grade_id,c.class_id]),[[5,52]]);
   assert.deepEqual((await request('/api/users/teacher/assignments',4)).data.assignments.map(c=>c.class_id),[52]);
  });
  await t.test('saving the canonical register retains legacy learner links and the other grade register',async()=>{
   const body={class_id:52,grade_id:5,date:'2026-10-19',attendance:[{student_id:501,status:'present'},{student_id:502,status:'present'}]};
   assert.equal((await request('/api/attendance/submit',3,body)).status,200);
   const saved=await snapshot('attendance','student_id');assert.equal(saved.length,3);assert.equal(saved.find(r=>r.student_id===503).status,'absent');
   assert.equal((await roster(3)).data.total_students,2);
   for(const patch of [{grade_id:2},{attendance:[{student_id:503,status:'present'}]},{attendance:[]},{attendance:[{student_id:501,status:'unknown'}]}]){
    const r=await request('/api/attendance/submit',1,{...body,...patch});assert.equal(r.status,400);assert.deepEqual(await snapshot('attendance','student_id'),saved);
   }
  });
  await t.test('explicit inactive assignments and ambiguous legacy labels fail closed',async()=>{
   await db.query('UPDATE teacher_assignments SET is_active=false WHERE teacher_id=3');assert.equal((await roster(3)).status,403);
   await db.query('UPDATE teacher_assignments SET is_active=true WHERE teacher_id=3');
   await db.query("INSERT INTO classes(id,name,grade_id) VALUES(53,' Class B ',5)");
   assert.equal((await roster(3)).status,403);assert.deepEqual((await roster(1)).data.students.map(s=>s.student_id),[502]);
   await db.query('DELETE FROM classes WHERE id=53');await db.query('ALTER TABLE teacher_assignments DROP COLUMN is_active');
   assert.equal((await roster(3)).status,200);await db.query('ALTER TABLE teacher_assignments ADD COLUMN is_active BOOLEAN DEFAULT true');
  });
  await t.test('the compatibility reads and attendance saves never rewrite accounts or assignments',async()=>{
   assert.deepEqual(await snapshot('users'),before.users);assert.deepEqual(await snapshot('teacher_assignments'),before.assignments);assert.deepEqual(await snapshot('classes'),before.classes);
  });
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.pool.end();await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await control.end();if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;}
});
