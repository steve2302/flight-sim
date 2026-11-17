/* SPOTTER Trainer — scoring and inter-observer comparison (DOM-free). */
(function (root) {
  'use strict';
  const ST = root.ST;
  const CFG = ST.CFG;
  const NB = CFG.bins.length;

  /** Interpret one SPOTTER record's tokens. */
  ST.parseRecordTokens = function (tokens) {
    const r = { species: null, count: 0, hasCount: false, bin: null, glare: false, mixed: false,
                deleted: false, transect: null, unknown: [] };
    tokens.forEach((raw, i) => {
      const tok = String(raw).trim();
      if (!tok || tok === 'NA') return;
      let m;
      if (tok === 'delete_last_record') r.deleted = true;
      else if (tok === 'start_transect' || tok === 'end_transect') r.transect = tok;
      else if (/^\d+$/.test(tok)) { r.count += parseInt(tok, 10); r.hasCount = true; }
      else if ((m = tok.match(/(\d+)\s*-\s*(\d+)/))) r.bin = m[1] + '-' + m[2];   // last bin pressed wins
      else if (tok === 'glare') r.glare = true;
      else if (tok === 'mixed_species_group') r.mixed = true;
      else if (i === 0) r.species = tok;
      else r.unknown.push(tok);
    });
    r.binIdx = ST.geom.binIndexOfKey(r.bin);
    return r;
  };

  function matchCost(r, g) {
    const half = Math.max(1, g.tExit - g.tAbeam);
    let c = Math.abs(r.t - g.tAbeam) / half;
    if (r.species !== g.species) c += 0.8;
    c += r.binIdx == null ? 0.4 : 0.4 * Math.abs(r.binIdx - g.binIdx);
    c += 0.3 * Math.abs(Math.log((r.count + 1) / (g.size + 1)));
    return c;
  }
  ST.matchCost = matchCost;

  function inWindow(r, g) {
    return r.t >= g.tEnter - 0.5 && r.t <= g.tExit + CFG.matchGraceS;
  }
  ST.recordInWindow = inWindow;

  const countTol = n => Math.max(1, Math.round(0.1 * n));
  const sizeClass = n => (n === 1 ? '1' : n <= 4 ? '2–4' : n <= 9 ? '5–9' : '10+');
  const SIZE_CLASSES = ['1', '2–4', '5–9', '10+'];

  /**
   * Score one session against its scenario.
   * session: { side, records: [{t, tokens}], observer, position }
   */
  ST.scoreSession = function (scenario, session) {
    const side = session.side || ST.sideOfPosition(session.position);
    // A run ended early only had the chance to see groups that entered view before it stopped
    const flown = session.durationS != null ? session.durationS : Infinity;
    const groups = scenario.groups.filter(g => g.side === side && g.tEnter < flown);
    const all = session.records.map((rec, i) => Object.assign({ idx: i, t: rec.t, tokens: rec.tokens },
      ST.parseRecordTokens(rec.tokens)));
    const sightings = all.filter(r => !r.transect);
    const deleted = sightings.filter(r => r.deleted && CFG.deleteDiscardsRecord);
    const valid = sightings.filter(r => r.species && !(r.deleted && CFG.deleteDiscardsRecord));

    // Greedy one-to-one assignment on ascending cost
    const pairs = [];
    valid.forEach(r => groups.forEach(g => { if (inWindow(r, g)) pairs.push({ r, g, c: matchCost(r, g) }); }));
    pairs.sort((a, b) => a.c - b.c);
    const recOf = new Map(), grpOf = new Map();
    for (const p of pairs) {
      if (recOf.has(p.g.id) || grpOf.has(p.r.idx)) continue;
      recOf.set(p.g.id, p.r); grpOf.set(p.r.idx, p.g);
    }

    const isTarget = g => g.binIdx >= 0 && g.binIdx < NB;
    const targets = groups.filter(isTarget);
    const rows = groups.map(g => {
      const r = recOf.get(g.id) || null;
      const row = {
        groupId: g.id, species: g.species, size: g.size, X: g.X, bin: g.bin, binIdx: g.binIdx,
        tAbeam: g.tAbeam, behaviour: g.behaviour, target: isTarget(g), detected: !!r, record: r
      };
      if (r) {
        row.speciesOk = r.species === g.species;
        row.binOk = r.binIdx === g.binIdx;
        row.binOff = r.binIdx == null ? null : r.binIdx - g.binIdx;
        row.countOk = r.hasCount && r.count === g.size;
        row.countClose = r.hasCount && Math.abs(r.count - g.size) <= countTol(g.size);
        row.latency = +(r.t - g.tAbeam).toFixed(2);
        row.quality = 0.35 * (row.speciesOk ? 1 : 0)
          + 0.35 * (row.binOk ? 1 : (row.binOff != null && Math.abs(row.binOff) === 1 ? 0.5 : 0))
          + 0.30 * (row.countOk ? 1 : row.countClose ? 0.5 : 0);
      }
      return row;
    });

    const tRows = rows.filter(r => r.target);
    const det = tRows.filter(r => r.detected);
    const outsideLogged = rows.filter(r => !r.target && r.detected);
    const falsePos = valid.filter(r => !grpOf.has(r.idx)).map(r => {
      // Name the nearest distractor in view, if any, to help debriefing
      const ds = (scenario.distractors || []).filter(d => d.side === side && r.t >= d.tEnter && r.t <= d.tExit + 1)
        .sort((a, b) => Math.abs(a.tAbeam - r.t) - Math.abs(b.tAbeam - r.t));
      return Object.assign({}, r, { likely: ds.length ? ds[0].type : null });
    });

    const pct = (a, b) => (b ? a / b : null);
    const byBin = CFG.bins.map((b, i) => {
      const inBin = tRows.filter(r => r.binIdx === i);
      return { key: b.key, n: inBin.length, detected: inBin.filter(r => r.detected).length,
               rate: pct(inBin.filter(r => r.detected).length, inBin.length) };
    });
    const bySize = SIZE_CLASSES.map(k => {
      const inC = tRows.filter(r => sizeClass(r.size) === k);
      const d = inC.filter(r => r.detected);
      return { key: k, n: inC.length, detected: d.length, rate: pct(d.length, inC.length),
               countExact: pct(d.filter(r => r.countOk).length, d.length) };
    });
    // Bin confusion: rows = true bin, cols = recorded bin (0..3) + missing
    const confusion = CFG.bins.map((_, i) => {
      const row = new Array(NB + 1).fill(0);
      det.filter(r => r.binIdx === i).forEach(r => {
        const j = r.record.binIdx; row[j == null ? NB : j]++;
      });
      return row;
    });
    const withBin = det.filter(r => r.record.binIdx != null);
    const withCount = det.filter(r => r.record.hasCount);
    const quality = det.reduce((a, r) => a + r.quality, 0);
    const opportunities = tRows.length + falsePos.length + outsideLogged.length;
    const animalsPresent = tRows.reduce((a, r) => a + r.size, 0);
    const animalsInDetected = det.reduce((a, r) => a + r.size, 0);
    const animalsCounted = det.reduce((a, r) => a + (r.record.hasCount ? r.record.count : 0), 0);

    const metrics = {
      targets: tRows.length,
      detected: det.length,
      detectionRate: pct(det.length, tRows.length),
      animalsPresent, animalsInDetected, animalsCounted,
      animalDetectionRate: pct(animalsInDetected, animalsPresent),
      speciesAccuracy: pct(det.filter(r => r.speciesOk).length, det.length),
      binExact: pct(det.filter(r => r.binOk).length, det.length),
      binWithinOne: pct(withBin.filter(r => Math.abs(r.binOff) <= 1).length, det.length),
      binBias: withBin.length ? ST.mean(withBin.map(r => r.binOff)) : null,
      countExact: pct(det.filter(r => r.countOk).length, det.length),
      countClose: pct(det.filter(r => r.countClose).length, det.length),
      countBiasPct: withCount.length ? ST.mean(withCount.map(r => (r.record.count - r.size) / r.size)) : null,
      latencyMedian: ST.median(det.map(r => r.latency)),
      falsePositives: falsePos.length,
      outsideStripLogged: outsideLogged.length,
      missingCount: valid.filter(r => !r.hasCount).length,
      missingBin: valid.filter(r => r.bin == null).length,
      deletedRecords: deleted.length,
      records: valid.length,
      score: opportunities ? 100 * quality / opportunities : null
    };

    return {
      observer: session.observer, position: session.position, side, mode: session.mode,
      scenarioId: scenario.id, metrics, byBin, bySize, confusion, rows, falsePos, outsideLogged
    };
  };

  /** Matched-record lookup used by practice-mode live feedback. */
  ST.quickMatch = function (scenario, side, rec, claimed) {
    const r = Object.assign({ t: rec.t }, ST.parseRecordTokens(rec.tokens));
    if (!r.species || r.transect || (r.deleted && CFG.deleteDiscardsRecord)) return null;
    let best = null, bestC = Infinity;
    for (const g of scenario.groups) {
      if (g.side !== side || claimed.has(g.id) || !inWindow(r, g)) continue;
      const c = matchCost(r, g);
      if (c < bestC) { bestC = c; best = g; }
    }
    return { parsed: r, group: best };
  };

  // ---------------------------------------------------------------------------
  // Inter-observer comparison
  // ---------------------------------------------------------------------------
  function kappa(pairs, k) {
    const n = pairs.length;
    if (!n) return null;
    const m = Array.from({ length: k }, () => new Array(k).fill(0));
    let agree = 0;
    pairs.forEach(([a, b]) => { m[a][b]++; if (a === b) agree++; });
    const po = agree / n;
    let pe = 0;
    for (let i = 0; i < k; i++) {
      const row = m[i].reduce((x, y) => x + y, 0);
      const col = m.reduce((x, r) => x + r[i], 0);
      pe += (row / n) * (col / n);
    }
    return pe >= 1 ? 1 : (po - pe) / (1 - pe);
  }

  ST.compareResults = function (scenario, results) {
    const pairs = [];
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const A = results[i], B = results[j];
        if (A.side !== B.side) continue;
        const rowsA = new Map(A.rows.filter(r => r.target).map(r => [r.groupId, r]));
        const rowsB = new Map(B.rows.filter(r => r.target).map(r => [r.groupId, r]));
        const ids = [...rowsA.keys()];
        const N = ids.length;
        let a = 0, b = 0, m = 0;
        const both = [];
        ids.forEach(id => {
          const ra = rowsA.get(id), rb = rowsB.get(id);
          if (ra.detected) a++;
          if (rb.detected) b++;
          if (ra.detected && rb.detected) { m++; both.push([ra, rb]); }
        });
        const binPairs = both.filter(([x, y]) => x.record.binIdx != null && y.record.binIdx != null)
          .map(([x, y]) => [x.record.binIdx, y.record.binIdx]);
        pairs.push({
          a: A, b: B, N, nA: a, nB: b, both: m, onlyA: a - m, onlyB: b - m, neither: N - a - b + m,
          pA: N ? a / N : null, pB: N ? b / N : null,
          // Lincoln–Petersen / double-observer estimates (what MRDS would infer without the truth)
          pAhat: b ? m / b : null, pBhat: a ? m / a : null, Nhat: m ? (a * b) / m : null,
          binAgree: binPairs.length ? binPairs.filter(([x, y]) => x === y).length / binPairs.length : null,
          binKappa: kappa(binPairs, NB),
          speciesAgree: both.length ? both.filter(([x, y]) => x.record.species === y.record.species).length / both.length : null,
          countAgree: both.length ? both.filter(([x, y]) => x.record.count === y.record.count).length / both.length : null,
          countMeanAbsDiff: both.length ? ST.mean(both.map(([x, y]) => Math.abs(x.record.count - y.record.count))) : null
        });
      }
    }
    return { scenarioId: scenario.id, results, pairs };
  };

  // ---------------------------------------------------------------------------
  // CSV exports
  // ---------------------------------------------------------------------------
  const csvCell = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  ST.toCsv = function (header, rows) {
    return [header.join(',')].concat(rows.map(r => header.map(h => csvCell(r[h])).join(','))).join('\r\n');
  };

  /** One row per group per observer — MRDS-style (object, observer, detected). */
  ST.mrdsCsv = function (scenario, results) {
    const rows = [];
    const objId = new Map(scenario.groups.map((g, i) => [g.id, i + 1]));
    results.forEach((res, oi) => {
      res.rows.forEach(r => {
        const rec = r.record;
        const bin = rec && rec.binIdx != null ? CFG.bins[rec.binIdx] : null;
        rows.push({
          object: objId.get(r.groupId), group_id: r.groupId, observer: oi + 1,
          observer_name: res.observer, position: res.position, detected: r.detected ? 1 : 0,
          species_true: r.species, species_recorded: rec ? rec.species : '',
          size_true: r.size, size_recorded: rec && rec.hasCount ? rec.count : '',
          bin_true: r.bin, bin_recorded: rec ? (rec.bin || '') : '',
          distbegin: bin ? bin.from : '', distend: bin ? bin.to : '',
          distance_true_m: +(r.X - CFG.blindStripM).toFixed(1),
          in_strip: r.target ? 1 : 0, t_abeam: r.tAbeam, t_record: rec ? rec.t : '',
          glare: rec && rec.glare ? 1 : 0
        });
      });
    });
    const header = ['object', 'group_id', 'observer', 'observer_name', 'position', 'detected', 'species_true',
      'species_recorded', 'size_true', 'size_recorded', 'bin_true', 'bin_recorded', 'distbegin', 'distend',
      'distance_true_m', 'in_strip', 't_abeam', 't_record', 'glare'];
    return ST.toCsv(header, rows);
  };
})(typeof window !== 'undefined' ? window : globalThis);
