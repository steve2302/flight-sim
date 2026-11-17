/* SPOTTER Trainer — scenario generation.
 * A scenario is the complete ground truth for one run: every animal group,
 * distractor and the aircraft's motion, generated from a seed. The same
 * scenario file replayed for two observers shows them identical sequences.
 */
(function (root) {
  'use strict';
  const ST = root.ST;
  const CFG = ST.CFG;

  ST.HABITATS = {
    plains: {
      label: 'Open plains — red soil, sparse bluebush',
      soil: [0.62, 0.36, 0.23], soil2: [0.72, 0.48, 0.32], grass: [0.69, 0.60, 0.42], grassAmt: 0.35,
      shrubsPerHa: 22, treesPerHa: 0.5, tussocksPerHa: 260,
      shrubCols: [[0.45, 0.50, 0.42], [0.52, 0.54, 0.45], [0.38, 0.42, 0.35], [0.58, 0.55, 0.44]],
      treeCols: [[0.36, 0.42, 0.30], [0.42, 0.46, 0.34]]
    },
    saltbush: {
      label: 'Chenopod shrubland — grey clay, dense saltbush',
      soil: [0.56, 0.46, 0.37], soil2: [0.66, 0.55, 0.44], grass: [0.66, 0.60, 0.47], grassAmt: 0.2,
      shrubsPerHa: 120, treesPerHa: 0.25, tussocksPerHa: 120,
      shrubCols: [[0.55, 0.58, 0.52], [0.48, 0.52, 0.46], [0.60, 0.60, 0.53], [0.44, 0.47, 0.40]],
      treeCols: [[0.36, 0.42, 0.30]]
    },
    woodland: {
      label: 'Open woodland — box / belah, grassy',
      soil: [0.58, 0.42, 0.29], soil2: [0.66, 0.52, 0.36], grass: [0.72, 0.64, 0.44], grassAmt: 0.6,
      shrubsPerHa: 35, treesPerHa: 12, tussocksPerHa: 420,
      shrubCols: [[0.40, 0.46, 0.34], [0.47, 0.50, 0.38], [0.35, 0.40, 0.30]],
      treeCols: [[0.30, 0.37, 0.26], [0.36, 0.41, 0.29], [0.27, 0.33, 0.25], [0.40, 0.42, 0.31]]
    }
  };

  ST.DENSITY = { low: 1.5, medium: 3, high: 6 };       // groups per km of transect, per side

  ST.SUN = {
    observerSide: 'Sun on observer side (glare, back-lit)',
    farSide: 'Sun on far side (front-lit)',
    ahead: 'Sun ahead of aircraft',
    behind: 'Sun behind aircraft'
  };

  function groupSize(rng, species) {
    if (species === 'goat') {
      const r = rng();
      if (r < 0.30) return rng.int(1, 3);
      if (r < 0.80) return rng.int(4, 15);
      return rng.int(16, 45);
    }
    const r = rng();
    if (r < 0.34) return 1;
    if (r < 0.56) return 2;
    if (r < 0.69) return 3;
    if (r < 0.77) return 4;
    if (r < 0.92) return rng.int(5, 9);
    if (r < 0.985) return rng.int(10, 25);
    return rng.int(26, 60);
  }

  function makeMembers(rng, species, n, behaviour) {
    const radius = species === 'goat' ? 3 + 1.6 * Math.sqrt(n) : 2 + 1.4 * Math.sqrt(n);
    const herdYaw = rng() * Math.PI * 2;
    const members = [];
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = radius * Math.sqrt(rng());
      const small = rng.chance(0.22);
      let pose, morph;
      if (species === 'goat') {
        pose = 'stand';
        morph = rng.weighted({ white: 0.3, black: 0.2, brown: 0.25, patchy: 0.25 });
      } else {
        pose = behaviour === 'graze' ? (rng.chance(0.75) ? 'graze' : 'sit')
             : (rng.chance(0.65) ? 'sit' : 'graze');
        morph = species === 'red_kangaroo' ? (rng.chance(0.4) && !small ? 'male' : 'female') : 'grey';
      }
      members.push({
        ds: +(r * Math.cos(a)).toFixed(2),
        dx: +(r * Math.sin(a)).toFixed(2),
        scale: +(small ? rng.range(0.55, 0.75) : rng.range(0.85, 1.15)).toFixed(3),
        pose, morph,
        yaw: +(behaviour === 'graze' ? herdYaw + rng.range(-0.8, 0.8) : rng() * Math.PI * 2).toFixed(3),
        phase: +(rng() * 10).toFixed(3)
      });
    }
    return members;
  }

  function visibility(X, s) {
    const A = ST.geom.halfWindowM(X), v = CFG.speedMs;
    return {
      tEnter: +((s - A) / v).toFixed(3),
      tAbeam: +(s / v).toFixed(3),
      tExit: +((s + A) / v).toFixed(3)
    };
  }

  function makeGroup(rng, side, s, p) {
    const species = rng.weighted(p.speciesMix);
    const size = groupSize(rng, species);
    const behaviour = species === 'goat'
      ? (rng.chance(0.3) ? 'flush' : 'graze')
      : rng.weighted({ sit: 0.4, graze: 0.4, flush: 0.2 });
    const X = +rng.range(22, 440).toFixed(1);
    const bin = ST.geom.binOf(X);
    const g = {
      side, species, size, X, s: +s.toFixed(1),
      bin: bin.key, binIdx: bin.idx, behaviour,
      members: makeMembers(rng, species, size, behaviour)
    };
    if (behaviour === 'flush') {
      const out = rng.range(-0.9, 0.9);          // mostly away from the aircraft
      g.flush = {
        leadM: +rng.range(60, 260).toFixed(1),   // along-track distance of aircraft when animals react
        dirA: +Math.sin(out).toFixed(3), dirX: +Math.cos(out).toFixed(3),
        speed: +(species === 'goat' ? rng.range(2, 3.5) : rng.range(5.5, 9)).toFixed(2),
        durS: +rng.range(2, 4).toFixed(2)
      };
    }
    Object.assign(g, visibility(X, g.s));
    return g;
  }

  const DISTRACTORS = { emu: 0.25, sheep: 0.15, stump: 0.25, rock: 0.2, mound: 0.15 };

  function makeDistractor(rng, side, s) {
    const type = rng.weighted(DISTRACTORS);
    const X = +rng.range(30, 440).toFixed(1);
    const n = type === 'emu' ? rng.int(1, 4) : type === 'sheep' ? rng.int(4, 30) : rng.int(1, 3);
    const spread = type === 'sheep' ? 3 + 1.5 * Math.sqrt(n) : type === 'emu' ? 6 : 4;
    const items = [];
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = spread * Math.sqrt(rng());
      items.push({
        ds: +(r * Math.cos(a)).toFixed(2), dx: +(r * Math.sin(a)).toFixed(2),
        scale: +rng.range(0.8, 1.2).toFixed(3), yaw: +(rng() * Math.PI * 2).toFixed(3),
        v: +rng.range(0, 1).toFixed(3)
      });
    }
    return Object.assign({ side, type, n, X, s: +s.toFixed(1), items }, visibility(X, s));
  }

  function motion(rng) {
    const w = () => +(rng() * Math.PI * 2).toFixed(3);
    return {
      // [amplitude, frequency Hz, phase]; roll/pitch in degrees, altitude in metres
      roll: [[1.3, 0.045, w()], [0.6, 0.13, w()], [0.25, 0.55, w()], [0.08, 2.1, w()]],
      pitch: [[0.5, 0.06, w()], [0.15, 0.7, w()], [0.05, 2.6, w()]],
      alt: [[3.0, 0.02, w()], [1.0, 0.11, w()]]
    };
  }

  ST.motionAt = function (terms, t) {
    let v = 0;
    for (const [a, f, ph] of terms) v += a * Math.sin(2 * Math.PI * f * t + ph);
    return v;
  };

  /**
   * params: { seed, durationS, density ('low'|'medium'|'high'), habitat,
   *           sun (key of ST.SUN), session ('AM'|'PM'), distractors (bool),
   *           speciesMix {red_kangaroo, grey_kangaroo, goat} }
   */
  ST.generateScenario = function (params) {
    const p = Object.assign({
      seed: 'demo', durationS: 300, density: 'medium', habitat: 'plains',
      sun: 'farSide', session: 'AM', distractors: true,
      speciesMix: { red_kangaroo: 0.45, grey_kangaroo: 0.45, goat: 0.10 }
    }, params || {});
    p.seed = String(p.seed);
    const rng = ST.rng(p.seed + '|scenario');
    const v = CFG.speedMs;
    const sMin = CFG.leadInM, sMax = Math.max(sMin + 100, v * p.durationS - CFG.tailM);
    const rate = (ST.DENSITY[p.density] || +p.density || 3) / 1000;       // per metre
    const dRate = p.distractors ? 2 / 1000 : 0;

    const groups = [], distractors = [];
    ['R', 'L'].forEach(side => {
      const list = [];
      let s = sMin + rng.exp(1 / rate);
      while (s < sMax) { list.push(makeGroup(rng, side, s, p)); s += rng.exp(1 / rate); }
      list.forEach((g, i) => { g.id = side + String(i + 1).padStart(3, '0'); });
      groups.push(...list);
      if (dRate > 0) {
        let sd = sMin * 0.6 + rng.exp(1 / dRate);
        while (sd < sMax) { distractors.push(makeDistractor(rng, side, sd)); sd += rng.exp(1 / dRate); }
      }
    });

    const sc = {
      format: 'spotter-trainer-scenario',
      version: 1,
      appVersion: ST.VERSION,
      params: p,
      geometry: {
        altitudeM: CFG.altitudeM, speedKn: CFG.speedKn, blindStripM: CFG.blindStripM,
        bins: CFG.bins.map(b => b.key), pitchDeg: CFG.pitchDeg, vFovDeg: CFG.vFovDeg,
        apertureNdcX: CFG.apertureNdcX, start: CFG.start
      },
      endS: p.durationS,
      groups, distractors,
      motion: motion(rng)
    };
    sc.hash = ST.scenarioHash(sc);
    sc.id = `${p.seed}-${p.habitat}-${p.density}-${Math.round(p.durationS / 60)}min-${sc.hash.slice(0, 6)}`;
    return sc;
  };

  ST.scenarioHash = function (sc) {
    const key = JSON.stringify({ g: sc.groups, d: sc.distractors, m: sc.motion, geo: sc.geometry, e: sc.endS });
    return ST.hashString(key).toString(16).padStart(8, '0') + ST.hashString(key + '#').toString(16).padStart(8, '0');
  };

  ST.validateScenario = function (sc) {
    if (!sc || sc.format !== 'spotter-trainer-scenario') throw new Error('Not a SPOTTER Trainer scenario file');
    if (ST.scenarioHash(sc) !== sc.hash) throw new Error('Scenario file has been modified (hash mismatch)');
    return sc;
  };

  /**
   * A scenario's visibility windows (tEnter/tExit) depend on the survey geometry it was
   * generated with. Replaying one under different geometry would mis-time the scoring,
   * so a scenario to be flown must match the current configuration.
   */
  ST.checkScenarioGeometry = function (sc) {
    const g = sc.geometry || {};
    const diffs = [['altitudeM', 'height', 'm'], ['speedKn', 'speed', ' kn'], ['blindStripM', 'blind strip', 'm'],
                   ['pitchDeg', 'view angle', '°'], ['vFovDeg', 'field of view', '°']]
      .filter(([k]) => g[k] != null && g[k] !== CFG[k])
      .map(([k, label, u]) => `${label} ${g[k]}${u} (now ${CFG[k]}${u})`);
    if (diffs.length) {
      throw new Error('Scenario was made for different survey geometry: ' + diffs.join(', ') +
        '. Generate a new scenario from the same seed instead.');
    }
    return sc;
  };

  /** Summary counts for a scenario on one side. */
  ST.scenarioSummary = function (sc, side) {
    const gs = sc.groups.filter(g => g.side === side);
    const inStrip = gs.filter(g => g.binIdx >= 0 && g.binIdx < CFG.bins.length);
    return {
      groups: gs.length,
      targets: inStrip.length,
      animals: inStrip.reduce((a, g) => a + g.size, 0),
      outside: gs.length - inStrip.length,
      distractors: sc.distractors.filter(d => d.side === side).length
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
