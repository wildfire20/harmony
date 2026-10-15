require('dotenv').config();
const fs=require('node:fs');
const path=require('node:path');
const db=require('../config/database');
async function run(database=db){
  const c=await database.pool.connect();
  try{
    await c.query('BEGIN');
    await c.query(fs.readFileSync(path.join(__dirname,'..','migrations','learner_behaviour.sql'),'utf8'));
    await c.query(fs.readFileSync(path.join(__dirname,'..','migrations','behaviour_parent_alerts.sql'),'utf8'));
    await c.query('SELECT record_id,parent_id,notification_id,first_attempt_at,status FROM behaviour_parent_emails LIMIT 0');
    await c.query('SELECT code,kind,category,points,version FROM behaviour_types LIMIT 0');
    await c.query('SELECT student_id,request_key,request_hash,status,void_reason FROM behaviour_records LIMIT 0');
    const missing=await c.query('SELECT code FROM unnest($1::text[]) AS seed(code) WHERE NOT EXISTS(SELECT 1 FROM behaviour_types b WHERE b.code=seed.code)',[require('../data/behaviourCatalogue.json').map(t=>t.code)]);
    if(missing.rowCount)throw new Error('Behaviour catalogue verification failed.');
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
if(require.main===module)run().then(()=>console.log('Merits & Demerits and Parent alerts migrations applied and verified.'))
  .catch(e=>{console.error('Behaviour migration failed; rolled back.',{code:e.code||'VERIFICATION_FAILED'});process.exitCode=1;}).finally(()=>db.pool.end());
module.exports={run};
