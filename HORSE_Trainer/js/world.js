/* Horse Survey Trainer — 3D world (Three.js r128).
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
  const LAT_MIN = -80, LAT_MAX = 700;
  const TEX_M = 25;             // metres covered by one soil texture tile
  const VIEW_AHEAD = 800, VIEW_BEHIND = 700;

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

  // ---------------------------------------------------------------------------
  // Four-legged animals: one parametric builder for horses, foals, cattle and deer.
  // Model faces +x. Named pivots: 'head' (neck base; rotate z to lower/raise the
  // neck) and 'leg0'..'leg3' (front-left, front-right, hind-left, hind-right;
  // rotate z to swing). Shadow copies keep the names, so they animate the same way.
  // ---------------------------------------------------------------------------
  const QUAD = {
    horse: { bodyLen: 0.78, bodyR: 0.32, bodyW: 0.27, bodyY: 1.08, legLen: 0.92, legR: 0.05, legX: [0.52, -0.52], legZ: 0.14,
             neckBase: [0.62, 1.20], neckLen: 0.80, neckR: 0.14, neckA: 0.70, headLen: 0.30, headR: 0.11, headB: 0.95,
             tailLen: 0.75, tailR: 0.075, tailA: 0.30, mane: true },
    foal:  { bodyLen: 0.60, bodyR: 0.26, bodyW: 0.21, bodyY: 1.13, legLen: 1.00, legR: 0.05, legX: [0.40, -0.40], legZ: 0.12,
             neckBase: [0.48, 1.24], neckLen: 0.62, neckR: 0.12, neckA: 0.60, headLen: 0.27, headR: 0.10, headB: 0.85,
             tailLen: 0.40, tailR: 0.05, tailA: 0.35, mane: true },
    cattle: { bodyLen: 0.88, bodyR: 0.40, bodyW: 0.34, bodyY: 0.96, legLen: 0.70, legR: 0.07, legX: [0.56, -0.60], legZ: 0.17,
              neckBase: [0.74, 1.06], neckLen: 0.42, neckR: 0.22, neckA: 1.25, headLen: 0.26, headR: 0.14, headB: 0.65,
              tailLen: 0.75, tailR: 0.03, tailA: 0.10, mane: false },
    deer:  { bodyLen: 0.60, bodyR: 0.27, bodyW: 0.22, bodyY: 0.98, legLen: 0.84, legR: 0.04, legX: [0.42, -0.42], legZ: 0.11,
             neckBase: [0.50, 1.10], neckLen: 0.56, neckR: 0.10, neckA: 0.50, headLen: 0.22, headR: 0.09, headB: 0.80,
             tailLen: 0.20, tailR: 0.05, tailA: 0.45, mane: true }
  };

  function quadruped(sp, col) {
    const G = geo();
    const body = mat(col.body), mane = mat(col.mane), legs = mat(col.legs), hoof = mat(0x1d1915);
    const face = col.face ? mat(col.face) : body;
    const o = new THREE.Group();
    // body: barrel + shoulder + hindquarter
    part(o, G.sphere, body, sp.bodyLen, sp.bodyR, sp.bodyW, 0, sp.bodyY, 0);
    part(o, G.sphere, body, sp.bodyLen * 0.38, sp.bodyR * 1.05, sp.bodyW * 1.02, sp.bodyLen * 0.62, sp.bodyY + sp.bodyR * 0.05, 0);
    part(o, G.sphere, body, sp.bodyLen * 0.42, sp.bodyR * 1.08, sp.bodyW * 1.08, -sp.bodyLen * 0.6, sp.bodyY + sp.bodyR * 0.08, 0);
    // legs
    const legXs = [sp.legX[0], sp.legX[0], sp.legX[1], sp.legX[1]];
    legXs.forEach((lx, i) => {
      const z = (i % 2 === 0 ? 1 : -1) * sp.legZ;
      const leg = new THREE.Group();
      leg.name = 'leg' + i;
      leg.position.set(lx, sp.legLen, z);
      o.add(leg);
      const hind = i >= 2, L = sp.legLen;
      part(leg, G.sphere, body, hind ? 0.15 : 0.11, L * 0.3, hind ? 0.11 : 0.09, 0, -L * 0.1, 0);
      part(leg, G.cyl, legs, sp.legR, L * 0.78, sp.legR, 0, -L * 0.57, 0);
      part(leg, G.cyl, hoof, sp.legR * 1.3, L * 0.07, sp.legR * 1.3, 0, -L + L * 0.035, 0);
    });
    // neck + head on a pivot at the neck base
    const a = sp.neckA, L = sp.neckLen, ux = Math.sin(a), uy = Math.cos(a);
    const head = pivot(o, sp.neckBase[0], sp.neckBase[1], 0);
    part(head, G.cyl, body, sp.neckR, L, sp.neckR * 0.85, 0.5 * L * ux, 0.5 * L * uy, 0, -a);
    if (sp.mane) {
      part(head, G.box, mane, 0.05, L * 0.95, 0.045,
        0.5 * L * ux - uy * sp.neckR * 0.85, 0.5 * L * uy + ux * sp.neckR * 0.85, 0, -a);
    }
    const b = sp.headB, ex = L * ux, ey = L * uy;
    part(head, G.sphere, face, sp.headLen, sp.headR, sp.headR * 0.85,
      ex + sp.headLen * 0.75 * Math.cos(b), ey - sp.headLen * 0.75 * Math.sin(b), 0, -b);
    part(head, G.cone, mane, 0.03, 0.10, 0.025, ex - 0.02, ey + 0.06, 0.05, 0.2);
    part(head, G.cone, mane, 0.03, 0.10, 0.025, ex - 0.02, ey + 0.06, -0.05, 0.2);
    if (col.antlers) {
      const ant = mat(0x6b5a46);
      part(head, G.cone, ant, 0.025, 0.42, 0.025, ex, ey + 0.24, 0.08, 0.35);
      part(head, G.cone, ant, 0.025, 0.42, 0.025, ex, ey + 0.24, -0.08, 0.35);
    }
    // tail hangs down and back from the rump (taper: narrow end at the top)
    const ta = sp.tailA, tx = -sp.bodyLen * 0.98, ty = sp.bodyY + sp.bodyR * 0.45;
    part(o, G.taper, mane, sp.tailR, sp.tailLen, sp.tailR, tx - 0.5 * sp.tailLen * Math.sin(ta), ty - 0.5 * sp.tailLen * Math.cos(ta), 0, -ta);
    return o;
  }

  // Brumby coats: body, mane/tail, lower legs ("points")
  const COAT = {
    bay:      { body: 0x55301a, mane: 0x16110e, legs: 0x1c1612 },
    brown:    { body: 0x3f2717, mane: 0x17110d, legs: 0x22180f },
    chestnut: { body: 0x74401f, mane: 0x6a3818, legs: 0x683a1d },
    black:    { body: 0x1f1b19, mane: 0x121010, legs: 0x181514 },
    grey:     { body: 0xbcb7ae, mane: 0x8f8a84, legs: 0x77726b },
    buckskin: { body: 0xb48c55, mane: 0x1a1410, legs: 0x241b14 },
    palomino: { body: 0xbf9a58, mane: 0xece0c2, legs: 0xc09a58 }
  };

  function horse(m) {
    const c = COAT[m.coat] || COAT.bay;
    // foals are paler and fluffier-looking than their dams
    const col = m.foal ? { body: shade(c.body, 1.12), mane: shade(c.mane, 1.15), legs: shade(c.legs, 1.1) } : c;
    return quadruped(m.foal ? QUAD.foal : QUAD.horse, col);
  }

  function distractorMesh(type, item) {
    const G = geo();
    const v = item.v;
    if (type === 'cattle') {
      const coats = [{ body: 0x1c1a19, mane: 0x1c1a19, legs: 0x1c1a19 },
                     { body: 0x6b3418, mane: 0x6b3418, legs: 0x6b3418, face: 0xe8e2d6 },
                     { body: 0x7a3d1f, mane: 0x7a3d1f, legs: 0x6a3519 }];
      return quadruped(QUAD.cattle, coats[Math.floor(v * coats.length) % coats.length]);
    }
    if (type === 'deer') {
      const c = shade(0x4b3c2f, 0.9 + v * 0.2);
      return quadruped(QUAD.deer, { body: c, mane: 0x2e251e, legs: 0x3a2f26, antlers: v > 0.6 });
    }
    const o = new THREE.Group();
    if (type === 'wombat') {
      const m = mat(shade(0x4a4440, 0.9 + v * 0.2));
      part(o, G.sphere, m, 0.45, 0.26, 0.30, 0, 0.26, 0);
      part(o, G.sphere, m, 0.17, 0.14, 0.16, 0.44, 0.24, 0);
    } else if (type === 'rock') {
      const m = mat(v > 0.5 ? 0x8a8780 : 0x9d998f);
      part(o, G.dodec, m, 0.6 + v * 0.7, 0.4 + v * 0.4, 0.5 + v * 0.6, 0, 0.2, 0);
      if (v > 0.4) part(o, G.dodec, m, 0.4, 0.3, 0.35, 0.7, 0.12, 0.3);
    } else { // fallen log
      const m = mat(shade(0x8d8678, 0.85 + v * 0.3));
      const len = 4 + v * 7;
      part(o, G.cyl, m, 0.22, len, 0.22, 0, 0.22, 0, HALF_PI);
      part(o, G.cyl, m, 0.09, len * 0.3, 0.09, len * 0.2, 0.25, 0.4, HALF_PI, 0.6);
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
      const haze = new THREE.Color(this.hab.haze || 0xd9c8ad);
      scene.background = haze;
      scene.fog = new THREE.Fog(haze, 450, 1500);

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

      scene.add(new THREE.HemisphereLight(0xc4d6e8, this.hab.hemiGround || 0x8a5a3c, 0.48));
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
      this.trunkMat = new THREE.MeshLambertMaterial({ color: this.hab.trunk || 0x5f5247 });
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
        if (accept(along, lat)) trees.push([along, lat, rng.range(hab.treeH[0], hab.treeH[1]), rng.range(hab.crownR[0], hab.crownR[1]), rng.int(4, 7), rng()]);
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
          holder.scale.setScalar(m.scale * this.boost);
          holder.rotation.y = m.yaw;
          const still = horse(m);
          holder.add(still);
          root3.add(holder);
          const { sh, copies } = addShadow([still]);
          const legs = [0, 1, 2, 3].map(i => still.getObjectByName('leg' + i));
          const shLegs = [0, 1, 2, 3].map(i => copies[0].getObjectByName('leg' + i));
          members.push({
            m, holder, still, hop: null, sh, shStill: copies[0], shHop: null,
            head: still.getObjectByName('head') || null,
            shHead: copies[0].getObjectByName('head') || null,
            legs, shLegs
          });
        });
        // Running order when the band bolts: whoever is furthest in the run direction leads
        if (d.flush) {
          const wx = d.flush.dirA, wz = d.flush.dirX;
          members.slice().sort((a, b) => (b.m.ds * wx + b.m.dx * wz) - (a.m.ds * wx + a.m.dx * wz))
            .forEach((mb, i) => { mb.rank = i; });
        }
        this.groupObj.set(d.id, { root3, members });
      } else {
        d.items.forEach(it => {
          const holder = new THREE.Group();
          holder.add(distractorMesh(d.type, it));
          holder.position.set(it.ds, 0, sgn * it.dx);
          holder.scale.setScalar(it.scale * this.boost);
          holder.rotation.y = it.yaw;
          root3.add(holder);
          // The holder is the model itself, so the shadow copies its parts
          const { sh, copies } = addShadow(holder.children);
          const model = holder.children[0];
          members.push({
            m: it, holder, sh,
            legs: [0, 1, 2, 3].map(i => model.getObjectByName('leg' + i)).filter(Boolean),
            shLegs: [0, 1, 2, 3].map(i => copies[0].getObjectByName('leg' + i)).filter(Boolean)
          });
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
     * Small deterministic idle movements: grazing horses lift their heads every
     * few seconds, standing horses look around. A band that has just galloped
     * stands with heads up. Motion is a strong detection cue.
     */
    _idle(ent, t) {
      if (ent.moving) return;
      const alerted = ent.item.d.flush && ent.settled;
      ent.members.forEach(mb => {
        if (!mb.head) return;
        const ph = mb.m.phase, pose = alerted ? 'stand' : mb.m.pose;
        let rz, ry;
        if (pose === 'graze') {
          const period = 6 + (ph % 1) * 5, u = ((t + ph * 3) % period) / period;
          const up = u > 0.75 ? Math.sin((u - 0.75) / 0.25 * Math.PI) : 0;
          rz = -1.55 * (1 - up);
          ry = 0.2 * Math.sin(t * 0.6 + ph);
        } else {
          rz = 0.08 * Math.sin(t * 0.5 + ph * 1.7);
          ry = 0.45 * Math.sin(t * 0.35 + ph) + 0.15 * Math.sin(t * 1.2 + ph * 2);
        }
        mb.head.rotation.set(0, ry, rz);
        if (mb.shHead) mb.shHead.rotation.set(0, ry, rz);
      });
    }

    /** Swing legs: gait phases per leg (FL, FR, HL, HR), stride frequency f, amplitude amp (rad). */
    _legs(mb, cyc, amp, phases) {
      for (let i = 0; i < mb.legs.length; i++) {
        const r = amp * Math.sin(2 * Math.PI * (cyc + phases[i]));
        mb.legs[i].rotation.z = r;
        if (mb.shLegs[i]) mb.shLegs[i].rotation.z = r;
      }
    }

    _animate(ent, t) {
      const d = ent.item.d, sgn = this.sgn;
      if (ent.item.kind === 'group' && d.flush) {
        const mo = ST.groupMotion(d, t);
        if (mo.el <= 0) return;
        if (!mo.running && ent.settled) return;
        ent.settled = !mo.running; ent.moving = mo.running; ent.moved = true;
        const wx = d.flush.dirA, wz = sgn * d.flush.dirX;
        const yaw = Math.atan2(-wz, wx);
        const f = d.flush, el = mo.el;
        // effort 0..1: accelerating, galloping, pulling up
        const effort = !mo.running ? 0 : el < 1.5 ? el / 1.5 : el < f.durS ? 1 : Math.max(0, 1 - (el - f.durS) / 2);
        const k = ST.clamp(el / 3, 0, 1);            // bunch into a running file over ~3 s
        ent.members.forEach(mb => {
          const m = mb.m, rank = mb.rank || 0;
          const lat = ((rank % 3) - 1) * 1.4 + ((m.phase * 7) % 1 - 0.5) * 0.8;
          const back = rank * 2.4 * (m.foal ? 0.8 : 1);
          const fx = -back * wx - lat * wz, fz = -back * wz + lat * wx;
          const bx = m.ds, bz = sgn * m.dx;
          const cyc = 2.2 * el + m.phase;              // ~2.2 strides/s at the gallop
          const bob = 0.07 * effort * Math.abs(Math.sin(2 * Math.PI * cyc)) * mb.holder.scale.x;
          mb.holder.position.set(bx + (fx - bx) * k + mo.da, bob, bz + (fz - bz) * k + sgn * mo.dx);
          mb.holder.rotation.y = yaw + ((m.phase % 0.3) - 0.15) * (1 - effort * 0.6);
          this._legs(mb, cyc, 0.62 * effort, [0.5, 0.6, 0, 0.1]);
          if (mb.head) {
            const rz = mo.running ? -0.35 + 0.12 * Math.sin(2 * Math.PI * cyc) : 0;
            mb.head.rotation.set(0, 0, rz);
            if (mb.shHead) mb.shHead.rotation.set(0, 0, rz);
          }
        });
      } else if (ent.item.kind === 'distractor' && (d.type === 'deer' || d.type === 'cattle' || d.type === 'wombat')) {
        const sp = d.type === 'deer' ? 0.6 : d.type === 'cattle' ? 0.25 : 0.3;
        ent.moved = true;
        const el = Math.max(0, t - d.tEnter);
        ent.members.forEach(mb => {
          const { m, holder } = mb;
          const dist = sp * el;
          holder.position.set(m.ds + Math.cos(m.yaw) * dist, 0, sgn * m.dx - Math.sin(m.yaw) * dist);
          if (mb.legs && mb.legs.length) this._legs(mb, 0.9 * el + m.v, 0.25, [0, 0.5, 0.5, 0]);   // walk
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
      const tx = Math.round((s + 30) / 2) * 2, tz = this.sgn * 120;
      this.sun.target.position.set(tx, 0, tz);
      this.sun.position.set(tx + this.sunDir.x * 1000, this.sunDir.y * 1000, tz + this.sunDir.z * 1000);

      this._updateChunks(s);
      this._updateAnimals(s, t);
    }

    render() { this.renderer.render(this.scene, this.camera); }

    /** Screen position (0..1) of a group's centre (follows the band if it runs), or null if behind camera. */
    projectGroup(groupId) {
      const g = this.groupObj.get(groupId);
      if (!g) return null;
      const v = new THREE.Vector3();
      g.members.forEach(mb => { v.add(mb.holder.position); });
      v.multiplyScalar(1 / Math.max(1, g.members.length)).add(g.root3.position);
      v.y += 0.8;
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
