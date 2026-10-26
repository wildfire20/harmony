// Calendar form values are South African wall-clock times, not browser/server time.
const SCHOOL_TIME_ZONE = 'Africa/Johannesburg';
const OFFSET_MINUTES = 120;
function parseSchoolTime(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value);
  const m = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!m) throw new Error('Enter a valid calendar date and time.');
  const [year,month,day,hour,minute,second] = [m[1],m[2],m[3],m[4]||0,m[5]||0,m[6]||0].map(Number);
  const ms = Number((m[7]||'').padEnd(3,'0'));
  const wall = new Date(Date.UTC(year,month-1,day,hour,minute,second,ms));
  if (year<1000 || wall.getUTCFullYear()!==year || wall.getUTCMonth()!==month-1 || wall.getUTCDate()!==day || hour>23 || minute>59 || second>59)
    throw new Error('Enter a valid calendar date and time.');
  let offset = OFFSET_MINUTES;
  if (m[8]==='Z') offset=0;
  else if (m[8]) {
    const h=Number(m[8].slice(1,3)),min=Number(m[8].slice(4,6));
    if(h>14 || min>59 || (h===14 && min!==0))throw new Error('Enter a valid calendar time zone.');
    offset=(m[8][0]==='-'?-1:1)*(h*60+min);
  }
  return new Date(wall.getTime()-offset*60000);
}
function schoolTimeParts(value) {
  const wall = new Date(parseSchoolTime(value).getTime()+OFFSET_MINUTES*60000).toISOString();
  return {date:wall.slice(0,10),time:wall.slice(11,16),wall:wall.slice(0,-1)};
}
const schoolTimeIso = value => schoolTimeParts(value).wall+'+02:00';
// react-big-calendar places Date objects in the browser's local grid. Represent the
// school's wall-clock components there so a device time zone cannot shift the grid.
function schoolDisplayDate(value) {
  const {wall}=schoolTimeParts(value);
  return new Date(Number(wall.slice(0,4)),Number(wall.slice(5,7))-1,Number(wall.slice(8,10)),
    Number(wall.slice(11,13)),Number(wall.slice(14,16)),Number(wall.slice(17,19)),Number(wall.slice(20,23)));
}
const schoolTimeLabel = value => new Intl.DateTimeFormat('en-ZA',{
  timeZone:SCHOOL_TIME_ZONE,dateStyle:'medium',timeStyle:'short',hourCycle:'h23'
}).format(parseSchoolTime(value));
module.exports={SCHOOL_TIME_ZONE,parseSchoolTime,schoolTimeParts,schoolTimeIso,schoolDisplayDate,schoolTimeLabel};
