/* Horse Survey Trainer — scenario generation.
 * A scenario is the complete ground truth for one run: every horse band,
 * distractor and the helicopter's motion, generated from a seed. The same
 * scenario file replayed for two observers shows them identical sequences.
 */
(function (root) {
  'use strict';
  const ST = root.ST;
  const CFG = ST.CFG;

  // Habitat look. treeH / crownR are ranges in metres; trunk is a hex colour;
  // haze is the sky/fog colour; hemiGround the bounce-light colour off the ground.
  ST.HABITATS = {
    alpine: {
      label: 'Alpine high plains — tussock grassland, snow gum edges',
      soil: [0.47, 0.44, 0.31], soil2: [0.54, 0.51, 0.35], grass: [0.62, 0.63, 0.40], grassAmt: 0.95,
      shrubsPerHa: 25, treesPerHa: 2.5, tussocksPerHa: 1100,
      shrubCols: [[0.42, 0.47, 0.36], [0.50, 0.53, 0.42], [0.36, 0.42, 0.33]],
      treeCols: [[0.40, 0.47, 0.36], [0.45, 0.50, 0.40]],
      treeH: [5, 10], crownR: [2.5, 4.5], trunk: 0xd6d0c2, haze: 0xc8d2da, hemiGround: 0x5d5a3c
    },
    snowgum: {
      label: 'Snow gum woodland — subalpine, grassy understorey',
      soil: [0.38, 0.34, 0.25], soil2: [0.45, 0.41, 0.30], grass: [0.62, 0.61, 0.42], grassAmt: 0.75,
      shrubsPerHa: 40, treesPerHa: 22, tussocksPerHa: 800,
      shrubCols: [[0.40, 0.45, 0.34], [0.47, 0.51, 0.40], [0.34, 0.40, 0.31]],
      treeCols: [[0.38, 0.45, 0.34], [0.43, 0.49, 0.38], [0.35, 0.42, 0.33]],
      treeH: [6, 12], crownR: [2.5, 5], trunk: 0xd9d3c6, haze: 0xc8d2da, hemiGround: 0x5a5839
    },
    tablelands: {
      label: 'Tablelands forest — tall eucalypt forest, grassy clearings',
      soil: [0.46, 0.37, 0.26], soil2: [0.53, 0.43, 0.30], grass: [0.58, 0.58, 0.37], grassAmt: 0.65,
      shrubsPerHa: 45, treesPerHa: 20, tussocksPerHa: 500,
      shrubCols: [[0.33, 0.40, 0.27], [0.40, 0.45, 0.31], [0.30, 0.36, 0.26]],
      treeCols: [[0.27, 0.35, 0.23], [0.32, 0.39, 0.26], [0.36, 0.41, 0.29]],
      treeH: [15, 26], crownR: [4, 7], trunk: 0x8b8378, haze: 0xcdd3d4, hemiGround: 0x5e5236
    },
    tablelandsOpen: {
      label: 'Tablelands — open grazing country, scattered trees',
      soil: [0.48, 0.39, 0.27], soil2: [0.55, 0.45, 0.31], grass: [0.64, 0.62, 0.40], grassAmt: 0.85,
      shrubsPerHa: 15, treesPerHa: 3, tussocksPerHa: 700,
      shrubCols: [[0.35, 0.42, 0.28], [0.42, 0.47, 0.32]],
      treeCols: [[0.29, 0.37, 0.24], [0.34, 0.40, 0.27]],
      treeH: [12, 22], crownR: [4, 7], trunk: 0x938a7e, haze: 0xd3d6d2, hemiGround: 0x625636
    }
  };

  ST.DENSITY = { low: 1, medium: 2, high: 4 };       // horse bands per km of transect, per side

  ST.SUN = {
    observerSide: 'Sun on observer side (glare, back-lit)',
    farSide: 'Sun on far side (front-lit)',
    ahead: 'Sun ahead of helicopter',
    behind: 'Sun behind helicopter'
  };

  // Brumby coat colours (relative frequency)
  ST.COATS = { bay: 0.33, brown: 0.2, chestnut: 0.15, black: 0.12, grey: 0.08, buckskin: 0.06, palomino: 0.06 };

  /** Band size and foals. Harem bands are mostly 3-10; bachelors and singles are common. */
  function bandSize(rng) {
    const r = rng();
    let n, type;
    if (r < 0.15) { n = 1; type = 'single'; }
    else if (r < 0.32) { n = rng.int(2, 4); type = 'bachelor'; }
    else if (r < 0.92) { n = rng.int(3, 10); type = 'harem'; }
    else { n = rng.int(11, 22); type = 'harem'; }        // bands merged at a grazing patch
    let foals = 0;
    if (type === 'harem') {
      const mares = Math.max(1, Math.round((n - 1) * 0.7));
      for (let i = 0; i < mares && foals < n - 2; i++) if (rng.chance(0.35)) foals++;
    }
    return { n, foals, type };
  }

  function makeMembers(rng, band, behaviour) {
    const n = band.n, adults = n - band.foals;
    const radius = 2.5 + 1.8 * Math.sqrt(n);
    const herdYaw = rng() * Math.PI * 2;
    const members = [];
    // Adults first; each foal is then placed beside an adult (its mother)
    for (let i = 0; i < n; i++) {
      const foal = i >= adults;
      let ds, dx, coat;
      if (foal) {
        const mum = members[rng.int(0, adults - 1)];
        const a = rng() * Math.PI * 2;
        ds = mum.ds + 1.4 * Math.cos(a); dx = mum.dx + 1.4 * Math.sin(a);
        coat = rng.chance(0.6) ? mum.coat : rng.weighted(ST.COATS);
      } else {
        const a = rng() * Math.PI * 2, r = radius * Math.sqrt(rng());
        ds = r * Math.cos(a); dx = r * Math.sin(a);
        coat = rng.weighted(ST.COATS);
      }
      const pose = behaviour === 'stand' ? (rng.chance(0.8) ? 'stand' : 'graze')
        : (rng.chance(0.75) ? 'graze' : 'stand');
      members.push({
        ds: +ds.toFixed(2), dx: +dx.toFixed(2),
        scale: +(foal ? rng.range(0.55, 0.66) : rng.range(0.92, 1.08)).toFixed(3),
        foal, coat, pose,
        yaw: +(herdYaw + rng.range(-0.9, 0.9)).toFixed(3),
        phase: +(rng() * 10).toFixed(3)
      });
    }
    return members;
  }

  /**
   * Displacement of a band at time t (shared by the scenario's visibility
   * windows and the 3D world). Horses react when the helicopter is leadM
   * short of them, accelerate to a gallop, run for durS seconds, then pull up over 2 s.
   * Returns { da, dx } (along-track, lateral-away metres), running flag, elapsed time.
   */
  ST.groupMotion = function (g, t) {
    const f = g.flush;
    if (!f) return { da: 0, dx: 0, running: false, el: -1 };
    const el = t - (g.s - f.leadM) / CFG.speedMs;
    if (el <= 0) return { da: 0, dx: 0, running: false, el };
    const ramp = 1.5, stop = 2;
    let d;
    if (el < ramp) d = f.speed * el * el / (2 * ramp);
    else if (el < f.durS) d = f.speed * (el - ramp / 2);
    else {
      const tau = Math.min(el - f.durS, stop);
      d = f.speed * (f.durS - ramp / 2) + f.speed * (tau - tau * tau / (2 * stop));
    }
    return { da: f.dirA * d, dx: f.dirX * d, running: el < f.durS + stop, el };
  };

  /** Visibility of a fixed point (lateral X, along-track s) in the window. */
  function visibility(X, s) {
    const A = ST.geom.halfWindowM(X), v = CFG.speedMs;
    return {
      tEnter: +((s - A) / v).toFixed(3),
      tAbeam: +(s / v).toFixed(3),
      tExit: +((s + A) / v).toFixed(3)
    };
  }

  /** Visibility of a moving band, found by stepping time. Also returns where it was first seen. */
  function movingVisibility(g) {
    const v = CFG.speedMs, dt = 0.05;
    const t0 = (g.s - 700) / v, t1 = (g.s + 900) / v;
    let tEnter = null, tExit = null, tAbeam = null, Xseen = null, prevRel = null;
    for (let t = t0; t <= t1; t += dt) {
      const mo = ST.groupMotion(g, t);
      const X = g.X0 + mo.dx, sG = g.s + mo.da;
      const rel = v * t - sG;
      const inView = X > CFG.eyeLateralM + 1 && Math.abs(rel) <= ST.geom.halfWindowM(X);
      if (inView) {
        if (tEnter == null) { tEnter = t; Xseen = X; }
        tExit = t;
      }
      if (tAbeam == null && prevRel != null && prevRel < 0 && rel >= 0) tAbeam = t;
      prevRel = rel;
    }
    return { tEnter, tExit, tAbeam, Xseen };
  }

  function makeGroup(rng, side, s) {
    const band = bandSize(rng);
    const behaviour = rng.weighted({ graze: 0.3, stand: 0.1, gallop: 0.6 });
    const X0 = +rng.range(12, 190).toFixed(1);
    const g = {
      side, species: 'horse', size: band.n, foals: band.foals, bandType: band.type,
      X0, s: +s.toFixed(1), behaviour,
      members: makeMembers(rng, band, behaviour)
    };
    if (behaviour === 'gallop') {
      // Mostly away from the helicopter's track, sometimes angled ahead or back
      const out = rng.range(-1.3, 1.3);
      g.flush = {
        leadM: +rng.range(40, 220).toFixed(1),     // helicopter distance short of the band when it bolts
        dirA: +Math.sin(out).toFixed(3), dirX: +Math.cos(out).toFixed(3),
        speed: +rng.range(7, 12).toFixed(2),       // gallop, m/s
        durS: +rng.range(4, 11).toFixed(2)
      };
      const vis = movingVisibility(g);
      if (vis.tEnter == null) {
        // Ran out of sight before it could be seen: not a target
        Object.assign(g, visibility(X0, g.s), { X: X0, bin: 'out', binIdx: CFG.bins.length, unseen: true });
      } else {
        // Truth is where the band was first in view
        g.X = +vis.Xseen.toFixed(1);
        g.tEnter = +vis.tEnter.toFixed(3); g.tExit = +vis.tExit.toFixed(3);
        g.tAbeam = +(vis.tAbeam != null ? vis.tAbeam : (vis.tEnter + vis.tExit) / 2).toFixed(3);
        const bin = ST.geom.binOf(g.X);
        g.bin = bin.key; g.binIdx = bin.idx;
      }
    } else {
      g.X = X0;
      const bin = ST.geom.binOf(X0);
      g.bin = bin.key; g.binIdx = bin.idx;
      Object.assign(g, visibility(X0, g.s));
    }
    return g;
  }

  const DISTRACTORS = { deer: 0.25, cattle: 0.22, wombat: 0.13, rock: 0.22, log: 0.18 };

  function makeDistractor(rng, side, s) {
    const type = rng.weighted(DISTRACTORS);
    const X = +rng.range(12, 200).toFixed(1);
    const n = type === 'deer' ? rng.int(1, 3) : type === 'cattle' ? rng.int(3, 18) : type === 'wombat' ? 1 : rng.int(1, 3);
    const spread = type === 'cattle' ? 3 + 1.8 * Math.sqrt(n) : type === 'deer' ? 5 : 4;
    const items = [];
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = spread * Math.sqrt(rng());
      items.push({
        ds: +(r * Math.cos(a)).toFixed(2), dx: +(r * Math.sin(a)).toFixed(2),
        scale: +rng.range(0.85, 1.15).toFixed(3), yaw: +(rng() * Math.PI * 2).toFixed(3),
        v: +rng.range(0, 1).toFixed(3)
      });
    }
    return Object.assign({ side, type, n, X, s: +s.toFixed(1), items }, visibility(X, s));
  }

  function motion(rng) {
    const w = () => +(rng() * Math.PI * 2).toFixed(3);
    return {
      // [amplitude, frequency Hz, phase]; roll/pitch in degrees, altitude in metres.
      // Helicopter: gentler long-period roll than a fixed wing, plus rotor vibration.
      roll: [[1.0, 0.05, w()], [0.45, 0.16, w()], [0.25, 0.7, w()], [0.07, 5.2, w()]],
      pitch: [[0.6, 0.07, w()], [0.2, 0.5, w()], [0.06, 5.2, w()]],
      alt: [[2.5, 0.03, w()], [0.8, 0.15, w()]]
    };
  }

  ST.motionAt = function (terms, t) {
    let v = 0;
    for (const [a, f, ph] of terms) v += a * Math.sin(2 * Math.PI * f * t + ph);
    return v;
  };

  /**
   * params: { seed, durationS, density ('low'|'medium'|'high'), habitat,
   *           sun (key of ST.SUN), session ('AM'|'PM'), distractors (bool) }
   */
  ST.generateScenario = function (params) {
    const p = Object.assign({
      seed: 'demo', durationS: 300, density: 'medium', habitat: 'alpine',
      sun: 'farSide', session: 'AM', distractors: true
    }, params || {});
    p.seed = String(p.seed);
    const rng = ST.rng(p.seed + '|scenario');
    const v = CFG.speedMs;
    const sMin = CFG.leadInM, sMax = Math.max(sMin + 100, v * p.durationS - CFG.tailM);
    const rate = (ST.DENSITY[p.density] || +p.density || 2) / 1000;       // per metre
    const dRate = p.distractors ? 1.5 / 1000 : 0;

    const groups = [], distractors = [];
    ['R', 'L'].forEach(side => {
      const list = [];
      let s = sMin + rng.exp(1 / rate);
      while (s < sMax) { list.push(makeGroup(rng, side, s)); s += rng.exp(1 / rate); }
      list.forEach((g, i) => { g.id = side + String(i + 1).padStart(3, '0'); });
      groups.push(...list);
      if (dRate > 0) {
        let sd = sMin * 0.6 + rng.exp(1 / dRate);
        while (sd < sMax) { distractors.push(makeDistractor(rng, side, sd)); sd += rng.exp(1 / dRate); }
      }
    });

    const sc = {
      format: 'horse-trainer-scenario',
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
    if (!sc || sc.format !== 'horse-trainer-scenario') throw new Error('Not a Horse Survey Trainer scenario file');
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
      foals: inStrip.reduce((a, g) => a + (g.foals || 0), 0),
      galloping: inStrip.filter(g => g.flush).length,
      outside: gs.length - inStrip.length,
      distractors: sc.distractors.filter(d => d.side === side).length
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
