const classScope = require('./classScope');
const crypto = require('node:crypto');
const db = require('../config/database');
const { logAudit } = require('../utils/auditLogger');
const { queueDemeritAlerts, correctDemeritAlerts } = require('./behaviourParentAlerts');
const fail = (status, message) => Object.assign(new Error(message), { status });
const isAdmin = actor => ['admin', 'super_admin'].includes(actor?.role);
const id = value => {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value)<1 || Number(value)>2147483647) throw fail(400,'Select a valid learner or record.');
  return Number(value);
};
const clean = (value, max, minimum=0) => {
  if (typeof value!=='string' || value.trim().length<minimum || value.trim().length>max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw fail(400,'Please check the text fields.');
  return value.trim();
};
const fields = (body, allowed) => {
  if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!allowed.includes(k))) throw fail(400,'Invalid form fields.');
};
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const teacherScope = classScope.teacherScope('$1','u.grade_id','u.class_id');
async function transaction(work) {
  const c=await db.pool.connect();
  try {await c.query('BEGIN');const result=await work(c);await c.query('COMMIT');return result;}
  catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
async function learner(c, actor, learnerId) {
  const studentId=id(learnerId);
  if (!['teacher','parent','admin','super_admin'].includes(actor?.role)) throw fail(403,'Access denied.');
  const scope=isAdmin(actor)?'$1::integer > 0':actor.role==='teacher'?teacherScope:
    `EXISTS (SELECT 1 FROM parent_students ps WHERE ps.parent_id=$1 AND ps.student_id=u.id)`;
  const row=(await c.query(`SELECT u.id,u.student_number,u.first_name,u.last_name FROM users u
    WHERE u.id=$2 AND u.role='student' AND u.is_active=true AND (${scope}) FOR SHARE OF u`,[actor.id,studentId])).rows[0];
  if (!row) throw fail(404,'Learner not found or access unavailable.');
  // Lock current links/assignments as well as the learner until the transaction ends.
  if (actor.role==='parent' && !(await c.query('SELECT parent_id FROM parent_students WHERE parent_id=$1 AND student_id=$2 FOR SHARE',[actor.id,studentId])).rowCount) throw fail(404,'Learner access changed.');
  if (actor.role==='teacher') {
    await c.query(`SELECT ta.teacher_id FROM teacher_assignments ta JOIN users u ON u.id=$2
      WHERE ta.teacher_id=$1 AND ta.grade_id=u.grade_id AND ${classScope.active('ta')}
        AND ${classScope.resolvedClassId('ta.grade_id','ta.class_id')}=${classScope.resolvedClassId('u.grade_id','u.class_id')} FOR SHARE OF ta`,[actor.id,studentId]);
    await c.query(`SELECT homeroom.id FROM classes homeroom JOIN users u ON u.id=$2
      WHERE homeroom.id=${classScope.resolvedClassId('u.grade_id','u.class_id')}
      AND to_jsonb(homeroom)->>'teacher_id'=$1::text FOR SHARE OF homeroom`,[actor.id,studentId]);
    if(!(await c.query(`SELECT u.id FROM users u WHERE u.id=$2 AND ${teacherScope}`,[actor.id,studentId])).rowCount)throw fail(404,'Learner access changed.');
  }
  return row;
}
async function audit(c,actor,action,entityId,details) {
  await logAudit({executor:c,required:true,userId:actor.id,userName:`${actor.first_name||''} ${actor.last_name||''}`.trim(),
    userRole:actor.role,action,entityType:'behaviour',entityId,details});
}
async function listLearners(actor, query='') {
  if (!isAdmin(actor)&&actor?.role!=='teacher') throw fail(403,'Staff access is required.');
  const q=clean(query,100);
  const scope=isAdmin(actor)?'$1::integer > 0':teacherScope;
  return {learners:(await db.query(`SELECT u.id,u.student_number,u.first_name,u.last_name,g.name AS grade_name,c.name AS class_name
    FROM users u LEFT JOIN grades g ON g.id=u.grade_id LEFT JOIN classes c ON c.id=u.class_id
    WHERE u.role='student' AND u.is_active=true AND (${scope}) AND
    (u.student_number ILIKE $2 OR (u.first_name||' '||u.last_name) ILIKE $2)
    ORDER BY u.last_name,u.first_name,u.id LIMIT 30`,[actor.id,`%${q}%`])).rows};
}
async function catalogue(actor) {
  if (!isAdmin(actor)&&actor?.role!=='teacher') throw fail(403,'Staff access is required.');
  return {types:(await db.query(`SELECT id,code,kind,label,category,points,is_active,version FROM behaviour_types
    WHERE ($1::boolean OR is_active=true) ORDER BY kind DESC,category NULLS FIRST,code`,[isAdmin(actor)])).rows};
}
function typeInput(body, update=false) {
  fields(body,update?['label','category','points','is_active','version']:['code','kind','label','category','points']);
  const label=clean(body.label,300,3);
  if (update && (!Number.isInteger(body.version)||body.version<1||typeof body.is_active!=='boolean')) throw fail(400,'Refresh the catalogue and try again.');
  if (!update && (!/^[A-Z0-9_-]{2,12}$/.test(body.code||'')||!['merit','demerit'].includes(body.kind))) throw fail(400,'Enter a unique code and select Merit or Demerit.');
  return label;
}
async function saveType(actor,body,typeId=null) {
  if(!isAdmin(actor))throw fail(403,'Only Admin can manage the catalogue.');
  const update=typeId!=null, label=typeInput(body,update);
  return transaction(async c=>{
    const original=update?(await c.query('SELECT * FROM behaviour_types WHERE id=$1 FOR UPDATE',[id(typeId)])).rows[0]:null;
    if(update&&!original)throw fail(404,'Type not found.');
    if(update&&original.version!==body.version)throw fail(409,'This type changed. Refresh before editing.');
    const kind=original?.kind||body.kind;
    const category=kind==='merit'?null:Number(body.category), points=kind==='merit'?null:Number(body.points);
    if(kind==='merit'&&(body.category!=null||body.points!=null))throw fail(400,'Merits are counted as awards and do not have points.');
    if(kind==='demerit'&&(![1,2,3,4].includes(category)||!Number.isInteger(points)||points<1||points>100))throw fail(400,'Choose category 1–4 and points between 1 and 100.');
    const row=update?(await c.query(`UPDATE behaviour_types SET label=$2,category=$3,points=$4,is_active=$5,version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *`,[original.id,label,category,points,body.is_active])).rows[0]:
      (await c.query('INSERT INTO behaviour_types(code,kind,label,category,points) VALUES($1,$2,$3,$4,$5) RETURNING *',[body.code,kind,label,category,points])).rows[0];
    await audit(c,actor,update?'behaviour_type_updated':'behaviour_type_created',row.id,{before:original,after:row});return {type:row};
  });
}
async function records(actor,query) {
  const year=query.year==null?Number(today().slice(0,4)):Number(query.year);
  if(!Number.isInteger(year)||year<2000||year>2100)throw fail(400,'Enter a valid school year.');
  const kind=query.kind||'all';if(!['all','merit','demerit'].includes(kind))throw fail(400,'Invalid record type.');
  const page=query.page==null?1:id(query.page);if(page>10000)throw fail(400,'Invalid page.');
  return transaction(async c=>{
    const student=await learner(c,actor,query.student_id);
    const params=[student.id,`${year}-01-01`,`${year+1}-01-01`];
    const summary=(await c.query(`SELECT count(*) FILTER(WHERE kind='merit' AND status='active')::int AS merits,
      count(*) FILTER(WHERE kind='demerit' AND status='active')::int AS demerits,
      COALESCE(sum(points) FILTER(WHERE kind='demerit' AND status='active'),0)::int AS demerit_points
      FROM behaviour_records WHERE student_id=$1 AND event_date >= $2::date AND event_date < $3::date`,params)).rows[0];
    const result=await c.query(`SELECT b.id,b.type_code,b.kind,b.label,b.category,b.points,b.event_date::text,b.notes,b.status,
      b.recorded_by,b.created_at,b.void_reason,b.voided_at, u.first_name||' '||u.last_name AS recorded_by_name,
      count(*) OVER()::int AS total_count
      FROM behaviour_records b JOIN users u ON u.id=b.recorded_by
      WHERE b.student_id=$1 AND b.event_date >= $2::date AND b.event_date < $3::date AND ($4='all' OR b.kind=$4)
      ORDER BY b.event_date DESC,b.id DESC LIMIT 50 OFFSET $5`,[...params,kind,(page-1)*50]);
    const points_balance={starting:100,remaining:100-summary.demerit_points,review_required:summary.demerit_points>=70};
    return {learner:student,summary,points_balance,records:result.rows.map(({total_count,...row})=>({...row,can_void:row.status==='active'&&(isAdmin(actor)||(actor.role==='teacher'&&row.recorded_by===actor.id))})),page,has_more:page*50<Number(result.rows[0]?.total_count||0)};
  });
}
async function createRecord(actor,body) {
  if(!isAdmin(actor)&&actor?.role!=='teacher')throw fail(403,'Only teachers and Admin may record merits or demerits.');
  fields(body,['student_id','type_id','event_date','notes','request_key']);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_key||''))throw fail(400,'Refresh the form and try again.');
  const studentId=id(body.student_id),typeId=id(body.type_id),date=String(body.event_date||''),notes=clean(body.notes==null?'':body.notes,1000);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||date<'2000-01-01'||date>today())throw fail(400,'Choose a valid date that is not in the future.');
  const digest=crypto.createHash('sha256').update(JSON.stringify({actor:actor.id,studentId,typeId,date,notes})).digest('hex');
  return transaction(async c=>{
    await learner(c,actor,studentId);
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['behaviour:'+body.request_key]);
    const previous=(await c.query('SELECT id,recorded_by,request_hash FROM behaviour_records WHERE request_key=$1',[body.request_key])).rows[0];
    if(previous){if(previous.recorded_by!==actor.id||previous.request_hash!==digest)throw fail(409,'This request key was already used. Refresh the form.');return {id:previous.id,duplicate:true};}
    const type=(await c.query('SELECT * FROM behaviour_types WHERE id=$1 AND is_active=true FOR SHARE',[typeId])).rows[0];
    if(!type)throw fail(409,'This type is unavailable. Refresh the catalogue.');
    const record=(await c.query(`INSERT INTO behaviour_records(student_id,type_id,type_code,kind,label,category,points,event_date,notes,recorded_by,request_key,request_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12) RETURNING id`,[studentId,type.id,type.code,type.kind,type.label,type.category,type.points,date,notes,actor.id,body.request_key,digest])).rows[0];
    await queueDemeritAlerts(c,{id:record.id,student_id:studentId,kind:type.kind});
    await audit(c,actor,'behaviour_record_created',record.id,{student_id:studentId,type_code:type.code,kind:type.kind,label:type.label,category:type.category,points:type.points,event_date:date});
    return {id:record.id,duplicate:false};
  });
}
async function voidRecord(actor,recordId,body) {
  if(!isAdmin(actor)&&actor?.role!=='teacher')throw fail(403,'Staff access is required.');
  fields(body,['reason']);const reason=clean(body.reason,500,10);
  return transaction(async c=>{
    const record=(await c.query('SELECT * FROM behaviour_records WHERE id=$1 FOR UPDATE',[id(recordId)])).rows[0];
    if(!record)throw fail(404,'Record not found.');await learner(c,actor,record.student_id);
    if(!isAdmin(actor)&&record.recorded_by!==actor.id)throw fail(403,'Ask Admin to correct another staff member’s record.');
    if(record.status==='voided'){if(record.void_reason!==reason)throw fail(409,'This record was already corrected.');return {voided:true,duplicate:true};}
    await c.query("UPDATE behaviour_records SET status='voided',voided_by=$2,voided_at=NOW(),void_reason=$3 WHERE id=$1",[record.id,actor.id,reason]);
    await correctDemeritAlerts(c,record);
    await audit(c,actor,'behaviour_record_voided',record.id,{student_id:record.student_id,reason});return {voided:true};
  });
}
async function adminAlerts(actor,query={}) {
  if(!isAdmin(actor))throw fail(403,'Admin access is required.');
  const year=query.year==null?Number(today().slice(0,4)):Number(query.year);
  if(!Number.isInteger(year)||year<2000||year>2100)throw fail(400,'Enter a valid school year.');
  const page=query.page==null?1:id(query.page);if(page>10000)throw fail(400,'Invalid page.');
  const result=await db.query(`SELECT u.id,u.student_number,u.first_name,u.last_name,
    g.name AS grade_name,c.name AS class_name,100-sum(b.points)::integer AS remaining,
    count(*) OVER()::integer AS total_count FROM users u JOIN behaviour_records b ON b.student_id=u.id
    LEFT JOIN grades g ON g.id=u.grade_id LEFT JOIN classes c ON c.id=u.class_id
    WHERE u.role='student' AND u.is_active=true AND b.kind='demerit' AND b.status='active'
      AND b.event_date >= $1::date AND b.event_date < $2::date
    GROUP BY u.id,u.student_number,u.first_name,u.last_name,g.name,c.name HAVING sum(b.points)>=70
    ORDER BY remaining,u.last_name,u.first_name,u.id LIMIT 50 OFFSET $3`,[`${year}-01-01`,`${year+1}-01-01`,(page-1)*50]);
  return {year,starting:100,threshold:30,count:result.rows[0]?.total_count||0,page,
    learners:result.rows.map(({total_count,...row})=>row)};
}
module.exports={adminAlerts,listLearners,catalogue,saveType,records,createRecord,voidRecord};
