const test=require('node:test');
const assert=require('node:assert/strict');
const {registrationWindow}=require('../services/parentReRegistrationPolicy');
for(const [date,phase] of [
 ['2026-12-10T23:59:59.999+02:00','not_open'],
 ['2026-12-11T00:00:00+02:00','open'],
 ['2026-12-31T12:00:00+02:00','open'],
 ['2027-01-08T23:59:59.999+02:00','open'],
 ['2027-01-09T00:00:00+02:00','closed'],
])test('Re-registration calendar at '+date,()=>{
 const result=registrationWindow(new Date(date));assert.equal(result.phase,phase);assert.equal(result.is_open,phase==='open');
 assert.equal(result.time_zone,'Africa/Johannesburg');assert.equal(result.opens_on,'2026-12-11');assert.equal(result.closes_on,'2027-01-08');
});
