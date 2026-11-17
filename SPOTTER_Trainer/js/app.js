/* SPOTTER Trainer — application shell: setup, run loop, feedback, reports. */
(function () {
  'use strict';
  const ST = window.ST;
  const CFG = ST.CFG;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => (v == null ? '—' : Math.round(v * 100) + '%');
  const fmtT = s => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtNum = (v, d) => (v == null ? '—' : v.toFixed(d == null ? 1 : d));
  const speciesShort = k => (ST.SPECIES[k] ? ST.SPECIES[k].short : k || '?');

  const state = {
    mapping: ST.parseSpotterConfig(ST.DEFAULT_SPOTTER_CSV),
    configSource: 'SPOTTER default GamepadAudioConfig.csv',
    loadedScenario: null,
    last: null,                 // { session, scenario, result }
    compareFiles: []            // { name, session|scenario }
  };

  function show(id) {
    ['setup', 'sim', 'report', 'compare'].forEach(s => $(s).classList.toggle('hidden', s !== id));
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ===========================================================================
  // Setup screen
  // ===========================================================================
  function initSetup() {
    const hab = $('f-habitat');
    Object.entries(ST.HABITATS).forEach(([k, v]) => hab.add(new Option(v.label, k)));
    const sun = $('f-sun');
    Object.entries(ST.SUN).forEach(([k, v]) => sun.add(new Option(v, k)));
    sun.value = 'farSide';
    ST.POSITIONS.forEach(p => $('f-position').add(new Option(p.replace(/(Left|Right)/, '$1 '), p)));
    $('f-position').value = 'RightFront';
    $('f-seed').value = 'K' + String(Math.floor(Math.random() * 9000) + 1000);
    try { $('f-observer').value = localStorage.getItem('st-observer') || ''; } catch (e) { /* storage unavailable */ }

    $('f-mode').addEventListener('change', () => {
      const practice = $('f-mode').value === 'practice';
      $('f-guides').checked = practice; $('f-labels').checked = practice;
    });
    $('btn-new-seed').onclick = () => { $('f-seed').value = 'K' + String(Math.floor(Math.random() * 9000) + 1000); };
    $('btn-dl-scenario').onclick = () => {
      const sc = currentScenario();
      download(`scenario_${sc.id}.json`, JSON.stringify(sc, null, 1), 'application/json');
    };
    $('f-scenario-file').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        let obj = JSON.parse(await f.text());
        if (obj.format === 'spotter-trainer-session') obj = obj.scenario;
        state.loadedScenario = ST.checkScenarioGeometry(ST.validateScenario(obj));
        updateScenarioInfo();
      } catch (err) { setMsg('setup-msg', 'Could not load scenario: ' + err.message, true); }
      e.target.value = '';
    };
    $('btn-clear-scenario').onclick = () => { state.loadedScenario = null; updateScenarioInfo(); };
    $('f-config-file').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const map = ST.parseSpotterConfig(await f.text());
        if (!Object.keys(map).length) throw new Error('no button rows found');
        state.mapping = map; state.configSource = f.name;
        renderMapping();
      } catch (err) { setMsg('setup-msg', 'Could not load config: ' + err.message, true); }
      e.target.value = '';
    };
    ['f-seed', 'f-duration', 'f-density', 'f-habitat', 'f-sun', 'f-distractors', 'f-position'].forEach(id =>
      $(id).addEventListener('change', updateScenarioInfo));
    $('btn-start').onclick = startSession;
    $('btn-compare').onclick = () => { show('compare'); renderCompareFiles(); };
    renderMapping();
    updateScenarioInfo();
    setInterval(() => {
      const pad = ST.Input.firstPad();
      $('pad-status').textContent = pad ? `Controller connected: ${pad.id}` : 'No controller detected — press a button on the Xbox controller, or use the keyboard.';
      $('pad-status').className = pad ? 'ok' : 'warn';
    }, 500);
  }

  function setMsg(id, text, bad) { const el = $(id); el.textContent = text; el.className = bad ? 'msg bad' : 'msg'; }

  function genParams() {
    return {
      seed: $('f-seed').value.trim() || 'K0000',
      durationS: +$('f-duration').value * 60,
      density: $('f-density').value,
      habitat: $('f-habitat').value,
      sun: $('f-sun').value,
      session: $('f-session').value,
      distractors: $('f-distractors').checked
    };
  }
  function currentScenario() { return state.loadedScenario || ST.generateScenario(genParams()); }

  function updateScenarioInfo() {
    const loaded = !!state.loadedScenario;
    document.querySelectorAll('.gen-field').forEach(el => { el.disabled = loaded; });
    $('btn-clear-scenario').classList.toggle('hidden', !loaded);
    const sc = currentScenario();
    const side = ST.sideOfPosition($('f-position').value);
    const sm = ST.scenarioSummary(sc, side);
    $('scenario-info').innerHTML =
      `${loaded ? '<b>Loaded scenario</b> ' : ''}<code>${esc(sc.id)}</code><br>` +
      `${fmtT(sc.endS)} transect · ${esc(ST.HABITATS[sc.params.habitat].label)} · ${esc(ST.SUN[sc.params.sun] || '')}<br>` +
      `${side === 'R' ? 'Right' : 'Left'} side: ${sm.targets} groups (${sm.animals} animals) in the strip, ` +
      `${sm.outside} outside it, ${sm.distractors} distractors`;
  }

  function renderMapping() {
    const m = state.mapping;
    const keyFor = {};
    Object.entries(ST.KEYBOARD).forEach(([k, b]) => { if (!keyFor[b]) keyFor[b] = k.replace(/^Key|^Digit/, '').replace('Arrow', 'Arrow '); });
    const rows = Object.keys(m).filter(b => m[b].data && m[b].data !== 'NA').map(b =>
      `<tr><td>${esc(b)}</td><td>${esc(m[b].data)}</td><td>${m[b].newRecord ? 'new record' : 'append'}</td><td>${esc(keyFor[b === 'Start_On' || b === 'Start_Off' ? 'Start' : b] || '')}</td></tr>`);
    $('mapping').innerHTML = `<p class="dim">Button mapping from <b>${esc(state.configSource)}</b></p>` +
      `<table class="tbl"><thead><tr><th>Controller</th><th>Recorded</th><th></th><th>Keyboard</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  // ===========================================================================
  // Running a session
  // ===========================================================================
  let run = null;

  function startSession() {
    const observer = $('f-observer').value.trim();
    if (!observer) { setMsg('setup-msg', 'Enter the observer name first.', true); $('f-observer').focus(); return; }
    try { localStorage.setItem('st-observer', observer); } catch (e) { /* ignore */ }
    setMsg('setup-msg', '');
    const sc = currentScenario();
    const position = $('f-position').value;
    const side = ST.sideOfPosition(position);
    const settings = {
      guides: $('f-guides').checked, labels: $('f-labels').checked,
      speech: $('f-speech').checked, quality: $('f-quality').value,
      sizeBoost: +$('f-boost').value
    };
    const session = {
      format: 'spotter-trainer-session', version: 1, appVersion: ST.VERSION,
      scenarioId: sc.id, scenarioHash: sc.hash,
      observer, position, side, seat: /Rear$/.test(position) ? 'Rear' : 'Front',
      session: $('f-session').value, mode: $('f-mode').value,
      startUTC: null, endUTC: null, presses: [], records: [], preTokens: [], pauses: [],
      settings, configSource: state.configSource, scenario: sc
    };

    show('sim');
    const glCanvas = $('gl'), ovCanvas = $('ov');
    let world;
    try {
      world = new ST.World(glCanvas, sc, { side, quality: settings.quality, sizeBoost: settings.sizeBoost });
    } catch (err) {
      show('setup'); setMsg('setup-msg', 'WebGL could not start: ' + err.message, true); return;
    }
    const overlay = new ST.Overlay(ovCanvas, {
      side, seat: session.seat, guides: settings.guides, labels: settings.labels,
      glare: sc.params.sun === 'observerSide'
    });
    const builder = new ST.RecordBuilder(state.mapping);
    const input = new ST.Input((btn) => onPress(btn));

    run = {
      sc, session, world, overlay, builder, input, settings,
      t: 0, paused: false, ended: false, lastFrame: null, raf: 0, hud: true,
      openRec: null, lastPressT: 0, claimed: new Set(), missedPtr: 0,
      targets: sc.groups.filter(g => g.side === side && g.binIdx >= 0 && g.binIdx < CFG.bins.length)
        .sort((a, b) => a.tExit - b.tExit)
    };
    layout();
    $('toasts').innerHTML = '';
    banner('Building terrain…');
    // Let the banner paint, then prewarm and start
    setTimeout(() => {
      world.prewarm();
      world.update(0);
      session.startUTC = Date.now();
      input.enabled = true;
      banner(session.mode === 'practice' ? 'Practice — feedback on' : 'Assessment — no feedback until the end', 2.5);
      run.lastFrame = performance.now();
      run.raf = requestAnimationFrame(frame);
    }, 30);
  }

  function layout() {
    if (!run) return;
    const W = window.innerWidth, H = window.innerHeight;
    let w = Math.min(W, H * CFG.aspect), h = w / CFG.aspect;
    w = Math.floor(w); h = Math.floor(h);
    const stage = $('stage');
    stage.style.width = w + 'px'; stage.style.height = h + 'px';
    ['gl', 'ov'].forEach(id => { $(id).style.width = w + 'px'; $(id).style.height = h + 'px'; });
    run.world.resize(w, h);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    run.overlay.resize(Math.round(w * dpr), Math.round(h * dpr));
  }
  window.addEventListener('resize', layout);

  function frame(now) {
    if (!run || run.ended) return;
    run.raf = requestAnimationFrame(frame);
    run.input.poll();
    const dt = Math.min((now - run.lastFrame) / 1000, 0.25);
    run.lastFrame = now;
    if (!run.paused) run.t += dt;
    const t = run.t;
    run.world.update(t);
    run.world.render();
    run.overlay.draw(run.world, t);

    if (run.openRec && t - run.lastPressT > CFG.recordCloseS) closeRecord();
    if (run.session.mode === 'practice') checkMissed(t);
    updateHud();
    if (t >= run.sc.endS) finishSession();
  }

  function onPress(btn) {
    if (!run || run.paused || run.ended) return;
    const t = run.t;
    const res = run.builder.press(btn, t);
    run.lastPressT = t;
    if (res.type === 'new') {
      if (run.openRec && run.openRec !== res.record) closeRecord();
      run.openRec = /^(start|end)_transect$/.test(res.data) ? null : res.record;
    }
    if (run.settings.speech && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(res.audio);
        u.rate = 1.3; window.speechSynthesis.speak(u);
      } catch (e) { /* speech unavailable */ }
    }
    run.input.rumble(60);
  }

  function closeRecord() {
    const rec = run.openRec; run.openRec = null;
    if (!rec || run.session.mode !== 'practice') return;
    const m = ST.quickMatch(run.sc, run.session.side, rec, run.claimed);
    if (!m) return;
    const p = m.parsed;
    const yours = `${speciesShort(p.species)} ×${p.hasCount ? p.count : '?'} · ${p.bin || 'no bin'}`;
    if (!m.group) { toast(`No group there — false positive? (${yours})`, 'bad'); return; }
    const g = m.group;
    run.claimed.add(g.id);
    const errs = [];
    if (g.binIdx < 0 || g.binIdx >= CFG.bins.length) errs.push(g.binIdx < 0 ? 'inside the blind strip — not counted' : 'outside the 300 m strip — not counted');
    else {
      if (p.species !== g.species) errs.push(`species was ${speciesShort(g.species)}`);
      if (!p.hasCount) errs.push(`no count (was ${g.size})`);
      else if (p.count !== g.size) errs.push(`count was ${g.size}`);
      if (!p.bin) errs.push(`no bin (was ${g.bin})`);
      else if (p.bin !== g.bin) errs.push(`bin was ${g.bin}`);
    }
    if (!errs.length) { toast(`✓ ${yours}`, 'good'); run.overlay.addRing(g.id, 'rgba(80,220,120,A)', 1.6, run.t); }
    else { toast(`${yours} — ${errs.join(', ')}`, 'warn'); run.overlay.addRing(g.id, 'rgba(255,170,40,A)', 2.2, run.t); }
  }

  function checkMissed(t) {
    const tg = run.targets;
    while (run.missedPtr < tg.length && tg[run.missedPtr].tExit + CFG.matchGraceS + CFG.recordCloseS < t) {
      const g = tg[run.missedPtr++];
      if (!run.claimed.has(g.id)) toast(`Missed: ${speciesShort(g.species)} ×${g.size} in ${g.bin} m`, 'bad');
    }
  }

  function toast(text, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = text;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.classList.add('fade'), 3200);
    setTimeout(() => el.remove(), 3800);
  }

  let bannerTimer = 0;
  function banner(text, secs) {
    const b = $('banner'); b.textContent = text; b.classList.remove('hidden');
    clearTimeout(bannerTimer);
    if (secs) bannerTimer = setTimeout(() => b.classList.add('hidden'), secs * 1000);
  }

  function updateHud() {
    const hud = $('hud');
    hud.classList.toggle('hidden', !run.hud);
    if (!run.hud) return;
    const r = run.builder.current;
    let rec = '—';
    if (r) {
      const p = ST.parseRecordTokens(r.tokens);
      rec = p.transect ? p.transect.replace('_', ' ')
        : `${speciesShort(p.species)} · ${p.hasCount ? p.count : '–'} · ${p.bin || '–'}${p.glare ? ' · glare' : ''}${p.deleted ? ' · DELETED' : ''}`;
    }
    $('hud-rec').textContent = rec;
    $('hud-time').textContent = `${fmtT(run.t)} / ${fmtT(run.sc.endS)}`;
    $('hud-pad').textContent = run.input.padName ? '🎮' : '⌨';
  }

  function setPaused(p) {
    if (!run || run.ended) return;
    run.paused = p;
    run.session.pauses.push({ t: +run.t.toFixed(3), paused: p });
    $('pause').classList.toggle('hidden', !p);
  }

  window.addEventListener('keydown', e => {
    if (!run || run.ended || $('sim').classList.contains('hidden')) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { setPaused(!run.paused); e.preventDefault(); }
    else if (e.code === 'KeyH') run.hud = !run.hud;
    else if (e.code === 'KeyF') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && run && !run.ended && !run.paused) setPaused(true); });

  function finishSession(abandon) {
    if (!run || run.ended) return;
    run.ended = true;
    cancelAnimationFrame(run.raf);
    if (run.openRec) closeRecord();
    run.input.enabled = false; run.input.destroy();
    const s = run.session;
    s.endUTC = Date.now();
    s.durationS = +run.t.toFixed(3);
    s.completed = run.t >= run.sc.endS;
    s.presses = run.builder.presses;
    s.records = run.builder.records;
    s.preTokens = run.builder.preTokens;
    const sc = run.sc;
    run.world.dispose();
    $('pause').classList.add('hidden');
    run = null;
    if (abandon) { show('setup'); return; }
    const result = ST.scoreSession(sc, s);
    state.last = { session: s, scenario: sc, result };
    renderReport(state.last);
    show('report');
  }

  // ===========================================================================
  // Report
  // ===========================================================================
  function barChart(byBin) {
    const W = 380, H = 150, bw = 60, gap = 26, x0 = 44;
    let s = `<svg viewBox="0 0 ${W} ${H + 40}" class="chart" role="img" aria-label="Detection rate by distance bin">`;
    [0, 0.5, 1].forEach(v => {
      const y = 10 + H * (1 - v);
      s += `<line x1="${x0 - 4}" x2="${W}" y1="${y}" y2="${y}" class="grid"/><text x="${x0 - 8}" y="${y + 4}" class="axis" text-anchor="end">${v * 100}%</text>`;
    });
    byBin.forEach((b, i) => {
      const x = x0 + 10 + i * (bw + gap);
      const v = b.rate == null ? 0 : b.rate;
      const h = H * v;
      s += `<rect x="${x}" y="${10 + H - h}" width="${bw}" height="${h}" rx="3" fill="${CFG.bins[i].colour}" stroke="#0004"/>`;
      s += `<text x="${x + bw / 2}" y="${H + 26}" text-anchor="middle" class="axis">${b.key} m</text>`;
      s += `<text x="${x + bw / 2}" y="${H + 38}" text-anchor="middle" class="axis dim">${b.detected}/${b.n}</text>`;
      if (b.rate != null) s += `<text x="${x + bw / 2}" y="${6 + H - h}" text-anchor="middle" class="val">${pct(b.rate)}</text>`;
    });
    return s + '</svg>';
  }

  function tile(label, value, sub) {
    return `<div class="tile"><div class="tv">${value}</div><div class="tl">${label}</div>${sub ? `<div class="ts">${sub}</div>` : ''}</div>`;
  }

  function renderReport({ session: s, scenario: sc, result: r }) {
    const m = r.metrics;
    const conf = r.confusion.map((row, i) =>
      `<tr><th>${CFG.bins[i].key}</th>${row.map((v, j) => `<td class="${!v ? '' : j === i ? 'diag' : 'off'}">${v || ''}</td>`).join('')}</tr>`).join('');
    const sizeRows = r.bySize.map(b => `<tr><td>${b.key}</td><td>${b.detected}/${b.n}</td><td>${pct(b.rate)}</td><td>${pct(b.countExact)}</td></tr>`).join('');
    const issues = [];
    if (m.missingCount) issues.push(`${m.missingCount} record(s) with no count`);
    if (m.missingBin) issues.push(`${m.missingBin} record(s) with no distance bin`);
    if (m.deletedRecords) issues.push(`${m.deletedRecords} record(s) deleted with Back`);
    if (m.outsideStripLogged) issues.push(`${m.outsideStripLogged} group(s) logged that were outside the strip or in the blind strip`);
    if (s.preTokens.length) issues.push(`${s.preTokens.length} press(es) before the first record`);
    const fp = r.falsePos.map(f => `<li>${fmtT(f.t)} — ${esc(speciesShort(f.species))} ×${f.hasCount ? f.count : '?'} · ${esc(f.bin || 'no bin')}${f.likely ? ` <span class="dim">(a ${esc(f.likely)} was in view)</span>` : ''}</li>`).join('');
    const rows = r.rows.slice().sort((a, b) => a.tAbeam - b.tAbeam).map(g => {
      const rec = g.record;
      let res;
      if (!g.detected) res = g.target ? '<span class="bad">missed</span>' : '<span class="dim">not logged (correct)</span>';
      else {
        const bits = [];
        bits.push(`<span class="${g.speciesOk ? '' : 'bad'}">${esc(speciesShort(rec.species))}</span>`);
        bits.push(`<span class="${g.countOk ? '' : g.countClose ? 'warn' : 'bad'}">×${rec.hasCount ? rec.count : '?'}</span>`);
        bits.push(`<span class="${g.binOk ? '' : 'bad'}">${esc(rec.bin || 'no bin')}</span>`);
        res = bits.join(' · ') + (g.target ? '' : ' <span class="bad">(outside strip)</span>');
      }
      return `<tr class="${g.target ? '' : 'dim'}"><td>${g.groupId}</td><td>${fmtT(g.tAbeam)}</td><td>${speciesShort(g.species)}</td><td>${g.size}</td><td>${g.bin}</td><td>${g.behaviour}</td><td>${res}</td><td>${g.detected ? fmtNum(g.latency) : ''}</td><td>${g.quality != null ? Math.round(g.quality * 100) : ''}</td></tr>`;
    }).join('');

    $('report-body').innerHTML = `
      <div class="report-head">
        <div>
          <h1>${esc(s.observer)} <span class="dim">· ${esc(s.position)} · ${s.mode === 'practice' ? 'Practice' : 'Assessment'}</span></h1>
          <p class="dim">Scenario <code>${esc(sc.id)}</code> · ${new Date(s.startUTC).toLocaleString()} · ${fmtT(s.durationS)} flown${s.completed ? '' : ' (ended early)'}${s.settings && s.settings.sizeBoost > 1 ? ` · <span class="warn">animals enlarged ×${s.settings.sizeBoost}</span>` : ''}</p>
        </div>
        <div class="score"><div class="sv">${m.score == null ? '—' : Math.round(m.score)}</div><div class="sl">overall score</div></div>
      </div>
      <div class="tiles">
        ${tile('Groups detected', pct(m.detectionRate), `${m.detected} of ${m.targets}`)}
        ${tile('Animals in detected groups', pct(m.animalDetectionRate), `${m.animalsInDetected} of ${m.animalsPresent}`)}
        ${tile('Species correct', pct(m.speciesAccuracy))}
        ${tile('Bin exact', pct(m.binExact), `within one bin ${pct(m.binWithinOne)}`)}
        ${tile('Count exact', pct(m.countExact), `within ±10% ${pct(m.countClose)}`)}
        ${tile('False positives', m.falsePositives, m.outsideStripLogged ? `+${m.outsideStripLogged} outside strip` : '')}
        ${tile('Median timing', m.latencyMedian == null ? '—' : (m.latencyMedian >= 0 ? '+' : '') + m.latencyMedian.toFixed(1) + ' s', 'relative to abeam')}
        ${tile('Distance bias', m.binBias == null ? '—' : (m.binBias > 0 ? '+' : '') + m.binBias.toFixed(2) + ' bins', m.binBias > 0.15 ? 'tends to call groups too far' : m.binBias < -0.15 ? 'tends to call groups too near' : 'no clear bias')}
      </div>
      <div class="cols">
        <section><h2>Detection by distance bin</h2>${barChart(r.byBin)}<p class="dim small">This is the observer's detection function. A steep drop in the far bins is expected; a drop in the near bins usually means groups under the strut or window edge are being missed.</p></section>
        <section><h2>Bin confusion</h2><p class="dim small">Rows: true bin. Columns: bin recorded.</p>
          <table class="tbl conf"><thead><tr><th></th>${CFG.bins.map(b => `<th>${b.key}</th>`).join('')}<th>none</th></tr></thead><tbody>${conf}</tbody></table>
          <h2>By group size</h2>
          <table class="tbl"><thead><tr><th>Size</th><th>Detected</th><th>Rate</th><th>Count exact</th></tr></thead><tbody>${sizeRows}</tbody></table>
        </section>
      </div>
      ${issues.length ? `<section><h2>Data entry</h2><ul>${issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul></section>` : ''}
      ${fp ? `<section><h2>False positives</h2><ul>${fp}</ul></section>` : ''}
      <section><details><summary>Every group on this side (${r.rows.length})</summary>
        <table class="tbl groups"><thead><tr><th>Group</th><th>Abeam</th><th>Species</th><th>Size</th><th>Bin</th><th>Behaviour</th><th>Recorded</th><th>Δt (s)</th><th>Quality</th></tr></thead><tbody>${rows}</tbody></table>
      </details></section>
      <p class="dim small">Score = 100 × (sum of record quality) ÷ (groups in strip + false positives + out-of-strip records). Record quality: species 35%, bin 35% (half for an adjacent bin), count 30% (half if within ±10%).</p>`;
  }

  function initReport() {
    $('btn-dl-dat').onclick = () => {
      const { session, scenario } = state.last;
      download(ST.sessionFileStem(session) + '.dat', ST.buildDat(session, scenario));
    };
    $('btn-dl-session').onclick = () => {
      const { session } = state.last;
      download(ST.sessionFileStem(session) + '.session.json', JSON.stringify(session), 'application/json');
    };
    $('btn-dl-results').onclick = () => {
      const { session, scenario, result } = state.last;
      download(ST.sessionFileStem(session) + '_results.csv', ST.mrdsCsv(scenario, [result]), 'text/csv');
    };
    $('btn-replay').onclick = () => {
      state.loadedScenario = state.last.scenario;
      $('f-observer').value = '';
      updateScenarioInfo();
      show('setup');
      setMsg('setup-msg', 'Same scenario loaded — enter the next observer and press Start.');
    };
    $('btn-home').onclick = () => { show('setup'); updateScenarioInfo(); };
    $('btn-report-compare').onclick = () => {
      const { session } = state.last;
      if (!state.compareFiles.some(f => f.session === session)) {
        state.compareFiles.push({ name: `${session.observer} (${session.position}, this run)`, session });
      }
      show('compare'); renderCompareFiles();
    };
    $('btn-pause-resume').onclick = () => setPaused(false);
    $('btn-pause-end').onclick = () => finishSession(false);
    $('btn-pause-abandon').onclick = () => finishSession(true);
  }

  // ===========================================================================
  // Compare observers
  // ===========================================================================
  function initCompare() {
    $('f-compare-files').onchange = async e => {
      for (const f of e.target.files) {
        try {
          const text = await f.text();
          if (/\.json$/i.test(f.name)) {
            const obj = JSON.parse(text);
            if (obj.format === 'spotter-trainer-session') state.compareFiles.push({ name: f.name, session: obj });
            else if (obj.format === 'spotter-trainer-scenario') state.compareFiles.push({ name: f.name, scenario: ST.validateScenario(obj) });
            else throw new Error('unrecognised JSON');
          } else {
            state.compareFiles.push({ name: f.name, dat: text });
          }
        } catch (err) { setMsg('compare-msg', `${f.name}: ${err.message}`, true); }
      }
      e.target.value = '';
      renderCompareFiles();
    };
    $('btn-compare-clear').onclick = () => { state.compareFiles = []; renderCompareFiles(); $('compare-body').innerHTML = ''; };
    $('btn-compare-run').onclick = runCompare;
    $('btn-compare-back').onclick = () => show('setup');
  }

  function renderCompareFiles() {
    $('compare-files').innerHTML = state.compareFiles.length
      ? state.compareFiles.map(f => `<li>${esc(f.name)} <span class="dim">${f.scenario ? 'scenario' : f.dat ? 'SPOTTER .dat' : 'session'}</span></li>`).join('')
      : '<li class="dim">No files loaded yet.</li>';
  }

  function runCompare() {
    setMsg('compare-msg', '');
    const files = state.compareFiles;
    let sc = (files.find(f => f.scenario) || {}).scenario || ((files.find(f => f.session) || {}).session || {}).scenario;
    if (!sc) { setMsg('compare-msg', 'Load at least one session file (.session.json) or the scenario file.', true); return; }
    try { ST.validateScenario(sc); } catch (err) { setMsg('compare-msg', err.message, true); return; }
    const sessions = [];
    for (const f of files) {
      if (f.session) {
        if (f.session.scenarioHash !== sc.hash) { setMsg('compare-msg', `${f.name} was flown on a different scenario (${f.session.scenarioId}).`, true); return; }
        sessions.push(f.session);
      } else if (f.dat) {
        sessions.push(Object.assign(ST.parseDat(f.dat, sc), { name: f.name }));
      }
    }
    if (sessions.length < 1) { setMsg('compare-msg', 'No observer sessions loaded.', true); return; }
    const boosts = new Set(sessions.map(s => (s.settings && s.settings.sizeBoost) || 1));
    if (boosts.size > 1) setMsg('compare-msg', 'Warning: observers flew with different animal-size settings, so they are not directly comparable.', true);
    const results = sessions.map(s => ST.scoreSession(sc, s));
    const cmp = ST.compareResults(sc, results);
    state.lastCompare = { sc, results, cmp };

    const obsRows = results.map(r => `<tr><td>${esc(r.observer)}</td><td>${esc(r.position)}</td><td>${r.metrics.score == null ? '—' : Math.round(r.metrics.score)}</td><td>${pct(r.metrics.detectionRate)}</td><td>${pct(r.metrics.speciesAccuracy)}</td><td>${pct(r.metrics.binExact)}</td><td>${pct(r.metrics.countExact)}</td><td>${r.metrics.falsePositives}</td></tr>`).join('');
    const pairRows = cmp.pairs.map(p => `<tr><td>${esc(p.a.observer)} vs ${esc(p.b.observer)}</td><td>${p.N}</td><td>${p.both}</td><td>${p.onlyA}</td><td>${p.onlyB}</td><td>${p.neither}</td>
      <td>${pct(p.pA)} / ${pct(p.pAhat)}</td><td>${pct(p.pB)} / ${pct(p.pBhat)}</td><td>${p.Nhat == null ? '—' : p.Nhat.toFixed(1)} <span class="dim">(true ${p.N})</span></td>
      <td>${pct(p.speciesAgree)}</td><td>${pct(p.binAgree)} <span class="dim">κ ${fmtNum(p.binKappa, 2)}</span></td><td>${pct(p.countAgree)} <span class="dim">±${fmtNum(p.countMeanAbsDiff, 1)}</span></td></tr>`).join('');

    // Per-group matrix for observers on the same side as the first
    const side = results[0].side;
    const same = results.filter(r => r.side === side);
    const groups = sc.groups.filter(g => g.side === side && g.binIdx >= 0 && g.binIdx < CFG.bins.length).sort((a, b) => a.tAbeam - b.tAbeam);
    const cell = (r, id) => {
      const row = r.rows.find(x => x.groupId === id);
      if (!row || !row.detected) return '<td class="bad">—</td>';
      const rec = row.record;
      const ok = row.speciesOk && row.binOk && row.countOk;
      return `<td class="${ok ? 'good' : 'warn'}">${esc(speciesShort(rec.species))} ×${rec.hasCount ? rec.count : '?'} · ${esc(rec.bin || '?')}</td>`;
    };
    const matrix = groups.map(g => `<tr><td>${g.id}</td><td>${fmtT(g.tAbeam)}</td><td>${speciesShort(g.species)} ×${g.size} · ${g.bin}</td>${same.map(r => cell(r, g.id)).join('')}</tr>`).join('');

    $('compare-body').innerHTML = `
      <p class="dim">Scenario <code>${esc(sc.id)}</code></p>
      <section><h2>Observers</h2><table class="tbl"><thead><tr><th>Observer</th><th>Seat</th><th>Score</th><th>Detected</th><th>Species</th><th>Bin exact</th><th>Count exact</th><th>False +</th></tr></thead><tbody>${obsRows}</tbody></table></section>
      ${cmp.pairs.length ? `<section><h2>Double-observer agreement</h2>
        <p class="dim small">Pairs on the same side of the aircraft. "p true / p est." compares each observer's actual detection rate with the double-observer (Lincoln–Petersen) estimate an MRDS analysis would make without knowing the truth.</p>
        <table class="tbl"><thead><tr><th>Pair</th><th>Groups</th><th>Both</th><th>A only</th><th>B only</th><th>Neither</th><th>A: p true / est.</th><th>B: p true / est.</th><th>N est.</th><th>Species agree</th><th>Bin agree</th><th>Count agree</th></tr></thead><tbody>${pairRows}</tbody></table></section>`
        : '<p class="dim">Load at least two observers from the same side of the aircraft to see agreement statistics.</p>'}
      <section><details open><summary>Group by group (${side === 'R' ? 'right' : 'left'} side)</summary>
        <table class="tbl groups"><thead><tr><th>Group</th><th>Abeam</th><th>Truth</th>${same.map(r => `<th>${esc(r.observer)}</th>`).join('')}</tr></thead><tbody>${matrix}</tbody></table>
      </details></section>
      <p><button id="btn-dl-mrds" class="btn">Download MRDS-format CSV</button></p>`;
    $('btn-dl-mrds').onclick = () => download(`mrds_${sc.id}.csv`, ST.mrdsCsv(sc, results), 'text/csv');
  }

  // Console access for instructors / debugging: ST.debug.run, ST.debug.state
  ST.debug = { get run() { return run; }, state };

  // ===========================================================================
  initSetup();
  initReport();
  initCompare();
  show('setup');
})();
