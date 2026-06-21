/* presets.js — factory SE graphs. Each builds a Graph via a small builder. */
(function (global) {
  'use strict';

  // builder: g.add(type, x, y, params) -> node; g.wire(from,'out',to,'in')
  // optional meta = { duration, loop } the editor applies on load
  function build(fn, meta) {
    return function () {
      const g = new Graph();
      const ctx = {
        g,
        add: (type, x, y, params) => g.addNode(type, x, y, params),
        wire: (a, ap, b, bp) => g.connect(a.id, ap, b.id, bp),
      };
      fn(ctx);
      if (meta) { if (meta.duration) g.suggestedDuration = meta.duration; if (meta.loop) g.suggestedLoop = true; }
      return g;
    };
  }

  const woodFloorWalk = build(({ add, wire }) => {
    // Dry close foley: dull wooden "toko" impacts plus narrow high "kii" creaks.
    // Everything is synthesized from impulses/noise/oscillators; no external samples.
    const stepTimes = '0.08, 0.57, 1.05, 1.54';

    const knockSeq = add('sequencer', 40, 60, { times: stepTimes, levels: '1, 0.76, 0.92, 0.72', pitches: '', mode: 'env', attack: 0.001, decay: 0.085 });
    const knockNoise = add('noise', 40, 250, { color: 'white', seed: 420 });
    const knockBand = add('filter', 310, 210, { type: 'bandpass', cutoff: 780, q: 2.2, gain: 0, cvAmount: 0 });
    const knockGate = add('gain', 580, 170, { gain: 1.15 });
    const boardMid = add('resonator', 850, 80, { freq: 430, decay: 0.18, damping: 0.44, mix: 0.82 });
    const boardLow = add('resonator', 850, 250, { freq: 165, decay: 0.26, damping: 0.62, mix: 0.52 });
    const boardMix = add('mixer', 1120, 170, { levelA: 0.92, levelB: 0.46, levelC: 1, levelD: 1 });

    const tickSeq = add('sequencer', 40, 460, { times: '0.115, 0.615, 1.095, 1.585', levels: '0.72, 0.56, 0.66, 0.50', pitches: '', mode: 'env', attack: 0.0005, decay: 0.024 });
    const tickNoise = add('noise', 310, 470, { color: 'white', seed: 421 });
    const tickBand = add('filter', 580, 470, { type: 'bandpass', cutoff: 2150, q: 5.5, gain: 0, cvAmount: 0 });
    const tickGate = add('gain', 850, 470, { gain: 0.48 });

    const squeakSeq = add('sequencer', 40, 680, { times: '0.145, 0.645, 1.145, 1.635', levels: '0.44, 0.68, 0.36, 0.58', pitches: '1540, 1280, 1720, 1420', mode: 'env', attack: 0.025, decay: 0.24 });
    const squeakOsc = add('oscillator', 310, 680, { wave: 'triangle', freq: 0, fmAmount: 1, pmAmount: 0.18, voices: 2, detune: 7 });
    const squeakGate = add('gain', 580, 680, { gain: 0.34 });
    const squeakBand = add('filter', 850, 680, { type: 'bandpass', cutoff: 1580, q: 7, gain: 5, cvAmount: 0 });
    const squeakChorus = add('chorus', 1120, 680, { rate: 5.5, depth: 1.4, delay: 7, feedback: 0.16, mix: 0.18 });

    const thumpSeq = add('sequencer', 40, 900, { times: stepTimes, levels: '0.55, 0.48, 0.52, 0.45', pitches: '83, 76, 88, 80', mode: 'env', attack: 0.001, decay: 0.13 });
    const thumpOsc = add('oscillator', 310, 900, { wave: 'sine', freq: 0, fmAmount: 1, pmAmount: 0, voices: 1, detune: 12 });
    const thumpGate = add('gain', 580, 900, { gain: 0.70 });
    const thumpLP = add('filter', 850, 900, { type: 'lowpass', cutoff: 220, q: 0.7, gain: 0, cvAmount: 0 });

    const detailMix = add('mixer', 1380, 620, { levelA: 0.58, levelB: 0.62, levelC: 0.76, levelD: 1 });
    const allMix = add('mixer', 1640, 360, { levelA: 1.0, levelB: 0.78, levelC: 1, levelD: 1 });
    const glue = add('compressor', 1900, 360, { threshold: -12, ratio: 3, attack: 0.003, release: 0.13, makeup: 2 });
    const room = add('reverb', 2160, 360, { size: 0.18, damp: 0.72, mix: 0.08 });
    const pan = add('panner', 2420, 360, { pan: 0, cvAmount: 0, spread: 4 });
    const out = add('output', 2680, 380, { gain: 0.9, normalize: true });
    const note = add('note', 1370, 510, { text: '木床歩行: キィキィ成分はSqueak、トコトコ成分はKnock/Tickを調整' });

    wire(knockNoise, 'out', knockBand, 'in');
    wire(knockBand, 'out', knockGate, 'in');
    wire(knockSeq, 'out', knockGate, 'cv');
    wire(knockGate, 'out', boardMid, 'in');
    wire(knockGate, 'out', boardLow, 'in');
    wire(boardMid, 'out', boardMix, 'a');
    wire(boardLow, 'out', boardMix, 'b');

    wire(tickNoise, 'out', tickBand, 'in');
    wire(tickBand, 'out', tickGate, 'in');
    wire(tickSeq, 'out', tickGate, 'cv');

    wire(squeakSeq, 'pitch', squeakOsc, 'fm');
    wire(squeakOsc, 'out', squeakGate, 'in');
    wire(squeakSeq, 'out', squeakGate, 'cv');
    wire(squeakGate, 'out', squeakBand, 'in');
    wire(squeakBand, 'out', squeakChorus, 'in');

    wire(thumpSeq, 'pitch', thumpOsc, 'fm');
    wire(thumpOsc, 'out', thumpGate, 'in');
    wire(thumpSeq, 'out', thumpGate, 'cv');
    wire(thumpGate, 'out', thumpLP, 'in');

    wire(tickGate, 'out', detailMix, 'a');
    wire(squeakChorus, 'out', detailMix, 'b');
    wire(thumpLP, 'out', detailMix, 'c');
    wire(boardMix, 'out', allMix, 'a');
    wire(detailMix, 'out', allMix, 'b');
    wire(allMix, 'out', glue, 'in');
    wire(glue, 'out', room, 'in');
    wire(room, 'out', pan, 'in');
    wire(pan, 'out', out, 'in');

    note.attachedTo = detailMix.id;
  }, { duration: 2.2 });

  const PRESETS = {

    'Laser Shot': build(({ add, wire }) => {
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

    'Explosion': build(({ add, wire }) => {
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

    'Coin / Pickup': build(({ add, wire }) => {
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

    'Powerup Arp': build(({ add, wire }) => {
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

    'Hit / Impact': build(({ add, wire }) => {
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

    'Footstep': build(({ add, wire }) => {
      // layer 1: filtered noise burst -> the "scuff" of the sole
      const noise = add('noise', 40, 60, { color: 'white', seed: 2390 });
      const filt = add('filter', 320, 60, { type: 'lowpass', cutoff: 16931, q: 14.488, gain: -18.912, cvAmount: 0 });
      const nEnv = add('envelope', 600, 60, { attack: 0, decay: 1.434, sustain: 0.602, release: 0.03, gate: 0.035 });
      // layer 2: low pitched thump -> the body weight landing
      const thumpSweep = add('sweep', 40, 360, { start: 110, end: 0, time: 0.05, curve: 'exp' });
      const thump = add('oscillator', 319, 419, { wave: 'sine', freq: 49, fmAmount: 1240, pmAmount: 0.212, voices: 1, detune: 12 });
      const tEnv = add('envelope', 600, 300, { attack: 1.522, decay: 0.62, sustain: 0.619, release: 0.352, gate: 0.09 });
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

    'UI Blip': build(({ add, wire }) => {
      const osc = add('oscillator', 40, 60, { wave: 'sine', freq: 1200, fmAmount: 0 });
      const env = add('envelope', 340, 60, { attack: 0.002, decay: 0.04, sustain: 0, release: 0.02, gate: 0.04 });
      const out = add('output', 620, 80, { gain: 0.6 });
      wire(osc, 'out', env, 'in');
      wire(env, 'out', out, 'in');
    }),

    'Wind / Whoosh': build(({ add, wire }) => {
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

    'Stereo Whoosh (Pan)': build(({ add, wire }) => {
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

    'Robot Bleep (S&H)': build(({ add, wire }) => {
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

    'Pluck (Karplus)': build(({ add, wire }) => {
      const k = add('karplus', 60, 80, { freq: 330, decay: 1.6, damping: 0.35, exciter: 'noise' });
      const eq = add('filter', 360, 80, { type: 'peaking', cutoff: 1200, q: 2, gain: 5 });
      const out = add('output', 640, 100, { gain: 0.85 });
      wire(k, 'out', eq, 'in');
      wire(eq, 'out', out, 'in');
    }),

    'Wood Knock (Resonator)': build(({ add, wire }) => {
      // A short noise impact, band-limited (wood is struck dull, not white),
      // excites 3 inharmonic well-damped modes = a warm woody "knock". A crisp
      // band-passed tick from the raw impact adds the attack snap.
      const n = add('noise', 40, 140, { color: 'white', seed: 4 });
      const click = add('envelope', 300, 140, { attack: 0.0003, decay: 0.004, sustain: 0, release: 0.002, gate: 0.003 });
      const exLP = add('filter', 560, 80, { type: 'lowpass', cutoff: 1300, q: 0.7, gain: 0 });  // dull excitation
      const body = add('resonator', 820, 20, { freq: 196, decay: 0.22, damping: 0.35, mix: 1 });   // low body
      const mid = add('resonator', 820, 180, { freq: 540, decay: 0.16, damping: 0.42, mix: 1 });    // woody mid (loudest)
      const tock = add('resonator', 820, 340, { freq: 1180, decay: 0.09, damping: 0.5, mix: 1 });   // high "tock"
      const tick = add('filter', 560, 460, { type: 'bandpass', cutoff: 1400, q: 1.1, gain: 0 });     // dry attack snap
      const mix = add('mixer', 1100, 200, { levelA: 1.0, levelB: 0.95, levelC: 0.5, levelD: 0.2 });
      const lp = add('filter', 1360, 200, { type: 'lowpass', cutoff: 300, q: 4.76, gain: 0, cvAmount: 1840 });
      const out = add('output', 1620, 220, { gain: 0.9, normalize: true });
      wire(n, 'out', click, 'in');
      wire(click, 'out', exLP, 'in');
      wire(click, 'out', tick, 'in');     // raw impact -> attack snap
      wire(exLP, 'out', body, 'in');
      wire(exLP, 'out', mid, 'in');
      wire(exLP, 'out', tock, 'in');
      wire(body, 'out', mix, 'a');
      wire(mid, 'out', mix, 'b');
      wire(tock, 'out', mix, 'c');
      wire(tick, 'out', mix, 'd');
      wire(mix, 'out', lp, 'in');
      wire(lp, 'out', out, 'in');
    }),

    'Wood Floor Walk (Creaky)': woodFloorWalk,

    'Campfire (Granular)': build(({ add, wire }) => {
      const crackle = add('granular', 40, 60, { density: 60, grainLen: 0.01, cutoff: 326, q: 12.468, pitchSpread: 0.7, seed: 9 });
      const rumbleN = add('noise', 40, 320, { color: 'brown', seed: 3 });
      const rumbleF = add('filter', 320, 320, { type: 'lowpass', cutoff: 400, q: 0.8, gain: 0, cvAmount: 4000 });
      const mix = add('mixer', 600, 160, { levelA: 1, levelB: 0.35 });
      const out = add('output', 880, 180, { gain: 0.8, normalize: true });
      wire(crackle, 'out', mix, 'a');
      wire(rumbleN, 'out', rumbleF, 'in');
      wire(rumbleF, 'out', mix, 'b');
      wire(mix, 'out', out, 'in');
    }),

    'Reverse Riser': build(({ add, wire }) => {
      const n = add('noise', 40, 60, { color: 'pink', seed: 7 });
      const cv = add('sweep', 40, 280, { start: 1, end: 0, time: 0.9, curve: 'exp' });
      const f = add('filter', 320, 80, { type: 'bandpass', cutoff: 600, q: 4, cvAmount: 4000 });
      const env = add('envelope', 600, 80, { attack: 0.002, decay: 0.9, sustain: 0, release: 0.1, gate: 0.9 });
      const rev = add('reverse', 880, 80, { window: 1.0 });
      const rv = add('reverb', 1140, 80, { size: 0.7, damp: 0.4, mix: 0.3 });
      const out = add('output', 1400, 100, { gain: 0.9, normalize: true });
      wire(n, 'out', f, 'in'); wire(cv, 'out', f, 'cv');
      wire(f, 'out', env, 'in');
      wire(env, 'out', rev, 'in');     // a decaying hit -> reversed = a swelling riser
      wire(rev, 'out', rv, 'in');
      wire(rv, 'out', out, 'in');
    }),

    'Footsteps (Seq)': woodFloorWalk,

    'Arpeggio (Seq)': build(({ add, wire }) => {
      const seq = add('sequencer', 40, 60, { times: '0,0.12,0.24,0.36,0.48,0.6,0.72', levels: '1', pitches: '330,392,494,659,494,392,330', mode: 'env', attack: 0.002, decay: 0.12 });
      const osc = add('oscillator', 380, 60, { wave: 'square', freq: 0, fmAmount: 1 });
      const g = add('gain', 380, 320, { gain: 1 });
      const dl = add('delay', 680, 180, { time: 0.12, feedback: 0.35, mix: 0.3 });
      const out = add('output', 960, 200, { gain: 0.7 });
      wire(seq, 'pitch', osc, 'fm'); wire(osc, 'out', g, 'in'); wire(seq, 'out', g, 'cv');
      wire(g, 'out', dl, 'in'); wire(dl, 'out', out, 'in');
    }),

    'Phaser Sweep': build(({ add, wire }) => {
      const n = add('noise', 40, 60, { color: 'white', seed: 2 });
      const env = add('envelope', 320, 60, { attack: 0.3, decay: 0.5, sustain: 0.6, release: 0.5, gate: 1.0 });
      const ph = add('phaser', 600, 60, { rate: 0.4, depth: 0.9, stages: 6, feedback: 0.5, mix: 0.6 });
      const out = add('output', 880, 80, { gain: 0.8, normalize: true });
      wire(n, 'out', env, 'in'); wire(env, 'out', ph, 'in'); wire(ph, 'out', out, 'in');
    }),

    'Wide Chorus Pad': build(({ add, wire }) => {
      const osc = add('oscillator', 40, 60, { wave: 'saw', freq: 160, voices: 3, detune: 14 });
      const env = add('envelope', 320, 60, { attack: 0.2, decay: 0.4, sustain: 0.6, release: 0.5, gate: 1.2 });
      const ch = add('chorus', 600, 60, { rate: 0.5, depth: 3, delay: 18, feedback: 0.2, mix: 0.6 });
      const pan = add('panner', 880, 60, { pan: 0, cvAmount: 0, spread: 6 });
      const wid = add('widener', 1160, 60, { width: 1.7 });
      const out = add('output', 1420, 80, { gain: 0.8, normalize: true });
      wire(osc, 'out', env, 'in'); wire(env, 'out', ch, 'in'); wire(ch, 'out', pan, 'in'); wire(pan, 'out', wid, 'in'); wire(wid, 'out', out, 'in');
    }),

    'Creature Talk (Formant)': build(({ add, wire }) => {
      const osc = add('oscillator', 40, 60, { wave: 'saw', freq: 120, voices: 2, detune: 10, fmAmount: 8 });
      const vib = add('lfo', 40, 320, { wave: 'sine', rate: 5, depth: 1, offset: 0 });
      const fmnt = add('formant', 360, 60, { vowel: 'a', shift: 0.85, q: 10, mix: 1 });
      const env = add('envelope', 640, 60, { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.2, gate: 0.6 });
      const out = add('output', 900, 80, { gain: 0.85, normalize: true });
      wire(vib, 'out', osc, 'fm'); wire(osc, 'out', fmnt, 'in'); wire(fmnt, 'out', env, 'in'); wire(env, 'out', out, 'in');
    }),

    'Ping-Pong Blip': build(({ add, wire }) => {
      const osc = add('oscillator', 40, 60, { wave: 'sine', freq: 1200 });
      const env = add('envelope', 320, 60, { attack: 0.002, decay: 0.05, sustain: 0, release: 0.02, gate: 0.04 });
      const pp = add('pingpong', 600, 60, { time: 0.18, feedback: 0.55, mix: 0.6 });
      const out = add('output', 880, 80, { gain: 0.7 });
      wire(osc, 'out', env, 'in'); wire(env, 'out', pp, 'in'); wire(pp, 'out', out, 'in');
    }),

    'Deep Roar (Pitch+Formant)': build(({ add, wire }) => {
      const n = add('noise', 40, 60, { color: 'brown', seed: 8 });
      const sawN = add('oscillator', 40, 320, { wave: 'saw', freq: 80, voices: 3, detune: 18 });
      const mix = add('mixer', 320, 160, { levelA: 0.6, levelB: 0.8 });
      const ps = add('pitchshift', 600, 160, { semitones: -7, grain: 0.1, mix: 1 });
      const fmnt = add('formant', 880, 160, { vowel: 'o', shift: 0.7, q: 8, mix: 0.9 });
      const env = add('envelope', 1160, 160, { attack: 0.08, decay: 0.5, sustain: 0.5, release: 0.4, gate: 0.8 });
      const out = add('output', 1420, 180, { gain: 0.85, normalize: true });
      wire(n, 'out', mix, 'a'); wire(sawN, 'out', mix, 'b'); wire(mix, 'out', ps, 'in');
      wire(ps, 'out', fmnt, 'in'); wire(fmnt, 'out', env, 'in'); wire(env, 'out', out, 'in');
    }),

    'Zap (Electric)': build(({ add, wire }) => {
      // random-stepped buzz, ring-modulated & clipped, amplitude-flickered (ビリビリ),
      // then fold-distorted & pitched up for a screaming edge; + crackle sparks
      const sh = add('samplehold', 40, 60, { rate: 376, glide: 0.139, seed: 4310 });
      const buzz = add('oscillator', 320, 60, { wave: 'saw', freq: 8000, fmAmount: 804, pmAmount: 3.6, voices: 2, detune: 25 });
      const ring = add('oscillator', 320, 320, { wave: 'square', freq: 1700, fmAmount: 0, pmAmount: 1, voices: 1, detune: 12 });
      const rm = add('ringmod', 600, 140);
      const dist = add('distortion', 820, 140, { mode: 'clip', drive: 33.34, mix: 0.881 });
      const bp = add('filter', 1035, -141, { type: 'bandpass', cutoff: 2500, q: 1.5, gain: 0, cvAmount: 4000 });
      const flick = add('drunklfo', 1036, 184, { rate: 42, depth: 0.6, offset: 0.45, seed: 2 });
      const g = add('gain', 1239, -116, { gain: 1.472 });
      const dist2 = add('distortion', 1447, -80, { mode: 'fold', drive: 40.935, mix: 0.804 });
      const pitch = add('pitchshift', 1656, -16, { semitones: 14, grain: 0.1, mix: 1 });
      const sparks = add('granular', 600, 420, { density: 180, grainLen: 0.005, cutoff: 6000, q: 6, pitchSpread: 0.8, seed: 7 });
      const mix = add('mixer', 1365, 402, { levelA: 1, levelB: 0.5 });
      const env = add('envelope', 1615, 406, { attack: 0, decay: 0.942, sustain: 0.459, release: 1.74, gate: 2.82 });
      const out = add('output', 1885, 411, { gain: 0.85, normalize: true });
      wire(sh, 'out', buzz, 'fm');
      wire(buzz, 'out', rm, 'a'); wire(ring, 'out', rm, 'b');
      wire(rm, 'out', dist, 'in'); wire(dist, 'out', bp, 'in');
      wire(bp, 'out', g, 'in'); wire(flick, 'out', g, 'cv');
      wire(g, 'out', dist2, 'in'); wire(dist2, 'out', pitch, 'in'); wire(pitch, 'out', mix, 'a');
      wire(sparks, 'out', mix, 'b');
      wire(mix, 'out', env, 'in'); wire(env, 'out', out, 'in');
    }, { duration: 3.0 }),

    'Splash (Water)': build(({ add, wire }) => {
      // a sequencer fires 4 wet noise bursts (バシャバシャ); high-Q granular
      // grains add pitched "bloop" bubbles underneath
      const seq = add('sequencer', 40, 60, { times: '0, 0.3, 0.55, 0.85', levels: '1, 0.7, 0.9, 0.6', pitches: '', mode: 'env', attack: 0.005, decay: 0.16 });
      const noise = add('noise', 40, 320, { color: 'white', seed: 5 });
      const bp = add('filter', 360, 320, { type: 'bandpass', cutoff: 1800, q: 1.2, gain: 0 });
      const g = add('gain', 640, 200, { gain: 1 });
      const bubbles = add('granular', 360, 520, { density: 45, grainLen: 0.03, cutoff: 700, q: 9, pitchSpread: 0.9, seed: 4 });
      const mix = add('mixer', 920, 300, { levelA: 1.0, levelB: 0.5 });
      const lp = add('filter', 1180, 300, { type: 'lowpass', cutoff: 4000, q: 0.7, gain: 0 });
      const out = add('output', 1440, 320, { gain: 0.85, normalize: true });
      wire(noise, 'out', bp, 'in'); wire(bp, 'out', g, 'in'); wire(seq, 'out', g, 'cv');
      wire(g, 'out', mix, 'a'); wire(bubbles, 'out', mix, 'b');
      wire(mix, 'out', lp, 'in'); wire(lp, 'out', out, 'in');
    }, { duration: 1.3 }),

    'Thunder': build(({ add, wire }) => {
      // crack: resonant high-pass noise -> long env -> pitch-shifted DOWN -21st
      // for a deep cracking boom; + rolling low-pass brown rumble + sub, reverb
      const crackN = add('noise', 40, 40, { color: 'white', seed: 2 });
      const crackHP = add('filter', 319, -115, { type: 'highpass', cutoff: 34, q: 9.421, gain: 17.712, cvAmount: 6448 });
      const crackEnv = add('envelope', 596, -114, { attack: 0, decay: 0.92, sustain: 0.421, release: 0.904, gate: 0.58 });
      const crackPitch = add('pitchshift', 1214, -117, { semitones: -21, grain: 0.2, mix: 0.619 });
      const rumbleN = add('noise', 40, 260, { color: 'brown', seed: 11 });
      const cutSweep = add('sweep', 40, 480, { start: 1, end: 0, time: 2.5, curve: 'exp' });
      const rumbleLP = add('filter', 320, 260, { type: 'lowpass', cutoff: 90, q: 1, gain: 0, cvAmount: 620 });
      const wobble = add('drunklfo', 320, 480, { rate: 6, depth: 0.5, offset: 0.5, seed: 5 });
      const rumbleG = add('gain', 600, 260, { gain: 1 });
      const rumbleEnv = add('envelope', 840, 260, { attack: 0.05, decay: 2.5, sustain: 0, release: 0.3, gate: 2.0 });
      const dist = add('distortion', 1080, 260, { mode: 'tanh', drive: 3, mix: 0.5 });
      const rv = add('reverb', 1312, 256, { size: 0.85, damp: 0.5, mix: 0.4 });
      const subSweep = add('sweep', 40, 700, { start: 80, end: 30, time: 0.6, curve: 'exp' });
      const subOsc = add('oscillator', 320, 700, { wave: 'sine', freq: 0, fmAmount: 1, pmAmount: 1, voices: 1, detune: 12 });
      const subEnv = add('envelope', 600, 719, { attack: 0.02, decay: 1.5, sustain: 0, release: 0.3, gate: 1.0 });
      const mix = add('mixer', 1709, 355, { levelA: 0.45, levelB: 1.0, levelC: 0.9, levelD: 1 });
      const out = add('output', 1952, 357, { gain: 0.9, normalize: true });
      wire(crackN, 'out', crackHP, 'in'); wire(crackHP, 'out', crackEnv, 'in');
      wire(crackEnv, 'out', crackPitch, 'in'); wire(crackPitch, 'out', mix, 'a');
      wire(rumbleN, 'out', rumbleLP, 'in'); wire(cutSweep, 'out', rumbleLP, 'cv');
      wire(rumbleLP, 'out', rumbleG, 'in'); wire(wobble, 'out', rumbleG, 'cv');
      wire(rumbleG, 'out', rumbleEnv, 'in'); wire(rumbleEnv, 'out', dist, 'in'); wire(dist, 'out', rv, 'in'); wire(rv, 'out', mix, 'b');
      wire(subSweep, 'out', subOsc, 'fm'); wire(subOsc, 'out', subEnv, 'in'); wire(subEnv, 'out', mix, 'c');
      wire(mix, 'out', out, 'in');
    }, { duration: 3.0 }),

    'Rain': build(({ add, wire }) => {
      // steady band-passed pink-noise hiss (slowly varied) + dense granular
      // droplets. Loops cleanly as an ambience bed.
      const hissN = add('noise', 40, 60, { color: 'pink', seed: 3 });
      const hissBP = add('filter', 320, 60, { type: 'bandpass', cutoff: 3000, q: 0.6, gain: 0 });
      const vary = add('drunklfo', 320, 300, { rate: 2, depth: 0.3, offset: 0.7, seed: 8 });
      const g = add('gain', 600, 60, { gain: 1 });
      const drops = add('granular', 610, 510, { density: 854, grainLen: 0.001, cutoff: 1239, q: 5, pitchSpread: 0.7, seed: 9 });
      const mix = add('mixer', 880, 200, { levelA: 0.8, levelB: 0.7 });
      const lp = add('filter', 1140, 200, { type: 'lowpass', cutoff: 6000, q: 0.7, gain: 0 });
      const out = add('output', 1400, 220, { gain: 0.8, normalize: true });
      const note = add('note', 610, 410, { text: '雨のパラパラ感を調整できます' });
      note.attachedTo = drops.id;     // pinned above the granular node
      wire(hissN, 'out', hissBP, 'in'); wire(hissBP, 'out', g, 'in'); wire(vary, 'out', g, 'cv');
      wire(g, 'out', mix, 'a'); wire(drops, 'out', mix, 'b');
      wire(mix, 'out', lp, 'in'); wire(lp, 'out', out, 'in');
    }, { duration: 3.0, loop: true }),

    'Bell (FM)': build(({ add, wire }) => {
      const fm = add('fmop', 40, 80, { freq: 440, ratio: 1.41, index: 9, indexDecay: 0.7, feedback: 0.1 });
      const env = add('envelope', 320, 80, { attack: 0.001, decay: 1.8, sustain: 0, release: 0.3, gate: 1.4 });
      const rv = add('reverb', 600, 80, { size: 0.7, damp: 0.4, mix: 0.25 });
      const out = add('output', 880, 100, { gain: 0.85, normalize: true });
      wire(fm, 'out', env, 'in'); wire(env, 'out', rv, 'in'); wire(rv, 'out', out, 'in');
    }, { duration: 2.5 }),

    'Glass Chime (Modal)': build(({ add, wire }) => {
      const md = add('modal', 40, 80, { freq: 880, structure: 'glass', partials: 6, decay: 1.8, damping: 0.3 });
      const rv = add('reverb', 320, 80, { size: 0.8, damp: 0.35, mix: 0.3 });
      const out = add('output', 600, 100, { gain: 0.85, normalize: true });
      wire(md, 'out', rv, 'in'); wire(rv, 'out', out, 'in');
    }, { duration: 2.5 }),

    'Geiger (Impulse)': build(({ add, wire }) => {
      const imp = add('impulse', 40, 80, { rate: 8, click: 1.5, jitter: 0.85, seed: 4 });
      const bp = add('filter', 320, 80, { type: 'bandpass', cutoff: 3200, q: 2, gain: 0 });
      const out = add('output', 600, 100, { gain: 0.8, normalize: true });
      wire(imp, 'out', bp, 'in'); wire(bp, 'out', out, 'in');
    }, { duration: 2.0 }),

    'Evolving Pad (Wavetable)': build(({ add, wire }) => {
      const morph = add('lfo', 40, 320, { wave: 'sine', rate: 0.2, depth: 0.5, offset: 0.5 });
      const wt = add('wavetable', 320, 80, { freq: 110, bank: 'additive', position: 0, fmAmount: 0 });
      const lp = add('filter', 600, 80, { type: 'lowpass', cutoff: 3000, q: 0.8, gain: 0 });
      const rv = add('reverb', 880, 80, { size: 0.85, damp: 0.4, mix: 0.3 });
      const out = add('output', 1160, 100, { gain: 0.8, normalize: true });
      wire(morph, 'out', wt, 'pos'); wire(wt, 'out', lp, 'in'); wire(lp, 'out', rv, 'in'); wire(rv, 'out', out, 'in');
    }, { duration: 4.0, loop: true }),

    'Default (Osc→Env→Out)': build(({ add, wire }) => {
      const osc = add('oscillator', 60, 80, { wave: 'sine', freq: 440 });
      const env = add('envelope', 360, 80, { attack: 0.005, decay: 0.15, sustain: 0.2, release: 0.1, gate: 0.2 });
      const out = add('output', 640, 100, { gain: 0.8 });
      wire(osc, 'out', env, 'in');
      wire(env, 'out', out, 'in');
    }),
  };

  // Japanese display names (the internal key stays English). Used by the
  // 日本語 toggle so preset names localize alongside node names.
  const PRESET_JA = {
    'Laser Shot': 'レーザー',
    'Explosion': '爆発',
    'Coin / Pickup': 'コイン / 取得',
    'Powerup Arp': 'パワーアップ',
    'Hit / Impact': 'ヒット / 衝撃',
    'Footstep': '足音',
    'UI Blip': 'UI ブリップ',
    'Wind / Whoosh': '風 / ウーッシュ',
    'Stereo Whoosh (Pan)': 'ステレオ・ウーッシュ',
    'Robot Bleep (S&H)': 'ロボット音 (S&H)',
    'Pluck (Karplus)': '撥弦 (Karplus)',
    'Wood Knock (Resonator)': '木のノック',
    'Wood Floor Walk (Creaky)': '木床歩行（キィキィトコトコ）',
    'Campfire (Granular)': '焚き火',
    'Reverse Riser': 'リバース・ライザー',
    'Footsteps (Seq)': '足音・連続（木床）',
    'Arpeggio (Seq)': 'アルペジオ (Seq)',
    'Phaser Sweep': 'フェイザー・スイープ',
    'Wide Chorus Pad': 'ワイド・コーラスパッド',
    'Creature Talk (Formant)': 'クリーチャーの声',
    'Ping-Pong Blip': 'ピンポン・ブリップ',
    'Deep Roar (Pitch+Formant)': '低い咆哮',
    'Zap (Electric)': '電撃 (ビリビリ)',
    'Splash (Water)': '水しぶき (バシャバシャ)',
    'Thunder': '雷',
    'Rain': '雨',
    'Bell (FM)': '鐘 (FM)',
    'Glass Chime (Modal)': 'ガラスのチャイム (Modal)',
    'Geiger (Impulse)': 'ガイガー (Impulse)',
    'Evolving Pad (Wavetable)': '進化するパッド (Wavetable)',
    'Default (Osc→Env→Out)': '基本 (Osc→Env→Out)',
  };

  global.PRESETS = PRESETS;
  global.PRESET_JA = PRESET_JA;
})(window);
