const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const time = require('../client/src/utils/schoolCalendarTime');
const { storageValue, validateRange } = require('../services/calendarTime');

for (const zone of ['UTC', 'Africa/Johannesburg', 'America/New_York', 'Asia/Tokyo']) {
  test(`school time stays fixed when the process or device uses ${zone}`, () => {
    const script = `const assert=require('node:assert/strict'),t=require('./client/src/utils/schoolCalendarTime');
      for(const value of ['2026-10-26T09:00:00','2026-10-26T09:00:00+02:00','2026-10-26T07:00:00Z']){
        assert.equal(t.schoolTimeParts(value).time,'09:00');
        assert.equal(t.schoolDisplayDate(value).getHours(),9);
        assert.match(t.schoolTimeLabel(value),/09:00/);
      }
      assert.equal(t.schoolTimeParts('2026-10-31T22:15:00Z').date,'2026-11-01');
      assert.equal(t.schoolTimeParts('2026-11-01T00:15:00+02:00').time,'00:15');`;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, TZ: zone }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  });
}
test('calendar input rejects impossible dates, times and offsets', () => {
  for (const value of [null, '', 'not-a-date', '2026-02-29T09:00', '2026-02-30',
    '2026-13-01', '2026-01-01T24:00', '2026-01-01T09:60', '2026-01-01T09:00+14:30']) {
    assert.throws(() => time.parseSchoolTime(value));
  }
  assert.equal(time.schoolTimeParts('2028-02-29T09:15').date, '2028-02-29');
});
test('schema writes keep clock values for naive columns and instants for timezone-aware columns', () => {
  assert.equal(storageValue('2026-10-26T07:15:00Z', 'timestamp without time zone'), '2026-10-26T09:15:00.000');
  assert.equal(storageValue('2026-10-26T09:15', 'timestamp with time zone'), '2026-10-26T09:15:00.000+02:00');
  assert.equal(storageValue(null, 'timestamp without time zone'), null);
  assert.throws(() => storageValue('2026-10-26T09:15', 'date'), { status: 503 });
  assert.throws(() => validateRange('2026-10-26T10:00', '2026-10-26T09:59'), { status: 400 });
  assert.doesNotThrow(() => validateRange('2026-10-26T10:00', null));
});
