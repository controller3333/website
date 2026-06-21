/* engine.js — ParticleEngine: simulates an EffectSpec and renders to a canvas.
 *
 * The graph compiles to plain data (see nodes.js); this module owns all the
 * runtime: spawning, physics integration, over-life curves, and drawing.
 * Sprites are drawn procedurally and cached on small offscreen canvases keyed
 * by (shape, color, softness) for speed.
 */
(function (global) {
  'use strict';

  // ---------- math / random ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rangeVal(rng, r) { return Array.isArray(rng) ? lerp(rng[0], rng[1], r) : rng; }

  // ---------- value/curl noise (for turbulence) ----------
  function hash2(ix, iy) {
    let h = ix * 374761393 + iy * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy), b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  // curl of a scalar noise field -> divergence-free flow
  function curl(x, y) {
    const e = 0.5;
    const n1 = vnoise(x, y + e), n2 = vnoise(x, y - e);
    const n3 = vnoise(x + e, y), n4 = vnoise(x - e, y);
    return { x: (n1 - n2) / (2 * e), y: -(n3 - n4) / (2 * e) };
  }

  // ---------- color ----------
  function hexToRgb(hex) {
    hex = (hex || '#fff').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360 / 60;
    const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 1) { r = c; g = x; } else if (h < 2) { r = x; g = c; }
    else if (h < 3) { g = c; b = x; } else if (h < 4) { g = x; b = c; }
    else if (h < 5) { r = x; b = c; } else { r = c; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }
  function sampleGradient(stops, t) {
    if (!stops || !stops.length) return { r: 255, g: 255, b: 255 };
    const s = stops;
    if (t <= s[0].t) return hexToRgb(s[0].c);
    if (t >= s[s.length - 1].t) return hexToRgb(s[s.length - 1].c);
    for (let i = 0; i < s.length - 1; i++) {
      if (t >= s[i].t && t <= s[i + 1].t) {
        const f = (t - s[i].t) / Math.max(1e-6, s[i + 1].t - s[i].t);
        const a = hexToRgb(s[i].c), b = hexToRgb(s[i + 1].c);
        return { r: lerp(a.r, b.r, f), g: lerp(a.g, b.g, f), b: lerp(a.b, b.b, f) };
      }
    }
    return hexToRgb(s[s.length - 1].c);
  }
  // curve: {points:[{t,v}], from, to}; returns from..to scaled by piecewise-linear v
  function sampleCurve(cv, t) {
    if (!cv) return 1;
    const pts = cv.points || [{ t: 0, v: 1 }, { t: 1, v: 1 }];
    let v;
    if (t <= pts[0].t) v = pts[0].v;
    else if (t >= pts[pts.length - 1].t) v = pts[pts.length - 1].v;
    else {
      v = pts[pts.length - 1].v;
      for (let i = 0; i < pts.length - 1; i++) {
        if (t >= pts[i].t && t <= pts[i + 1].t) {
          const f = (t - pts[i].t) / Math.max(1e-6, pts[i + 1].t - pts[i].t);
          v = lerp(pts[i].v, pts[i + 1].v, f); break;
        }
      }
    }
    const from = cv.from == null ? 0 : cv.from, to = cv.to == null ? 1 : cv.to;
    return from + (to - from) * v;
  }

  // ---------- sprite cache ----------
  const spriteCache = {};
  function getSprite(shape, softness, r, g, b) {
    const key = shape + '|' + (softness | 0 ? '' : (softness || 0).toFixed(2)) + '|' + (r | 0) + ',' + (g | 0) + ',' + (b | 0);
    if (spriteCache[key]) return spriteCache[key];
    const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    const cx = S / 2, cy = S / 2, R = S / 2 - 2;
    const rgb = `${r | 0},${g | 0},${b | 0}`;
    x.clearRect(0, 0, S, S);
    if (shape === 'soft' || shape === 'circle') {
      const soft = shape === 'soft' ? Math.max(0.01, softness == null ? 0.6 : softness) : Math.max(0.0, softness || 0);
      const grad = x.createRadialGradient(cx, cy, 0, cx, cy, R);
      grad.addColorStop(0, `rgba(${rgb},1)`);
      grad.addColorStop(Math.max(0.001, 1 - soft), `rgba(${rgb},1)`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      x.fillStyle = grad; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fill();
    } else {
      x.fillStyle = `rgb(${rgb})`; x.strokeStyle = `rgb(${rgb})`;
      x.lineWidth = R * 0.35; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath();
      if (shape === 'square') { x.rect(cx - R * 0.8, cy - R * 0.8, R * 1.6, R * 1.6); x.fill(); }
      else if (shape === 'triangle') { poly(x, cx, cy, R, 3, -Math.PI / 2); x.fill(); }
      else if (shape === 'star') { star(x, cx, cy, R, R * 0.45, 5); x.fill(); }
      else if (shape === 'ring') { x.lineWidth = R * 0.28; x.arc(cx, cy, R * 0.75, 0, TAU); x.stroke(); }
      else if (shape === 'plus') { x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R); x.stroke(); }
      else if (shape === 'spark') { x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.stroke(); }
      else { x.arc(cx, cy, R, 0, TAU); x.fill(); }
    }
    spriteCache[key] = c;
    return c;
  }
  function poly(x, cx, cy, R, sides, rot) {
    for (let i = 0; i < sides; i++) {
      const a = rot + i / sides * TAU;
      const px = cx + Math.cos(a) * R, py = cy + Math.sin(a) * R;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath();
  }
  function star(x, cx, cy, R, r, points) {
    for (let i = 0; i < points * 2; i++) {
      const rad = i % 2 ? r : R;
      const a = -Math.PI / 2 + i / (points * 2) * TAU;
      const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath();
  }

  // emoji/text glyphs cached on their own canvases (color baked into the glyph)
  const emojiCache = {};
  function getEmoji(text) {
    const key = text || '?';
    if (emojiCache[key]) return emojiCache[key];
    const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.font = (S * 0.8) + 'px serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(key, S / 2, S / 2 + 2);
    emojiCache[key] = c;
    return c;
  }

  const BLEND = { add: 'lighter', lighter: 'lighter', screen: 'screen', normal: 'source-over' };

  // ---------- Particle pool ----------
  function makeParticle() {
    return { alive: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1,
      size0: 4, size: 4, rot: 0, spin: 0, r: 255, g: 255, b: 255, a0: 1, a: 1, em: 0, seed: 0 };
  }

  class ParticleEngine {
    constructor() {
      this.spec = { background: '#0a0a12', emitters: [], persistence: 0, timeScale: 1 };
      this.particles = [];
      this.pool = [];
      this.time = 0;
      this.emState = [];   // per-emitter accumulator/state
      this.rng = mulberry32(12345);
      this.count = 0;
    }

    setSpec(spec) {
      this.spec = spec || this.spec;
      this._resetEmitters();
    }

    _resetEmitters() {
      this.emState = (this.spec.emitters || []).map(() => ({ acc: 0, emitted: 0, bursted: false }));
    }

    reset() {
      for (const p of this.particles) { p.alive = false; this.pool.push(p); }
      this.particles.length = 0;
      this.time = 0;
      this.count = 0;
      this.rng = mulberry32(0x1234 + ((Math.random() * 1e6) | 0));
      this._resetEmitters();
      // prewarm: fast-forward each emitter's prewarm seconds
      let maxPre = 0;
      for (const em of (this.spec.emitters || [])) maxPre = Math.max(maxPre, em.prewarm || 0);
      if (maxPre > 0) {
        const dt = 1 / 60;
        for (let t = 0; t < maxPre; t += dt) this.step(dt, true);
      }
    }

    _spawn() {
      let p = this.pool.pop();
      if (!p) p = makeParticle();
      p.alive = true;
      this.particles.push(p);
      this.count++;
      return p;
    }

    _emitParticle(emIdx, em) {
      const rng = this.rng;
      const p = this._spawn();
      p.em = emIdx;
      p.age = 0;
      p.seed = rng() * 1000;
      // ---- shape: position + outward normal ----
      let px = 0, py = 0, nx = 0, ny = -1;
      const sh = em.shape;
      if (sh) {
        if (sh.kind === 'point') { const a = rng() * TAU; nx = Math.cos(a); ny = Math.sin(a); }
        else if (sh.kind === 'circle') {
          const a = rng() * TAU;
          const rr = sh.edge ? sh.radius : sh.radius * Math.sqrt(rng());
          px = Math.cos(a) * rr; py = Math.sin(a) * rr;
          nx = Math.cos(a); ny = Math.sin(a);
        } else if (sh.kind === 'ring') {
          const lo = (sh.arc ? sh.arc[0] : 0) * DEG, hi = (sh.arc ? sh.arc[1] : 360) * DEG;
          const a = lerp(lo, hi, rng());
          const rr = sh.radius + (rng() - 0.5) * sh.thickness;
          px = Math.cos(a) * rr; py = Math.sin(a) * rr;
          nx = Math.cos(a); ny = Math.sin(a);
        } else if (sh.kind === 'cone') {
          const base = sh.angle * DEG + (rng() - 0.5) * sh.spread * DEG;
          nx = Math.cos(base); ny = Math.sin(base);
          const rr = sh.radius * rng();
          px = nx * rr; py = ny * rr;
        } else if (sh.kind === 'box') {
          if (sh.edge) {
            const w = sh.width, h = sh.height;
            if (rng() < w / (w + h)) { px = (rng() - 0.5) * w; py = (rng() < 0.5 ? -0.5 : 0.5) * h; }
            else { px = (rng() < 0.5 ? -0.5 : 0.5) * w; py = (rng() - 0.5) * h; }
          } else { px = (rng() - 0.5) * sh.width; py = (rng() - 0.5) * sh.height; }
          const a = rng() * TAU; nx = Math.cos(a); ny = Math.sin(a);
        } else if (sh.kind === 'line') {
          const a = sh.angle * DEG, t = (rng() - 0.5) * sh.length;
          px = Math.cos(a) * t; py = Math.sin(a) * t;
          nx = -Math.sin(a); ny = Math.cos(a);
        }
      } else { const a = rng() * TAU; nx = Math.cos(a); ny = Math.sin(a); }
      p.x = (em.ox || 0) + px;
      p.y = (em.oy || 0) + py;
      p._nx = nx; p._ny = ny;       // remember normal for radial force
      p._px = px; p._py = py;

      // ---- init defaults ----
      p.vx = 0; p.vy = 0;
      p.size0 = 4; p.life = 1;
      p.r = 255; p.g = 255; p.b = 255; p.a0 = 1;
      p.rot = 0; p.spin = 0;
      let speedSet = false;

      for (const m of em.inits) {
        if (m.prop === 'speed') {
          const sp = rangeVal(m.speed, rng());
          let dx, dy;
          if (m.mode === 'shape') { dx = nx; dy = ny; }
          else if (m.mode === 'angle') { const a = m.angle * DEG + (rng() - 0.5) * m.spread * DEG; dx = Math.cos(a); dy = Math.sin(a); }
          else { const a = rng() * TAU; dx = Math.cos(a); dy = Math.sin(a); }
          p.vx += dx * sp; p.vy += dy * sp; speedSet = true;
        } else if (m.prop === 'velocity') {
          p.vx += rangeVal(m.vx, rng()); p.vy += rangeVal(m.vy, rng()); speedSet = true;
        } else if (m.prop === 'size') {
          p.size0 = rangeVal(m.size, rng());
        } else if (m.prop === 'life') {
          p.life = Math.max(0.02, rangeVal(m.life, rng()));
        } else if (m.prop === 'color') {
          let c;
          if (m.random) { const a = hexToRgb(m.color), b = hexToRgb(m.colorB); const f = rng(); c = { r: lerp(a.r, b.r, f), g: lerp(a.g, b.g, f), b: lerp(a.b, b.b, f) }; }
          else c = hexToRgb(m.color);
          p.r = c.r; p.g = c.g; p.b = c.b; p.a0 = m.alpha == null ? 1 : m.alpha;
        } else if (m.prop === 'colorHSV') {
          const c = hsvToRgb(rangeVal(m.hue, rng()), rangeVal(m.sat, rng()), rangeVal(m.val, rng()));
          p.r = c.r; p.g = c.g; p.b = c.b; p.a0 = m.alpha == null ? 1 : m.alpha;
        } else if (m.prop === 'rotation') {
          p.rot = rangeVal(m.rotation, rng()) * DEG;
          p.spin = rangeVal(m.spin, rng()) * DEG;
        }
      }
      p.size = p.size0;
      p.a = p.a0;
      // base color stored for over-life multiply
      p._r0 = p.r; p._g0 = p.g; p._b0 = p.b;
      return p;
    }

    // advance the simulation by dt seconds
    step(dt, silent) {
      dt *= (this.spec.timeScale || 1);
      if (dt <= 0) return;
      this.time += dt;
      const emitters = this.spec.emitters || [];

      // ---- spawn ----
      for (let ei = 0; ei < emitters.length; ei++) {
        const em = emitters[ei];
        const st = this.emState[ei] || (this.emState[ei] = { acc: 0, emitted: 0, bursted: false });
        const local = this.time - (em.delay || 0);
        if (local < 0) continue;
        const dur = em.duration || 0;          // 0 = continuous
        const within = dur <= 0 ? true : (em.loop ? true : local <= dur);
        // burst (once per loop cycle)
        if (em.burst > 0) {
          const cycle = dur > 0 ? dur : 1e9;
          const phase = em.loop && dur > 0 ? Math.floor(local / cycle) : 0;
          if (st.burstPhase !== phase && (em.loop || phase === 0)) {
            st.burstPhase = phase;
            for (let i = 0; i < em.burst && this._emCount(ei) < em.max; i++) this._emitParticle(ei, em);
          }
        }
        // continuous rate
        if (em.rate > 0 && within) {
          const inEmit = dur <= 0 ? true : ((em.loop ? (local % dur) : local) <= dur);
          if (inEmit) {
            st.acc += em.rate * dt;
            let n = Math.floor(st.acc);
            st.acc -= n;
            while (n-- > 0 && this._emCount(ei) < em.max) this._emitParticle(ei, em);
          }
        }
      }

      // ---- update ----
      const tNoise = this.time;
      const arr = this.particles;
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        const em = emitters[p.em]; if (!em) { this._kill(i); continue; }
        p.age += dt;
        if (p.age >= p.life) { this._kill(i); continue; }
        const t = p.age / p.life;

        // forces
        for (const f of em.forces) {
          if (f.kind === 'gravity') { p.vx += f.gx * dt; p.vy += f.gy * dt; }
          else if (f.kind === 'drag') { const d = Math.max(0, 1 - f.drag * dt); p.vx *= d; p.vy *= d; }
          else if (f.kind === 'turbulence') {
            const c = curl(p.x * f.scale + tNoise * f.speed, p.y * f.scale - tNoise * f.speed);
            p.vx += (c.x - 0.5) * 2 * f.strength * dt;
            p.vy += (c.y - 0.5) * 2 * f.strength * dt;
          } else if (f.kind === 'wind') {
            const a = f.angle * DEG;
            const g = 1 + (vnoise(p.seed, tNoise * 0.7) - 0.5) * 2 * f.gust;
            p.vx += Math.cos(a) * f.strength * g * dt;
            p.vy += Math.sin(a) * f.strength * g * dt;
          } else if (f.kind === 'attractor') {
            const dx = (em.ox + f.x) - p.x, dy = (em.oy + f.y) - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy) + 1e-3;
            const fall = Math.max(0, 1 - dist / f.radius);
            const a = f.strength * fall / dist;
            p.vx += dx * a * dt; p.vy += dy * a * dt;
          } else if (f.kind === 'vortex') {
            const dx = p.x - (em.ox + f.x), dy = p.y - (em.oy + f.y);
            const dist = Math.sqrt(dx * dx + dy * dy) + 1e-3;
            p.vx += (-dy / dist) * f.strength * dt - (dx / dist) * f.strength * f.inward * dt;
            p.vy += (dx / dist) * f.strength * dt - (dy / dist) * f.strength * f.inward * dt;
          } else if (f.kind === 'radial') {
            const dx = p.x - em.ox, dy = p.y - em.oy;
            const dist = Math.sqrt(dx * dx + dy * dy) + 1e-3;
            p.vx += (dx / dist) * f.strength * dt; p.vy += (dy / dist) * f.strength * dt;
          } else if (f.kind === 'bounce') {
            const floor = em.oy + f.floor;
            if (p.y > floor && p.vy > 0) { p.y = floor; p.vy = -p.vy * f.bounce; p.vx *= (1 - f.friction); }
          }
        }

        // over-life
        let sizeScale = 1, velScale = 1, alphaScale = 1, colored = false;
        for (const o of em.overlife) {
          if (o.prop === 'size') sizeScale = sampleCurve(o.curve, t);
          else if (o.prop === 'velocity') velScale = sampleCurve(o.curve, t);
          else if (o.prop === 'alpha') alphaScale = sampleCurve(o.curve, t);
          else if (o.prop === 'color') {
            const c = sampleGradient(o.gradient, t);
            p.r = c.r; p.g = c.g; p.b = c.b; colored = true;
          }
        }
        if (!colored) { p.r = p._r0; p.g = p._g0; p.b = p._b0; }

        // integrate
        p.x += p.vx * velScale * dt;
        p.y += p.vy * velScale * dt;
        p.rot += p.spin * dt;
        p.size = p.size0 * sizeScale;
        p.a = p.a0 * alphaScale;
      }
    }

    _emCount(ei) {
      // approximate live count for this emitter (cheap enough for our caps)
      let c = 0; const arr = this.particles;
      for (let i = 0; i < arr.length; i++) if (arr[i].em === ei) c++;
      return c;
    }
    _kill(i) {
      const p = this.particles[i];
      p.alive = false;
      this.pool.push(p);
      const last = this.particles.pop();
      if (i < this.particles.length) this.particles[i] = last;
      this.count--;
    }

    // render to a 2D context. cx,cy = effect origin in canvas pixels; scale = zoom.
    render(ctx, w, h, cx, cy, scale) {
      scale = scale || 1;
      const emitters = this.spec.emitters || [];
      const arr = this.particles;
      // group draws by blend to minimize state changes
      const byBlend = {};
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        const em = emitters[p.em]; if (!em || !em.render) continue;
        const b = em.render.blend || 'add';
        (byBlend[b] || (byBlend[b] = [])).push(p);
      }
      for (const b in byBlend) {
        ctx.globalCompositeOperation = BLEND[b] || 'lighter';
        const list = byBlend[b];
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          const em = emitters[p.em]; const rd = em.render;
          if (p.a <= 0.003 || p.size <= 0.05) continue;
          const isEmoji = rd.shape === 'emoji';
          const sprite = isEmoji ? getEmoji(rd.emoji) : getSprite(rd.shape, rd.softness, p.r, p.g, p.b);
          const sx = cx + p.x * scale, sy = cy + p.y * scale;
          let drawR = p.size * scale;
          ctx.globalAlpha = Math.min(1, p.a);
          ctx.save();
          ctx.translate(sx, sy);
          // velocity stretch / spark orientation
          if (rd.stretch > 0 || rd.shape === 'spark') {
            const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            const ang = Math.atan2(p.vy, p.vx);
            ctx.rotate(ang);
            const stretch = 1 + (rd.stretch || 0) * Math.min(4, sp / 200);
            const sw = drawR * 2 * stretch, sh = drawR * 2;
            if (rd.glow > 0) { ctx.shadowColor = `rgb(${p.r | 0},${p.g | 0},${p.b | 0})`; ctx.shadowBlur = drawR * rd.glow * 2; }
            ctx.drawImage(sprite, -sw / 2, -sh / 2, sw, sh);
          } else {
            ctx.rotate(p.rot);
            if (rd.glow > 0) { ctx.shadowColor = `rgb(${p.r | 0},${p.g | 0},${p.b | 0})`; ctx.shadowBlur = drawR * rd.glow * 2; }
            const d = drawR * 2;
            ctx.drawImage(sprite, -drawR, -drawR, d, d);
          }
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  global.ParticleEngine = ParticleEngine;
  global.VFXUtil = { sampleGradient, sampleCurve, hexToRgb };
})(window);
