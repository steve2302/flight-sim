/* SPOTTER Trainer — core: configuration, survey geometry, seeded RNG, noise.
 * DOM-free so it can be unit-tested under Node.
 */
(function (root) {
  'use strict';
  const ST = root.ST = root.ST || {};
  ST.VERSION = '0.1.0';

  const deg = Math.PI / 180;

  // ---------------------------------------------------------------------------
  // Survey configuration (NSW Western Plains fixed-wing survey, Cessna Caravan)
  // ---------------------------------------------------------------------------
  ST.CFG = {
    altitudeM: 76,                 // height above ground
    speedKn: 100,                  // ground speed
    speedMs: 100 * 1852 / 3600,    // 51.44 m/s (185.2 km/h)
    blindStripM: 40,               // inner edge of the strip, measured from nadir
    eyeLateralM: 0.8,              // observer eye offset from aircraft centreline
    pitchDeg: 38,                  // camera look-down angle (centre of view)
    vFovDeg: 66,                   // vertical field of view of the rendered view
    aspect: 16 / 9,                // fixed so every observer sees the same view
    apertureNdcX: 0.80,            // half-width of the window opening (NDC units)
    leadInM: 700,                  // empty ground before the first group
    tailM: 450,                    // empty ground after the last group
    matchGraceS: 3,                // records accepted up to this long after a group leaves view
    recordCloseS: 3.5,             // practice feedback: record treated as finished after this idle time
    deleteDiscardsRecord: true,    // a record containing delete_last_record is discarded
    start: { lat: -32.35, lon: 144.30, groundAslM: 95 },   // synthetic transect origin (heading 090)
    // Bins are measured from the outer edge of the 40 m blind strip.
    bins: [
      { key: '0-50',    from: 0,   to: 50,  colour: '#f3d01c', name: 'yellow' },
      { key: '50-100',  from: 50,  to: 100, colour: '#3fae49', name: 'green' },
      { key: '100-200', from: 100, to: 200, colour: '#2f6fd6', name: 'blue' },
      { key: '200-300', from: 200, to: 300, colour: '#1b1b1b', name: 'black' }
    ]
  };
  const CFG = ST.CFG;

  ST.SPECIES = {
    red_kangaroo:  { label: 'Red kangaroo',  short: 'Red' },
    grey_kangaroo: { label: 'Grey kangaroo', short: 'Grey' },
    goat:          { label: 'Feral goat',    short: 'Goat' }
  };

  // SPOTTER's shipped GamepadAudioConfig.csv (used when no file is loaded).
  ST.DEFAULT_SPOTTER_CSV = [
    'Button,AudioText,RecordedData,NewRecord',
    'A,one,1,No',
    'B,two,2,No',
    'Y,three,3,No',
    'X,four,4,No',
    'LeftShoulder,goat,goat,Yes',
    'RightShoulder,glare,glare,No',
    'Start_On,start transect,start_transect,Yes',
    'Start_Off,end transect,end_transect,Yes',
    'Back,delete last record,delete_last_record,No',
    'DPadUp,blue one hundred to two hundred meters,(blue) 100-200,No',
    'DPadLeft,green fifty to one hundred meters,(green) 50-100,No',
    'DPadDown,yellow zero to fifty meters,(yellow) 0-50,No',
    'DPadRight,black two hundred to three hundred meters,(black) 200-300,No',
    'LeftTrigger,grey kangaroo,grey_kangaroo,Yes',
    'RightTrigger,red kangaroo,red_kangaroo,Yes',
    'LeftThumbUp,blue one hundred to two hundred meters,(blue) 100-200,No',
    'LeftThumbLeft,green fifty to one hundred meters,(green) 50-100,No',
    'LeftThumbDown,yellow zero to fifty meters,(yellow) 0-50,No',
    'LeftThumbRight,black two hundred to three hundred meters,(black) 200-300,No',
    'RightThumbDown,ten,10,No',
    'RightThumbLeft,not configured,NA,No',
    'RightThumbUp,mixed species in the same group,mixed_species_group,No',
    'RightThumbRight,not configured,NA,No',
    'LeftThumbClick,not configured,NA,No',
    'RightThumbClick,not configured,NA,No'
  ].join('\n');

  // ---------------------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------------------
  // World frame: x = along-track (aircraft flies +x, heading 090),
  // y = up, z = lateral (right of track = +z). X below = lateral distance
  // of a ground point from the aircraft centreline (always positive).
  ST.geom = {
    deg,
    /** Depth of a ground point (at along-offset 0) along the camera's view axis. */
    camDepth(X) {
      const P = CFG.pitchDeg * deg;
      return CFG.altitudeM * Math.sin(P) + (X - CFG.eyeLateralM) * Math.cos(P);
    },
    /** Along-track half-width (m) of the window opening at lateral distance X. */
    halfWindowM(X) {
      const k = CFG.apertureNdcX * Math.tan(CFG.vFovDeg * deg / 2) * CFG.aspect;
      return k * ST.geom.camDepth(X);
    },
    /** NDC y (+1 top, -1 bottom) of the ground line at lateral X, wings level. */
    ndcY(X) {
      const decl = Math.atan2(CFG.altitudeM, X - CFG.eyeLateralM);
      return -Math.tan(decl - CFG.pitchDeg * deg) / Math.tan(CFG.vFovDeg * deg / 2);
    },
    /** Boundaries (m from nadir) of the strip: 40, 90, 140, 240, 340. */
    boundaries() {
      const b = [CFG.blindStripM + CFG.bins[0].from];
      CFG.bins.forEach(x => b.push(CFG.blindStripM + x.to));
      return b;
    },
    /** Bin of a lateral distance from nadir: idx -1 blind strip, 0..3 bins, 4 outside. */
    binOf(X) {
      const d = X - CFG.blindStripM;
      if (d < 0) return { idx: -1, key: 'blind' };
      for (let i = 0; i < CFG.bins.length; i++) {
        if (d < CFG.bins[i].to) return { idx: i, key: CFG.bins[i].key };
      }
      return { idx: CFG.bins.length, key: 'out' };
    },
    binIndexOfKey(key) {
      if (key == null) return null;
      const i = CFG.bins.findIndex(b => b.key === key);
      return i >= 0 ? i : null;
    },
    /** Synthetic GPS position after flying s metres along the transect. */
    latLon(s) {
      const st = CFG.start;
      return { lat: st.lat, lon: st.lon + s / (111320 * Math.cos(st.lat * deg)) };
    },
    /** Inverse of latLon for longitude -> along-track metres. */
    sFromLon(lon, start) {
      const st = start || CFG.start;
      return (lon - st.lon) * 111320 * Math.cos(st.lat * deg);
    }
  };

  // ---------------------------------------------------------------------------
  // Seeded RNG (xmur3 hash + mulberry32)
  // ---------------------------------------------------------------------------
  ST.hashString = function (str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };

  ST.rng = function (seed) {
    let a = typeof seed === 'number' ? seed >>> 0 : ST.hashString(String(seed));
    const f = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + (hi - lo) * f();
    f.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * f());
    f.pick = arr => arr[Math.floor(f() * arr.length)];
    f.chance = p => f() < p;
    f.exp = mean => -Math.log(1 - f()) * mean;
    f.weighted = obj => {
      const keys = Object.keys(obj);
      let total = 0; keys.forEach(k => { total += obj[k]; });
      let r = f() * total;
      for (const k of keys) { r -= obj[k]; if (r <= 0) return k; }
      return keys[keys.length - 1];
    };
    return f;
  };

  // ---------------------------------------------------------------------------
  // Value noise (world-anchored, optionally tileable)
  // ---------------------------------------------------------------------------
  function hash2(ix, iz, seed) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  ST.valueNoise = function (x, z, seed, period) {
    let ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    let ix1 = ix + 1, iz1 = iz + 1;
    if (period) {
      const m = v => ((v % period) + period) % period;
      ix = m(ix); iz = m(iz); ix1 = m(ix1); iz1 = m(iz1);
    }
    const a = hash2(ix, iz, seed), b = hash2(ix1, iz, seed);
    const c = hash2(ix, iz1, seed), d = hash2(ix1, iz1, seed);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
  ST.fbm = function (x, z, seed, octaves, period) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < (octaves || 4); i++) {
      sum += amp * ST.valueNoise(x * freq, z * freq, seed + i * 101, period ? period * freq : 0);
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  };

  ST.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  ST.lerp = (a, b, t) => a + (b - a) * t;
  ST.median = arr => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  ST.mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  if (typeof module !== 'undefined' && module.exports) module.exports = ST;
})(typeof window !== 'undefined' ? window : globalThis);
