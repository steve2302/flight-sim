/* SPOTTER Trainer — 3D world (Three.js r128).
 * Everything visible is a deterministic function of (scenario, time), so a
 * scenario replays identically for every observer.
 */
(function (root) {
  'use strict';
  const ST = root.ST;
  const CFG = ST.CFG;
  const THREE = root.THREE;
  const deg = Math.PI / 180;

  const CHUNK_L = 200;          // along-track length of a ground chunk (m)
  const LAT_MIN = -80, LAT_MAX = 1600;
  const TEX_M = 25;             // metres covered by one soil texture tile
  const VIEW_AHEAD = 1300, VIEW_BEHIND = 1300;

  // ---------------------------------------------------------------------------
  // Procedural soil texture (tileable)
  // ---------------------------------------------------------------------------
  function makeSoilTexture(hab, seed, size) {
    const N = size, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N), d = img.data;
    const rng = ST.rng(seed + '|soil');
    // Isotropic grain: per-pixel noise, softened below (lattice noise shows a grid from the air)
    for (let i = 0; i < N * N; i++) {
      const v = 0.86 + rng() * 0.16 - 0.08;
      d[i * 4] = 255 * v * 0.98; d[i * 4 + 1] = 255 * v * 0.96; d[i * 4 + 2] = 255 * v * 0.94; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    if ('filter' in g) {
      const tmp = document.createElement('canvas'); tmp.width = tmp.height = N;
      const tg = tmp.getContext('2d');
      tg.filter = `blur(${N / 900}px)`;
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) tg.drawImage(c, ox, oy);   // wrap-around blur
      g.drawImage(tmp, 0, 0);
    }
    // Soft mid-scale blotches, drawn with wrap-around so the tile stays seamless
    const blob = (x, y, r, col) => {
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
      }
    };
    for (let i = 0; i < 60; i++) {
      const dark = rng() < 0.5;
      blob(rng() * N, rng() * N, rng.range(0.03, 0.12) * N,
        dark ? `rgba(60,30,20,${rng.range(0.06, 0.14)})` : `rgba(255,235,210,${rng.range(0.05, 0.12)})`);
    }
    // gibber stones and pebbles
    for (let i = 0; i < N * 3; i++) {
      const x = rng() * N, y = rng() * N, r = rng.range(0.6, 2.2) * N / 1024;
      const dark = rng() < 0.6;
      g.fillStyle = dark ? `rgba(70,45,35,${rng.range(0.25, 0.6)})` : `rgba(255,240,220,${rng.range(0.15, 0.35)})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // dry grass tufts / litter
    const tufts = Math.round(N * 1.2 * hab.grassAmt + N * 0.2);
    g.lineWidth = Math.max(1, N / 1024);
    for (let i = 0; i < tufts; i++) {
      const x = rng() * N, y = rng() * N, len = rng.range(3, 9) * N / 1024;
      g.strokeStyle = `rgba(${200 + rng() * 40 | 0},${180 + rng() * 40 | 0},${120 + rng() * 30 | 0},${rng.range(0.25, 0.55)})`;
      for (let k = 0; k < 5; k++) {
        const a = rng() * Math.PI * 2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // ---------------------------------------------------------------------------
  // Shared geometry/material helpers for animals
  // ---------------------------------------------------------------------------
  const GEO = {};
  function geo() {
    if (GEO.sphere) return GEO;
    GEO.sphere = new THREE.SphereGeometry(1, 16, 12);
    GEO.cone = new THREE.ConeGeometry(1, 1, 8);
    GEO.cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
    GEO.taper = new THREE.CylinderGeometry(0.3, 1, 1, 8);
    GEO.box = new THREE.BoxGeometry(1, 1, 1);
    GEO.dodec = new THREE.DodecahedronGeometry(1, 0);
    return GEO;
  }

  /** Irregular lumpy blob (shrubs, tree canopy), darker underneath to fake self-shadowing. */
  function lumpyGeometry(detail, seed, amount) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const pos = g.attributes.position, cols = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = ST.fbm(v.x * 1.7 + 5, v.z * 1.7 + v.y * 1.3 + 9, seed, 3);
      v.multiplyScalar(1 + amount * (n - 0.5) * 2);
      pos.setXYZ(i, v.x, v.y, v.z);
      const shadeF = 0.72 + 0.28 * ST.clamp((v.y + 0.6) / 1.4, 0, 1);
      cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = shadeF;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.computeVertexNormals();
    return g;
  }

  // Rough fur and fleece back-scatter low sun much as the soil does (see groundMat),
  // so animals get the same emissive lift; without it they render too dark against
  // the ground and lose their colour.
  const ANIMAL_EMI = 0.20;
  const MATS = new Map();
  function mat(hex) {
    if (!MATS.has(hex)) {
      const c = new THREE.Color(hex);
      MATS.set(hex, new THREE.MeshLambertMaterial({ color: c, emissive: c.clone().multiplyScalar(ANIMAL_EMI) }));
    }
    return MATS.get(hex);
  }
  function shade(hex, f) {
    const c = new THREE.Color(hex); c.multiplyScalar(f); return c.getHex();
  }
  function part(parent, g, m, sx, sy, sz, x, y, z, rz, ry) {
    const mesh = new THREE.Mesh(g, m);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, ry || 0, rz || 0);
    mesh.receiveShadow = true;      // shaded under trees; animals cast projected shadows instead
    parent.add(mesh);
    return mesh;
  }
  function pivot(parent, x, y, z) {
    const p = new THREE.Group();
    p.name = 'head';
    p.position.set(x, y, z);
    parent.add(p);
    return p;
  }
  const HALF_PI = Math.PI / 2;

  // Field marks that separate the species from the air:
  //  red male   - rust-red back, white underparts and legs, pale tail tip, big
  //  red female - blue-grey back ("blue flier"), white underparts and legs
  //  grey       - uniform grey-brown, belly only slightly paler, dark paws, feet and tail tip
  const ROO = {
    male:   { fur: 0x9a4b32, pale: 0xe6dccb, legs: 0xdacdb8, tip: 0xd6c8b2, ear: 0x7e3f2a },
    female: { fur: 0x9294a0, pale: 0xebe7df, legs: 0xdcd7cf, tip: 0xd5d0c8, ear: 0x7c7d88 },
    grey:   { fur: 0x77706a, pale: 0xa39b90, legs: 0x3a322d, tip: 0x26201c, ear: 0x4a423b }
  };
  // Relative body size by morph (applied on top of the scenario's per-animal scale).
  // Red males are much the largest; red females are smaller than greys.
  const MORPH_SIZE = { male: 1.25, female: 0.92, grey: 1.04 };

  function kangaroo(pose, morph, rngv) {
    const G = geo();
    const P = ROO[morph] || ROO.grey;
    const fur = mat(shade(P.fur, 0.93 + rngv * 0.14));
    const pale = mat(P.pale), legs = mat(P.legs), tip = mat(P.tip), ear = mat(P.ear);
    const o = new THREE.Group();
    let head;
    if (pose === 'graze') {            // pentapedal grazing, head down
      part(o, G.sphere, fur, 0.30, 0.25, 0.22, -0.18, 0.30, 0);
      part(o, G.sphere, pale, 0.30, 0.15, 0.15, 0.02, 0.24, 0, -0.3);
      part(o, G.sphere, fur, 0.36, 0.19, 0.165, 0.06, 0.34, 0, -0.35);
      part(o, G.box, legs, 0.40, 0.05, 0.07, -0.06, 0.03, 0.09);
      part(o, G.box, legs, 0.40, 0.05, 0.07, -0.06, 0.03, -0.09);
      part(o, G.cyl, legs, 0.025, 0.24, 0.025, 0.30, 0.12, 0.06);
      part(o, G.cyl, legs, 0.025, 0.24, 0.025, 0.30, 0.12, -0.06);
      part(o, G.taper, fur, 0.065, 0.75, 0.065, -0.68, 0.08, 0, HALF_PI);
      part(o, G.taper, tip, 0.03, 0.25, 0.03, -1.12, 0.04, 0, HALF_PI);
      head = pivot(o, 0.34, 0.34, 0);
      part(head, G.sphere, fur, 0.10, 0.07, 0.07, 0.06, -0.06, 0);
      part(head, G.sphere, fur, 0.13, 0.075, 0.07, 0.13, -0.17, 0, -0.9);
      part(head, G.cone, ear, 0.035, 0.11, 0.03, 0.04, -0.06, 0.045, 0.5);
      part(head, G.cone, ear, 0.035, 0.11, 0.03, 0.04, -0.06, -0.045, 0.5);
    } else if (pose === 'hop') {
      part(o, G.sphere, fur, 0.28, 0.23, 0.21, -0.20, 0.50, 0);
      part(o, G.sphere, pale, 0.32, 0.13, 0.14, 0.04, 0.56, 0, 0.25);
      part(o, G.sphere, fur, 0.40, 0.19, 0.18, 0.08, 0.62, 0, 0.25);
      part(o, G.box, legs, 0.46, 0.05, 0.07, -0.36, 0.22, 0.08, 0.6);
      part(o, G.box, legs, 0.46, 0.05, 0.07, -0.36, 0.22, -0.08, 0.6);
      part(o, G.sphere, fur, 0.13, 0.08, 0.075, 0.46, 0.82, 0, -0.1);
      part(o, G.cone, ear, 0.035, 0.12, 0.03, 0.38, 0.93, 0.05, 0.6);
      part(o, G.cone, ear, 0.035, 0.12, 0.03, 0.38, 0.93, -0.05, 0.6);
      part(o, G.taper, fur, 0.065, 0.85, 0.065, -0.75, 0.48, 0, HALF_PI - 0.2);
      part(o, G.taper, tip, 0.03, 0.25, 0.03, -1.29, 0.59, 0, HALF_PI - 0.2);
      head = null;
    } else {                           // sitting upright / alert
      part(o, G.sphere, fur, 0.30, 0.24, 0.24, -0.06, 0.28, 0);
      part(o, G.sphere, fur, 0.22, 0.38, 0.20, 0.03, 0.62, 0, -0.25);
      part(o, G.sphere, pale, 0.15, 0.30, 0.15, 0.12, 0.58, 0, -0.25);
      part(o, G.box, legs, 0.42, 0.05, 0.08, 0.08, 0.03, 0.09);
      part(o, G.box, legs, 0.42, 0.05, 0.08, 0.08, 0.03, -0.09);
      part(o, G.cyl, legs, 0.022, 0.18, 0.022, 0.19, 0.52, 0.07, 0.4);
      part(o, G.cyl, legs, 0.022, 0.18, 0.022, 0.19, 0.52, -0.07, 0.4);
      part(o, G.taper, fur, 0.065, 0.80, 0.065, -0.50, 0.06, 0, HALF_PI);
      part(o, G.taper, tip, 0.03, 0.25, 0.03, -0.97, 0.035, 0, HALF_PI);
      head = pivot(o, 0.08, 0.98, 0);
      part(head, G.sphere, fur, 0.14, 0.085, 0.08, 0.07, 0.06, 0, -0.15);
      part(head, G.cone, ear, 0.035, 0.13, 0.03, -0.01, 0.17, 0.05);
      part(head, G.cone, ear, 0.035, 0.13, 0.03, -0.01, 0.17, -0.05);
    }
    return o;
  }

  // Goats: horizontal back on four legs, often strongly patterned, horns, tail up.
  const GOAT_COL = {
    white: [0xe8e3d8, 0xe0dacd], black: [0x2a2624, 0x2a2624],
    brown: [0x7a5232, 0x55381f], patchy: [0xe8e3d8, 0x2a2624]
  };
  function goat(morph) {
    const G = geo();
    const [bc, hc] = GOAT_COL[morph] || GOAT_COL.brown;
    const body = mat(bc), head = mat(hc), leg = mat(shade(hc, 0.8)), horn = mat(0x4a4038);
    const o = new THREE.Group();
    part(o, G.sphere, body, 0.42, 0.22, 0.18, 0, 0.58, 0);
    if (morph === 'patchy') part(o, G.sphere, head, 0.20, 0.17, 0.185, 0.22, 0.60, 0);
    [[0.27, 0.09], [0.27, -0.09], [-0.27, 0.09], [-0.27, -0.09]].forEach(([x, z]) =>
      part(o, G.cyl, leg, 0.03, 0.46, 0.03, x, 0.23, z));
    part(o, G.cone, body, 0.03, 0.12, 0.03, -0.42, 0.76, 0, 0.6);
    const h = pivot(o, 0.36, 0.68, 0);
    part(h, G.cyl, head, 0.06, 0.30, 0.06, 0.08, 0.10, 0, -0.5);
    part(h, G.sphere, head, 0.14, 0.08, 0.075, 0.20, 0.22, 0, -0.4);
    part(h, G.cone, horn, 0.022, 0.18, 0.022, 0.12, 0.33, 0.04, 0.7);
    part(h, G.cone, horn, 0.022, 0.18, 0.022, 0.12, 0.33, -0.04, 0.7);
    return o;
  }

  function distractorMesh(type, item) {
    const G = geo();
    const o = new THREE.Group();
    const v = item.v;
    if (type === 'emu') {
      const b = mat(shade(0x4b4037, 0.9 + v * 0.2)), l = mat(0x6c665e);
      part(o, G.sphere, b, 0.45, 0.33, 0.28, 0, 1.05, 0);
      part(o, G.cyl, b, 0.045, 0.6, 0.045, 0.32, 1.45, 0, -0.35);
      part(o, G.sphere, b, 0.08, 0.07, 0.07, 0.45, 1.76, 0);
      part(o, G.cyl, l, 0.03, 0.9, 0.03, 0, 0.45, 0.08);
      part(o, G.cyl, l, 0.03, 0.9, 0.03, 0, 0.45, -0.08);
    } else if (type === 'sheep') {
      const w = mat(shade(0xd6cdbb, 0.85 + v * 0.2)), l = mat(0xc9c0b0);
      part(o, G.sphere, w, 0.50, 0.32, 0.30, 0, 0.62, 0);
      part(o, G.sphere, l, 0.15, 0.12, 0.10, 0.52, 0.70, 0);
      [[0.3, 0.12], [0.3, -0.12], [-0.3, 0.12], [-0.3, -0.12]].forEach(([x, z]) =>
        part(o, G.cyl, l, 0.035, 0.36, 0.035, x, 0.18, z));
    } else if (type === 'stump') {
      const m = mat(shade(0x433629, 0.85 + v * 0.3));
      const h = 0.6 + v * 0.9, r = 0.2 + v * 0.15;
      part(o, G.cyl, m, r, h, r, 0, h / 2, 0, 0.12 * (v - 0.5));
      if (v > 0.5) part(o, G.cyl, m, r * 0.5, h * 0.7, r * 0.5, 0.2, h * 0.75, 0, -0.5);
    } else if (type === 'rock') {
      const m = mat(v > 0.5 ? 0x6b5a4c : 0x857869);
      part(o, G.dodec, m, 0.5 + v * 0.5, 0.3 + v * 0.3, 0.4 + v * 0.5, 0, 0.15, 0);
    } else { // termite mound
      const m = mat(shade(0x9a6a48, 0.85 + v * 0.25));
      const h = 0.7 + v * 0.9;
      part(o, G.cone, m, 0.5 + v * 0.4, h, 0.5 + v * 0.4, 0, h / 2, 0);
    }
    return o;
  }

  // Planar projected shadows. The scene shadow map covers ~900 m, so a kangaroo's
  // shadow would be 1-2 texels and blur away; a projected copy of the animal gives a
  // crisp silhouette at any distance — the long low-sun shadow is a key spotting cue.
  function shadowProjection(L) {
    const m = new THREE.Matrix4();
    m.set(1, -L.x / L.y, 0, 0,
          0, 0, 0, 0.02,
          0, -L.z / L.y, 1, 0,
          0, 0, 0, 1);
    return m;
  }
  function shadowCopy(obj, shadowMat) {
    const c = obj.clone(true);
    c.traverse(ch => { if (ch.isMesh) { ch.material = shadowMat; ch.receiveShadow = false; ch.castShadow = false; } });
    return c;
  }

  // ---------------------------------------------------------------------------
  // World
  // ---------------------------------------------------------------------------
  ST.World = class {
    constructor(canvas, scenario, opts) {
      this.sc = scenario;
      this.side = opts.side;
      this.sgn = opts.side === 'R' ? 1 : -1;
      this.quality = opts.quality || 'high';
      this.boost = opts.sizeBoost || 1;     // optional enlargement of animals + distractors (training aid)
      const hi = this.quality === 'high';
      this.hab = ST.HABITATS[scenario.params.habitat] || ST.HABITATS.plains;
      this.seed = scenario.params.seed + '|' + scenario.params.habitat;

      const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      // High quality supersamples (2x): animals under a pixel wide at 200-300 m then read as a
      // faint smudge, as they do to the eye, instead of flickering in and out.
      r.setPixelRatio(hi ? 2 : 1);
      r.shadowMap.enabled = true;
      r.shadowMap.type = hi ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;

      const scene = this.scene = new THREE.Scene();
      const haze = new THREE.Color(0xd9c8ad);
      scene.background = haze;
      scene.fog = new THREE.Fog(haze, 650, 2400);

      this.camera = new THREE.PerspectiveCamera(CFG.vFovDeg, CFG.aspect, 0.5, 5000);
      this.camera.rotation.order = 'YXZ';

      // Low sun: first/last two hours of daylight
      const el = (scenario.params.sunElevationDeg || 18) * deg;
      const s = this.sgn;
      const horiz = {
        observerSide: [0.35, s * 1.0], farSide: [0.35, -s * 1.0],
        ahead: [1.0, s * 0.25], behind: [-1.0, s * 0.25]
      }[scenario.params.sun] || [0.35, -s];
      const hl = Math.hypot(horiz[0], horiz[1]);
      this.sunDir = new THREE.Vector3(horiz[0] / hl * Math.cos(el), Math.sin(el), horiz[1] / hl * Math.cos(el));

      scene.add(new THREE.HemisphereLight(0xc4d6e8, 0x8a5a3c, 0.48));
      const sun = this.sun = new THREE.DirectionalLight(0xfff0d6, 0.85);
      sun.castShadow = true;
      sun.shadow.mapSize.set(hi ? 4096 : 2048, hi ? 4096 : 2048);
      const sc = sun.shadow.camera;
      sc.left = -460; sc.right = 460; sc.top = 460; sc.bottom = -460; sc.near = 50; sc.far = 2200;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
      scene.add(sun); scene.add(sun.target);

      this.soilTex = makeSoilTexture(this.hab, this.seed, hi ? 1024 : 512);
      this.soilTex.anisotropy = r.capabilities.getMaxAnisotropy();
      this.soilTex.repeat.set(CHUNK_L / TEX_M, (LAT_MAX - LAT_MIN) / TEX_M);
      // Rough soil back-scatters low sun far more than a Lambert plane does; a little
      // emissive keeps ground/animal contrast realistic at grazing sun angles.
      const sl = this.hab.soil;
      this.groundMat = new THREE.MeshLambertMaterial({
        map: this.soilTex, vertexColors: true,
        emissive: new THREE.Color(sl[0] * 0.42, sl[1] * 0.42, sl[2] * 0.42),
        emissiveMap: this.soilTex
      });
      this.shrubMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      this.canopyMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      this.trunkMat = new THREE.MeshLambertMaterial({ color: 0x5f5247 });
      this.shrubGeo = lumpyGeometry(2, 311, 0.32);
      this.canopyGeo = lumpyGeometry(2, 577, 0.22);
      this.tussockGeo = lumpyGeometry(1, 911, 0.35);
      this.tussockMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });

      // Projected animal shadows (see shadowProjection). Opacity matches the
      // darkening of ground in the shadow map's shadows from shrubs and trees.
      this.shadowP = shadowProjection(this.sunDir);
      this.shadowMat = new THREE.MeshBasicMaterial({
        color: 0x1a0d06, transparent: true, opacity: 0.42, depthWrite: false,
        // stencil: overlapping parts of one silhouette darken only once
        stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
        stencilZPass: THREE.ReplaceStencilOp,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      });
      this.trunkGeo = new THREE.CylinderGeometry(0.6, 1, 1, 5);
      this.chunks = new Map();

      // Animal entities: groups + distractors on this side, sorted by along-track position
      this.items = scenario.groups.filter(g => g.side === this.side).map(g => ({ kind: 'group', d: g }))
        .concat((scenario.distractors || []).filter(d => d.side === this.side).map(d => ({ kind: 'distractor', d })))
        .sort((a, b) => a.d.s - b.d.s);
      this.nextItem = 0;
      this.active = [];
      this.groupObj = new Map();
      this.planeS = 0;
    }

    resize(w, h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = CFG.aspect;
      this.camera.updateProjectionMatrix();
    }

    // ---- ground chunks ------------------------------------------------------
    _makeChunk(i) {
      const hab = this.hab, sgn = this.sgn, seedN = ST.hashString(this.seed) & 0xffff;
      const W = LAT_MAX - LAT_MIN;
      const gGeo = new THREE.PlaneGeometry(CHUNK_L, W, 25, 84);
      gGeo.rotateX(-Math.PI / 2);
      const cx = i * CHUNK_L + CHUNK_L / 2, cz = sgn * (LAT_MIN + W / 2);
      const pos = gGeo.attributes.position, cols = new Float32Array(pos.count * 3);
      for (let k = 0; k < pos.count; k++) {
        const wx = cx + pos.getX(k), wz = cz + pos.getZ(k);
        const macro = ST.fbm(wx / 260, wz / 260, seedN, 4);
        const patch = ST.fbm(wx / 45, wz / 45, seedN + 7, 3);
        const grassN = ST.fbm(wx / 90, wz / 90, seedN + 13, 3);
        const gm = ST.clamp((grassN - 0.45) * 3, 0, 1) * hab.grassAmt;
        for (let c = 0; c < 3; c++) {
          let v = ST.lerp(hab.soil[c], hab.soil2[c], macro);
          v = ST.lerp(v, hab.grass[c], gm);
          cols[k * 3 + c] = v * (0.88 + 0.24 * patch);
        }
      }
      gGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const ground = new THREE.Mesh(gGeo, this.groundMat);
      ground.position.set(cx, 0, cz);
      ground.receiveShadow = true;

      const grp = new THREE.Group();
      grp.add(ground);

      // Vegetation, deterministic per chunk
      const rng = ST.rng(this.seed + '|veg|' + i);
      const areaHa = CHUNK_L * W / 10000;
      const dummy = new THREE.Object3D();
      const col = new THREE.Color();
      const accept = (wx, lat) => {
        const n = ST.fbm(wx / 70, lat / 70, seedN + 29, 3);
        let p = ST.clamp(0.15 + (n - 0.35) * 2.2, 0.05, 1);
        if (lat > 700) p *= 0.5;
        return rng() < p;
      };
      const qShrub = this.quality === 'high' ? 1 : 0.5;
      const nShrubCand = Math.round(hab.shrubsPerHa * areaHa * 1.4 * qShrub);
      const shrubs = [];
      for (let k = 0; k < nShrubCand; k++) {
        const along = i * CHUNK_L + rng() * CHUNK_L, lat = rng.range(6, LAT_MAX);
        if (accept(along, lat)) shrubs.push([along, lat, rng.range(0.35, 1.15), rng(), rng()]);
      }
      if (shrubs.length) {
        const im = new THREE.InstancedMesh(this.shrubGeo, this.shrubMat, shrubs.length);
        shrubs.forEach(([along, lat, rr, a, b], k) => {
          dummy.position.set(along, rr * 0.3, sgn * lat);
          dummy.rotation.set(0, a * 6.28, 0);
          dummy.scale.set(rr * (0.9 + b * 0.3), rr * (0.55 + a * 0.25), rr);
          dummy.updateMatrix();
          im.setMatrixAt(k, dummy.matrix);
          const c = hab.shrubCols[Math.floor(a * hab.shrubCols.length)];
          col.setRGB(c[0] * (0.9 + b * 0.2), c[1] * (0.9 + b * 0.2), c[2] * (0.9 + b * 0.2));
          im.setColorAt(k, col);
        });
        im.castShadow = true; im.receiveShadow = false;
        grp.add(im);
      }
      // Grass tussocks and litter in the near field: the small-scale clutter that animals
      // are seen against. Only out to ~420 m, where they are still more than a pixel.
      const TUSS_LAT = 420;
      const nTuss = Math.round((hab.tussocksPerHa || 0) * CHUNK_L * TUSS_LAT / 10000 * qShrub);
      if (nTuss > 0) {
        const im = new THREE.InstancedMesh(this.tussockGeo, this.tussockMat, nTuss);
        const rng = ST.rng(this.seed + '|tussock|' + i);   // own stream: trees stay where they were
        let n = 0;
        for (let k = 0; k < nTuss; k++) {
          const along = i * CHUNK_L + rng() * CHUNK_L, lat = rng.range(4, TUSS_LAT);
          // clumped: more tussocks where the grass noise is high
          const gN = ST.fbm(along / 90, lat / 90, seedN + 13, 3);
          if (rng() > 0.25 + gN) continue;
          const rr = rng.range(0.18, 0.45), a = rng(), b = rng();
          dummy.position.set(along, rr * 0.15, sgn * lat);
          dummy.rotation.set(0, a * 6.28, 0);
          dummy.scale.set(rr * (0.9 + b * 0.4), rr * (0.45 + a * 0.3), rr);
          dummy.updateMatrix();
          im.setMatrixAt(n, dummy.matrix);
          const c = hab.grass, f = 0.82 + b * 0.3;
          col.setRGB(c[0] * f, c[1] * f, c[2] * f * 0.95);
          im.setColorAt(n, col);
          n++;
        }
        im.count = n;
        im.castShadow = false; im.receiveShadow = true;
        grp.add(im);
      }

      const nTreeCand = Math.round(hab.treesPerHa * areaHa * 1.4);
      const trees = [];
      for (let k = 0; k < nTreeCand; k++) {
        const along = i * CHUNK_L + rng() * CHUNK_L, lat = rng.range(8, LAT_MAX);
        if (accept(along, lat)) trees.push([along, lat, rng.range(5, 11), rng.range(2.4, 4.5), rng.int(4, 7), rng()]);
      }
      if (trees.length) {
        const trunks = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, trees.length);
        const nBlobs = trees.reduce((a, t) => a + t[4], 0);
        const can = new THREE.InstancedMesh(this.canopyGeo, this.canopyMat, nBlobs);
        let bi = 0;
        trees.forEach(([along, lat, h, cr, nb, v], k) => {
          dummy.position.set(along, h * 0.3, sgn * lat);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.18 + h * 0.012, h * 0.6, 0.18 + h * 0.012);
          dummy.updateMatrix(); trunks.setMatrixAt(k, dummy.matrix);
          const c = hab.treeCols[Math.floor(v * hab.treeCols.length)];
          for (let b = 0; b < nb; b++) {
            const a = rng() * 6.28, off = Math.sqrt(rng()) * cr * 0.85;
            dummy.position.set(along + Math.cos(a) * off, h * rng.range(0.5, 0.85), sgn * lat + Math.sin(a) * off);
            const sr = cr * rng.range(0.45, 0.75);
            dummy.scale.set(sr, sr * 0.8, sr);
            dummy.updateMatrix(); can.setMatrixAt(bi, dummy.matrix);
            const f = 0.85 + rng() * 0.25;
            col.setRGB(c[0] * f, c[1] * f, c[2] * f); can.setColorAt(bi, col);
            bi++;
          }
        });
        trunks.castShadow = true; can.castShadow = true;
        grp.add(trunks); grp.add(can);
      }
      this.scene.add(grp);
      return grp;
    }

    _disposeChunk(grp) {
      this.scene.remove(grp);
      grp.children.forEach(ch => {
        if (ch.isInstancedMesh) { if (ch.dispose) ch.dispose(); }
        else if (ch.geometry) ch.geometry.dispose();
      });
    }

    _updateChunks(s) {
      const i0 = Math.floor((s - VIEW_BEHIND) / CHUNK_L), i1 = Math.floor((s + VIEW_AHEAD) / CHUNK_L);
      for (const [i, grp] of this.chunks) {
        if (i < i0 || i > i1) { this._disposeChunk(grp); this.chunks.delete(i); }
      }
      let built = 0;
      for (let i = i0; i <= i1; i++) {
        if (!this.chunks.has(i)) {
          // Build at most two chunks per frame after start-up to avoid hitches
          if (built >= 2 && this.chunks.size > 4) break;
          this.chunks.set(i, this._makeChunk(i)); built++;
        }
      }
    }

    /** Build every chunk needed for t=0 (call before the first frame). */
    prewarm() {
      const i0 = Math.floor(-VIEW_BEHIND / CHUNK_L), i1 = Math.floor(VIEW_AHEAD / CHUNK_L);
      for (let i = i0; i <= i1; i++) if (!this.chunks.has(i)) this.chunks.set(i, this._makeChunk(i));
    }

    // ---- animals --------------------------------------------------------------
    _spawn(item) {
      const d = item.d, sgn = this.sgn;
      const root3 = new THREE.Group();
      root3.position.set(d.s, 0, sgn * d.X);
      const members = [];
      // Each member gets a flattened shadow copy, a sibling of its holder under root3
      // (root3 only translates in x/z, so projecting the holder's local matrix is exact).
      const addShadow = (objs) => {
        const sh = new THREE.Group();
        sh.matrixAutoUpdate = false;
        const copies = objs.map(o => { const c = shadowCopy(o, this.shadowMat); c.visible = o.visible; sh.add(c); return c; });
        root3.add(sh);
        return { sh, copies };
      };
      if (item.kind === 'group') {
        d.members.forEach(m => {
          const holder = new THREE.Group();
          holder.position.set(m.ds, 0, sgn * m.dx);
          const morphK = d.species === 'goat' ? 1 : (MORPH_SIZE[m.morph] || 1);
          holder.scale.setScalar(m.scale * morphK * this.boost);
          holder.rotation.y = m.yaw;
          let still, hop = null;
          if (d.species === 'goat') still = goat(m.morph);
          else {
            still = kangaroo(m.pose, m.morph, (m.phase % 1));
            if (d.flush) { hop = kangaroo('hop', m.morph, (m.phase % 1)); hop.visible = false; holder.add(hop); }
          }
          holder.add(still);
          root3.add(holder);
          const { sh, copies } = addShadow(hop ? [still, hop] : [still]);
          members.push({
            m, holder, still, hop, sh, shStill: copies[0], shHop: copies[1] || null,
            head: still.getObjectByName('head') || null,
            shHead: copies[0].getObjectByName('head') || null,
            goat: d.species === 'goat'
          });
        });
        this.groupObj.set(d.id, root3);
      } else {
        d.items.forEach(it => {
          const holder = distractorMesh(d.type, it);
          holder.position.set(it.ds, 0, sgn * it.dx);
          holder.scale.setScalar(it.scale * this.boost);
          holder.rotation.y = it.yaw;
          root3.add(holder);
          // The holder is the model itself, so the shadow copies its parts
          const { sh } = addShadow(holder.children);
          members.push({ m: it, holder, sh });
        });
      }
      this.scene.add(root3);
      const ent = { item, root3, members };
      this._updateShadows(ent);
      return ent;
    }

    /** Keep each projected shadow under its holder (after holders move). */
    _updateShadows(ent) {
      const P = this.shadowP;
      ent.members.forEach(mb => {
        mb.holder.updateMatrix();
        mb.sh.matrix.multiplyMatrices(P, mb.holder.matrix);
        mb.sh.matrixWorldNeedsUpdate = true;
        if (mb.hop) { mb.shHop.visible = mb.hop.visible; mb.shStill.visible = mb.still.visible; }
      });
    }

    /**
     * Small deterministic idle movements: grazers lift their heads every few
     * seconds, sitting animals look around. Motion is a strong detection cue.
     */
    _idle(ent, t) {
      ent.members.forEach(mb => {
        if (!mb.head || (mb.hop && mb.hop.visible)) return;
        const ph = mb.m.phase, pose = mb.m.pose;
        let rz = 0, ry = 0;
        if (mb.goat && ent.moving) {
          rz = 0; ry = 0;                 // trotting away, head up
        } else if (mb.goat) {
          // mostly head down grazing (pivot rz negative), occasionally up
          const period = 6 + (ph % 1) * 5, u = ((t + ph * 3) % period) / period;
          const up = u > 0.78 ? Math.sin((u - 0.78) / 0.22 * Math.PI) : 0;
          rz = -1.3 * (1 - up);
          ry = 0.25 * Math.sin(t * 0.5 + ph);
        } else if (pose === 'graze') {
          const period = 5 + (ph % 1) * 4, u = ((t + ph * 3) % period) / period;
          const up = u > 0.72 ? Math.sin((u - 0.72) / 0.28 * Math.PI) : 0;
          rz = 1.0 * up;
          ry = 0.2 * Math.sin(t * 0.7 + ph);
        } else {
          ry = 0.7 * Math.sin(t * 0.35 + ph) + 0.25 * Math.sin(t * 1.3 + ph * 2);
          rz = 0.1 * Math.sin(t * 0.5 + ph * 1.7);
        }
        mb.head.rotation.set(0, ry, rz);
        if (mb.shHead) mb.shHead.rotation.set(0, ry, rz);
      });
    }

    _animate(ent, t) {
      const d = ent.item.d, sgn = this.sgn;
      if (ent.item.kind === 'group' && d.flush) {
        const tf = (d.s - d.flush.leadM) / CFG.speedMs;
        if (t > tf) {
          const el = Math.min(t - tf, d.flush.durS);
          const hopping = t - tf < d.flush.durS;
          ent.moving = hopping;
          if (!hopping && ent.settled) return;
          ent.settled = !hopping; ent.moved = true;
          const dist = d.flush.speed * el;
          const wx = d.flush.dirA, wz = sgn * d.flush.dirX;
          const yaw = Math.atan2(-wz, wx);
          ent.members.forEach(({ m, holder, still, hop }) => {
            holder.position.set(m.ds + wx * dist, 0, sgn * m.dx + wz * dist);
            holder.rotation.y = yaw + (m.phase % 0.4) - 0.2;
            if (hop) {
              hop.visible = hopping; still.visible = !hopping;
              holder.position.y = hopping ? 0.45 * Math.abs(Math.sin(Math.PI * 2.2 * (t - tf) + m.phase)) * holder.scale.x : 0;
            } else {
              holder.position.y = 0;
            }
          });
        }
      } else if (ent.item.kind === 'distractor' && (d.type === 'emu' || d.type === 'sheep')) {
        const sp = d.type === 'emu' ? 0.9 : 0.25;
        ent.moved = true;
        ent.members.forEach(({ m, holder }) => {
          const dist = sp * (t - d.tEnter);
          holder.position.set(m.ds + Math.cos(m.yaw) * dist, 0, sgn * m.dx - Math.sin(m.yaw) * dist);
        });
      }
    }

    _updateAnimals(s, t) {
      while (this.nextItem < this.items.length && this.items[this.nextItem].d.s < s + VIEW_AHEAD) {
        this.active.push(this._spawn(this.items[this.nextItem]));
        this.nextItem++;
      }
      this.active = this.active.filter(ent => {
        if (ent.item.d.s < s - VIEW_BEHIND) {
          this.scene.remove(ent.root3);
          if (ent.item.kind === 'group') this.groupObj.delete(ent.item.d.id);
          return false;
        }
        ent.moved = false;
        this._animate(ent, t);
        if (ent.moved) this._updateShadows(ent);
        if (ent.item.kind === 'group') this._idle(ent, t);
        return true;
      });
    }

    // ---- per-frame update -------------------------------------------------------
    update(t) {
      const s = CFG.speedMs * t;
      this.planeS = s;
      const mo = this.sc.motion;
      const roll = ST.motionAt(mo.roll, t);       // + = right wing down
      const pitch = ST.motionAt(mo.pitch, t);     // + = nose up
      const alt = ST.motionAt(mo.alt, t);
      this.roll = roll;
      const cam = this.camera;
      cam.position.set(s, CFG.altitudeM + alt, this.sgn * CFG.eyeLateralM);
      cam.rotation.y = this.side === 'R' ? Math.PI : 0;
      // Looking sideways: aircraft roll tilts the view up/down (moves ground
      // relative to the strut markers); aircraft pitch rotates the image.
      cam.rotation.x = -(CFG.pitchDeg + this.sgn * roll) * deg;
      cam.rotation.z = this.sgn * pitch * deg;

      // Sun + shadow frustum follow the visible ground (snapped to reduce shimmer)
      const tx = Math.round((s + 40) / 2) * 2, tz = this.sgn * 230;
      this.sun.target.position.set(tx, 0, tz);
      this.sun.position.set(tx + this.sunDir.x * 1000, this.sunDir.y * 1000, tz + this.sunDir.z * 1000);

      this._updateChunks(s);
      this._updateAnimals(s, t);
    }

    render() { this.renderer.render(this.scene, this.camera); }

    /** Screen position (0..1) of a group's centre, or null if behind camera. */
    projectGroup(groupId) {
      const o = this.groupObj.get(groupId);
      if (!o) return null;
      const v = new THREE.Vector3();
      o.getWorldPosition(v); v.y += 0.6;
      v.project(this.camera);
      if (v.z > 1) return null;
      return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
    }

    dispose() {
      for (const [, grp] of this.chunks) this._disposeChunk(grp);
      this.chunks.clear();
      this.active.forEach(e => this.scene.remove(e.root3));
      this.soilTex.dispose();
      this.groundMat.dispose();
      this.renderer.dispose();
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
