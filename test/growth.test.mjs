// Growth projection: node test/growth.test.mjs
import assert from 'node:assert/strict';
import { projectToday } from '../js/growth-fit.js';

const birth = new Date('2026-01-01').getTime(), D = 86400000;
const rows = [['2026-01-01', 7.125], ['2026-01-13', 8.25], ['2026-02-10', 10.8125], ['2026-03-10', 12.875], ['2026-05-04', 15.3], ['2026-07-07', 17]]
  .map(([d, y]) => ({ x: new Date(d).getTime(), y }));

// held out: fit on five, predict the sixth
const p = projectToday(rows.slice(0, 5), birth, rows[5].x);
assert.ok(Math.abs(p.y - 17) < 0.4, `predicted ${p.y.toFixed(2)} for 17`);

const today = projectToday(rows, birth, new Date('2026-09-22').getTime());
assert.ok(today.y > 17 && today.y < 21, `today ${today.y.toFixed(2)} should be a plausible 8.5-month weight`);
assert.equal(today.from, rows[5]);

assert.equal(projectToday(rows.slice(0, 1), birth), null, 'one point: no projection');
assert.equal(projectToday(rows, birth, rows[5].x + 3600e3), null, 'measured today: nothing to project');
assert.ok(projectToday(rows, null, new Date('2026-09-22').getTime()), 'works without a birth date');
console.log('growth: all assertions passed');
