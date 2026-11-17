/* SPOTTER Trainer — SPOTTER logger emulation.
 * Mirrors SPOTTER's behaviour: buttons map to RecordedData via
 * GamepadAudioConfig.csv; a NewRecord=Yes button starts a new line, every
 * other button appends ",<data>" to the current line. Output is SPOTTER's
 * .dat format so existing processing scripts can read it.
 */
(function (root) {
  'use strict';
  const ST = root.ST;
  const CFG = ST.CFG;

  // RFC 4180 field splitter (same as SPOTTER's ParseCsvLine)
  function parseCsvLine(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
      } else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  }

  /** Parse GamepadAudioConfig.csv -> { buttonId: {audio, data, newRecord} } */
  ST.parseSpotterConfig = function (text) {
    const map = {};
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const p = parseCsvLine(line);
      if (p.length < 2 || !p[0].trim()) continue;
      map[p[0].trim()] = {
        audio: (p[1] || '').trim(),
        data: (p[2] || '').trim(),
        newRecord: (p[3] || '').trim().toLowerCase() === 'yes'
      };
    }
    return map;
  };

  /** Builds SPOTTER records from button presses. */
  ST.RecordBuilder = class {
    constructor(mapping) {
      this.mapping = mapping;
      this.records = [];        // { t, tokens: [...] }
      this.presses = [];        // { t, button, data }
      this.preTokens = [];      // presses before the first record (SPOTTER appends to the header line)
      this.current = null;
      this.inBreak = true;      // SPOTTER: first Start press logs Start_On
    }
    press(buttonId, t) {
      if (buttonId === 'Start') {
        buttonId = this.inBreak ? 'Start_On' : 'Start_Off';
        this.inBreak = !this.inBreak;
      }
      const m = this.mapping[buttonId];
      const data = m && m.data ? m.data : buttonId;
      const audio = m && m.audio ? m.audio : buttonId.replace(/_/g, ' ');
      this.presses.push({ t: +t.toFixed(3), button: buttonId, data });
      if (m && m.newRecord) {
        this.current = { t: +t.toFixed(3), tokens: [data] };
        this.records.push(this.current);
        return { type: 'new', record: this.current, audio, button: buttonId, data };
      }
      if (this.current) this.current.tokens.push(data);
      else this.preTokens.push(data);
      return { type: 'append', record: this.current, audio, button: buttonId, data };
    }
  };

  // ---------------------------------------------------------------------------
  // .dat writer / reader
  // ---------------------------------------------------------------------------
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const p2 = n => String(n).padStart(2, '0');
  const p3 = n => String(n).padStart(3, '0');
  function hh12(d) { const h = d.getHours() % 12; return h === 0 ? 12 : h; }
  function ampm(d) { return d.getHours() < 12 ? 'am' : 'pm'; }

  ST.sanitizeName = s => (s || 'Unknown').replace(/[\\/:*?"<>|]/g, '_').replace(/[ .]/g, '_');

  /** File stem in SPOTTER's naming convention. */
  ST.sessionFileStem = function (session) {
    const d = new Date(session.startUTC);
    const ts = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}-${p3(d.getMilliseconds())}`;
    return `${ts}_${session.session}_${ST.sanitizeName(session.observer)}_${session.position}`;
  };

  function dotNetTicks(ms) {
    // .NET ticks = 100 ns intervals since 0001-01-01
    return (BigInt(Math.round(ms * 10)) * 1000n + 621355968000000000n).toString();
  }

  ST.buildDat = function (session, scenario) {
    const start = new Date(session.startUTC);
    const header = `${DAYS[start.getDay()]} ${p2(start.getDate())} ${p2(start.getMonth() + 1)} ${start.getFullYear()} ` +
      `${p2(hh12(start))}_${p2(start.getMinutes())}_${p2(start.getSeconds())} ${ampm(start)}_` +
      `${session.session}_${session.observer}_${session.position}`;
    let out = header + session.preTokens.map(t => ',' + t).join('');
    const geoStart = (scenario.geometry && scenario.geometry.start) || CFG.start;
    for (const r of session.records) {
      const ms = start.getTime() + r.t * 1000;
      const d = new Date(ms);
      const s = CFG.speedMs * r.t;
      const lon = geoStart.lon + s / (111320 * Math.cos(geoStart.lat * Math.PI / 180));
      const alt = geoStart.groundAslM + CFG.altitudeM + ST.motionAt(scenario.motion.alt, r.t);
      // SPOTTER stamps records with GPS (UTC) time; the header uses local time.
      const uh = d.getUTCHours();
      const time = `${uh % 12 === 0 ? 12 : uh % 12}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ${uh < 12 ? 'am' : 'pm'}`;
      out += '\r\n' + [time, session.session, session.observer, session.position, dotNetTicks(ms),
        geoStart.lat.toFixed(7), lon.toFixed(7), '90', alt.toFixed(1), '0.9', '1.3', 'NA', '-9999', '-9999'
      ].join(',') + r.tokens.map(t => ',' + t).join('');
    }
    return out;
  };

  /**
   * Parse a SPOTTER .dat file into a session object. Record times are
   * recovered from longitude (distance along the transect), so this also
   * works on files written by the real SPOTTER flying a known transect.
   */
  ST.parseDat = function (text, scenario) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) throw new Error('Empty .dat file');
    const geoStart = (scenario && scenario.geometry && scenario.geometry.start) || CFG.start;
    const records = [];
    let observer = null, position = null, sess = null;
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i].split(',');
      if (f.length < 15) continue;
      observer = f[2]; position = f[3]; sess = f[1];
      const s = ST.geom.sFromLon(parseFloat(f[6]), geoStart);
      records.push({ t: +(s / CFG.speedMs).toFixed(3), tokens: f.slice(14).map(x => x.trim()) });
    }
    if (!position) {
      const h = lines[0].split(',')[0].split('_');
      position = h[h.length - 1]; observer = h[h.length - 2]; sess = h[h.length - 3];
    }
    return {
      format: 'spotter-trainer-session', source: 'dat', observer, position, session: sess,
      side: ST.sideOfPosition(position), records, preTokens: []
    };
  };

  ST.sideOfPosition = pos => (/^left/i.test(pos || '') ? 'L' : 'R');
  ST.POSITIONS = ['LeftFront', 'LeftRear', 'RightFront', 'RightRear'];

  // ---------------------------------------------------------------------------
  // Input: Xbox controller via the Gamepad API + keyboard fallback
  // ---------------------------------------------------------------------------
  // Standard Gamepad mapping indices -> SPOTTER button ids
  const PAD_BUTTONS = {
    0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LeftShoulder', 5: 'RightShoulder',
    6: 'LeftTrigger', 7: 'RightTrigger', 8: 'Back', 9: 'Start',
    10: 'LeftThumbClick', 11: 'RightThumbClick',
    12: 'DPadUp', 13: 'DPadDown', 14: 'DPadLeft', 15: 'DPadRight'
  };

  ST.KEYBOARD = {
    KeyR: 'RightTrigger', KeyG: 'LeftTrigger', KeyT: 'LeftShoulder',
    Digit1: 'A', Digit2: 'B', Digit3: 'Y', Digit4: 'X', Digit0: 'RightThumbDown',
    Numpad1: 'A', Numpad2: 'B', Numpad3: 'Y', Numpad4: 'X', Numpad0: 'RightThumbDown',
    ArrowDown: 'DPadDown', ArrowLeft: 'DPadLeft', ArrowUp: 'DPadUp', ArrowRight: 'DPadRight',
    KeyE: 'RightShoulder', KeyM: 'RightThumbUp', Backspace: 'Back', Enter: 'Start'
  };

  ST.Input = class {
    constructor(onPress) {
      this.onPress = onPress;
      this.enabled = false;
      this.prev = {};
      this.stickHeld = { L: false, R: false };
      this.padName = null;
      this._onKey = e => {
        if (!this.enabled || e.repeat) return;
        const id = ST.KEYBOARD[e.code];
        if (id) { e.preventDefault(); this.onPress(id, 'keyboard'); }
      };
      window.addEventListener('keydown', this._onKey);
    }
    destroy() { window.removeEventListener('keydown', this._onKey); }

    static firstPad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected) return p;
      return null;
    }

    poll() {
      const pad = ST.Input.firstPad();
      this.padName = pad ? pad.id : null;
      if (!pad) { this.prev = {}; return; }
      const btns = pad.buttons;
      for (const idx in PAD_BUTTONS) {
        const b = btns[idx];
        if (!b) continue;
        const down = idx === '6' || idx === '7' ? b.value > 0.5 : b.pressed;
        if (down && !this.prev[idx] && this.enabled) this.onPress(PAD_BUTTONS[idx], 'pad');
        this.prev[idx] = down;
      }
      this._stick('L', pad.axes[0] || 0, pad.axes[1] || 0, 'LeftThumb');
      this._stick('R', pad.axes[2] || 0, pad.axes[3] || 0, 'RightThumb');
    }

    _stick(k, x, y, prefix) {
      const mag = Math.hypot(x, y);
      if (this.stickHeld[k]) { if (mag < 0.3) this.stickHeld[k] = false; return; }
      if (mag < 0.7) return;
      this.stickHeld[k] = true;
      const dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'Right' : 'Left') : (y > 0 ? 'Down' : 'Up');
      if (this.enabled) this.onPress(prefix + dir, 'pad');
    }

    rumble(ms) {
      const pad = ST.Input.firstPad();
      const act = pad && pad.vibrationActuator;
      if (act && act.playEffect) {
        act.playEffect('dual-rumble', { duration: ms || 120, strongMagnitude: 0.4, weakMagnitude: 0.4 }).catch(() => {});
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
