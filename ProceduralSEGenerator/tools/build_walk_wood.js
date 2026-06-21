/* build_walk_wood.js
 *
 * Run: node tools/build_walk_wood.js
 *
 * Renders the built-in "Wood Floor Walk (Creaky)" preset to a WAV file.
 * The sound is fully procedural: no external samples are used.
 */
'use strict';

const fs = require('fs');
const path = require('path');

global.window = global;
require(path.join(__dirname, '..', 'js', 'dsp.js'));
require(path.join(__dirname, '..', 'js', 'graph.js'));
require(path.join(__dirname, '..', 'js', 'presets.js'));

const PRESET = 'Wood Floor Walk (Creaky)';
const DURATION = 2.2;
const SR = 44100;
const OUT_DIR = path.join(__dirname, '..');
const BASENAME = 'Wood_Floor_Walk_Creaky';

const graph = PRESETS[PRESET]();
const sig = graph.render(graph.suggestedDuration || DURATION, SR);
const L = sig.stereo ? sig.l : sig;
const R = sig.stereo ? sig.r : sig;

function writeWav(file, l, r, sr) {
  const channels = 2;
  const len = l.length;
  const blockAlign = channels * 2;
  const dataSize = len * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * blockAlign, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  let off = 44;
  const enc = v => {
    v = Math.max(-1, Math.min(1, v));
    return v < 0 ? v * 0x8000 : v * 0x7FFF;
  };
  for (let i = 0; i < len; i++) {
    buf.writeInt16LE(enc(l[i]) | 0, off);
    off += 2;
    buf.writeInt16LE(enc(r[i]) | 0, off);
    off += 2;
  }
  fs.writeFileSync(file, buf);
}

const wavPath = path.join(OUT_DIR, BASENAME + '.wav');
const jsonPath = path.join(OUT_DIR, BASENAME + '.json');
writeWav(wavPath, L, R, SR);
fs.writeFileSync(jsonPath, JSON.stringify(graph.toJSON(), null, 2));

let peak = 0;
let nan = 0;
for (let i = 0; i < L.length; i++) {
  const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
  if (!isFinite(L[i]) || !isFinite(R[i])) nan++;
  if (a > peak) peak = a;
}

console.log('preset:', PRESET);
console.log('nodes:', Object.keys(graph.nodes).length, 'connections:', graph.connections.length);
console.log('rendered:', L.length, 'samples', (L.length / SR).toFixed(2) + 's @', SR, sig.stereo ? 'stereo' : 'mono', 'peak', peak.toFixed(3), 'nan', nan);
console.log('wav :', wavPath);
console.log('json:', jsonPath);
