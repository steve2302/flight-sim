/* Tests for ST.scoreSession's early-stop handling (session.durationS).
 * Run from HORSE_Trainer/:  node --test tests/
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

require(path.join(__dirname, '..', 'js', 'core.js'));
require(path.join(__dirname, '..', 'js', 'spotter.js'));
require(path.join(__dirname, '..', 'js', 'scoring.js'));
const ST = globalThis.ST;

// Minimal hand-built scenario: three in-strip groups on the left, one on the right.
function group(id, tEnter, side = 'left', extra = {}) {
  return Object.assign({
    id, side, species: 'horse', size: 3, foals: 1, X: 30, bin: '0-20', binIdx: 0,
    tEnter, tAbeam: tEnter + 2, tExit: tEnter + 4, behaviour: 'grazing'
  }, extra);
}
const scenario = {
  id: 'test-scenario',
  groups: [group('g1', 10), group('g2', 50), group('g3', 100), group('g4', 20, 'right')],
  distractors: []
};
// Correct, complete record for a band: horse, count, one foal, bin
const rec = (t, n = 3) => ({ t, tokens: ['horse', String(n), 'foal', '(yellow) 0-20'] });

test('full run: every group on the observer side is a target', () => {
  const res = ST.scoreSession(scenario, { side: 'left', records: [rec(12), rec(52), rec(102)] });
  assert.equal(res.metrics.targets, 3);
  assert.equal(res.metrics.detected, 3);
  assert.equal(res.metrics.detectionRate, 1);
  assert.equal(res.metrics.score, 100);
});

test('missing durationS is treated as a complete run', () => {
  const res = ST.scoreSession(scenario, { side: 'left', records: [rec(12)] });
  assert.equal(res.metrics.targets, 3);
  assert.equal(res.metrics.detectionRate, 1 / 3);
});

test('run ended early: groups entering view after the stop are not counted as misses', () => {
  const res = ST.scoreSession(scenario, { side: 'left', durationS: 60, records: [rec(12), rec(52)] });
  assert.deepEqual(res.rows.map(r => r.groupId), ['g1', 'g2']);
  assert.equal(res.metrics.targets, 2);
  assert.equal(res.metrics.detected, 2);
  assert.equal(res.metrics.detectionRate, 1);
  assert.equal(res.metrics.score, 100);
});

test('a group still in view at the stop is scored (tEnter < durationS)', () => {
  // Stop at t=51: g2 entered at 50, so it was available and missed
  const res = ST.scoreSession(scenario, { side: 'left', durationS: 51, records: [rec(12)] });
  assert.equal(res.metrics.targets, 2);
  assert.equal(res.metrics.detected, 1);
  const g2 = res.rows.find(r => r.groupId === 'g2');
  assert.equal(g2.detected, false);
});

test('a group entering exactly at the stop time is excluded', () => {
  const res = ST.scoreSession(scenario, { side: 'left', durationS: 50, records: [rec(12)] });
  assert.equal(res.metrics.targets, 1);
});

test('durationS of 0 scores nothing and does not divide by zero', () => {
  const res = ST.scoreSession(scenario, { side: 'left', durationS: 0, records: [] });
  assert.equal(res.metrics.targets, 0);
  assert.equal(res.metrics.detectionRate, null);
  assert.equal(res.metrics.score, null);
});

test('early-stop filter still respects the observer side', () => {
  const res = ST.scoreSession(scenario, { side: 'right', durationS: 60, records: [rec(22)] });
  assert.deepEqual(res.rows.map(r => r.groupId), ['g4']);
  assert.equal(res.metrics.detectionRate, 1);
});

test('MRDS export after an early stop only lists groups that were available', () => {
  const res = ST.scoreSession(scenario, { side: 'left', durationS: 60, observer: 'A', records: [rec(12)] });
  const lines = ST.mrdsCsv(scenario, [res]).split('\r\n');
  assert.equal(lines.length, 1 + 2);            // header + g1, g2
  assert.match(lines[1], /^1,g1,1,A,/);
  assert.match(lines[2], /^2,g2,1,A,.*,0,/);    // g2 not detected
});

test('foal presses are counted; a wrong foal count costs 20% of record quality', () => {
  const noFoal = { t: 12, tokens: ['horse', '3', '(yellow) 0-20'] };
  const twoFoals = { t: 52, tokens: ['horse', '2', '1', 'foal', 'foal', '(yellow) 0-20'] };
  const res = ST.scoreSession(scenario, { side: 'left', records: [noFoal, twoFoals, rec(102)] });
  const [g1, g2, g3] = res.rows;
  assert.equal(g1.record.foals, 0); assert.equal(g1.foalsOk, false); assert.ok(Math.abs(g1.quality - 0.8) < 1e-9);
  assert.equal(g2.record.foals, 2); assert.equal(g2.record.count, 3); assert.ok(Math.abs(g2.quality - 0.8) < 1e-9);
  assert.equal(g3.quality, 1);
  assert.equal(res.metrics.foalsExact, 1 / 3);
});

test('a SPOTTER record built from controller presses scores correctly', () => {
  const b = new ST.RecordBuilder(ST.parseSpotterConfig(ST.DEFAULT_SPOTTER_CSV));
  ['RightTrigger', 'Y', 'LeftShoulder', 'DPadDown'].forEach(btn => b.press(btn, 12));
  assert.deepEqual(b.records[0].tokens, ['horse', '3', 'foal', '(yellow) 0-20']);
  b.press('RightTrigger', 52); b.press('RightThumbLeft', 52);
  assert.deepEqual(b.records[1].tokens, ['horse', '(orange) 100-150']);
  const res = ST.scoreSession(scenario, { side: 'left', records: b.records.slice(0, 1) });
  assert.equal(res.rows[0].quality, 1);
});
