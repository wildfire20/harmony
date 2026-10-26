const {parseSchoolTime,schoolTimeIso,schoolTimeParts}=require('../client/src/utils/schoolCalendarTime');
// Return text with an explicit offset before node-postgres can interpret a naive
// timestamp in the Railway process time zone. Existing wall-clock values stay put.
const schoolTimeSql = column => `(CASE WHEN pg_typeof(${column})='timestamp with time zone'::regtype
  THEN to_char(${column} AT TIME ZONE 'Africa/Johannesburg','YYYY-MM-DD"T"HH24:MI:SS.MS')
  ELSE to_char(${column},'YYYY-MM-DD"T"HH24:MI:SS.MS') END || '+02:00')`;
const schoolWallSql = column => `(${schoolTimeSql(column)})::timestamp`;
async function dateStorageTypes(executor) {
  const rows=(await executor.query(`SELECT column_name,data_type FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='school_events' AND column_name IN ('start_date','end_date')`)).rows;
  return Object.fromEntries(rows.map(r=>[r.column_name,r.data_type]));
}
function storageValue(value,type) {
  if(value===null || value==='')return null;
  if(!['timestamp without time zone','timestamp with time zone'].includes(type))
    throw Object.assign(new Error('Calendar time storage needs updating. Please contact the school office.'),{status:503});
  try{return type==='timestamp with time zone'?schoolTimeIso(value):schoolTimeParts(value).wall;}
  catch(e){throw Object.assign(e,{status:400});}
}
function validateRange(start,end) {
  if(end!=null && parseSchoolTime(end)<parseSchoolTime(start))
    throw Object.assign(new Error('End date and time must be on or after the start date and time.'),{status:400});
}
module.exports={schoolTimeSql,schoolWallSql,dateStorageTypes,storageValue,validateRange};
