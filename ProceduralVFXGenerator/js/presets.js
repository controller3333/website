/* presets.js — ready-made effect graphs, built with a small layout helper.
 * Each preset returns graph JSON (nodes + connections) ready for Graph.fromJSON. */
(function (global) {
  'use strict';

  let _id = 1;
  function reset() { _id = 1; }
  function nid(t) { return t + '_' + (_id++); }
  function wire(fn, fp, tn, tp) { return { id: 'c_' + (_id++), from: { node: fn, port: fp }, to: { node: tn, port: tp } }; }

  // build({effect, emitters:[{params, modules:[{type,params}]}]}) -> graph JSON
  function build(spec) {
    reset();
    const nodes = [], conns = [];
    const effectId = 'effect_0';
    nodes.push({ id: effectId, type: 'effect', x: 1040, y: 220, params: spec.effect || {} });
    let prevEmit = null;
    (spec.emitters || []).forEach((em, ei) => {
      const emId = nid('emitter');
      const baseY = 60 + ei * 300;
      const mods = em.modules || [];
      const emX = 120 + mods.length * 160 + 40;
      nodes.push({ id: emId, type: 'emitter', x: emX, y: baseY + 40, params: em.params || {} });
      let prevMod = null;
      mods.forEach((m, mi) => {
        const mId = nid(m.type);
        nodes.push({ id: mId, type: m.type, x: 120 + mi * 160, y: baseY, params: m.params || {} });
        if (prevMod) conns.push(wire(prevMod, 'out', mId, 'in'));
        prevMod = mId;
      });
      if (prevMod) conns.push(wire(prevMod, 'out', emId, 'modules'));
      if (prevEmit) conns.push(wire(prevEmit, 'out', emId, 'in'));
      prevEmit = emId;
    });
    if (prevEmit) conns.push(wire(prevEmit, 'out', effectId, 'emitters'));
    return { version: 1, app: 'ProceduralVFXGenerator', nodes, connections: conns };
  }

  const G = (pts, from, to) => ({ points: pts, from, to });

  const PRESETS = {
    'Fire 🔥': () => build({
      effect: { background: '#0a0608', persistence: 0.12 },
      emitters: [{
        params: { rate: 180, ox: 0, oy: 60 },
        modules: [
          { type: 'shapeCircle', params: { radius: 16, edge: false } },
          { type: 'initSpeed', params: { mode: 'angle', speed: [40, 90], angle: -90, spread: 24 } },
          { type: 'initSize', params: { size: [10, 22] } },
          { type: 'initLife', params: { life: [0.6, 1.1] } },
          { type: 'forceTurbulence', params: { strength: 220, scale: 0.012, speed: 0.8 } },
          { type: 'forceGravity', params: { gx: 0, gy: -130 } },
          { type: 'colorOverLife', params: { gradient: [{ t: 0, c: '#fff7d6' }, { t: 0.25, c: '#ffcf4d' }, { t: 0.6, c: '#ff5a1f' }, { t: 1, c: '#2a0500' }] } },
          { type: 'sizeOverLife', params: { curve: G([{ t: 0, v: 0.4 }, { t: 0.3, v: 1 }, { t: 1, v: 0.1 }], 0, 1.4) } },
          { type: 'alphaOverLife', params: { curve: G([{ t: 0, v: 0 }, { t: 0.15, v: 1 }, { t: 1, v: 0 }], 0, 1) } },
          { type: 'render', params: { shape: 'soft', blend: 'add', glow: 0.5, softness: 0.7 } },
        ],
      }],
    }),

    'Explosion 💥': () => build({
      effect: { background: '#08060a', persistence: 0.2 },
      emitters: [{
        params: { rate: 0, burst: 240, duration: 1.6, loop: true },
        modules: [
          { type: 'shapePoint', params: {} },
          { type: 'initSpeed', params: { mode: 'random', speed: [120, 560] } },
          { type: 'initSize', params: { size: [3, 9] } },
          { type: 'initLife', params: { life: [0.4, 1.0] } },
          { type: 'forceDrag', params: { drag: 2.6 } },
          { type: 'forceGravity', params: { gx: 0, gy: 220 } },
          { type: 'colorOverLife', params: { gradient: [{ t: 0, c: '#ffffff' }, { t: 0.2, c: '#ffd24d' }, { t: 0.55, c: '#ff4d22' }, { t: 1, c: '#3a0a00' }] } },
          { type: 'sizeOverLife', params: { curve: G([{ t: 0, v: 1 }, { t: 1, v: 0 }], 0, 1.2) } },
          { type: 'alphaOverLife', params: { curve: G([{ t: 0, v: 1 }, { t: 0.7, v: 1 }, { t: 1, v: 0 }], 0, 1) } },
          { type: 'render', params: { shape: 'spark', blend: 'add', glow: 0.6, stretch: 1.5 } },
        ],
      }],
    }),

    'Smoke 💨': () => build({
      effect: { background: '#15161a', persistence: 0 },
      emitters: [{
        params: { rate: 50, ox: 0, oy: 80 },
        modules: [
          { type: 'shapeCircle', params: { radius: 20 } },
          { type: 'initSpeed', params: { mode: 'angle', speed: [20, 50], angle: -90, spread: 20 } },
          { type: 'initSize', params: { size: [24, 44] } },
          { type: 'initLife', params: { life: [1.8, 3.2] } },
          { type: 'forceTurbulence', params: { strength: 80, scale: 0.006, speed: 0.4 } },
          { type: 'forceGravity', params: { gx: 10, gy: -40 } },
          { type: 'colorOverLife', params: { gradient: [{ t: 0, c: '#9aa0aa' }, { t: 0.5, c: '#5b606b' }, { t: 1, c: '#23262c' }] } },
          { type: 'sizeOverLife', params: { curve: G([{ t: 0, v: 0.3 }, { t: 1, v: 1 }], 0, 1.6) } },
          { type: 'alphaOverLife', params: { curve: G([{ t: 0, v: 0 }, { t: 0.2, v: 0.7 }, { t: 1, v: 0 }], 0, 1) } },
          { type: 'render', params: { shape: 'soft', blend: 'normal', glow: 0, softness: 0.9 } },
        ],
      }],
    }),

    'Magic Sparkle ✨': () => build({
      effect: { background: '#0a0716', persistence: 0.3 },
      emitters: [{
        params: { rate: 120, ox: 0, oy: 0 },
        modules: [
          { type: 'shapeCircle', params: { radius: 70, edge: true } },
          { type: 'initSpeed', params: { mode: 'shape', speed: [-30, 20] } },
          { type: 'initSize', params: { size: [2, 5] } },
          { type: 'initLife', params: { life: [0.7, 1.6] } },
          { type: 'initRotation', params: { rotation: [0, 360], spin: [-180, 180] } },
          { type: 'forceVortex', params: { x: 0, y: 0, strength: 120, inward: 0.4 } },
          { type: 'colorOverLife', params: { gradient: [{ t: 0, c: '#ffffff' }, { t: 0.4, c: '#7df9ff' }, { t: 0.8, c: '#c77dff' }, { t: 1, c: '#3a0a55' }] } },
          { type: 'sizeOverLife', params: { curve: G([{ t: 0, v: 0 }, { t: 0.3, v: 1 }, { t: 1, v: 0 }], 0, 1.4) } },
          { type: 'alphaOverLife', params: { curve: G([{ t: 0, v: 0 }, { t: 0.2, v: 1 }, { t: 1, v: 0 }], 0, 1) } },
          { type: 'render', params: { shape: 'star', blend: 'add', glow: 0.7 } },
        ],
      }],
    }),

    'Fountain ⛲': () => build({
      effect: { background: '#06101a', persistence: 0.1 },
      emitters: [{
        params: { rate: 220, ox: 0, oy: 120 },
        modules: [
          { type: 'shapePoint', params: {} },
          { type: 'initSpeed', params: { mode: 'angle', speed: [300, 440], angle: -90, spread: 22 } },
          { type: 'initSize', params: { size: [3, 6] } },
          { type: 'initLife', params: { life: [1.0, 1.8] } },
          { type: 'forceGravity', params: { gx: 0, gy: 620 } },
          { type: 'forceDrag', params: { drag: 0.3 } },
          { type: 'colorOverLife', params: { gradient: [{ t: 0, c: '#dffaff' }, { t: 0.5, c: '#4db6ff' }, { t: 1, c: '#0a3a8a' }] } },
          { type: 'alphaOverLife', params: { curve: G([{ t: 0, v: 1 }, { t: 0.8, v: 0.9 }, { t: 1, v: 0 }], 0, 1) } },
          { type: 'render', params: { shape: 'soft', blend: 'add', glow: 0.4, softness: 0.6 } },
        ],
      }],
    }),

    'Rain 🌧': () => build({
      effect: { background: '#10131a', persistence: 0 },
      emitters: [{
        params: { rate: 300, ox: 0, oy: -260 },
        modules: [
          { type: 'shapeBox', params: { width: 700, height: 10 } },
          { type: 'initVelocity', params: { vx: [-40, -20], vy: [620, 820] } },
          { type: 'initSize', params: { size: [1.5, 3] } },
          { type: 'initLife', params: { life: [0.7, 1.0] } },
          { type: 'colorOverLife', params: { gradient: [{ t: 0, c: '#aacbe6' }, { t: 1, c: '#5878a0' }] } },
          { type: 'render', params: { shape: 'spark', blend: 'screen', glow: 0.1, stretch: 3 } },
        ],
      }],
    }),

    'Snow ❄': () => build({
      effect: { background: '#0c1018', persistence: 0 },
      emitters: [{
        params: { rate: 90, ox: 0, oy: -260 },
        modules: [
          { type: 'shapeBox', params: { width: 720, height: 10 } },
          { type: 'initVelocity', params: { vx: [-20, 20], vy: [40, 90] } },
          { type: 'initSize', params: { size: [2, 5] } },
          { type: 'initLife', params: { life: [4, 6] } },
          { type: 'initRotation', params: { rotation: [0, 360], spin: [-40, 40] } },
          { type: 'forceTurbulence', params: { strength: 30, scale: 0.008, speed: 0.3 } },
          { type: 'colorOverLife', params: { gradient: [{ t: 0, c: '#ffffff' }, { t: 1, c: '#dfe9f5' }] } },
          { type: 'alphaOverLife', params: { curve: G([{ t: 0, v: 0 }, { t: 0.1, v: 1 }, { t: 0.9, v: 1 }, { t: 1, v: 0 }], 0, 1) } },
          { type: 'render', params: { shape: 'soft', blend: 'screen', glow: 0.2, softness: 0.8 } },
        ],
      }],
    }),

    'Confetti 🎉': () => build({
      effect: { background: '#0a0a12', persistence: 0 },
      emitters: [{
        params: { rate: 0, burst: 160, duration: 2.2, loop: true, ox: 0, oy: 120 },
        modules: [
          { type: 'shapePoint', params: {} },
          { type: 'initSpeed', params: { mode: 'angle', speed: [350, 620], angle: -90, spread: 70 } },
          { type: 'initSize', params: { size: [4, 8] } },
          { type: 'initLife', params: { life: [1.4, 2.4] } },
          { type: 'initColor', params: { color: '#ff4d6d', random: true, colorB: '#4dd0ff' } },
          { type: 'initRotation', params: { rotation: [0, 360], spin: [-360, 360] } },
          { type: 'forceGravity', params: { gx: 0, gy: 520 } },
          { type: 'forceDrag', params: { drag: 1.2 } },
          { type: 'alphaOverLife', params: { curve: G([{ t: 0, v: 1 }, { t: 0.8, v: 1 }, { t: 1, v: 0 }], 0, 1) } },
          { type: 'render', params: { shape: 'square', blend: 'normal', glow: 0 } },
        ],
      }],
    }),

    'Portal 🌀': () => build({
      effect: { background: '#080612', persistence: 0.45 },
      emitters: [{
        params: { rate: 260, ox: 0, oy: 0 },
        modules: [
          { type: 'shapeRing', params: { radius: 90, thickness: 30, arc: [0, 360] } },
          { type: 'initSpeed', params: { mode: 'shape', speed: [-10, 10] } },
          { type: 'initSize', params: { size: [2, 5] } },
          { type: 'initLife', params: { life: [0.8, 1.6] } },
          { type: 'forceVortex', params: { x: 0, y: 0, strength: 300, inward: 0.5 } },
          { type: 'colorOverLife', params: { gradient: [{ t: 0, c: '#e0c3fc' }, { t: 0.5, c: '#8e2de2' }, { t: 1, c: '#2a0845' }] } },
          { type: 'sizeOverLife', params: { curve: G([{ t: 0, v: 1 }, { t: 1, v: 0 }], 0, 1.2) } },
          { type: 'alphaOverLife', params: { curve: G([{ t: 0, v: 0 }, { t: 0.2, v: 1 }, { t: 1, v: 0 }], 0, 1) } },
          { type: 'render', params: { shape: 'soft', blend: 'add', glow: 0.6, softness: 0.6 } },
        ],
      }],
    }),

    'Rainbow Burst 🌈': () => build({
      effect: { background: '#0a0a12', persistence: 0.15 },
      emitters: [{
        params: { rate: 0, burst: 200, duration: 1.4, loop: true },
        modules: [
          { type: 'shapePoint', params: {} },
          { type: 'initSpeed', params: { mode: 'random', speed: [120, 400] } },
          { type: 'initSize', params: { size: [4, 9] } },
          { type: 'initLife', params: { life: [0.8, 1.4] } },
          { type: 'initColorHSV', params: { hue: [0, 360], sat: [0.8, 1], val: [0.9, 1], alpha: 1 } },
          { type: 'forceDrag', params: { drag: 1.8 } },
          { type: 'sizeOverLife', params: { curve: G([{ t: 0, v: 1 }, { t: 1, v: 0 }], 0, 1.2) } },
          { type: 'alphaOverLife', params: { curve: G([{ t: 0, v: 1 }, { t: 0.7, v: 1 }, { t: 1, v: 0 }], 0, 1) } },
          { type: 'render', params: { shape: 'soft', blend: 'add', glow: 0.6, softness: 0.5 } },
        ],
      }],
    }),

    'Bouncy Coins 🪙': () => build({
      effect: { background: '#0c0d13', persistence: 0 },
      emitters: [{
        params: { rate: 18, ox: 0, oy: -180 },
        modules: [
          { type: 'shapeBox', params: { width: 400, height: 10 } },
          { type: 'initVelocity', params: { vx: [-60, 60], vy: [0, 60] } },
          { type: 'initSize', params: { size: [14, 20] } },
          { type: 'initLife', params: { life: [3, 4.5] } },
          { type: 'initRotation', params: { rotation: [0, 360], spin: [-120, 120] } },
          { type: 'forceGravity', params: { gx: 0, gy: 700 } },
          { type: 'forceBounce', params: { floor: 200, bounce: 0.55, friction: 0.15 } },
          { type: 'alphaOverLife', params: { curve: G([{ t: 0, v: 1 }, { t: 0.85, v: 1 }, { t: 1, v: 0 }], 0, 1) } },
          { type: 'render', params: { shape: 'emoji', emoji: '🪙', blend: 'normal', glow: 0 } },
        ],
      }],
    }),

    'Fireworks 🎆': () => build({
      effect: { background: '#05060c', persistence: 0.7 },
      emitters: [{
        params: { rate: 0, burst: 220, duration: 2.0, loop: true },
        modules: [
          { type: 'shapePoint', params: {} },
          { type: 'initSpeed', params: { mode: 'random', speed: [180, 320] } },
          { type: 'initSize', params: { size: [2, 4] } },
          { type: 'initLife', params: { life: [1.0, 1.8] } },
          { type: 'initColor', params: { color: '#ffd166', random: true, colorB: '#06d6a0' } },
          { type: 'forceGravity', params: { gx: 0, gy: 90 } },
          { type: 'forceDrag', params: { drag: 1.0 } },
          { type: 'colorOverLife', params: { gradient: [{ t: 0, c: '#ffffff' }, { t: 0.3, c: '#ffe08a' }, { t: 1, c: '#ff3b6b' }] } },
          { type: 'alphaOverLife', params: { curve: G([{ t: 0, v: 1 }, { t: 0.6, v: 1 }, { t: 1, v: 0 }], 0, 1) } },
          { type: 'render', params: { shape: 'soft', blend: 'add', glow: 0.7, softness: 0.5 } },
        ],
      }],
    }),
  };

  global.PRESETS = PRESETS;
  global.PRESET_BUILD = build;
})(window);
