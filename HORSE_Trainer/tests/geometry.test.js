/* Survey geometry (helicopter, 61 m AGL, 50 kn) and the scenario geometry check.
 * Run from HORSE_Trainer/:  node --test tests/
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

require(path.join(__dirname, '..', 'js', 'core.js'));
require(path.join(__dirname, '..', 'js', 'spotter.js'));
require(path.join(__dirname, '..', 'js', 'scenario.js'));
const ST = globalThis.ST;

test('helicopter flies at 61 m above ground and 50 kn', () => {
  assert.equal(ST.CFG.altitudeM, 61);
  assert.equal(ST.CFG.speedKn, 50);
});

test('five bins from the 20 m blind strip: 20, 40, 60, 90, 120, 170 m from nadir', () => {
  assert.deepEqual(ST.geom.boundaries(), [20, 40, 60, 90, 120, 170]);
  assert.deepEqual(ST.CFG.bins.map(b => b.key), ['0-20', '20-40', '40-70', '70-100', '100-150']);
});

test('every bin boundary is inside the rendered view', () => {
  ST.geom.boundaries().forEach(X => {
    const y = ST.geom.ndcY(X);
    assert.ok(y > -0.9 && y < 0.9, `boundary ${X} m at ndc ${y}`);
  });
});

test('default controller config maps every bin, horse and foal to a button', () => {
  const map = ST.parseSpotterConfig(ST.DEFAULT_SPOTTER_CSV);
  const data = Object.values(map).map(m => m.data);
  ST.CFG.bins.forEach(b => assert.ok(data.some(d => d.includes(b.key)), b.key));
  assert.ok(data.includes('horse') && data.includes('foal'));
});

test('new scenarios record 61 m and pass the geometry check', () => {
  const sc = ST.generateScenario({ seed: 'geo', durationS: 60 });
  assert.equal(sc.geometry.altitudeM, 61);
  assert.doesNotThrow(() => ST.checkScenarioGeometry(sc));
});

test('a scenario saved for different geometry is rejected with a clear reason', () => {
  const sc = ST.generateScenario({ seed: 'geo', durationS: 60 });
  sc.geometry = Object.assign({}, sc.geometry, { altitudeM: 76 });
  assert.throws(() => ST.checkScenarioGeometry(sc), /height 76m \(now 61m\)/);
});

test('bands: sizes, foals and visibility windows are consistent', () => {
  const sc = ST.generateScenario({ seed: 'bands', durationS: 600, density: 'high' });
  assert.ok(sc.groups.length > 20);
  sc.groups.forEach(g => {
    assert.equal(g.species, 'horse');
    assert.ok(g.foals >= 0 && g.foals <= g.size - 2 || g.foals === 0, `${g.id}: ${g.foals} foals in ${g.size}`);
    assert.equal(g.members.length, g.size);
    assert.equal(g.members.filter(m => m.foal).length, g.foals);
    assert.ok(g.tEnter < g.tExit, g.id);
  });
});

test('most bands gallop, and a galloping band is binned where it was first seen', () => {
  const sc = ST.generateScenario({ seed: 'gallop', durationS: 600, density: 'high' });
  const gal = sc.groups.filter(g => g.flush);
  assert.ok(gal.length / sc.groups.length > 0.45);
  gal.filter(g => !g.unseen).forEach(g => {
    const mo = ST.groupMotion(g, g.tEnter);
    assert.ok(Math.abs(g.X0 + mo.dx - g.X) < 1.5, `${g.id}: X ${g.X} vs ${g.X0 + mo.dx}`);
    assert.equal(g.bin, ST.geom.binOf(g.X).key);
  });
});

test('gallop motion: still before reacting, then moving away, then stopped', () => {
  const g = { s: 1000, flush: { leadM: 200, dirA: 0, dirX: 1, speed: 10, durS: 8 } };
  const tReact = (1000 - 200) / ST.CFG.speedMs;
  assert.equal(ST.groupMotion(g, tReact - 1).dx, 0);
  const a = ST.groupMotion(g, tReact + 3), b = ST.groupMotion(g, tReact + 6);
  assert.ok(a.running && b.dx > a.dx && a.dx > 0);
  assert.equal(ST.groupMotion(g, tReact + 20).running, false);
});
