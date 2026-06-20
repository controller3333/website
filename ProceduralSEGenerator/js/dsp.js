/* dsp.js — DSP engine & node-type definitions.
 *
 * Every connection carries a mono Float32Array buffer of length ctx.length.
 * Each node type exposes:
 *   category, title, color, inputs[], outputs[], params[]
 *   process(node, ins, ctx) -> { portName: Float32Array }
 *
 * ctx = { sampleRate, length, duration }
 * ins[portName] = Float32Array | null   (null = unconnected)
 * node.params   = { paramName: value }
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;

  // ---- small helpers ---------------------------------------------------
  function buf(ctx) { return new Float32Array(ctx.length); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function p(node, name, def) {
    const v = node.params[name];
    return (v === undefined || v === null) ? def : v;
  }

  // Biquad (RBJ cookbook). Recomputes coeffs each call so cutoff can vary.
  function biquadCoeffs(type, f0, Q, sr) {
    f0 = clamp(f0, 10, sr * 0.49);
    Q = Math.max(0.0001, Q);
    const w0 = TAU * f0 / sr;
    const cw = Math.cos(w0), sw = Math.sin(w0);
    const alpha = sw / (2 * Q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'highpass') {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === 'bandpass') {
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else { // lowpass
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }

  // ADSR helper: level at time t (seconds), gate = note-on length.
  function adsrLevel(t, a, d, s, r, gate) {
    if (t < gate) {
      if (t < a) return a > 0 ? t / a : 1;
      if (t < a + d) return d > 0 ? 1 - (1 - s) * ((t - a) / d) : s;
      return s;
    }
    // release: figure level at gate moment
    let gl;
    if (gate < a) gl = a > 0 ? gate / a : 1;
    else if (gate < a + d) gl = d > 0 ? 1 - (1 - s) * ((gate - a) / d) : s;
    else gl = s;
    if (r <= 0) return 0;
    const rel = 1 - (t - gate) / r;
    return rel > 0 ? gl * rel : 0;
  }

  // deterministic-ish PRNG so renders are stable per-seed
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // wave shape from normalized phase [0,1)
  function waveSample(wave, ph) {
    switch (wave) {
      case 'square': return ph < 0.5 ? 1 : -1;
      case 'saw': return 2 * ph - 1;
      case 'triangle': return ph < 0.5 ? (4 * ph - 1) : (3 - 4 * ph);
      case 'sine':
      default: return Math.sin(TAU * ph);
    }
  }

  // ---- stereo signal helpers ------------------------------------------
  // A signal is either a Float32Array (mono) or { stereo:true, l, r }.
  function isStereo(s) { return !!(s && s.stereo); }
  function toMono(s) {
    if (!s) return null;
    if (!s.stereo) return s;
    const n = s.l.length, m = new Float32Array(n);
    for (let i = 0; i < n; i++) m[i] = (s.l[i] + s.r[i]) * 0.5;
    return m;
  }

  // ---- node type registry ---------------------------------------------
  const TYPES = {

    // ===== SOURCES =====
    oscillator: {
      category: 'Source', title: 'オシレーター', color: '#3b82f6',
      inputs: [{ name: 'fm', label: 'FM' }, { name: 'pm', label: 'PM' }],
      outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'wave', type: 'select', label: '波形', options: ['sine', 'square', 'saw', 'triangle'], default: 'sine' },
        { name: 'freq', type: 'number', label: '周波数', min: 20, max: 8000, step: 1, default: 440, unit: 'Hz', log: true },
        { name: 'fmAmount', type: 'number', label: 'FM量', min: 0, max: 4000, step: 1, default: 200, unit: 'Hz' },
        { name: 'pmAmount', type: 'number', label: 'PM量', min: 0, max: 4, step: 0.01, default: 1 },
        { name: 'voices', type: 'number', label: 'ユニゾン', min: 1, max: 7, step: 1, default: 1 },
        { name: 'detune', type: 'number', label: 'デチューン', min: 0, max: 50, step: 0.5, default: 12, unit: 'ct' },
      ],
      process(node, ins, ctx) {
        const out = buf(ctx);
        const wave = p(node, 'wave', 'sine');
        const f0 = p(node, 'freq', 440) * (ctx.pitchMul || 1);
        const fmAmt = p(node, 'fmAmount', 0);
        const pmAmt = p(node, 'pmAmount', 1);
        const fm = ins.fm, pm = ins.pm;
        const sr = ctx.sampleRate;
        const voices = Math.max(1, Math.min(7, Math.round(p(node, 'voices', 1))));
        const detune = p(node, 'detune', 0);
        // per-voice detune ratio (symmetric spread) + initial phase offset
        const ratios = new Array(voices), phases = new Array(voices);
        for (let v = 0; v < voices; v++) {
          const off = voices > 1 ? (v / (voices - 1)) * 2 - 1 : 0;
          ratios[v] = Math.pow(2, (off * detune) / 1200);
          phases[v] = (v * 0.137) % 1;
        }
        const norm = 1 / Math.sqrt(voices);
        for (let i = 0; i < out.length; i++) {
          const fmv = fm ? fm[i] * fmAmt : 0;
          const pmv = pm ? pm[i] * pmAmt : 0;
          let s = 0;
          for (let v = 0; v < voices; v++) {
            let f = (f0 + fmv) * ratios[v];
            if (f < 0) f = 0;
            phases[v] += f / sr; phases[v] -= Math.floor(phases[v]);
            let phase = phases[v] + pmv; phase -= Math.floor(phase);
            s += waveSample(wave, phase);
          }
          out[i] = s * norm;
        }
        return { out };
      }
    },

    noise: {
      category: 'Source', title: 'ノイズ', color: '#6366f1',
      inputs: [], outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'color', type: 'select', label: '色', options: ['white', 'pink', 'brown'], default: 'white' },
        { name: 'seed', type: 'number', label: 'シード', min: 0, max: 9999, step: 1, default: 1 },
      ],
      process(node, ins, ctx) {
        const out = buf(ctx);
        const color = p(node, 'color', 'white');
        const rnd = mulberry32((p(node, 'seed', 1) + (ctx.seedOffset || 0)) * 2654435761 + 12345);
        if (color === 'pink') {
          let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
          for (let i = 0; i < out.length; i++) {
            const w = rnd() * 2 - 1;
            b0 = 0.99886 * b0 + w * 0.0555179;
            b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.96900 * b2 + w * 0.1538520;
            b3 = 0.86650 * b3 + w * 0.3104856;
            b4 = 0.55000 * b4 + w * 0.5329522;
            b5 = -0.7616 * b5 - w * 0.0168980;
            out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
            b6 = w * 0.115926;
          }
        } else if (color === 'brown') {
          let last = 0;
          for (let i = 0; i < out.length; i++) {
            const w = rnd() * 2 - 1;
            last = (last + 0.02 * w) / 1.02;
            out[i] = last * 3.5;
          }
        } else {
          for (let i = 0; i < out.length; i++) out[i] = rnd() * 2 - 1;
        }
        return { out };
      }
    },

    // ===== MODULATION / CONTROL =====
    lfo: {
      category: 'Modulation', title: 'LFO', color: '#a855f7',
      inputs: [], outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'wave', type: 'select', label: '波形', options: ['sine', 'triangle', 'saw', 'square'], default: 'sine' },
        { name: 'rate', type: 'number', label: '速度', min: 0.1, max: 200, step: 0.1, default: 6, unit: 'Hz', log: true },
        { name: 'depth', type: 'number', label: '深さ', min: 0, max: 1, step: 0.01, default: 1 },
        { name: 'offset', type: 'number', label: '中心', min: -1, max: 1, step: 0.01, default: 0 },
      ],
      process(node, ins, ctx) {
        const out = buf(ctx);
        const wave = p(node, 'wave', 'sine');
        const rate = p(node, 'rate', 6);
        const depth = p(node, 'depth', 1);
        const offset = p(node, 'offset', 0);
        const sr = ctx.sampleRate;
        let ph = 0;
        for (let i = 0; i < out.length; i++) {
          ph += rate / sr; ph -= Math.floor(ph);
          out[i] = clamp(waveSample(wave, ph) * depth + offset, -1, 1);
        }
        return { out };
      }
    },

    envelope: {
      category: 'Modulation', title: 'エンベロープ(ADSR)', color: '#ec4899',
      inputs: [{ name: 'in', label: '入力' }], outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'attack', type: 'number', label: '立上り', min: 0, max: 2, step: 0.001, default: 0.005, unit: 's' },
        { name: 'decay', type: 'number', label: '減衰', min: 0, max: 2, step: 0.001, default: 0.08, unit: 's' },
        { name: 'sustain', type: 'number', label: '保持', min: 0, max: 1, step: 0.01, default: 0.0 },
        { name: 'release', type: 'number', label: '余韻', min: 0, max: 4, step: 0.001, default: 0.1, unit: 's' },
        { name: 'gate', type: 'number', label: 'ゲート', min: 0, max: 10, step: 0.01, default: 0.15, unit: 's' },
      ],
      process(node, ins, ctx) {
        const out = buf(ctx);
        const a = p(node, 'attack', 0.005), d = p(node, 'decay', 0.08);
        const s = p(node, 'sustain', 0), r = p(node, 'release', 0.1);
        const gate = p(node, 'gate', 0.15);
        const inb = ins.in;
        const sr = ctx.sampleRate;
        for (let i = 0; i < out.length; i++) {
          const env = adsrLevel(i / sr, a, d, s, r, gate);
          out[i] = inb ? inb[i] * env : env;
        }
        return { out };
      }
    },

    sweep: {
      category: 'Modulation', title: 'スイープ', color: '#d946ef',
      inputs: [], outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'start', type: 'number', label: '開始値', min: -2000, max: 4000, step: 1, default: 1 },
        { name: 'end', type: 'number', label: '終了値', min: -2000, max: 4000, step: 1, default: 0 },
        { name: 'time', type: 'number', label: '時間', min: 0.001, max: 10, step: 0.001, default: 0.2, unit: 's' },
        { name: 'curve', type: 'select', label: 'カーブ', options: ['linear', 'exp', 'log'], default: 'exp' },
      ],
      process(node, ins, ctx) {
        const out = buf(ctx);
        const start = p(node, 'start', 1), end = p(node, 'end', 0);
        const time = p(node, 'time', 0.2), curve = p(node, 'curve', 'exp');
        const sr = ctx.sampleRate;
        const nT = Math.max(1, time * sr);
        for (let i = 0; i < out.length; i++) {
          let t = i / nT; if (t > 1) t = 1;
          let k = t;
          if (curve === 'exp') k = t * t;
          else if (curve === 'log') k = Math.sqrt(t);
          out[i] = start + (end - start) * k;
        }
        return { out };
      }
    },

    samplehold: {
      category: 'Modulation', title: 'サンプル&ホールド', color: '#c026d3',
      inputs: [{ name: 'in', label: '入力' }], outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'rate', type: 'number', label: '速度', min: 1, max: 4000, step: 1, default: 24, unit: 'Hz', log: true },
        { name: 'glide', type: 'number', label: '滑り', min: 0, max: 0.999, step: 0.001, default: 0 },
        { name: 'seed', type: 'number', label: 'シード', min: 0, max: 9999, step: 1, default: 1 },
      ],
      // Steps the input (or, if unconnected, an internal random source) at `rate`.
      // Classic for retro stepped pitch/filter modulation; feed into Osc FM or Filter CV.
      process(node, ins, ctx) {
        const out = buf(ctx);
        const sr = ctx.sampleRate;
        const rate = p(node, 'rate', 24);
        const stepN = Math.max(1, Math.round(sr / rate));
        const glide = p(node, 'glide', 0);
        const inb = ins.in;
        const rnd = mulberry32((p(node, 'seed', 1) + (ctx.seedOffset || 0)) * 40503 + 7);
        const k = glide <= 0 ? 1 : (1 - glide);
        let held = inb ? inb[0] : rnd() * 2 - 1;
        let cur = held;
        for (let i = 0; i < out.length; i++) {
          if (i % stepN === 0) held = inb ? inb[i] : rnd() * 2 - 1;
          cur += (held - cur) * k;
          out[i] = cur;
        }
        return { out };
      }
    },

    // ===== PROCESSORS =====
    gain: {
      category: 'Processor', title: 'ゲイン/アンプ', color: '#10b981',
      inputs: [{ name: 'in', label: '入力' }, { name: 'cv', label: 'CV' }],
      outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'gain', type: 'number', label: '倍率', min: 0, max: 4, step: 0.01, default: 1 },
      ],
      process(node, ins, ctx) {
        const out = buf(ctx);
        const g = p(node, 'gain', 1);
        const inb = ins.in, cv = ins.cv;
        if (!inb) return { out };
        for (let i = 0; i < out.length; i++) out[i] = inb[i] * g * (cv ? cv[i] : 1);
        return { out };
      }
    },

    filter: {
      category: 'Processor', title: 'フィルター', color: '#14b8a6',
      inputs: [{ name: 'in', label: '入力' }, { name: 'cv', label: 'カットCV' }],
      outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'type', type: 'select', label: '種類', options: ['lowpass', 'highpass', 'bandpass'], default: 'lowpass' },
        { name: 'cutoff', type: 'number', label: 'カット', min: 20, max: 18000, step: 1, default: 1200, unit: 'Hz', log: true },
        { name: 'q', type: 'number', label: 'Q', min: 0.1, max: 24, step: 0.1, default: 1 },
        { name: 'cvAmount', type: 'number', label: 'CV量', min: 0, max: 16000, step: 1, default: 4000, unit: 'Hz' },
      ],
      process(node, ins, ctx) {
        const out = buf(ctx);
        const inb = ins.in;
        if (!inb) return { out };
        const type = p(node, 'type', 'lowpass');
        const cutoff = p(node, 'cutoff', 1200);
        const Q = p(node, 'q', 1);
        const cvAmt = p(node, 'cvAmount', 0);
        const cv = ins.cv;
        const sr = ctx.sampleRate;
        let z1 = 0, z2 = 0;
        let co = biquadCoeffs(type, cutoff, Q, sr);
        let lastCut = cutoff;
        for (let i = 0; i < out.length; i++) {
          if (cv) {
            const c = clamp(cutoff + cv[i] * cvAmt, 10, sr * 0.49);
            if (Math.abs(c - lastCut) > 1) { co = biquadCoeffs(type, c, Q, sr); lastCut = c; }
          }
          const x = inb[i];
          const y = co[0] * x + z1;
          z1 = co[1] * x - co[3] * y + z2;
          z2 = co[2] * x - co[4] * y;
          out[i] = y;
        }
        return { out };
      }
    },

    distortion: {
      category: 'Processor', title: '歪み', color: '#f97316',
      inputs: [{ name: 'in', label: '入力' }], outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'mode', type: 'select', label: 'モード', options: ['tanh', 'clip', 'fold'], default: 'tanh' },
        { name: 'drive', type: 'number', label: '強さ', min: 1, max: 50, step: 0.1, default: 4 },
        { name: 'mix', type: 'number', label: '混ぜ', min: 0, max: 1, step: 0.01, default: 1 },
      ],
      process(node, ins, ctx) {
        const out = buf(ctx);
        const inb = ins.in;
        if (!inb) return { out };
        const mode = p(node, 'mode', 'tanh');
        const drive = p(node, 'drive', 4);
        const mix = p(node, 'mix', 1);
        for (let i = 0; i < out.length; i++) {
          const x = inb[i] * drive;
          let y;
          if (mode === 'clip') y = clamp(x, -1, 1);
          else if (mode === 'fold') { y = x; while (y > 1 || y < -1) y = y > 1 ? 2 - y : -2 - y; }
          else y = Math.tanh(x);
          out[i] = inb[i] * (1 - mix) + y * mix;
        }
        return { out };
      }
    },

    bitcrush: {
      category: 'Processor', title: 'ビットクラッシュ', color: '#eab308',
      inputs: [{ name: 'in', label: '入力' }], outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'bits', type: 'number', label: 'ビット', min: 1, max: 16, step: 1, default: 6 },
        { name: 'reduction', type: 'number', label: '間引き', min: 1, max: 64, step: 1, default: 8 },
      ],
      process(node, ins, ctx) {
        const out = buf(ctx);
        const inb = ins.in;
        if (!inb) return { out };
        const bits = p(node, 'bits', 6);
        const red = Math.max(1, Math.round(p(node, 'reduction', 8)));
        const levels = Math.pow(2, bits);
        let hold = 0;
        for (let i = 0; i < out.length; i++) {
          if (i % red === 0) hold = Math.round(inb[i] * levels) / levels;
          out[i] = hold;
        }
        return { out };
      }
    },

    timeshift: {
      category: 'Processor', title: 'タイムシフト', color: '#0d9488',
      inputs: [{ name: 'in', label: '入力' }], outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'offset', type: 'number', label: '遅延', min: 0, max: 5, step: 0.001, default: 0.2, unit: 's' },
      ],
      // Pure latency: delays the whole input later in time (zero-pad the front).
      // Lets a whole layer be positioned on the timeline — e.g. trigger a burst
      // at an exact moment to sync with a visual event.
      process(node, ins, ctx) {
        const out = buf(ctx);
        const inb = ins.in;
        if (!inb) return { out };
        const dN = Math.round(p(node, 'offset', 0) * ctx.sampleRate);
        for (let i = 0; i < out.length; i++) out[i] = i >= dN ? inb[i - dN] : 0;
        return { out };
      }
    },

    delay: {
      category: 'Processor', title: 'ディレイ/エコー', color: '#0ea5e9',
      inputs: [{ name: 'in', label: '入力' }], outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'time', type: 'number', label: '時間', min: 0.001, max: 1, step: 0.001, default: 0.12, unit: 's' },
        { name: 'feedback', type: 'number', label: '反復', min: 0, max: 0.95, step: 0.01, default: 0.4 },
        { name: 'mix', type: 'number', label: '混ぜ', min: 0, max: 1, step: 0.01, default: 0.35 },
      ],
      process(node, ins, ctx) {
        const out = buf(ctx);
        const inb = ins.in;
        if (!inb) return { out };
        const sr = ctx.sampleRate;
        const dN = Math.max(1, Math.round(p(node, 'time', 0.12) * sr));
        const fb = p(node, 'feedback', 0.4);
        const mix = p(node, 'mix', 0.35);
        const line = new Float32Array(dN);
        let wi = 0;
        for (let i = 0; i < out.length; i++) {
          const echo = line[wi];
          const x = inb[i];
          line[wi] = x + echo * fb;
          out[i] = x * (1 - mix) + echo * mix;
          wi = (wi + 1) % dN;
        }
        return { out };
      }
    },

    reverb: {
      category: 'Processor', title: 'リバーブ', color: '#0891b2',
      inputs: [{ name: 'in', label: '入力' }], outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'size', type: 'number', label: '広さ', min: 0.1, max: 1, step: 0.01, default: 0.6 },
        { name: 'damp', type: 'number', label: '吸音', min: 0, max: 1, step: 0.01, default: 0.4 },
        { name: 'mix', type: 'number', label: '混ぜ', min: 0, max: 1, step: 0.01, default: 0.3 },
      ],
      process(node, ins, ctx) {
        const out = buf(ctx);
        const inb = ins.in;
        if (!inb) return { out };
        const sr = ctx.sampleRate;
        const size = p(node, 'size', 0.6);
        const damp = p(node, 'damp', 0.4);
        const mix = p(node, 'mix', 0.3);
        // 4 feedback comb filters + cheap output (Schroeder-ish)
        const tunings = [1116, 1188, 1277, 1356].map(t => Math.max(1, Math.round(t * sr / 44100)));
        const fb = 0.5 + size * 0.48;
        const combs = tunings.map(n => ({ b: new Float32Array(n), i: 0, store: 0 }));
        for (let i = 0; i < out.length; i++) {
          let wet = 0;
          const x = inb[i];
          for (let c = 0; c < combs.length; c++) {
            const cb = combs[c];
            const y = cb.b[cb.i];
            cb.store = y * (1 - damp) + cb.store * damp;
            cb.b[cb.i] = x + cb.store * fb;
            cb.i = (cb.i + 1) % cb.b.length;
            wet += y;
          }
          wet *= 0.25;
          out[i] = x * (1 - mix) + wet * mix;
        }
        return { out };
      }
    },

    // ===== COMBINERS =====
    mixer: {
      category: 'Combiner', title: 'ミキサー', color: '#84cc16', stereoAware: true,
      inputs: [{ name: 'a', label: 'A' }, { name: 'b', label: 'B' }, { name: 'c', label: 'C' }, { name: 'd', label: 'D' }],
      outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'levelA', type: 'number', label: 'A音量', min: 0, max: 2, step: 0.01, default: 1 },
        { name: 'levelB', type: 'number', label: 'B音量', min: 0, max: 2, step: 0.01, default: 1 },
        { name: 'levelC', type: 'number', label: 'C音量', min: 0, max: 2, step: 0.01, default: 1 },
        { name: 'levelD', type: 'number', label: 'D音量', min: 0, max: 2, step: 0.01, default: 1 },
      ],
      process(node, ins, ctx) {
        const chans = [['a', 'levelA'], ['b', 'levelB'], ['c', 'levelC'], ['d', 'levelD']];
        let anyStereo = false;
        for (const [ch] of chans) if (isStereo(ins[ch])) anyStereo = true;
        if (!anyStereo) {
          const out = buf(ctx);
          for (const [ch, lv] of chans) {
            const b = ins[ch]; if (!b) continue;
            const g = p(node, lv, 1);
            for (let i = 0; i < out.length; i++) out[i] += b[i] * g;
          }
          return { out };
        }
        const L = buf(ctx), R = buf(ctx);
        for (const [ch, lv] of chans) {
          const b = ins[ch]; if (!b) continue;
          const g = p(node, lv, 1);
          if (isStereo(b)) for (let i = 0; i < L.length; i++) { L[i] += b.l[i] * g; R[i] += b.r[i] * g; }
          else for (let i = 0; i < L.length; i++) { const v = b[i] * g; L[i] += v; R[i] += v; }
        }
        return { out: { stereo: true, l: L, r: R } };
      }
    },

    ringmod: {
      category: 'Combiner', title: 'リング変調', color: '#65a30d',
      inputs: [{ name: 'a', label: 'A' }, { name: 'b', label: 'B' }],
      outputs: [{ name: 'out', label: '出力' }],
      params: [],
      process(node, ins, ctx) {
        const out = buf(ctx);
        const a = ins.a, b = ins.b;
        if (!a || !b) return { out };
        for (let i = 0; i < out.length; i++) out[i] = a[i] * b[i];
        return { out };
      }
    },

    // ===== STEREO =====
    panner: {
      category: 'Stereo', title: 'パンナー', color: '#22d3ee', stereoAware: true,
      inputs: [{ name: 'in', label: '入力' }, { name: 'cv', label: 'パンCV' }],
      outputs: [{ name: 'out', label: '出力' }],
      params: [
        { name: 'pan', type: 'number', label: 'パン', min: -1, max: 1, step: 0.01, default: 0 },
        { name: 'cvAmount', type: 'number', label: 'CV量', min: 0, max: 1, step: 0.01, default: 1 },
        { name: 'spread', type: 'number', label: '広がり', min: 0, max: 20, step: 0.1, default: 0, unit: 'ms' },
      ],
      // mono -> stereo. Equal-power pan with optional Pan CV (e.g. an LFO/Sweep
      // for auto-pan) and a Haas-style width (small delay on one channel).
      process(node, ins, ctx) {
        const L = buf(ctx), R = buf(ctx);
        const inb = toMono(ins.in);
        if (!inb) return { out: { stereo: true, l: L, r: R } };
        const panP = p(node, 'pan', 0);
        const cvAmt = p(node, 'cvAmount', 1);
        const cv = toMono(ins.cv);
        for (let i = 0; i < L.length; i++) {
          const pan = clamp(panP + (cv ? cv[i] * cvAmt : 0), -1, 1);
          const a = (pan + 1) * 0.25 * Math.PI;
          const x = inb[i];
          L[i] = x * Math.cos(a);
          R[i] = x * Math.sin(a);
        }
        const dN = Math.round(p(node, 'spread', 0) / 1000 * ctx.sampleRate);
        if (dN > 0) {
          const R2 = buf(ctx);
          for (let i = 0; i < R.length; i++) R2[i] = i >= dN ? R[i - dN] : 0;
          return { out: { stereo: true, l: L, r: R2 } };
        }
        return { out: { stereo: true, l: L, r: R } };
      }
    },

    // ===== OUTPUT =====
    output: {
      category: 'Output', title: '出力', color: '#ef4444', singleton: true, stereoAware: true,
      inputs: [{ name: 'in', label: '入力' }], outputs: [],
      params: [
        { name: 'gain', type: 'number', label: 'マスター', min: 0, max: 2, step: 0.01, default: 0.9 },
        { name: 'normalize', type: 'toggle', label: '正規化', default: false },
      ],
      process(node, ins, ctx) {
        const inb = ins.in;
        const g = p(node, 'gain', 0.9);
        const norm = p(node, 'normalize', false);
        if (isStereo(inb)) {
          const L = buf(ctx), R = buf(ctx);
          for (let i = 0; i < L.length; i++) { L[i] = inb.l[i] * g; R[i] = inb.r[i] * g; }
          if (norm) {
            let peak = 0;
            for (let i = 0; i < L.length; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > peak) peak = a; }
            if (peak > 1e-6) { const k = 0.98 / peak; for (let i = 0; i < L.length; i++) { L[i] *= k; R[i] *= k; } }
          }
          for (let i = 0; i < L.length; i++) { L[i] = clamp(L[i], -1, 1); R[i] = clamp(R[i], -1, 1); }
          return { out: { stereo: true, l: L, r: R } };
        }
        const out = buf(ctx);
        if (inb) for (let i = 0; i < out.length; i++) out[i] = inb[i] * g;
        if (norm) {
          let peak = 0;
          for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
          if (peak > 1e-6) { const k = 0.98 / peak; for (let i = 0; i < out.length; i++) out[i] *= k; }
        }
        for (let i = 0; i < out.length; i++) out[i] = clamp(out[i], -1, 1);
        return { out };
      }
    },
  };

  global.DSP = { TYPES, helpers: { clamp, biquadCoeffs, adsrLevel, mulberry32, waveSample, isStereo, toMono } };
})(window);
