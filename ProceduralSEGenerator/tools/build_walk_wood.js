/* build_walk_wood.js — realistic footsteps on a wooden floor (4 steps).
 *
 * Run:  node tools/build_walk_wood.js
 *
 * Each step layers three components for a believable hard-wood footstep:
 *   - knock : noise -> resonant band-pass ~300Hz (the board's tonal "tok")
 *   - clack : same noise -> band-pass ~1.3kHz, ultra-short (woody surface edge,
 *             band-limited so it stays a "tok" and not a bright hissy "tss")
 *   - thump : low sine, fast decay (body weight landing)
 * Per step the seed / board pitch / level / pan / timing all differ so no two
 * steps are identical (the key to not sounding robotic). Steps alternate L/R
 * (alternating feet) at a ~0.5s walking cadence with slight irregularity.
 */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = global;
require(path.join(__dirname, '..', 'js', 'dsp.js'));
require(path.join(__dirname, '..', 'js', 'graph.js'));

const DURATION = 2.2;
const SR = 44100;
const OUT_DIR = path.join(__dirname, '..');
const BASENAME = 'Walk_Wood_4steps';

const g = new Graph();
const N = (type, x, y, params) => g.addNode(type, x, y, params);
const W = (a, ap, b, bp) => g.connect(a.id, ap, b.id, bp);

// one footstep voice -> returns its final (stereo, time-placed) node
function makeStep(i, s) {
  const y = 40 + i * 540;
  const noise = N('noise', 0, y + 60, { color: 'white', seed: s.seed });
  // knock: resonant band-pass = the wooden board's tonal "tok"
  const fbp = N('filter', 280, y, { type: 'bandpass', cutoff: s.knockHz, q: s.q, cvAmount: 0 });
  const eKnock = N('envelope', 540, y, { attack: 0.001, decay: s.knockDecay, sustain: 0, release: 0.03, gate: s.knockDecay + 0.01 });
  // clack: band-passed ultra-short edge = the woody surface contact
  const fhp = N('filter', 280, y + 140, { type: 'bandpass', cutoff: s.clickHz, q: 2.0, cvAmount: 0 });
  const eClick = N('envelope', 540, y + 140, { attack: 0.0005, decay: 0.016, sustain: 0, release: 0.012, gate: 0.02 });
  // thump: low body
  const o = N('oscillator', 280, y + 300, { wave: 'sine', freq: s.thumpHz, fmAmount: 0, voices: 1 });
  const eThump = N('envelope', 540, y + 300, { attack: 0.001, decay: s.thumpDecay, sustain: 0, release: 0.03, gate: 0.08 });
  W(noise, 'out', fbp, 'in'); W(fbp, 'out', eKnock, 'in');
  W(noise, 'out', fhp, 'in'); W(fhp, 'out', eClick, 'in');
  W(o, 'out', eThump, 'in');
  // mix the three components, place on the timeline, then pan (alternating foot)
  const mix = N('mixer', 820, y + 120, { levelA: s.knockLvl, levelB: s.clickLvl, levelC: s.thumpLvl });
  const ts = N('timeshift', 1080, y + 120, { offset: s.t });
  const pan = N('panner', 1340, y + 120, { pan: s.pan, cvAmount: 0, spread: 3 });
  W(eKnock, 'out', mix, 'a'); W(eClick, 'out', mix, 'b'); W(eThump, 'out', mix, 'c');
  W(mix, 'out', ts, 'in'); W(ts, 'out', pan, 'in');
  return pan;
}

// 4 steps: alternating L/R, ~0.5s cadence with slight irregularity, all varied
const steps = [
  { t: 0.10, pan: -0.30, seed: 21, knockHz: 320, q: 4.5, clickHz: 1300, thumpHz: 95, knockDecay: 0.060, thumpDecay: 0.070, knockLvl: 1.0, clickLvl: 0.28, thumpLvl: 0.75 },
  { t: 0.61, pan: 0.33, seed: 37, knockHz: 280, q: 5.0, clickHz: 1150, thumpHz: 88, knockDecay: 0.065, thumpDecay: 0.075, knockLvl: 0.95, clickLvl: 0.24, thumpLvl: 0.78 },
  { t: 1.16, pan: -0.25, seed: 53, knockHz: 300, q: 4.2, clickHz: 1450, thumpHz: 100, knockDecay: 0.055, thumpDecay: 0.065, knockLvl: 1.0, clickLvl: 0.30, thumpLvl: 0.72 },
  { t: 1.69, pan: 0.29, seed: 66, knockHz: 350, q: 4.8, clickHz: 1250, thumpHz: 91, knockDecay: 0.062, thumpDecay: 0.072, knockLvl: 0.92, clickLvl: 0.26, thumpLvl: 0.70 },
];
const stepNodes = steps.map((s, i) => makeStep(i, s));

// master: sum steps (per-step level), output. (kept dry — close foley style)
const mix = N('mixer', 1640, 360, { levelA: 1.0, levelB: 0.88, levelC: 0.97, levelD: 0.8 });
const out = N('output', 1920, 380, { gain: 0.9, normalize: true });
stepNodes.forEach((n, i) => W(n, 'out', mix, ['a', 'b', 'c', 'd'][i]));
W(mix, 'out', out, 'in');

// ---- render --------------------------------------------------------------
const sig = g.render(DURATION, SR);
const L = sig.stereo ? sig.l : sig;
const R = sig.stereo ? sig.r : sig;

function writeWav(file, l, r, sr) {
  const channels = 2, len = l.length, blockAlign = channels * 2, dataSize = len * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * blockAlign, 28); buf.writeUInt16LE(blockAlign, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  let off = 44;
  const enc = v => { v = Math.max(-1, Math.min(1, v)); return v < 0 ? v * 0x8000 : v * 0x7FFF; };
  for (let i = 0; i < len; i++) { buf.writeInt16LE(enc(l[i]) | 0, off); off += 2; buf.writeInt16LE(enc(r[i]) | 0, off); off += 2; }
  fs.writeFileSync(file, buf);
}

const wavPath = path.join(OUT_DIR, BASENAME + '.wav');
const jsonPath = path.join(OUT_DIR, BASENAME + '.json');
writeWav(wavPath, L, R, SR);
fs.writeFileSync(jsonPath, JSON.stringify(g.toJSON(), null, 2));

let peak = 0, nan = 0;
for (let i = 0; i < L.length; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (!isFinite(L[i]) || !isFinite(R[i])) nan++; if (a > peak) peak = a; }
console.log('nodes:', Object.keys(g.nodes).length, 'connections:', g.connections.length);
console.log('rendered:', L.length, 'samples', DURATION + 's @', SR, sig.stereo ? 'stereo' : 'mono', 'peak', peak.toFixed(3), 'nan', nan);
console.log('wav :', wavPath);
console.log('json:', jsonPath);
