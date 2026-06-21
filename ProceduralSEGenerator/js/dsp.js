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
  // gainDb is only used by peaking / lowshelf / highshelf.
  function biquadCoeffs(type, f0, Q, sr, gainDb) {
    f0 = clamp(f0, 10, sr * 0.49);
    Q = Math.max(0.0001, Q);
    const w0 = TAU * f0 / sr;
    const cw = Math.cos(w0), sw = Math.sin(w0);
    const alpha = sw / (2 * Q);
    const A = Math.pow(10, (gainDb || 0) / 40); // shelf/peak amplitude
    let b0, b1, b2, a0, a1, a2;
    if (type === 'highpass') {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === 'bandpass') {
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === 'notch') {
      b0 = 1; b1 = -2 * cw; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === 'peaking') {
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    } else if (type === 'lowshelf') {
      const sa = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + sa);
      b1 = 2 * A * ((A - 1) - (A + 1) * cw);
      b2 = A * ((A + 1) - (A - 1) * cw - sa);
      a0 = (A + 1) + (A - 1) * cw + sa;
      a1 = -2 * ((A - 1) + (A + 1) * cw);
      a2 = (A + 1) + (A - 1) * cw - sa;
    } else if (type === 'highshelf') {
      const sa = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + sa);
      b1 = -2 * A * ((A - 1) + (A + 1) * cw);
      b2 = A * ((A + 1) + (A - 1) * cw - sa);
      a0 = (A + 1) - (A - 1) * cw + sa;
      a1 = 2 * ((A - 1) - (A + 1) * cw);
      a2 = (A + 1) - (A - 1) * cw - sa;
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

  // parse a text param "0.1, 0.5 0.9" -> [0.1,0.5,0.9] (comma/space separated)
  function parseNums(str) {
    if (str === undefined || str === null) return [];
    return String(str).split(/[\s,]+/).map(parseFloat).filter(v => !isNaN(v));
  }
  // parse "t:level" pairs "0:0, 0.02:1, 0.3:0" -> [[0,0],[0.02,1],[0.3,0]]
  function parsePairs(str) {
    if (str === undefined || str === null) return [];
    return String(str).split(/[\s,]+/).map(tok => {
      const m = tok.split(':');
      const t = parseFloat(m[0]), v = parseFloat(m[1]);
      return (isNaN(t) || isNaN(v)) ? null : [t, v];
    }).filter(Boolean);
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
      category: 'Source', title: 'Oscillator', color: '#3b82f6',
      inputs: [{ name: 'fm', label: 'FM' }, { name: 'pm', label: 'PM' }],
      outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'wave', type: 'select', label: 'Wave', options: ['sine', 'square', 'saw', 'triangle'], default: 'sine' },
        { name: 'freq', type: 'number', label: 'Freq', min: 20, max: 8000, step: 1, default: 440, unit: 'Hz', log: true },
        { name: 'fmAmount', type: 'number', label: 'FM Amt', min: 0, max: 4000, step: 1, default: 200, unit: 'Hz' },
        { name: 'pmAmount', type: 'number', label: 'PM Amt', min: 0, max: 4, step: 0.01, default: 1 },
        { name: 'voices', type: 'number', label: 'Unison', min: 1, max: 7, step: 1, default: 1 },
        { name: 'detune', type: 'number', label: 'Detune', min: 0, max: 50, step: 0.5, default: 12, unit: 'ct' },
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
      category: 'Source', title: 'Noise', color: '#6366f1',
      inputs: [], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'color', type: 'select', label: 'Color', options: ['white', 'pink', 'brown'], default: 'white' },
        { name: 'seed', type: 'number', label: 'Seed', min: 0, max: 9999, step: 1, default: 1 },
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

    karplus: {
      category: 'Source', title: 'Pluck (Karplus)', color: '#8b5cf6',
      inputs: [{ name: 'trig', label: 'Trig' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'freq', type: 'number', label: 'Freq', min: 40, max: 4000, step: 1, default: 220, unit: 'Hz', log: true },
        { name: 'decay', type: 'number', label: 'Decay', min: 0.05, max: 6, step: 0.01, default: 1.2, unit: 's' },
        { name: 'damping', type: 'number', label: 'Damping', min: 0, max: 1, step: 0.01, default: 0.4 },
        { name: 'exciter', type: 'select', label: 'Exciter', options: ['noise', 'impulse'], default: 'noise' },
        { name: 'seed', type: 'number', label: 'Seed', min: 0, max: 9999, step: 1, default: 1 },
      ],
      // Karplus-Strong: a short exciter fills a delay line tuned to `freq`,
      // then a damped feedback loop makes it ring & decay like a plucked string
      // / mallet / "boing". Optional `trig` input re-excites on rising edges.
      process(node, ins, ctx) {
        const out = buf(ctx);
        const sr = ctx.sampleRate;
        const freq = p(node, 'freq', 220) * (ctx.pitchMul || 1);
        const decay = p(node, 'decay', 1.2);
        const damping = clamp(p(node, 'damping', 0.4), 0, 1);
        const exciter = p(node, 'exciter', 'noise');
        const rnd = mulberry32((p(node, 'seed', 1) + (ctx.seedOffset || 0)) * 668265263 + 91);
        const dN = Math.max(2, Math.round(sr / freq));
        const line = new Float32Array(dN);
        // feedback per sample so the ring decays to ~ -60dB over `decay` seconds
        const fb = Math.pow(0.001, dN / (decay * sr));
        const lp = 0.5 + damping * 0.49; // low-pass averaging weight (more = duller)
        const trig = ins.trig;
        let prevTrig = 0, idx = 0, last = 0;
        const excite = () => { for (let k = 0; k < dN; k++) line[k] = exciter === 'impulse' ? (k === 0 ? 1 : 0) : (rnd() * 2 - 1); };
        excite();
        for (let i = 0; i < out.length; i++) {
          if (trig) { const t = trig[i]; if (t > 0.5 && prevTrig <= 0.5) { excite(); idx = 0; last = 0; } prevTrig = t; }
          const cur = line[idx];
          const filtered = lp * cur + (1 - lp) * last; // one-pole damping
          last = filtered;
          line[idx] = filtered * fb;
          out[i] = cur;
          idx = (idx + 1) % dN;
        }
        return { out };
      }
    },

    granular: {
      category: 'Source', title: 'Granular / Particles', color: '#7c3aed',
      inputs: [{ name: 'density', label: 'Density CV' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'density', type: 'number', label: 'Density', min: 1, max: 2000, step: 1, default: 120, unit: '/s', log: true },
        { name: 'grainLen', type: 'number', label: 'Grain', min: 0.001, max: 0.2, step: 0.001, default: 0.02, unit: 's' },
        { name: 'cutoff', type: 'number', label: 'Tone', min: 100, max: 16000, step: 1, default: 3000, unit: 'Hz', log: true },
        { name: 'q', type: 'number', label: 'Q', min: 0.3, max: 16, step: 0.1, default: 2 },
        { name: 'pitchSpread', type: 'number', label: 'Spread', min: 0, max: 1, step: 0.01, default: 0.5 },
        { name: 'seed', type: 'number', label: 'Seed', min: 0, max: 9999, step: 1, default: 1 },
      ],
      // Scatters short band-passed noise grains at a given density — fire crackle,
      // rain, debris, electric sparks, Geiger. `density` CV (0..1) scales rate.
      process(node, ins, ctx) {
        const out = buf(ctx);
        const sr = ctx.sampleRate;
        const baseDensity = p(node, 'density', 120);
        const grainN = Math.max(2, Math.round(p(node, 'grainLen', 0.02) * sr));
        const cutoff = p(node, 'cutoff', 3000);
        const Q = p(node, 'q', 2);
        const spread = clamp(p(node, 'pitchSpread', 0.5), 0, 1);
        const rnd = mulberry32((p(node, 'seed', 1) + (ctx.seedOffset || 0)) * 2246822519 + 3);
        const dcv = ins.density;
        for (let i = 0; i < out.length; i++) {
          const dens = baseDensity * (dcv ? clamp(dcv[i], 0, 4) : 1);
          if (rnd() < dens / sr) {
            // spawn one grain: band-passed noise burst with a hann window
            const fc = clamp(cutoff * Math.pow(2, (rnd() * 2 - 1) * spread * 2), 30, sr * 0.49);
            const co = biquadCoeffs('bandpass', fc, Q, sr);
            const amp = 0.5 + rnd() * 0.5;
            let z1 = 0, z2 = 0;
            const gl = Math.min(grainN, out.length - i);
            for (let k = 0; k < gl; k++) {
              const x = rnd() * 2 - 1;
              const y = co[0] * x + z1;
              z1 = co[1] * x - co[3] * y + z2;
              z2 = co[2] * x - co[4] * y;
              const win = 0.5 - 0.5 * Math.cos(TAU * k / grainN); // hann
              out[i + k] += y * win * amp;
            }
          }
        }
        return { out };
      }
    },

    fmop: {
      category: 'Source', title: 'FM Operator', color: '#2563eb',
      inputs: [{ name: 'trig', label: 'Trig' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'freq', type: 'number', label: 'Freq', min: 20, max: 8000, step: 1, default: 220, unit: 'Hz', log: true },
        { name: 'ratio', type: 'number', label: 'Ratio', min: 0.1, max: 8, step: 0.01, default: 1.41 },
        { name: 'index', type: 'number', label: 'Index', min: 0, max: 20, step: 0.1, default: 6 },
        { name: 'indexDecay', type: 'number', label: 'Idx Decay', min: 0.01, max: 4, step: 0.01, default: 0.5, unit: 's' },
        { name: 'feedback', type: 'number', label: 'Feedback', min: 0, max: 1, step: 0.01, default: 0 },
      ],
      // 2-operator FM: a modulator sine phase-modulates a carrier sine. Integer
      // `ratio` = harmonic/brassy, inharmonic (1.41, 3.5…) = bell/metal/sci-fi.
      // `index` (mod depth) decays over `indexDecay` for a struck-bell attack.
      // `trig` re-strikes the index envelope on rising edges.
      process(node, ins, ctx) {
        const out = buf(ctx);
        const sr = ctx.sampleRate;
        const f0 = p(node, 'freq', 220) * (ctx.pitchMul || 1);
        const ratio = p(node, 'ratio', 1.41);
        const index = p(node, 'index', 6);
        const idxDecay = p(node, 'indexDecay', 0.5);
        const fb = clamp(p(node, 'feedback', 0), 0, 1);
        const trig = ins.trig;
        let cPh = 0, mPh = 0, lastMod = 0, t = 0, prevTrig = 0;
        const cInc = f0 / sr, mInc = f0 * ratio / sr;
        for (let i = 0; i < out.length; i++) {
          if (trig) { const tv = trig[i]; if (tv > 0.5 && prevTrig <= 0.5) t = 0; prevTrig = tv; }
          const idx = index * Math.exp(-t / idxDecay);
          const mod = Math.sin(TAU * mPh + fb * lastMod);
          lastMod = mod;
          out[i] = Math.sin(TAU * cPh + idx * mod);
          cPh += cInc; cPh -= Math.floor(cPh);
          mPh += mInc; mPh -= Math.floor(mPh);
          t += 1 / sr;
        }
        return { out };
      }
    },

    modal: {
      category: 'Source', title: 'Modal / Mallet', color: '#1d4ed8',
      inputs: [{ name: 'trig', label: 'Trig' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'freq', type: 'number', label: 'Freq', min: 20, max: 6000, step: 1, default: 440, unit: 'Hz', log: true },
        { name: 'structure', type: 'select', label: 'Body', options: ['harmonic', 'bar', 'bell', 'glass', 'membrane', 'metal'], default: 'bell' },
        { name: 'partials', type: 'number', label: 'Partials', min: 1, max: 8, step: 1, default: 6 },
        { name: 'decay', type: 'number', label: 'Decay', min: 0.02, max: 6, step: 0.01, default: 1.2, unit: 's' },
        { name: 'damping', type: 'number', label: 'Damping', min: 0, max: 1, step: 0.01, default: 0.4 },
      ],
      // Sum of inharmonic, exponentially-decaying sine partials = a struck object
      // (bell / glass / metal bar / ceramic / drum). The self-ringing counterpart
      // to Resonator. `trig` re-strikes on rising edges.
      process(node, ins, ctx) {
        const out = buf(ctx);
        const sr = ctx.sampleRate;
        const f0 = p(node, 'freq', 440) * (ctx.pitchMul || 1);
        const structure = p(node, 'structure', 'bell');
        const np = Math.max(1, Math.min(8, Math.round(p(node, 'partials', 6))));
        const decay = p(node, 'decay', 1.2);
        const damping = clamp(p(node, 'damping', 0.4), 0, 1);
        const RATIOS = {
          harmonic: [1, 2, 3, 4, 5, 6, 7, 8],
          bar: [1, 2.76, 5.40, 8.93, 13.34, 18.64, 24.82, 31.87],
          bell: [1, 2.0, 2.4, 3.0, 4.5, 5.33, 6.67, 8.0],
          glass: [1, 2.32, 4.25, 6.63, 9.38, 12.5, 16.0, 20.0],
          membrane: [1, 1.59, 2.14, 2.30, 2.65, 2.92, 3.16, 3.5],
          metal: [1, 1.73, 2.41, 3.14, 4.07, 5.18, 6.44, 7.83],
        };
        const ratios = RATIOS[structure] || RATIOS.bell;
        const phases = new Array(np).fill(0);
        const incs = new Array(np), amps = new Array(np), decs = new Array(np);
        let norm = 0;
        for (let pi = 0; pi < np; pi++) {
          incs[pi] = (f0 * ratios[pi]) / sr;
          amps[pi] = 1 / (pi + 1);
          decs[pi] = decay * Math.pow(1 - damping * 0.8, pi); // higher partials decay faster
          norm += amps[pi];
        }
        norm = 1 / norm;
        const trig = ins.trig;
        let t = 0, prevTrig = 0;
        for (let i = 0; i < out.length; i++) {
          if (trig) { const tv = trig[i]; if (tv > 0.5 && prevTrig <= 0.5) { t = 0; for (let pi = 0; pi < np; pi++) phases[pi] = 0; } prevTrig = tv; }
          let s = 0;
          for (let pi = 0; pi < np; pi++) {
            s += amps[pi] * Math.sin(TAU * phases[pi]) * Math.exp(-t / decs[pi]);
            phases[pi] += incs[pi]; phases[pi] -= Math.floor(phases[pi]);
          }
          out[i] = s * norm;
          t += 1 / sr;
        }
        return { out };
      }
    },

    impulse: {
      category: 'Source', title: 'Impulse / Click', color: '#3b82f6',
      inputs: [], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'rate', type: 'number', label: 'Rate', min: 0, max: 200, step: 0.1, default: 0, unit: 'Hz' },
        { name: 'click', type: 'number', label: 'Click', min: 0.1, max: 20, step: 0.1, default: 2, unit: 'ms' },
        { name: 'jitter', type: 'number', label: 'Jitter', min: 0, max: 1, step: 0.01, default: 0 },
        { name: 'seed', type: 'number', label: 'Seed', min: 0, max: 9999, step: 1, default: 1 },
      ],
      // Single (rate=0) or repeated short exponential clicks. Excites Resonator/
      // Karplus/Filter, or stands alone as ticks / sparks / Geiger (with jitter).
      process(node, ins, ctx) {
        const out = buf(ctx);
        const sr = ctx.sampleRate;
        const rate = p(node, 'rate', 0);
        const clickN = Math.max(1, Math.round(p(node, 'click', 2) / 1000 * sr));
        const jitter = clamp(p(node, 'jitter', 0), 0, 1);
        const rnd = mulberry32((p(node, 'seed', 1) + (ctx.seedOffset || 0)) * 1597334677 + 5);
        const stamp = (start) => {
          for (let k = 0; k < clickN && start + k < out.length; k++) {
            if (start + k < 0) continue;
            out[start + k] += Math.exp(-3 * k / clickN); // short decaying blip
          }
        };
        if (rate <= 0) { stamp(0); return { out }; }
        const period = sr / rate;
        for (let n = 0; ; n++) {
          let pos = n * period;
          if (jitter > 0) pos += (rnd() * 2 - 1) * jitter * period * 0.5;
          const idx = Math.round(pos);
          if (idx >= out.length) break;
          stamp(idx);
        }
        return { out };
      }
    },

    wavetable: {
      category: 'Source', title: 'Wavetable', color: '#0ea5e9',
      inputs: [{ name: 'fm', label: 'FM' }, { name: 'pos', label: 'Pos CV' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'freq', type: 'number', label: 'Freq', min: 20, max: 8000, step: 1, default: 220, unit: 'Hz', log: true },
        { name: 'bank', type: 'select', label: 'Bank', options: ['basic', 'additive', 'vocal'], default: 'basic' },
        { name: 'position', type: 'number', label: 'Position', min: 0, max: 1, step: 0.001, default: 0 },
        { name: 'fmAmount', type: 'number', label: 'FM Amt', min: 0, max: 4000, step: 1, default: 0, unit: 'Hz' },
      ],
      // Morphs through a bank of single-cycle tables via `position` (+ `pos` CV for
      // evolving timbres). basic = sine→tri→saw→square, additive = harmonic sweep,
      // vocal = vowel-ish formant tables.
      process(node, ins, ctx) {
        const out = buf(ctx);
        const sr = ctx.sampleRate;
        const N = 2048;
        const f0 = p(node, 'freq', 220) * (ctx.pitchMul || 1);
        const bank = p(node, 'bank', 'basic');
        const posBase = p(node, 'position', 0);
        const fmAmt = p(node, 'fmAmount', 0);
        const fm = ins.fm, posCv = ins.pos;
        // build the table set for this bank (each is one cycle, length N)
        const tables = [];
        const mk = fn => { const t = new Float32Array(N); for (let k = 0; k < N; k++) t[k] = fn(k / N); return t; };
        if (bank === 'basic') {
          tables.push(mk(ph => Math.sin(TAU * ph)));
          tables.push(mk(ph => ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph));     // triangle
          tables.push(mk(ph => 2 * ph - 1));                            // saw
          tables.push(mk(ph => ph < 0.5 ? 1 : -1));                     // square
        } else if (bank === 'additive') {
          // position morphs harmonic count 1..16 (sine -> rich)
          for (let h = 1; h <= 16; h += 3) {
            tables.push(mk(ph => { let s = 0; for (let n = 1; n <= h; n++) s += Math.sin(TAU * n * ph) / n; return s * 0.6; }));
          }
        } else { // vocal: a few vowel-ish formant tables
          const VOW = [[700, 1220, 2600], [400, 1700, 2400], [300, 2300, 3000], [450, 800, 2830]]; // a e i o
          for (const f of VOW) {
            tables.push(mk(ph => {
              let s = 0;
              for (let n = 1; n <= 30; n++) {
                let a = 0; for (const fr of f) { const fn = n * f0; a += Math.exp(-Math.pow((fn - fr) / 180, 2)); }
                s += a * Math.sin(TAU * n * ph) / n;
              }
              return s;
            }));
          }
          let mx = 0; for (const tb of tables) for (let k = 0; k < N; k++) mx = Math.max(mx, Math.abs(tb[k]));
          if (mx > 1e-6) for (const tb of tables) for (let k = 0; k < N; k++) tb[k] /= mx;
        }
        const nT = tables.length;
        let ph = 0;
        for (let i = 0; i < out.length; i++) {
          let f = f0 + (fm ? fm[i] * fmAmt : 0); if (f < 0) f = 0;
          let pos = clamp(posBase + (posCv ? posCv[i] : 0), 0, 1);
          const fp = pos * (nT - 1);
          const t0 = Math.floor(fp), t1 = Math.min(nT - 1, t0 + 1), mixT = fp - t0;
          const x = ph * N, x0 = Math.floor(x) % N, x1 = (x0 + 1) % N, fr = x - Math.floor(x);
          const a = tables[t0], b = tables[t1];
          const va = a[x0] * (1 - fr) + a[x1] * fr;
          const vb = b[x0] * (1 - fr) + b[x1] * fr;
          out[i] = va * (1 - mixT) + vb * mixT;
          ph += f / sr; ph -= Math.floor(ph);
        }
        return { out };
      }
    },

    // ===== MODULATION / CONTROL =====
    lfo: {
      category: 'Modulation', title: 'LFO', color: '#a855f7',
      inputs: [], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'wave', type: 'select', label: 'Wave', options: ['sine', 'triangle', 'saw', 'square'], default: 'sine' },
        { name: 'rate', type: 'number', label: 'Rate', min: 0.1, max: 200, step: 0.1, default: 6, unit: 'Hz', log: true },
        { name: 'depth', type: 'number', label: 'Depth', min: 0, max: 1, step: 0.01, default: 1 },
        { name: 'offset', type: 'number', label: 'Offset', min: -1, max: 1, step: 0.01, default: 0 },
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
      category: 'Modulation', title: 'Envelope (ADSR)', color: '#ec4899',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'attack', type: 'number', label: 'Attack', min: 0, max: 2, step: 0.001, default: 0.005, unit: 's' },
        { name: 'decay', type: 'number', label: 'Decay', min: 0, max: 2, step: 0.001, default: 0.08, unit: 's' },
        { name: 'sustain', type: 'number', label: 'Sustain', min: 0, max: 1, step: 0.01, default: 0.0 },
        { name: 'release', type: 'number', label: 'Release', min: 0, max: 4, step: 0.001, default: 0.1, unit: 's' },
        { name: 'gate', type: 'number', label: 'Gate', min: 0, max: 10, step: 0.01, default: 0.15, unit: 's' },
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
      category: 'Modulation', title: 'Sweep', color: '#d946ef',
      inputs: [], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'start', type: 'number', label: 'Start', min: -2000, max: 4000, step: 1, default: 1 },
        { name: 'end', type: 'number', label: 'End', min: -2000, max: 4000, step: 1, default: 0 },
        { name: 'time', type: 'number', label: 'Time', min: 0.001, max: 10, step: 0.001, default: 0.2, unit: 's' },
        { name: 'curve', type: 'select', label: 'Curve', options: ['linear', 'exp', 'log'], default: 'exp' },
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
      category: 'Modulation', title: 'Sample & Hold', color: '#c026d3',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'rate', type: 'number', label: 'Rate', min: 1, max: 4000, step: 1, default: 24, unit: 'Hz', log: true },
        { name: 'glide', type: 'number', label: 'Glide', min: 0, max: 0.999, step: 0.001, default: 0 },
        { name: 'seed', type: 'number', label: 'Seed', min: 0, max: 9999, step: 1, default: 1 },
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

    multienv: {
      category: 'Modulation', title: 'Multi Envelope', color: '#f472b6',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'points', type: 'text', label: 'Points (t:lvl)', default: '0:0, 0.01:1, 0.15:0.3, 0.5:0' },
        { name: 'curve', type: 'select', label: 'Curve', options: ['linear', 'exp', 'smooth'], default: 'linear' },
      ],
      // Arbitrary breakpoint envelope: "t:level" pairs (seconds). Interpolates
      // between points; holds last level after the final point. Applied to `in`
      // if connected, otherwise output the contour itself (use as CV).
      process(node, ins, ctx) {
        const out = buf(ctx);
        const sr = ctx.sampleRate;
        const curve = p(node, 'curve', 'linear');
        let pts = parsePairs(p(node, 'points', '')).sort((a, b) => a[0] - b[0]);
        if (!pts.length) pts = [[0, 0]];
        const inb = ins.in;
        const shape = k => curve === 'exp' ? k * k : curve === 'smooth' ? k * k * (3 - 2 * k) : k;
        let seg = 0;
        for (let i = 0; i < out.length; i++) {
          const t = i / sr;
          while (seg < pts.length - 1 && t >= pts[seg + 1][0]) seg++;
          let env;
          if (seg >= pts.length - 1) env = pts[pts.length - 1][1];
          else {
            const [t0, v0] = pts[seg], [t1, v1] = pts[seg + 1];
            const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
            env = v0 + (v1 - v0) * shape(clamp(k, 0, 1));
          }
          out[i] = inb ? inb[i] * env : env;
        }
        return { out };
      }
    },

    sequencer: {
      category: 'Modulation', title: 'Sequencer', color: '#db2777',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }, { name: 'pitch', label: 'Pitch' }],
      params: [
        { name: 'times', type: 'text', label: 'Times(s)', default: '0, 0.5, 1.0, 1.5' },
        { name: 'levels', type: 'text', label: 'Levels', default: '1' },
        { name: 'pitches', type: 'text', label: 'Pitch(Hz)', default: '' },
        { name: 'mode', type: 'select', label: 'Mode', options: ['env', 'gate', 'trig'], default: 'env' },
        { name: 'attack', type: 'number', label: 'Attack', min: 0, max: 1, step: 0.001, default: 0.002, unit: 's' },
        { name: 'decay', type: 'number', label: 'Decay', min: 0.001, max: 2, step: 0.001, default: 0.08, unit: 's' },
      ],
      // Fires an event at each time in `times`. `out` = per-step envelope/gate/
      // trigger (scaled by `levels`, cycled); drive a Gain CV (rhythmic amp),
      // or a Karplus/Pluck `Trig` (mode=trig). `pitch` holds each step's Hz from
      // `pitches` (→ Osc FM, fmAmount 1) for arpeggios. `in` connected = sequenced VCA.
      process(node, ins, ctx) {
        const out = buf(ctx), pitchOut = buf(ctx), sr = ctx.sampleRate;
        const times = parseNums(p(node, 'times', ''));
        let levels = parseNums(p(node, 'levels', '')); if (!levels.length) levels = [1];
        const pitches = parseNums(p(node, 'pitches', ''));
        const mode = p(node, 'mode', 'env');
        const a = p(node, 'attack', 0.002), d = p(node, 'decay', 0.08);
        const steps = times.map((t, i) => ({ t, lvl: levels[i % levels.length], pitch: pitches.length ? pitches[i % pitches.length] : 0 }));
        const inb = ins.in;
        for (const st of steps) {
          const start = Math.round(st.t * sr);
          if (mode === 'trig') {
            const tn = Math.max(1, Math.round(0.001 * sr));
            for (let k = 0; k < tn; k++) { const idx = start + k; if (idx >= 0 && idx < out.length) out[idx] = st.lvl; }
          } else if (mode === 'gate') {
            const len = Math.max(1, Math.round(d * sr));
            for (let k = 0; k < len; k++) { const idx = start + k; if (idx >= 0 && idx < out.length) out[idx] = Math.max(out[idx], st.lvl); }
          } else { // env: attack ramp then decay to 0
            const aN = Math.max(1, Math.round(a * sr)), dN = Math.max(1, Math.round(d * sr));
            for (let k = 0; k < aN + dN; k++) {
              const idx = start + k; if (idx < 0 || idx >= out.length) continue;
              let e = k < aN ? k / aN : 1 - (k - aN) / dN; if (e < 0) e = 0;
              out[idx] = Math.max(out[idx], e * st.lvl);
            }
          }
        }
        if (inb) for (let i = 0; i < out.length; i++) out[i] *= inb[i];
        if (pitches.length) {
          const sorted = steps.slice().sort((x, y) => x.t - y.t);
          let si = -1;
          for (let i = 0; i < pitchOut.length; i++) {
            const t = i / sr;
            while (si + 1 < sorted.length && t >= sorted[si + 1].t) si++;
            pitchOut[i] = si >= 0 ? sorted[si].pitch : 0;
          }
        }
        return { out, pitch: pitchOut };
      }
    },

    drunklfo: {
      category: 'Modulation', title: 'Smooth Random', color: '#9333ea',
      inputs: [], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'rate', type: 'number', label: 'Rate', min: 0.1, max: 100, step: 0.1, default: 4, unit: 'Hz', log: true },
        { name: 'depth', type: 'number', label: 'Depth', min: 0, max: 1, step: 0.01, default: 1 },
        { name: 'offset', type: 'number', label: 'Offset', min: -1, max: 1, step: 0.01, default: 0 },
        { name: 'seed', type: 'number', label: 'Seed', min: 0, max: 9999, step: 1, default: 1 },
      ],
      // Interpolated random walk (value noise) — organic wobble for fire flicker,
      // creature movement, hand-held camera-ish modulation. Smoother than S&H.
      process(node, ins, ctx) {
        const out = buf(ctx), sr = ctx.sampleRate;
        const rate = p(node, 'rate', 4), depth = p(node, 'depth', 1), offset = p(node, 'offset', 0);
        const rnd = mulberry32((p(node, 'seed', 1) + (ctx.seedOffset || 0)) * 22695477 + 1);
        const stepN = Math.max(1, Math.round(sr / rate));
        let prev = rnd() * 2 - 1, next = rnd() * 2 - 1, c = 0;
        for (let i = 0; i < out.length; i++) {
          if (c >= stepN) { c = 0; prev = next; next = rnd() * 2 - 1; }
          const k = c / stepN, s = 0.5 - 0.5 * Math.cos(Math.PI * k); // cosine ease
          out[i] = clamp((prev + (next - prev) * s) * depth + offset, -1, 1);
          c++;
        }
        return { out };
      }
    },

    // ===== PROCESSORS =====
    gain: {
      category: 'Processor', title: 'Gain / Amp', color: '#10b981',
      inputs: [{ name: 'in', label: 'In' }, { name: 'cv', label: 'CV' }],
      outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'gain', type: 'number', label: 'Gain', min: 0, max: 4, step: 0.01, default: 1 },
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
      category: 'Processor', title: 'Filter', color: '#14b8a6',
      inputs: [{ name: 'in', label: 'In' }, { name: 'cv', label: 'Cutoff CV' }],
      outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'type', type: 'select', label: 'Type', options: ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf'], default: 'lowpass' },
        { name: 'cutoff', type: 'number', label: 'Cutoff', min: 20, max: 18000, step: 1, default: 1200, unit: 'Hz', log: true },
        { name: 'q', type: 'number', label: 'Q', min: 0.1, max: 24, step: 0.1, default: 1 },
        { name: 'gain', type: 'number', label: 'Gain', min: -24, max: 24, step: 0.5, default: 0, unit: 'dB' },
        { name: 'cvAmount', type: 'number', label: 'CV Amt', min: 0, max: 16000, step: 1, default: 4000, unit: 'Hz' },
      ],
      process(node, ins, ctx) {
        const out = buf(ctx);
        const inb = ins.in;
        if (!inb) return { out };
        const type = p(node, 'type', 'lowpass');
        const cutoff = p(node, 'cutoff', 1200);
        const Q = p(node, 'q', 1);
        const gainDb = p(node, 'gain', 0);
        const cvAmt = p(node, 'cvAmount', 0);
        const cv = ins.cv;
        const sr = ctx.sampleRate;
        let z1 = 0, z2 = 0;
        let co = biquadCoeffs(type, cutoff, Q, sr, gainDb);
        let lastCut = cutoff;
        for (let i = 0; i < out.length; i++) {
          if (cv) {
            const c = clamp(cutoff + cv[i] * cvAmt, 10, sr * 0.49);
            if (Math.abs(c - lastCut) > 1) { co = biquadCoeffs(type, c, Q, sr, gainDb); lastCut = c; }
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
      category: 'Processor', title: 'Distortion', color: '#f97316',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'mode', type: 'select', label: 'Mode', options: ['tanh', 'clip', 'fold'], default: 'tanh' },
        { name: 'drive', type: 'number', label: 'Drive', min: 1, max: 50, step: 0.1, default: 4 },
        { name: 'mix', type: 'number', label: 'Mix', min: 0, max: 1, step: 0.01, default: 1 },
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
      category: 'Processor', title: 'Bitcrush', color: '#eab308',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'bits', type: 'number', label: 'Bits', min: 1, max: 16, step: 1, default: 6 },
        { name: 'reduction', type: 'number', label: 'Down', min: 1, max: 64, step: 1, default: 8 },
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
      category: 'Processor', title: 'Time Shift', color: '#0d9488',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'offset', type: 'number', label: 'Offset', min: 0, max: 5, step: 0.001, default: 0.2, unit: 's' },
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

    reverse: {
      category: 'Processor', title: 'Reverse', color: '#06b6d4',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'window', type: 'number', label: 'Window', min: 0, max: 10, step: 0.01, default: 0, unit: 's' },
      ],
      // Time-reverse the signal (whole buffer, or just the first `window` seconds
      // if > 0). Reverse-cymbal / charge-up / "suck-in" effects. Trivial offline.
      process(node, ins, ctx) {
        const out = buf(ctx);
        const inb = ins.in;
        if (!inb) return { out };
        const w = p(node, 'window', 0);
        const len = w > 0 ? Math.min(out.length, Math.round(w * ctx.sampleRate)) : out.length;
        for (let i = 0; i < len; i++) out[i] = inb[len - 1 - i];
        for (let i = len; i < out.length; i++) out[i] = inb[i];
        return { out };
      }
    },

    resonator: {
      category: 'Processor', title: 'Resonator', color: '#0e7490',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'freq', type: 'number', label: 'Freq', min: 40, max: 6000, step: 1, default: 320, unit: 'Hz', log: true },
        { name: 'decay', type: 'number', label: 'Decay', min: 0.02, max: 4, step: 0.01, default: 0.4, unit: 's' },
        { name: 'damping', type: 'number', label: 'Damping', min: 0, max: 1, step: 0.01, default: 0.3 },
        { name: 'mix', type: 'number', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.7 },
      ],
      // A tuned feedback comb (+ one-pole damping) that imparts a pitched
      // resonance to any input — strike noise -> wood/metal/glass "ring".
      process(node, ins, ctx) {
        const out = buf(ctx);
        const inb = ins.in;
        if (!inb) return { out };
        const sr = ctx.sampleRate;
        const freq = p(node, 'freq', 320) * (ctx.pitchMul || 1);
        const decay = p(node, 'decay', 0.4);
        const damping = clamp(p(node, 'damping', 0.3), 0, 1);
        const mix = p(node, 'mix', 0.7);
        const dN = Math.max(2, Math.round(sr / freq));
        const line = new Float32Array(dN);
        const fb = Math.pow(0.001, dN / (decay * sr));
        const lp = 0.5 + damping * 0.49;
        let idx = 0, last = 0;
        for (let i = 0; i < out.length; i++) {
          const delayed = line[idx];
          const filtered = lp * delayed + (1 - lp) * last;
          last = filtered;
          line[idx] = inb[i] + filtered * fb;
          out[i] = inb[i] * (1 - mix) + delayed * mix;
          idx = (idx + 1) % dN;
        }
        return { out };
      }
    },

    delay: {
      category: 'Processor', title: 'Delay / Echo', color: '#0ea5e9',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'time', type: 'number', label: 'Time', min: 0.001, max: 1, step: 0.001, default: 0.12, unit: 's' },
        { name: 'feedback', type: 'number', label: 'Feedback', min: 0, max: 0.95, step: 0.01, default: 0.4 },
        { name: 'mix', type: 'number', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.35 },
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
      category: 'Processor', title: 'Reverb', color: '#0891b2',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'size', type: 'number', label: 'Size', min: 0.1, max: 1, step: 0.01, default: 0.6 },
        { name: 'damp', type: 'number', label: 'Damp', min: 0, max: 1, step: 0.01, default: 0.4 },
        { name: 'mix', type: 'number', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.3 },
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

    chorus: {
      category: 'Processor', title: 'Chorus / Flanger', color: '#2563eb',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'rate', type: 'number', label: 'Rate', min: 0.05, max: 10, step: 0.01, default: 0.6, unit: 'Hz', log: true },
        { name: 'depth', type: 'number', label: 'Depth', min: 0, max: 10, step: 0.01, default: 2, unit: 'ms' },
        { name: 'delay', type: 'number', label: 'Delay', min: 0, max: 30, step: 0.1, default: 12, unit: 'ms' },
        { name: 'feedback', type: 'number', label: 'Feedback', min: 0, max: 0.95, step: 0.01, default: 0 },
        { name: 'mix', type: 'number', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.5 },
      ],
      // LFO-modulated fractional delay. High delay/low feedback = chorus (thicken,
      // shimmer); short delay/high feedback = flanger (jet sweep). Sci-fi & width.
      process(node, ins, ctx) {
        const out = buf(ctx); const inb = ins.in; if (!inb) return { out };
        const sr = ctx.sampleRate;
        const rate = p(node, 'rate', 0.6), depthD = p(node, 'depth', 2) / 1000 * sr;
        const baseD = p(node, 'delay', 12) / 1000 * sr;
        const fb = p(node, 'feedback', 0), mix = p(node, 'mix', 0.5);
        const maxD = Math.max(2, Math.ceil(baseD + depthD + 2));
        const line = new Float32Array(maxD);
        let wi = 0, ph = 0;
        for (let i = 0; i < out.length; i++) {
          ph += rate / sr; if (ph >= 1) ph -= 1;
          const lfo = 0.5 - 0.5 * Math.cos(TAU * ph);
          let rp = wi - (baseD + lfo * depthD); while (rp < 0) rp += maxD;
          const i0 = Math.floor(rp), frac = rp - i0, i1 = (i0 + 1) % maxD;
          const delayed = line[i0] * (1 - frac) + line[i1] * frac;
          line[wi] = inb[i] + delayed * fb;
          out[i] = inb[i] * (1 - mix) + delayed * mix;
          wi = (wi + 1) % maxD;
        }
        return { out };
      }
    },

    phaser: {
      category: 'Processor', title: 'Phaser', color: '#4f46e5',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'rate', type: 'number', label: 'Rate', min: 0.05, max: 10, step: 0.01, default: 0.5, unit: 'Hz', log: true },
        { name: 'depth', type: 'number', label: 'Depth', min: 0, max: 1, step: 0.01, default: 0.8 },
        { name: 'stages', type: 'number', label: 'Stages', min: 2, max: 8, step: 2, default: 4 },
        { name: 'feedback', type: 'number', label: 'Feedback', min: 0, max: 0.9, step: 0.01, default: 0.3 },
        { name: 'mix', type: 'number', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.5 },
      ],
      // Cascaded 1st-order all-pass stages with an LFO-swept break frequency →
      // moving notches. Classic sci-fi sweep / jet / shimmer.
      process(node, ins, ctx) {
        const out = buf(ctx); const inb = ins.in; if (!inb) return { out };
        const sr = ctx.sampleRate;
        const rate = p(node, 'rate', 0.5), depth = clamp(p(node, 'depth', 0.8), 0, 1);
        const stages = Math.max(2, Math.round(p(node, 'stages', 4)));
        const fb = p(node, 'feedback', 0.3), mix = p(node, 'mix', 0.5);
        const fmin = 200, fmax = 1800;
        const x1 = new Float32Array(stages), y1 = new Float32Array(stages);
        let ph = 0, lastOut = 0;
        for (let i = 0; i < out.length; i++) {
          ph += rate / sr; if (ph >= 1) ph -= 1;
          const lfo = 0.5 - 0.5 * Math.cos(TAU * ph);
          const fc = fmin * Math.pow(fmax / fmin, lfo * depth);
          const t = Math.tan(Math.PI * clamp(fc, 20, sr * 0.49) / sr), a1 = (t - 1) / (t + 1);
          let s = inb[i] + lastOut * fb;
          for (let k = 0; k < stages; k++) {
            const xin = s, yout = a1 * xin + x1[k] - a1 * y1[k];
            x1[k] = xin; y1[k] = yout; s = yout;
          }
          lastOut = s;
          out[i] = inb[i] * (1 - mix) + s * mix;
        }
        return { out };
      }
    },

    compressor: {
      category: 'Processor', title: 'Compressor', color: '#16a34a',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'threshold', type: 'number', label: 'Thresh', min: -60, max: 0, step: 0.5, default: -18, unit: 'dB' },
        { name: 'ratio', type: 'number', label: 'Ratio', min: 1, max: 20, step: 0.1, default: 4 },
        { name: 'attack', type: 'number', label: 'Attack', min: 0.0005, max: 0.1, step: 0.0005, default: 0.005, unit: 's' },
        { name: 'release', type: 'number', label: 'Release', min: 0.005, max: 1, step: 0.005, default: 0.12, unit: 's' },
        { name: 'makeup', type: 'number', label: 'Makeup', min: 0, max: 24, step: 0.5, default: 0, unit: 'dB' },
      ],
      // Feed-forward peak compressor / limiter (high ratio = limiter). Tames
      // transients and adds punch/density to impacts & foley.
      process(node, ins, ctx) {
        const out = buf(ctx); const inb = ins.in; if (!inb) return { out };
        const sr = ctx.sampleRate;
        const thr = p(node, 'threshold', -18), ratio = Math.max(1, p(node, 'ratio', 4));
        const aC = Math.exp(-1 / (p(node, 'attack', 0.005) * sr));
        const rC = Math.exp(-1 / (p(node, 'release', 0.12) * sr));
        const makeup = Math.pow(10, p(node, 'makeup', 0) / 20);
        let env = 0;
        for (let i = 0; i < out.length; i++) {
          const x = inb[i], lvl = Math.abs(x);
          const coef = lvl > env ? aC : rC;
          env = coef * env + (1 - coef) * lvl;
          const envDb = 20 * Math.log10(env + 1e-9);
          const gr = envDb > thr ? (envDb - thr) * (1 - 1 / ratio) : 0;
          out[i] = x * Math.pow(10, -gr / 20) * makeup;
        }
        return { out };
      }
    },

    formant: {
      category: 'Processor', title: 'Formant Filter', color: '#65a30d',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'vowel', type: 'select', label: 'Vowel', options: ['a', 'e', 'i', 'o', 'u'], default: 'a' },
        { name: 'shift', type: 'number', label: 'Shift', min: 0.5, max: 2, step: 0.01, default: 1 },
        { name: 'q', type: 'number', label: 'Q', min: 2, max: 20, step: 0.5, default: 9 },
        { name: 'mix', type: 'number', label: 'Mix', min: 0, max: 1, step: 0.01, default: 1 },
      ],
      // Three parallel band-passes at a vowel's formant frequencies → voice /
      // creature / robot timbre on any input (best on buzzy saw or noise).
      // `shift` scales all formants (small = bigger/deeper creature, big = tiny).
      process(node, ins, ctx) {
        const out = buf(ctx); const inb = ins.in; if (!inb) return { out };
        const sr = ctx.sampleRate;
        const VOWELS = { a: [700, 1220, 2600], e: [400, 1700, 2400], i: [270, 2300, 3000], o: [450, 800, 2830], u: [325, 700, 2530] };
        const f = VOWELS[p(node, 'vowel', 'a')] || VOWELS.a;
        const shift = p(node, 'shift', 1), Q = p(node, 'q', 9), mix = p(node, 'mix', 1);
        const gains = [1.0, 0.6, 0.35];
        const co = f.map((fr, k) => biquadCoeffs('bandpass', fr * shift, Q + k * 1.5, sr));
        const z1 = [0, 0, 0], z2 = [0, 0, 0];
        for (let i = 0; i < out.length; i++) {
          const x = inb[i]; let wet = 0;
          for (let k = 0; k < 3; k++) {
            const c = co[k];
            const y = c[0] * x + z1[k];
            z1[k] = c[1] * x - c[3] * y + z2[k];
            z2[k] = c[2] * x - c[4] * y;
            wet += y * gains[k];
          }
          out[i] = x * (1 - mix) + wet * mix;
        }
        return { out };
      }
    },

    pitchshift: {
      category: 'Processor', title: 'Pitch Shifter', color: '#ea580c',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'semitones', type: 'number', label: 'Pitch', min: -24, max: 24, step: 1, default: 7, unit: 'st' },
        { name: 'grain', type: 'number', label: 'Grain', min: 0.02, max: 0.2, step: 0.005, default: 0.08, unit: 's' },
        { name: 'mix', type: 'number', label: 'Mix', min: 0, max: 1, step: 0.01, default: 1 },
      ],
      // Time-domain granular pitch shift: two crossfaded delay taps drifting at
      // the pitch ratio (raised-cosine windows sum to 1). Cheap, slightly grainy.
      process(node, ins, ctx) {
        const out = buf(ctx); const inb = ins.in; if (!inb) return { out };
        const sr = ctx.sampleRate;
        const ratio = Math.pow(2, p(node, 'semitones', 7) / 12);
        const L = Math.max(4, Math.round(p(node, 'grain', 0.08) * sr));
        const mix = p(node, 'mix', 1);
        const size = L + 4;
        const line = new Float32Array(size);
        let wi = 0, d1 = 0;
        const inc = 1 - ratio; // delay-pointer drift per sample
        const read = d => {
          let rp = wi - d; while (rp < 0) rp += size; while (rp >= size) rp -= size;
          const i0 = Math.floor(rp), frac = rp - i0, i1 = (i0 + 1) % size;
          return line[i0] * (1 - frac) + line[i1] * frac;
        };
        for (let i = 0; i < out.length; i++) {
          line[wi] = inb[i];
          d1 += inc; d1 = ((d1 % L) + L) % L;
          const d2 = (d1 + L / 2) % L;
          const w1 = 0.5 * (1 - Math.cos(TAU * d1 / L));
          const w2 = 0.5 * (1 - Math.cos(TAU * d2 / L));
          const wet = read(d1) * w1 + read(d2) * w2;
          out[i] = inb[i] * (1 - mix) + wet * mix;
          wi = (wi + 1) % size;
        }
        return { out };
      }
    },

    // ===== COMBINERS =====
    mixer: {
      category: 'Combiner', title: 'Mixer', color: '#84cc16', stereoAware: true,
      inputs: [{ name: 'a', label: 'A' }, { name: 'b', label: 'B' }, { name: 'c', label: 'C' }, { name: 'd', label: 'D' }],
      outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'levelA', type: 'number', label: 'Lvl A', min: 0, max: 2, step: 0.01, default: 1 },
        { name: 'levelB', type: 'number', label: 'Lvl B', min: 0, max: 2, step: 0.01, default: 1 },
        { name: 'levelC', type: 'number', label: 'Lvl C', min: 0, max: 2, step: 0.01, default: 1 },
        { name: 'levelD', type: 'number', label: 'Lvl D', min: 0, max: 2, step: 0.01, default: 1 },
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
      category: 'Combiner', title: 'Ring Mod', color: '#65a30d',
      inputs: [{ name: 'a', label: 'A' }, { name: 'b', label: 'B' }],
      outputs: [{ name: 'out', label: 'Out' }],
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
      category: 'Stereo', title: 'Panner', color: '#22d3ee', stereoAware: true,
      inputs: [{ name: 'in', label: 'In' }, { name: 'cv', label: 'Pan CV' }],
      outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'pan', type: 'number', label: 'Pan', min: -1, max: 1, step: 0.01, default: 0 },
        { name: 'cvAmount', type: 'number', label: 'CV Amt', min: 0, max: 1, step: 0.01, default: 1 },
        { name: 'spread', type: 'number', label: 'Width', min: 0, max: 20, step: 0.1, default: 0, unit: 'ms' },
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

    widener: {
      category: 'Stereo', title: 'Stereo Widener', color: '#0e7490', stereoAware: true,
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'width', type: 'number', label: 'Width', min: 0, max: 2, step: 0.01, default: 1.4 },
      ],
      // Mid/Side width control on a stereo signal: 0 = mono, 1 = unchanged,
      // >1 = wider. Place after a Panner / stereo Mixer (no effect on mono in).
      process(node, ins, ctx) {
        const inb = ins.in;
        const L = buf(ctx), R = buf(ctx);
        if (!inb) return { out: { stereo: true, l: L, r: R } };
        const width = p(node, 'width', 1.4);
        if (inb.stereo) {
          for (let i = 0; i < L.length; i++) {
            const mid = (inb.l[i] + inb.r[i]) * 0.5, side = (inb.l[i] - inb.r[i]) * 0.5 * width;
            L[i] = mid + side; R[i] = mid - side;
          }
        } else {
          for (let i = 0; i < L.length; i++) { L[i] = inb[i]; R[i] = inb[i]; }
        }
        return { out: { stereo: true, l: L, r: R } };
      }
    },

    pingpong: {
      category: 'Stereo', title: 'Ping-Pong Delay', color: '#0284c7', stereoAware: true,
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'time', type: 'number', label: 'Time', min: 0.02, max: 1.2, step: 0.01, default: 0.25, unit: 's' },
        { name: 'feedback', type: 'number', label: 'Feedback', min: 0, max: 0.95, step: 0.01, default: 0.45 },
        { name: 'mix', type: 'number', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.4 },
      ],
      // Stereo bouncing echo: feedback crosses L<->R so repeats alternate sides.
      process(node, ins, ctx) {
        const inb = ins.in;
        const outL = buf(ctx), outR = buf(ctx);
        if (!inb) return { out: { stereo: true, l: outL, r: outR } };
        const inL = inb.stereo ? inb.l : inb, inR = inb.stereo ? inb.r : inb;
        const sr = ctx.sampleRate;
        const dN = Math.max(1, Math.round(p(node, 'time', 0.25) * sr));
        const fb = p(node, 'feedback', 0.45), mix = p(node, 'mix', 0.4);
        const lineL = new Float32Array(dN), lineR = new Float32Array(dN);
        let idx = 0;
        for (let i = 0; i < outL.length; i++) {
          const tapL = lineL[idx], tapR = lineR[idx];
          const wetIn = (inL[i] + inR[i]) * 0.5;
          // input enters the LEFT line only; L feeds R, R feeds L -> echoes bounce
          lineL[idx] = wetIn + tapR * fb;
          lineR[idx] = tapL * fb;
          outL[i] = inL[i] * (1 - mix) + tapL * mix;
          outR[i] = inR[i] * (1 - mix) + tapR * mix;
          idx = (idx + 1) % dN;
        }
        return { out: { stereo: true, l: outL, r: outR } };
      }
    },

    // ===== UTILITY =====
    cvmath: {
      category: 'Utility', title: 'Scale & Offset', color: '#94a3b8',
      inputs: [{ name: 'in', label: 'In' }], outputs: [{ name: 'out', label: 'Out' }],
      params: [
        { name: 'scale', type: 'number', label: 'Scale', min: -4, max: 4, step: 0.01, default: 1 },
        { name: 'offset', type: 'number', label: 'Offset', min: -2, max: 2, step: 0.01, default: 0 },
        { name: 'mode', type: 'select', label: 'Mode', options: ['none', 'abs', 'clamp'], default: 'none' },
        { name: 'min', type: 'number', label: 'Min', min: -2, max: 2, step: 0.01, default: -1 },
        { name: 'max', type: 'number', label: 'Max', min: -2, max: 2, step: 0.01, default: 1 },
      ],
      // Remap / invert / bias / clamp any signal. Unconnected `in` -> constant
      // (= offset), so it doubles as a DC/constant source for CV.
      process(node, ins, ctx) {
        const out = buf(ctx);
        const inb = ins.in;
        const scale = p(node, 'scale', 1), offset = p(node, 'offset', 0);
        const mode = p(node, 'mode', 'none');
        const mn = p(node, 'min', -1), mx = p(node, 'max', 1);
        for (let i = 0; i < out.length; i++) {
          let v = (inb ? inb[i] : 0) * scale + offset;
          if (mode === 'abs') v = Math.abs(v);
          else if (mode === 'clamp') v = clamp(v, mn, mx);
          out[i] = v;
        }
        return { out };
      }
    },

    // ===== NOTE =====
    note: {
      category: 'Note', title: 'Note', color: '#eab308', annotation: true,
      inputs: [], outputs: [],
      params: [
        { name: 'text', type: 'textarea', label: '', default: 'メモ' },
      ],
      // Pure annotation — produces no audio and is never part of the render graph.
      process() { return {}; }
    },

    // ===== OUTPUT =====
    output: {
      category: 'Output', title: 'Output', color: '#ef4444', singleton: true, stereoAware: true,
      inputs: [{ name: 'in', label: 'In' }], outputs: [],
      params: [
        { name: 'gain', type: 'number', label: 'Master', min: 0, max: 2, step: 0.01, default: 0.9 },
        { name: 'normalize', type: 'toggle', label: 'Normalize', default: false },
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

  // ---- localized names + descriptions (for JP toggle & palette tooltips) ----
  // ja = Japanese node name; en/jaDesc = one-line descriptions for tooltips.
  const META = {
    oscillator: { ja: 'オシレーター', en: 'Sine/square/saw/triangle tone. FM/PM inputs, unison detune.', jaDesc: 'サイン/矩形/ノコギリ/三角波。FM・PM入力とユニゾンデチューン。' },
    noise: { ja: 'ノイズ', en: 'White / pink / brown noise (seeded, reproducible).', jaDesc: 'ホワイト/ピンク/ブラウンノイズ（シード指定で再現可）。' },
    karplus: { ja: 'プラック (弦)', en: 'Karplus-Strong plucked/struck string. Trig re-excites.', jaDesc: 'Karplus-Strong撥弦/打撃。Trig入力で再励起。' },
    granular: { ja: 'グラニュラー', en: 'Scatters short noise grains — fire / rain / sparks.', jaDesc: '短いノイズ粒を散布。炎/雨/火花などのテクスチャ。' },
    fmop: { ja: 'FMオペレータ', en: '2-operator FM — bells, metal, clangs, sci-fi.', jaDesc: '2オペレータFM。鐘/金属/クラング/SF。ratioとindexで音色。' },
    modal: { ja: 'モーダル/打撃体', en: 'Struck-object resonant partials — bell/glass/metal/drum.', jaDesc: '打撃で鳴る共鳴partial。鐘/ガラス/金属棒/陶器/太鼓を内蔵生成。' },
    impulse: { ja: 'インパルス/クリック', en: 'Single or repeated clicks — excite resonators, ticks, sparks.', jaDesc: '単発/連続クリック。レゾネータ励起・ティック・火花に。' },
    wavetable: { ja: 'ウェーブテーブル', en: 'Morphing wavetable osc (position CV) for evolving timbres.', jaDesc: 'positionで波形モーフ。CVで進化する音色（オルガン/声/ドローン）。' },
    lfo: { ja: 'LFO', en: 'Low-frequency oscillator control signal (-1..1).', jaDesc: '低周波オシレータの制御信号(-1..1)。' },
    envelope: { ja: 'エンベロープ (ADSR)', en: 'ADSR envelope; multiplies input or outputs the contour.', jaDesc: 'ADSR包絡線。入力に乗算、未接続なら包絡線を出力。' },
    multienv: { ja: 'マルチエンベロープ', en: 'Arbitrary "t:level" breakpoint envelope.', jaDesc: '任意の「t:level」ブレークポイント包絡線。' },
    sequencer: { ja: 'シーケンサー', en: 'Fires timed events (footsteps/arps). out + pitch outputs.', jaDesc: 'タイミングでイベント発火（足音/アルペジオ）。out+pitch出力。' },
    sweep: { ja: 'スイープ', en: 'Value ramp start→end over time (lin/exp/log).', jaDesc: '時間でstart→endへ変化する制御値（線形/exp/log）。' },
    samplehold: { ja: 'サンプル&ホールド', en: 'Steps/holds a signal at a rate (or internal random).', jaDesc: 'Rateでステップ状にホールド（未接続なら内部ランダム）。' },
    drunklfo: { ja: 'スムーズランダム', en: 'Interpolated random wobble (smoother than S&H).', jaDesc: '補間付きランダムのゆらぎ（S&Hより滑らか）。' },
    gain: { ja: 'ゲイン', en: 'Volume; CV input for amplitude modulation.', jaDesc: '音量。CV入力で振幅変調（ADSRで音量包絡）。' },
    filter: { ja: 'フィルター', en: 'Biquad LP/HP/BP/notch/peak/shelf. Cutoff CV input.', jaDesc: 'biquad LP/HP/BP/notch/peak/shelf。カットオフCV入力。' },
    resonator: { ja: 'レゾネーター', en: 'Tuned resonance — wood / metal / glass ring.', jaDesc: 'チューンド共鳴。木/金属/ガラスの鳴りを付与。' },
    distortion: { ja: 'ディストーション', en: 'tanh / clip / fold saturation.', jaDesc: 'tanh / clip / fold の歪み。' },
    bitcrush: { ja: 'ビットクラッシュ', en: 'Bit-depth & sample-rate reduction (lo-fi).', jaDesc: 'ビット深度・サンプルレート低減（ローファイ）。' },
    timeshift: { ja: 'タイムシフト', en: 'Delays a whole layer to a point on the timeline.', jaDesc: 'レイヤーをタイムライン上の任意位置へ遅延配置。' },
    reverse: { ja: 'リバース', en: 'Time-reverse the signal (reverse swell).', jaDesc: '信号を時間反転（リバーススウェル）。' },
    delay: { ja: 'ディレイ / エコー', en: 'Delay line with feedback.', jaDesc: 'フィードバック付きディレイ。' },
    reverb: { ja: 'リバーブ', en: 'Simple Schroeder reverb.', jaDesc: '簡易 Schroeder リバーブ。' },
    chorus: { ja: 'コーラス / フランジャー', en: 'LFO-modulated short delay (thicken / jet sweep).', jaDesc: 'LFO変調する短ディレイ（厚み/ジェット掃引）。' },
    phaser: { ja: 'フェイザー', en: 'Cascaded all-pass notches swept by an LFO.', jaDesc: 'オールパスのノッチをLFOで掃引。' },
    compressor: { ja: 'コンプレッサー', en: 'Peak compressor / limiter — punch & glue.', jaDesc: 'ピークコンプ/リミッタ。パンチと密度。' },
    formant: { ja: 'フォルマント', en: 'Vowel formant filter — voice / creature / robot.', jaDesc: '母音フォルマント。声/生物/ロボの音色。' },
    pitchshift: { ja: 'ピッチシフター', en: 'Granular pitch shift ±24 semitones.', jaDesc: 'グラニュラのピッチシフト（±24半音）。' },
    mixer: { ja: 'ミキサー', en: 'Sum up to 4 inputs with levels (stereo-aware).', jaDesc: '最大4入力をレベル付きで合成（ステレオ対応）。' },
    ringmod: { ja: 'リングモジュレーター', en: 'Multiply two signals (metallic / bell).', jaDesc: '2信号の乗算（金属的/ベル系）。' },
    panner: { ja: 'パンナー', en: 'Mono→stereo equal-power pan + Pan CV + width.', jaDesc: 'モノ→ステレオ等パワーパン＋Pan CV＋広がり。' },
    widener: { ja: 'ステレオワイドナー', en: 'Mid/Side stereo width (0=mono, >1=wider).', jaDesc: 'Mid/Sideでステレオ幅調整（0=モノ,>1=広い）。' },
    pingpong: { ja: 'ピンポンディレイ', en: 'Stereo echo that bounces L↔R.', jaDesc: '左右に跳ねるステレオ反響。' },
    cvmath: { ja: 'スケール & オフセット', en: 'Remap / invert / clamp a signal; constant source.', jaDesc: '信号の再マップ/反転/clamp。未接続で定数源。' },
    note: { ja: 'ノート', en: 'Comment / memo. Attach to a node\'s top edge.', jaDesc: 'コメント/メモ。ノードの上端に連結できます。' },
    output: { ja: '出力', en: 'Master gain, normalize, clip — the final output.', jaDesc: 'マスターゲイン/正規化/クリップ。最終出力。' },
  };
  const CAT_JA = { Source: 'ソース', Modulation: 'モジュレーション', Processor: 'プロセッサー', Combiner: 'ミキサー系', Stereo: 'ステレオ', Utility: 'ユーティリティ', Note: 'ノート', Output: '出力' };

  function title(type, lang) { const d = TYPES[type]; if (!d) return type; const m = META[type]; return (lang === 'ja' && m && m.ja) ? m.ja : d.title; }
  function desc(type, lang) { const m = META[type]; if (!m) return ''; return (lang === 'ja') ? (m.jaDesc || m.en || '') : (m.en || ''); }
  function catName(cat, lang) { return (lang === 'ja' && CAT_JA[cat]) ? CAT_JA[cat] : cat; }

  // ---- parameter descriptions (tooltips). generic by name + per-type overrides ----
  const PARAM_DESC = {
    wave: { en: 'Waveform shape.', ja: '波形の種類。' },
    freq: { en: 'Frequency in Hz.', ja: '周波数 (Hz)。' },
    fmAmount: { en: 'Depth of the FM input (Hz).', ja: 'FM入力の効き量 (Hz)。' },
    pmAmount: { en: 'Depth of the PM (phase mod) input.', ja: 'PM(位相変調)入力の効き量。' },
    voices: { en: 'Number of detuned unison voices.', ja: 'ユニゾンの声部数。' },
    detune: { en: 'Unison detune spread (cents).', ja: 'ユニゾンのデチューン幅 (cent)。' },
    color: { en: 'Noise color (white/pink/brown).', ja: 'ノイズの色 (white/pink/brown)。' },
    seed: { en: 'Random seed — same value = same result.', ja: '乱数シード。同じ値なら同じ結果。' },
    rate: { en: 'Rate in Hz.', ja: 'レート (Hz)。' },
    depth: { en: 'Modulation depth.', ja: '変調の深さ。' },
    offset: { en: 'Offset added to the output.', ja: '出力に加えるオフセット。' },
    attack: { en: 'Fade-in time.', ja: '立ち上がり時間。' },
    decay: { en: 'Time to fall from peak.', ja: 'ピークから下がる時間。' },
    sustain: { en: 'Held level after decay.', ja: '減衰後に保つレベル。' },
    release: { en: 'Fade-out time after the gate.', ja: 'ゲート後のリリース時間。' },
    gate: { en: 'Note-on (held) length.', ja: 'ノートオン(押下)の長さ。' },
    curve: { en: 'Shape of the change.', ja: '変化のカーブ。' },
    glide: { en: 'Smoothing between steps (0=stepped).', ja: 'ステップ間の滑らかさ(0=階段状)。' },
    times: { en: 'Event times in seconds (comma separated).', ja: '各イベントの時刻(秒, カンマ区切り)。' },
    levels: { en: 'Per-step levels (cycled).', ja: '各ステップの音量(繰り返し)。' },
    pitches: { en: 'Per-step pitch in Hz (→ Osc FM).', ja: '各ステップのピッチ(Hz, →Osc FM)。' },
    points: { en: 'Breakpoints "time:level" (seconds).', ja: 'ブレークポイント「時刻:値」(秒)。' },
    type: { en: 'Filter type.', ja: 'フィルターの種類。' },
    cutoff: { en: 'Cutoff / center frequency (Hz).', ja: 'カットオフ/中心周波数 (Hz)。' },
    q: { en: 'Resonance / bandwidth (Q).', ja: 'レゾナンス/帯域幅 (Q)。' },
    gain: { en: 'Gain.', ja: 'ゲイン。' },
    cvAmount: { en: 'How much the CV input moves the cutoff (Hz).', ja: 'CV入力がカットオフを動かす量 (Hz)。' },
    drive: { en: 'Amount of distortion.', ja: '歪みの強さ。' },
    mix: { en: 'Dry / wet balance.', ja: '原音とエフェクトの比率。' },
    bits: { en: 'Bit depth (lower = grittier).', ja: 'ビット深度(低いほど粗い)。' },
    reduction: { en: 'Sample-rate down-sampling factor.', ja: 'サンプルレート間引き量。' },
    window: { en: 'Reverse window in seconds (0 = whole buffer).', ja: '反転する範囲(秒, 0=全体)。' },
    size: { en: 'Reverb size / length.', ja: '残響の広さ・長さ。' },
    damp: { en: 'High-frequency damping.', ja: '高域の減衰。' },
    time: { en: 'Delay time in seconds.', ja: 'ディレイ時間(秒)。' },
    feedback: { en: 'Feedback amount (repeats).', ja: 'フィードバック量(繰り返し)。' },
    density: { en: 'Grains per second.', ja: '1秒あたりの粒の数。' },
    grainLen: { en: 'Length of each grain (s).', ja: '1粒の長さ(秒)。' },
    pitchSpread: { en: 'Random pitch spread of grains.', ja: '粒のピッチのばらつき。' },
    threshold: { en: 'Level where compression starts (dB).', ja: '圧縮を始める音量(dB)。' },
    ratio: { en: 'Compression ratio (higher = limiter).', ja: '圧縮比(高いほどリミッタ)。' },
    makeup: { en: 'Make-up gain after compression (dB).', ja: '圧縮後のメイクアップゲイン(dB)。' },
    stages: { en: 'Number of all-pass stages.', ja: 'オールパスの段数。' },
    scale: { en: 'Multiply the input by this.', ja: '入力を何倍するか。' },
    min: { en: 'Lower clamp limit.', ja: 'clampの下限。' },
    max: { en: 'Upper clamp limit.', ja: 'clampの上限。' },
    width: { en: 'Stereo width (1 = unchanged, >1 = wider).', ja: 'ステレオ幅(1=そのまま, >1=広い)。' },
    semitones: { en: 'Pitch shift in semitones.', ja: 'ピッチ変化(半音)。' },
    grain: { en: 'Grain size (s) — smaller = cleaner.', ja: '粒の長さ(秒, 小さいほどクリア)。' },
    text: { en: 'Note / memo text.', ja: 'メモの内容。' },
    normalize: { en: 'Normalize the peak to ~0 dB.', ja: 'ピークを約0dBに正規化。' },
    start: { en: 'Start value.', ja: '開始値。' },
    end: { en: 'End value.', ja: '終了値。' },
    exciter: { en: 'Excitation source (noise / impulse).', ja: '励起源 (noise/impulse)。' },
    damping: { en: 'Damping — higher = duller & shorter.', ja: 'ダンピング(高いほど鈍く短い)。' },
    ratio: { en: 'Modulator : carrier frequency ratio (integer = harmonic).', ja: 'モジュレータ:キャリアの周波数比(整数=ハーモニック)。' },
    index: { en: 'FM amount (brightness / metallic-ness).', ja: 'FMの深さ(明るさ/金属感)。' },
    indexDecay: { en: 'How fast the FM index falls (bell-like attack).', ja: 'FM深さの減衰時間(鐘のアタック感)。' },
    structure: { en: 'Resonant body type (partial ratio set).', ja: '共鳴体の種類(partial比のセット)。' },
    partials: { en: 'Number of partials summed.', ja: '合成するpartialの数。' },
    click: { en: 'Length of each click blip (ms).', ja: '各クリックの長さ(ms)。' },
    jitter: { en: 'Random timing variation (0 = exact).', ja: 'タイミングのランダム揺らぎ(0=正確)。' },
    bank: { en: 'Wavetable set to morph through.', ja: 'モーフする波形バンク。' },
    position: { en: 'Morph position through the wavetable (0..1).', ja: '波形テーブル内のモーフ位置(0..1)。' },
    levelA: { en: 'Level of input A.', ja: '入力Aの音量。' },
    levelB: { en: 'Level of input B.', ja: '入力Bの音量。' },
    levelC: { en: 'Level of input C.', ja: '入力Cの音量。' },
    levelD: { en: 'Level of input D.', ja: '入力Dの音量。' },
  };
  const PARAM_OVR = {
    'lfo.offset': { en: 'Center value of the output (bias).', ja: '出力の中心値(バイアス)。' },
    'drunklfo.offset': { en: 'Center value of the output (bias).', ja: '出力の中心値(バイアス)。' },
    'cvmath.offset': { en: 'Value added after scaling.', ja: 'スケール後に加える値。' },
    'timeshift.offset': { en: 'How far to delay the layer (s).', ja: 'レイヤーを遅らせる時間(秒)。' },
    'sweep.time': { en: 'Time to ramp start→end (s).', ja: 'start→endにかける時間(秒)。' },
    'distortion.mode': { en: 'Distortion curve (tanh/clip/fold).', ja: '歪みの種類 (tanh/clip/fold)。' },
    'sequencer.mode': { en: 'Output shape (env/gate/trig).', ja: '出力の形 (env/gate/trig)。' },
    'cvmath.mode': { en: 'Post op (none/abs/clamp).', ja: '後処理 (none/abs/clamp)。' },
    'filter.gain': { en: 'Boost/cut for peak & shelf types (dB).', ja: 'peak/shelf時のブースト/カット(dB)。' },
    'output.gain': { en: 'Master output level.', ja: 'マスター出力音量。' },
    'gain.gain': { en: 'Level multiplier.', ja: '音量の倍率。' },
    'envelope.decay': { en: 'Time to fall to the sustain level.', ja: 'サスティンまで下がる時間。' },
    'karplus.decay': { en: 'Ring length (s).', ja: '鳴りの長さ(秒)。' },
    'resonator.decay': { en: 'Ring length (s).', ja: '共鳴の長さ(秒)。' },
  };
  function paramDesc(type, name, lang) {
    const o = PARAM_OVR[type + '.' + name] || PARAM_DESC[name];
    if (!o) return '';
    return lang === 'ja' ? (o.ja || o.en || '') : (o.en || '');
  }

  // ---- visible UI labels (parameter labels, select options, port labels) ----
  const PARAM_LABELS = {
    wave: '波形',
    freq: '周波数',
    fmAmount: 'FM量',
    pmAmount: 'PM量',
    voices: 'ユニゾン',
    detune: 'デチューン',
    color: 'ノイズ色',
    seed: 'シード',
    rate: '速度',
    depth: '深さ',
    offset: 'オフセット',
    attack: '立上り',
    decay: '減衰',
    sustain: '保持',
    release: '余韻',
    gate: 'ゲート',
    start: '開始値',
    end: '終了値',
    time: '時間',
    curve: 'カーブ',
    glide: '滑り',
    points: 'ポイント',
    times: '時刻',
    levels: 'レベル',
    pitches: 'ピッチ',
    mode: 'モード',
    type: '種類',
    cutoff: 'カット',
    q: 'Q',
    gain: 'ゲイン',
    cvAmount: 'CV量',
    drive: '強さ',
    mix: '混ぜ',
    bits: 'ビット',
    reduction: '間引き',
    window: '範囲',
    size: '広さ',
    damp: '吸音',
    delay: '遅延',
    feedback: '反復',
    density: '密度',
    grainLen: '粒長',
    pitchSpread: 'ばらつき',
    threshold: 'しきい値',
    ratio: '比率',
    makeup: '補正',
    stages: '段数',
    scale: '倍率',
    min: '下限',
    max: '上限',
    width: '幅',
    semitones: '半音',
    grain: '粒度',
    text: 'メモ',
    normalize: '正規化',
    exciter: '励起源',
    damping: 'ダンピング',
    index: 'インデックス',
    indexDecay: 'Index減衰',
    structure: '材質',
    partials: '倍音数',
    click: 'クリック長',
    jitter: '揺らぎ',
    bank: 'バンク',
    position: '位置',
    levelA: 'A音量',
    levelB: 'B音量',
    levelC: 'C音量',
    levelD: 'D音量',
    pan: 'パン',
    spread: '広がり',
    vowel: '母音',
    shift: 'シフト',
  };
  const PARAM_LABEL_OVR = {
    'granular.cutoff': '音色',
    'granular.grainLen': '粒の長さ',
    'granular.pitchSpread': '音程ばらつき',
    'filter.cvAmount': 'カットCV量',
    'filter.gain': '増減',
    'gain.gain': '音量',
    'output.gain': 'マスター',
    'resonator.freq': '共鳴周波数',
    'karplus.freq': '音程',
    'modal.freq': '基音',
    'fmop.freq': 'キャリア',
    'fmop.ratio': '比率',
    'fmop.feedback': 'FB',
    'compressor.ratio': '圧縮比',
    'chorus.depth': '揺れ幅',
    'chorus.delay': '遅延',
    'panner.cvAmount': 'パンCV量',
    'panner.spread': '広がり',
    'pitchshift.semitones': '半音',
    'pitchshift.grain': '粒度',
    'wavetable.fmAmount': 'FM量',
  };
  const OPTION_LABELS = {
    sine: 'サイン',
    square: '矩形',
    saw: 'ノコギリ',
    triangle: '三角',
    white: 'ホワイト',
    pink: 'ピンク',
    brown: 'ブラウン',
    noise: 'ノイズ',
    impulse: 'インパルス',
    harmonic: '倍音',
    bar: '棒',
    bell: '鐘',
    glass: 'ガラス',
    membrane: '膜',
    metal: '金属',
    basic: '基本',
    additive: '加算',
    vocal: 'ボーカル',
    linear: '線形',
    exp: '指数',
    log: '対数',
    smooth: '滑らか',
    env: '包絡',
    gate: 'ゲート',
    trig: 'トリガ',
    lowpass: 'ローパス',
    highpass: 'ハイパス',
    bandpass: 'バンドパス',
    notch: 'ノッチ',
    peaking: 'ピーキング',
    lowshelf: 'ローシェルフ',
    highshelf: 'ハイシェルフ',
    tanh: 'ソフト',
    clip: 'クリップ',
    fold: 'フォールド',
    none: 'なし',
    abs: '絶対値',
    clamp: '制限',
    a: 'あ',
    e: 'え',
    i: 'い',
    o: 'お',
    u: 'う',
  };
  const PORT_LABELS = {
    In: '入力',
    Out: '出力',
    Trig: 'トリガ',
    'Density CV': '密度CV',
    'Pos CV': '位置CV',
    Pitch: 'ピッチ',
    CV: 'CV',
    'Cutoff CV': 'カットCV',
    'Pan CV': 'パンCV',
  };

  function paramLabel(type, name, fallback, lang) {
    if (lang !== 'ja') return fallback || name;
    return PARAM_LABEL_OVR[type + '.' + name] || PARAM_LABELS[name] || fallback || name;
  }
  function optionLabel(value, lang) {
    if (lang !== 'ja') return value;
    return OPTION_LABELS[value] || value;
  }
  function portLabel(label, lang) {
    if (lang !== 'ja') return label;
    return PORT_LABELS[label] || label;
  }

  global.DSP = { TYPES, META, title, desc, catName, paramDesc, paramLabel, optionLabel, portLabel, helpers: { clamp, biquadCoeffs, adsrLevel, mulberry32, waveSample, isStereo, toMono } };
})(window);
