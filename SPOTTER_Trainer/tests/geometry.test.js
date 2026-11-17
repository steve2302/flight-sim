/* Survey geometry (76 m AGL) and the scenario geometry check.
 * Run from SPOTTER_Trainer/:  node --test tests/
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

require(path.join(__dirname, '..', 'js', 'core.js'));
require(path.join(__dirname, '..', 'js', 'scenario.js'));
const ST = globalThis.ST;
const deg = 180 / Math.PI;

test('aircraft flies at 76 m above ground', () => {
  assert.equal(ST.CFG.altitudeM, 76);
});

test('strut marker angles below horizontal match 76 m', () => {
  const angles = ST.geom.boundaries().map(X => Math.atan2(76, X - ST.CFG.eyeLateralM) * deg);
  [62.7, 40.4, 28.6, 17.6, 12.6].forEach((a, i) => assert.ok(Math.abs(angles[i] - a) < 0.1, `${angles[i]} vs ${a}`));
});

test('every bin boundary is inside the rendered view', () => {
  ST.geom.boundaries().forEach(X => {
    const y = ST.geom.ndcY(X);
    assert.ok(y > -1 && y < 1, `boundary ${X} m at ndc ${y}`);
  });
});

test('new scenarios record 76 m and pass the geometry check', () => {
  const sc = ST.generateScenario({ seed: 'geo', durationS: 60 });
  assert.equal(sc.geometry.altitudeM, 76);
  assert.doesNotThrow(() => ST.checkScenarioGeometry(sc));
});

test('a scenario saved at 96 m is rejected with a clear reason', () => {
  const sc = ST.generateScenario({ seed: 'geo', durationS: 60 });
  sc.geometry = Object.assign({}, sc.geometry, { altitudeM: 96 });
  assert.throws(() => ST.checkScenarioGeometry(sc), /height 96m \(now 76m\)/);
});
