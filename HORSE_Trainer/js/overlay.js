/* Horse Survey Trainer — cabin overlay: helicopter door opening, door pillar
 * with bin tape, landing skid, glare, feedback rings. Markers are fixed to the
 * helicopter, so when it rolls the ground moves relative to them.
 */
(function (root) {
  'use strict';
  const ST = root.ST;
  const CFG = ST.CFG;

  ST.Overlay = class {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts;               // { side, seat:'Front'|'Rear', guides, labels, glare }
      this.staticLayer = document.createElement('canvas');
      this.rings = [];                // { groupId, until, colour }
    }

    resize(w, h) {
      this.canvas.width = w; this.canvas.height = h;
      this.staticLayer.width = w; this.staticLayer.height = h;
      this.w = w; this.h = h;
      this._drawStatic();
    }

    /** Window aperture in pixels. */
    aperture() {
      const w = this.w, h = this.h, ax = (1 - CFG.apertureNdcX) / 2;
      return { x0: w * ax, y0: h * 0.03, x1: w * (1 - ax), y1: h * 0.975, r: h * 0.11 };
    }

    _roundRect(g, x0, y0, x1, y1, r) {
      g.moveTo(x0 + r, y0);
      g.lineTo(x1 - r, y0); g.quadraticCurveTo(x1, y0, x1, y0 + r);
      g.lineTo(x1, y1 - r); g.quadraticCurveTo(x1, y1, x1 - r, y1);
      g.lineTo(x0 + r, y1); g.quadraticCurveTo(x0, y1, x0, y1 - r);
      g.lineTo(x0, y0 + r); g.quadraticCurveTo(x0, y0, x0 + r, y0);
    }

    _drawStatic() {
      const g = this.staticLayer.getContext('2d');
      const w = this.w, h = this.h, o = this.opts;
      const ap = this.aperture();
      const mirror = o.side === 'L';
      const X = fx => (mirror ? w - fx * w : fx * w);    // fractional x -> px, mirrored for left seats
      g.clearRect(0, 0, w, h);

      const bounds = ST.geom.boundaries();               // 20, 40, 60, 90, 120, 170
      const yOf = Xm => (1 - ST.geom.ndcY(Xm)) / 2 * h;

      // --- glare veil (sun on observer side) --------------------------------------
      if (o.glare) {
        const gr = g.createRadialGradient(w * 0.5, -h * 0.25, h * 0.1, w * 0.5, -h * 0.25, h * 1.1);
        gr.addColorStop(0, 'rgba(255,248,230,0.55)');
        gr.addColorStop(0.5, 'rgba(255,244,225,0.22)');
        gr.addColorStop(1, 'rgba(255,240,220,0.06)');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }

      // --- door pillar carrying the bin tape (near-vertical) -----------------------
      // Forward is toward the left for right-side seats. Rear seats look past the
      // pillar between the front and rear doors; the front seat has it aft.
      const rear = o.seat === 'Rear';
      const base = rear ? [0.115, 0.17] : [0.83, 0.885];   // x-range at the bottom edge
      const top = rear ? [0.15, 0.195] : [0.80, 0.845];    // x-range at the top edge
      const strutAt = (yPx, k) => {                          // k: 0 leading edge, 1 trailing edge
        const f = yPx / h;
        const xb = base[0] + (base[1] - base[0]) * k, xt = top[0] + (top[1] - top[0]) * k;
        return X(xt + (xb - xt) * f);
      };
      const sg = g.createLinearGradient(X(base[0]), 0, X(base[1]), 0);
      sg.addColorStop(0, '#2c2f33'); sg.addColorStop(0.4, '#55595f'); sg.addColorStop(1, '#25272b');
      g.fillStyle = sg;
      g.beginPath();
      g.moveTo(strutAt(0, 0), 0); g.lineTo(strutAt(0, 1), 0);
      g.lineTo(strutAt(h, 1), h); g.lineTo(strutAt(h, 0), h);
      g.closePath(); g.fill();

      // Bin colour tape between boundaries, along the strut's inboard face
      for (let i = 0; i < CFG.bins.length; i++) {
        const ya = yOf(bounds[i + 1]), yb = yOf(bounds[i]);
        g.fillStyle = CFG.bins[i].colour;
        g.beginPath();
        g.moveTo(strutAt(ya, 0.12), ya); g.lineTo(strutAt(ya, 0.55), ya);
        g.lineTo(strutAt(yb, 0.55), yb); g.lineTo(strutAt(yb, 0.12), yb);
        g.closePath(); g.fill();
      }
      // Boundary bands (red/white at the blind-strip edge and outer limit)
      bounds.forEach((Xm, i) => {
        const y = yOf(Xm), bh = Math.max(3, h * 0.006);
        const edge = i === 0 || i === bounds.length - 1;
        g.fillStyle = edge ? '#d42020' : '#ffffff';
        g.beginPath();
        g.moveTo(strutAt(y - bh, -0.05), y - bh); g.lineTo(strutAt(y - bh, 1.05), y - bh);
        g.lineTo(strutAt(y + bh, 1.05), y + bh); g.lineTo(strutAt(y + bh, -0.05), y + bh);
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.stroke();
      });

      // --- optional guide lines across the window ----------------------------------
      if (o.guides) {
        g.save();
        g.setLineDash([h * 0.012, h * 0.012]);
        g.lineWidth = Math.max(1, h * 0.0022);
        bounds.forEach((Xm, i) => {
          const y = yOf(Xm);
          g.strokeStyle = i === 0 || i === bounds.length - 1 ? 'rgba(230,40,40,0.55)' : 'rgba(255,255,255,0.45)';
          g.beginPath(); g.moveTo(ap.x0, y); g.lineTo(ap.x1, y); g.stroke();
        });
        g.restore();
      }

      // --- landing skid crossing the bottom of the view -----------------------------
      const skY = h * 0.935, skH = h * 0.03;
      const skg = g.createLinearGradient(0, skY - skH, 0, skY + skH);
      skg.addColorStop(0, '#5d6066'); skg.addColorStop(0.45, '#b9bcc0'); skg.addColorStop(1, '#3b3e42');
      g.fillStyle = skg;
      g.beginPath();
      g.moveTo(0, skY - skH * 0.6); g.lineTo(w, skY - skH * 0.2); g.lineTo(w, skY + skH * 1.0); g.lineTo(0, skY + skH * 0.6);
      g.closePath(); g.fill();

      // --- cabin wall with the door opening cut out ---------------------------------
      const wall = g.createLinearGradient(0, 0, 0, h);
      wall.addColorStop(0, '#4b4f55'); wall.addColorStop(1, '#2f3237');
      g.fillStyle = wall;
      g.beginPath();
      g.rect(0, 0, w, h);
      this._roundRect(g, ap.x0, ap.y0, ap.x1, ap.y1, ap.r);
      g.fill('evenodd');
      // window surround / bevel
      g.lineWidth = h * 0.018; g.strokeStyle = '#1f2125';
      g.beginPath(); this._roundRect(g, ap.x0, ap.y0, ap.x1, ap.y1, ap.r); g.stroke();
      g.lineWidth = h * 0.005; g.strokeStyle = '#121315';
      g.beginPath(); this._roundRect(g, ap.x0 + h * 0.008, ap.y0 + h * 0.008, ap.x1 - h * 0.008, ap.y1 - h * 0.008, ap.r * 0.92); g.stroke();

      // Tape ticks on the window frame (aft side) at each boundary
      const fx = mirror ? ap.x0 - h * 0.03 : ap.x1 - h * 0.004;
      bounds.forEach((Xm, i) => {
        const y = yOf(Xm);
        g.fillStyle = i === 0 || i === bounds.length - 1 ? '#d42020' : '#ffffff';
        g.fillRect(fx, y - h * 0.004, h * 0.034, h * 0.008);
      });
      for (let i = 0; i < CFG.bins.length; i++) {
        const ya = yOf(bounds[i + 1]), yb = yOf(bounds[i]);
        g.fillStyle = CFG.bins[i].colour;
        g.fillRect(fx + h * 0.008, ya + h * 0.006, h * 0.018, yb - ya - h * 0.012);
      }
      if (o.labels) {
        g.font = `${Math.round(h * 0.022)}px system-ui, sans-serif`;
        g.fillStyle = '#e8e8e8';
        g.textAlign = mirror ? 'right' : 'left';
        const lx = mirror ? fx - h * 0.006 : fx + h * 0.04;
        if (lx > 0 && lx < w) {
          for (let i = 0; i < CFG.bins.length; i++) {
            const ym = (yOf(bounds[i + 1]) + yOf(bounds[i])) / 2;
            g.fillText(CFG.bins[i].key, lx, ym + h * 0.008);
          }
        }
      }
    }

    addRing(groupId, colour, durS, now) {
      this.rings.push({ groupId, colour, until: now + durS });
    }

    draw(world, t) {
      const g = this.ctx, w = this.w, h = this.h;
      g.clearRect(0, 0, w, h);
      // Feedback rings are drawn under the cabin wall layer so they clip to the window
      this.rings = this.rings.filter(r => r.until > t);
      for (const r of this.rings) {
        const p = world.projectGroup(r.groupId);
        if (!p) continue;
        const a = Math.min(1, (r.until - t) / 0.4);
        g.strokeStyle = r.colour.replace('A', a.toFixed(2));
        g.lineWidth = Math.max(2, h * 0.004);
        g.beginPath(); g.arc(p.x * w, p.y * h, h * 0.045, 0, Math.PI * 2); g.stroke();
      }
      g.drawImage(this.staticLayer, 0, 0);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
