// Calendar-day arithmetic across daylight-saving changes. Run with the phones'
// zone: TZ=America/New_York node test/days.test.mjs
import assert from 'node:assert/strict';
import { sleepSecondsPerDay, byDay, T } from '../js/model.js';
import { startOfDay, endOfDay } from '../js/format.js';

const at = iso => new Date(iso).getTime();
const fallBack = at('2026-11-01T12:00:00-05:00');          // the 25-hour day
const springFwd = at('2026-03-08T12:00:00-04:00');         // the 23-hour day

assert.equal((endOfDay(fallBack) - startOfDay(fallBack)) / 36e5, 25, 'fall-back day is 25h');
assert.equal((endOfDay(springFwd) - startOfDay(springFwd)) / 36e5, 23, 'spring-forward day is 23h');

// A sleep running across 11pm on the 25-hour day used to spin forever.
const guard = setTimeout(() => { console.error('days: sleepSecondsPerDay hung'); process.exit(1); }, 3000);
const sleeps = [
  { type: T.SLEEP, start: at('2026-10-31T20:00:00-04:00'), end: at('2026-11-01T07:00:00-05:00') },
  { type: T.SLEEP, start: at('2026-11-01T22:00:00-05:00'), end: at('2026-11-02T06:30:00-05:00') },
  { type: T.SLEEP, start: at('2026-11-01T13:00:00-05:00'), end: at('2026-11-01T14:30:00-05:00') },
];
const per = sleepSecondsPerDay(sleeps, 3, at('2026-11-02T12:00:00-05:00'));
clearTimeout(guard);
const nov1 = per.get(startOfDay(fallBack));
const nov2 = per.get(startOfDay(at('2026-11-02T12:00:00-05:00')));
// Nov 1: 00:00–07:00 of the first night (8h with the repeated 1am hour) + 1.5h nap + 22:00–24:00
assert.equal(Math.round((nov1.night + nov1.day) / 3600 * 10) / 10, 8 + 1.5 + 2, 'Nov 1 total');
assert.equal(Math.round(nov1.day / 3600 * 10) / 10, 1.5, 'Nov 1 daytime');
assert.equal(Math.round((nov2.night + nov2.day) / 3600 * 10) / 10, 6.5, 'Nov 2 total');

// Buckets stay one per calendar day either side of the change.
const b = byDay([], 4, at('2026-11-03T12:00:00-05:00'));
assert.deepEqual(b.map(x => new Date(x.dayStart).getDate()), [31, 1, 2, 3]);

console.log('days: all assertions passed');
