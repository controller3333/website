/* presets.js — factory SE graphs. Each builds a Graph via a small builder. */
(function (global) {
  'use strict';

  // builder: g.add(type, x, y, params) -> node; g.wire(from,'out',to,'in')
  function build(fn) {
    return function () {
      const g = new Graph();
      const ctx = {
        g,
        add: (type, x, y, params) => g.addNode(type, x, y, params),
        wire: (a, ap, b, bp) => g.connect(a.id, ap, b.id, bp),
      };
      fn(ctx);
      return g;
    };
  }

  const PRESETS = {

    'レーザーショット': build(({ add, wire }) => {
      const sweep = add('sweep', 40, 60, { start: 1800, end: 200, time: 0.18, curve: 'exp' });
      const osc = add('oscillator', 320, 60, { wave: 'saw', freq: 200, fmAmount: 1 });
      const env = add('envelope', 600, 60, { attack: 0.002, decay: 0.18, sustain: 0, release: 0.04, gate: 0.18 });
      const dist = add('distortion', 880, 60, { mode: 'tanh', drive: 3, mix: 0.5 });
      const out = add('output', 1160, 80, { gain: 0.9 });
      wire(sweep, 'out', osc, 'fm');
      wire(osc, 'out', env, 'in');
      wire(env, 'out', dist, 'in');
      wire(dist, 'out', out, 'in');
    }),

    '爆発': build(({ add, wire }) => {
      const noise = add('noise', 40, 60, { color: 'brown', seed: 7 });
      const cut = add('sweep', 40, 280, { start: 1, end: -1, time: 0.6, curve: 'exp' });
      const filt = add('filter', 340, 80, { type: 'lowpass', cutoff: 4000, q: 1, cvAmount: 3500 });
      const env = add('envelope', 640, 80, { attack: 0.004, decay: 0.5, sustain: 0.0, release: 0.3, gate: 0.4 });
      const dist = add('distortion', 920, 80, { mode: 'tanh', drive: 5, mix: 0.6 });
      const out = add('output', 1200, 100, { gain: 0.95, normalize: true });
      wire(noise, 'out', filt, 'in');
      wire(cut, 'out', filt, 'cv');
      wire(filt, 'out', env, 'in');
      wire(env, 'out', dist, 'in');
      wire(dist, 'out', out, 'in');
    }),

    'コイン/取得': build(({ add, wire }) => {
      const osc = add('oscillator', 40, 60, { wave: 'square', freq: 988, fmAmount: 0 });
      const osc2 = add('oscillator', 40, 320, { wave: 'square', freq: 1319, fmAmount: 0 });
      const env1 = add('envelope', 340, 60, { attack: 0.001, decay: 0.06, sustain: 1, release: 0.02, gate: 0.06 });
      const env2 = add('envelope', 340, 320, { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05, gate: 0.18 });
      const mix = add('mixer', 640, 160, { levelA: 1, levelB: 1 });
      const out = add('output', 920, 180, { gain: 0.7 });
      wire(osc, 'out', env1, 'in');
      wire(osc2, 'out', env2, 'in');
      wire(env1, 'out', mix, 'a');
      wire(env2, 'out', mix, 'b');
      wire(mix, 'out', out, 'in');
    }),

    'パワーアップアルペジオ': build(({ add, wire }) => {
      const sweep = add('sweep', 40, 60, { start: 0, end: 1600, time: 0.5, curve: 'linear' });
      const osc = add('oscillator', 340, 60, { wave: 'square', freq: 300, fmAmount: 1 });
      const bit = add('bitcrush', 620, 60, { bits: 4, reduction: 6 });
      const env = add('envelope', 880, 60, { attack: 0.005, decay: 0.5, sustain: 0.5, release: 0.1, gate: 0.5 });
      const out = add('output', 1160, 80, { gain: 0.7 });
      wire(sweep, 'out', osc, 'fm');
      wire(osc, 'out', bit, 'in');
      wire(bit, 'out', env, 'in');
      wire(env, 'out', out, 'in');
    }),

    '打撃/インパクト': build(({ add, wire }) => {
      const noise = add('noise', 40, 60, { color: 'white', seed: 3 });
      const osc = add('oscillator', 40, 300, { wave: 'sine', freq: 120, fmAmount: 1 });
      const sweep = add('sweep', -260, 300, { start: 200, end: 0, time: 0.08, curve: 'exp' });
      const nEnv = add('envelope', 340, 60, { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02, gate: 0.05 });
      const oEnv = add('envelope', 340, 300, { attack: 0.001, decay: 0.1, sustain: 0, release: 0.03, gate: 0.1 });
      const mix = add('mixer', 640, 160, { levelA: 0.5, levelB: 1 });
      const filt = add('filter', 900, 160, { type: 'lowpass', cutoff: 2500, q: 1, cvAmount: 0 });
      const out = add('output', 1160, 180, { gain: 0.9 });
      wire(sweep, 'out', osc, 'fm');
      wire(noise, 'out', nEnv, 'in');
      wire(osc, 'out', oEnv, 'in');
      wire(nEnv, 'out', mix, 'a');
      wire(oEnv, 'out', mix, 'b');
      wire(mix, 'out', filt, 'in');
      wire(filt, 'out', out, 'in');
    }),

    '足音': build(({ add, wire }) => {
      // layer 1: filtered noise burst -> the "scuff" of the sole
      const noise = add('noise', 40, 60, { color: 'white', seed: 9 });
      const filt = add('filter', 320, 60, { type: 'lowpass', cutoff: 900, q: 1.2, cvAmount: 0 });
      const nEnv = add('envelope', 600, 60, { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03, gate: 0.035 });
      // layer 2: low pitched thump -> the body weight landing
      const thumpSweep = add('sweep', 40, 360, { start: 110, end: 0, time: 0.05, curve: 'exp' });
      const thump = add('oscillator', 320, 300, { wave: 'sine', freq: 80, fmAmount: 1 });
      const tEnv = add('envelope', 600, 300, { attack: 0.001, decay: 0.07, sustain: 0, release: 0.03, gate: 0.06 });
      const mix = add('mixer', 880, 160, { levelA: 0.7, levelB: 0.9 });
      const out = add('output', 1160, 180, { gain: 0.9, normalize: true });
      wire(noise, 'out', filt, 'in');
      wire(filt, 'out', nEnv, 'in');
      wire(thumpSweep, 'out', thump, 'fm');
      wire(thump, 'out', tEnv, 'in');
      wire(nEnv, 'out', mix, 'a');
      wire(tEnv, 'out', mix, 'b');
      wire(mix, 'out', out, 'in');
    }),

    'UIブリップ': build(({ add, wire }) => {
      const osc = add('oscillator', 40, 60, { wave: 'sine', freq: 1200, fmAmount: 0 });
      const env = add('envelope', 340, 60, { attack: 0.002, decay: 0.04, sustain: 0, release: 0.02, gate: 0.04 });
      const out = add('output', 620, 80, { gain: 0.6 });
      wire(osc, 'out', env, 'in');
      wire(env, 'out', out, 'in');
    }),

    '風/ウーッシュ': build(({ add, wire }) => {
      const noise = add('noise', 40, 60, { color: 'pink', seed: 5 });
      const lfo = add('sweep', 40, 300, { start: -1, end: 1, time: 0.5, curve: 'linear' });
      const filt = add('filter', 340, 80, { type: 'bandpass', cutoff: 800, q: 4, cvAmount: 2000 });
      const env = add('envelope', 640, 80, { attack: 0.15, decay: 0.2, sustain: 0.4, release: 0.25, gate: 0.4 });
      const out = add('output', 920, 100, { gain: 0.9, normalize: true });
      wire(noise, 'out', filt, 'in');
      wire(lfo, 'out', filt, 'cv');
      wire(filt, 'out', env, 'in');
      wire(env, 'out', out, 'in');
    }),

    'ステレオ・ウーッシュ': build(({ add, wire }) => {
      const noise = add('noise', 40, 60, { color: 'pink', seed: 5 });
      const fcv = add('sweep', 40, 320, { start: 1, end: -1, time: 0.5, curve: 'linear' });
      const filt = add('filter', 320, 80, { type: 'bandpass', cutoff: 700, q: 5, cvAmount: 2500 });
      const env = add('envelope', 600, 80, { attack: 0.12, decay: 0.2, sustain: 0.5, release: 0.25, gate: 0.4 });
      const pcv = add('sweep', 600, 340, { start: -1, end: 1, time: 0.6, curve: 'linear' });
      const pan = add('panner', 880, 100, { pan: 0, cvAmount: 1, spread: 6 });
      const out = add('output', 1160, 120, { gain: 0.9, normalize: true });
      wire(noise, 'out', filt, 'in');
      wire(fcv, 'out', filt, 'cv');
      wire(filt, 'out', env, 'in');
      wire(env, 'out', pan, 'in');
      wire(pcv, 'out', pan, 'cv');     // auto-pan L -> R
      wire(pan, 'out', out, 'in');
    }),

    'ロボットビープ(S&H)': build(({ add, wire }) => {
      const sh = add('samplehold', 40, 60, { rate: 16, glide: 0, seed: 4 });
      const osc = add('oscillator', 340, 60, { wave: 'square', freq: 500, fmAmount: 700, voices: 1 });
      const bit = add('bitcrush', 620, 60, { bits: 5, reduction: 4 });
      const env = add('envelope', 880, 60, { attack: 0.002, decay: 0.4, sustain: 0.6, release: 0.08, gate: 0.4 });
      const out = add('output', 1160, 80, { gain: 0.7 });
      wire(sh, 'out', osc, 'fm');       // stepped random pitch
      wire(osc, 'out', bit, 'in');
      wire(bit, 'out', env, 'in');
      wire(env, 'out', out, 'in');
    }),

    '基本形(オシレーター→エンベロープ→出力)': build(({ add, wire }) => {
      const osc = add('oscillator', 60, 80, { wave: 'sine', freq: 440 });
      const env = add('envelope', 360, 80, { attack: 0.005, decay: 0.15, sustain: 0.2, release: 0.1, gate: 0.2 });
      const out = add('output', 640, 100, { gain: 0.8 });
      wire(osc, 'out', env, 'in');
      wire(env, 'out', out, 'in');
    }),
  };

  global.PRESETS = PRESETS;
})(window);
