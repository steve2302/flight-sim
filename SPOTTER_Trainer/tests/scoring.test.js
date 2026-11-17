/* Tests for ST.scoreSession's early-stop handling (session.durationS).
 * Run from SPOTTER_Trainer/:  node --test tests/
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

require(path.join(__dirname, '..', 'js', 'core.js'));
require(path.join(__dirname, '..', 'js', 'scoring.js'));
const ST = globalThis.ST;

// Minimal hand-built scenario: three in-strip groups on the left, one on the right.
function group(id, tEnter, side = 'left', extra = {}) {
  return Object.assign({
    id, side, species: 'red_kangaroo', size: 3, X: 70, bin: '0-50', binIdx: 0,
    tEnter, tAbeam: tEnter + 2, tExit: tEnter + 4, behaviour: 'grazing'
  }, extra);
}
const scenario = {
  id: 'test-scenario',
  groups: [group('g1', 10), group('g2', 50), group('g3', 100), group('g4', 20, 'right')],
  distractors: []
};
// Correct, complete record for a group: species, count, bin
const rec = (t, n = 3) => ({ t, tokens: ['red_kangaroo', String(n), '(yellow) 0-50'] });

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
