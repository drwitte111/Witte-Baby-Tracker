// Timer arithmetic, no browser needed:  node test/sessions.test.mjs
import assert from 'node:assert/strict';
import { accrueFeed, feedTotals, normSleep, sleepElapsed, bankSleep, shiftStart, todayAt } from '../js/sessions.js';

const t0 = 1_000_000_000_000;
let s = { start: t0, side: 'LEFT', beginSide: 'LEFT', leftSec: 0, rightSec: 0, running: true, sinceTick: t0 };
assert.deepEqual(feedTotals(s, t0 + 90_000), { left: 90, right: 0, total: 90 }, 'left accrues while running');
s = { ...accrueFeed(s, t0 + 90_000), side: 'RIGHT', sinceTick: t0 + 90_000 };
assert.deepEqual(feedTotals(s, t0 + 150_000), { left: 90, right: 60, total: 150 }, 'switch keeps left, right accrues');
s = { ...accrueFeed(s, t0 + 150_000), running: false };
assert.equal(feedTotals(s, t0 + 999_000).total, 150, 'paused feed does not grow');
s = shiftStart(s, t0 - 300_000, 'leftSec');
assert.equal(s.leftSec, 390, 'started-earlier credits the begin side');

let sl = { start: t0 };
assert.deepEqual(normSleep(sl), { start: t0, elapsedSec: 0, running: true, sinceTick: t0 }, 'legacy { start } normalises');
assert.equal(sleepElapsed(sl, t0 + 600_000), 600, 'elapsed counts from start');
sl = { ...bankSleep(sl, t0 + 600_000), running: false };
assert.equal(sleepElapsed(sl, t0 + 900_000), 600, 'paused sleep holds');
sl = { ...bankSleep(sl, t0 + 900_000), running: true, sinceTick: t0 + 900_000 };
assert.equal(sleepElapsed(sl, t0 + 960_000), 660, 'resume continues from banked time');
sl = shiftStart(bankSleep(sl, t0 + 960_000), t0 - 120_000, 'elapsedSec');
assert.equal(Math.round(sl.elapsedSec), 780, 'fell-asleep-earlier credits elapsed');
assert.equal(sl.start, t0 - 120_000);

const now = new Date('2026-09-22T01:10:00').getTime();
assert.equal(new Date(todayAt('00:40', now)).getDate(), 22, 'earlier today stays today');
assert.equal(new Date(todayAt('23:50', now)).getDate(), 21, 'later than now rolls to yesterday');
assert.equal(todayAt('nope', now), null);

console.log('sessions: all assertions passed');
