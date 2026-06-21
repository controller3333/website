/* nodes.js — the node registry: every node type, its ports, params, and the
 * `compile()` that turns it into plain-data modules for the ParticleEngine.
 *
 * Design: a "module chain" of Shape -> Init -> Force -> OverLife -> Render
 * nodes builds up an array of module descriptors. Each chain node appends its
 * own descriptor to the upstream list:
 *      compile = (node, ins) => ({ out: [...(ins.in||[]), descriptor] })
 * An Emitter consumes a module chain (`modules`) plus an upstream emitter chain
 * (`in`) and emits an emitter chain. The Effect node turns the emitter chain
 * into the final EffectSpec.
 *
 * Port `type` tags ('mod' | 'emit') gate which ports may be wired together.
 */
(function (global) {
  'use strict';

  // ---- shared colors per category (also used to tint wires & node accents) ----
  const COL = {
    shape:   '#ffb74d',
    init:    '#64b5f6',
    force:   '#ba68c8',
    overlife:'#f06292',
    render:  '#aed581',
    emitter: '#4dd0e1',
    effect:  '#ff5277',
  };

  const TYPES = {};

  // ---- small helpers for building param defs ----
  const num   = (name, label, def, min, max, step, extra) => Object.assign({ type: 'number', name, label, default: def, min, max, step: step == null ? 0.01 : step }, extra || {});
  const int   = (name, label, def, min, max, extra) => Object.assign({ type: 'number', name, label, default: def, min, max, step: 1 }, extra || {});
  const rng   = (name, label, def, min, max, step, extra) => Object.assign({ type: 'range', name, label, default: def, min, max, step: step == null ? 0.01 : step }, extra || {});
  const sel   = (name, label, def, options, extra) => Object.assign({ type: 'select', name, label, default: def, options }, extra || {});
  const tog   = (name, label, def, extra) => Object.assign({ type: 'toggle', name, label, default: def }, extra || {});
  const col   = (name, label, def, extra) => Object.assign({ type: 'color', name, label, default: def }, extra || {});
  const grad  = (name, label, def, extra) => Object.assign({ type: 'gradient', name, label, default: def }, extra || {});
  const curve = (name, label, def, extra) => Object.assign({ type: 'curve', name, label, default: def }, extra || {});

  // default curve helpers: a curve is {points:[{t,v}...], from, to} where v∈[0,1]
  const C = (pts, from, to) => ({ points: pts, from: from, to: to });
  const RAMP_DOWN = (from, to) => C([{ t: 0, v: 1 }, { t: 1, v: 0 }], from, to);
  const RAMP_UP   = (from, to) => C([{ t: 0, v: 0 }, { t: 1, v: 1 }], from, to);
  const GROW_FADE = (from, to) => C([{ t: 0, v: 0 }, { t: 0.25, v: 1 }, { t: 1, v: 0 }], from, to);

  function def(type, o) { o.type = type; TYPES[type] = o; return o; }

  // ===== module-chain helper: append a descriptor onto the upstream list =====
  function chainOut(ins, descriptor) {
    return { out: [...(ins.in || []), descriptor] };
  }
  const MOD_IN  = { name: 'in',  label: 'in',  type: 'mod' };
  const MOD_OUT = { name: 'out', label: 'out', type: 'mod' };
  const modPorts = { inputs: [MOD_IN], outputs: [MOD_OUT] };

  // =====================================================================
  //  SHAPE nodes — where particles spawn + the outward "normal" direction
  // =====================================================================
  def('shapePoint', {
    category: 'Shape', color: COL.shape,
    title: { en: 'Point', ja: '点' },
    desc: { en: 'Spawn all particles at the emitter origin.', ja: 'エミッタ原点から放出。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [],
    compile: (n, ins) => chainOut(ins, { cat: 'shape', kind: 'point' }),
  });

  def('shapeCircle', {
    category: 'Shape', color: COL.shape,
    title: { en: 'Circle', ja: '円' },
    desc: { en: 'Spawn inside a disk; normal points outward.', ja: '円盤内に放出。法線は外向き。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      num('radius', 'Radius', 40, 0, 600, 1, { unit: 'px' }),
      tog('edge', 'Edge only', false),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'shape', kind: 'circle', radius: n.params.radius, edge: n.params.edge }),
  });

  def('shapeRing', {
    category: 'Shape', color: COL.shape,
    title: { en: 'Ring', ja: 'リング' },
    desc: { en: 'Spawn on a ring of given radius/thickness.', ja: '半径と太さで指定したリング上に放出。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      num('radius', 'Radius', 60, 0, 600, 1, { unit: 'px' }),
      num('thickness', 'Thickness', 6, 0, 200, 1, { unit: 'px' }),
      rng('arc', 'Arc°', [0, 360], 0, 360, 1, { unit: '°' }),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'shape', kind: 'ring', radius: n.params.radius, thickness: n.params.thickness, arc: n.params.arc }),
  });

  def('shapeCone', {
    category: 'Shape', color: COL.shape,
    title: { en: 'Cone', ja: 'コーン' },
    desc: { en: 'Emit in a directional cone (angle ± spread).', ja: '指定方向±広がりのコーン状に放出。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      num('angle', 'Direction°', -90, -180, 180, 1, { unit: '°' }),
      num('spread', 'Spread°', 30, 0, 360, 1, { unit: '°' }),
      num('radius', 'Base radius', 0, 0, 400, 1, { unit: 'px' }),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'shape', kind: 'cone', angle: n.params.angle, spread: n.params.spread, radius: n.params.radius }),
  });

  def('shapeBox', {
    category: 'Shape', color: COL.shape,
    title: { en: 'Box', ja: '矩形' },
    desc: { en: 'Spawn inside a rectangle.', ja: '矩形内に放出。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      num('width', 'Width', 200, 0, 1200, 1, { unit: 'px' }),
      num('height', 'Height', 20, 0, 1200, 1, { unit: 'px' }),
      tog('edge', 'Edge only', false),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'shape', kind: 'box', width: n.params.width, height: n.params.height, edge: n.params.edge }),
  });

  def('shapeLine', {
    category: 'Shape', color: COL.shape,
    title: { en: 'Line', ja: '線' },
    desc: { en: 'Spawn along a line; normal is perpendicular.', ja: '線分上に放出。法線は垂直方向。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      num('length', 'Length', 200, 0, 1200, 1, { unit: 'px' }),
      num('angle', 'Angle°', 0, -180, 180, 1, { unit: '°' }),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'shape', kind: 'line', length: n.params.length, angle: n.params.angle }),
  });

  // =====================================================================
  //  INIT nodes — set initial per-particle properties
  // =====================================================================
  def('initSpeed', {
    category: 'Init', color: COL.init,
    title: { en: 'Init Speed', ja: '初速' },
    desc: { en: 'Give particles an initial speed along a chosen direction.', ja: '指定方向に初速を与える。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      sel('mode', 'Direction', 'shape', ['shape', 'angle', 'random']),
      rng('speed', 'Speed', [40, 120], 0, 2000, 1, { unit: 'px/s' }),
      num('angle', 'Angle°', -90, -180, 180, 1, { unit: '°', when: p => p.mode === 'angle' }),
      num('spread', 'Spread°', 20, 0, 360, 1, { unit: '°', when: p => p.mode === 'angle' }),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'init', prop: 'speed', mode: n.params.mode, speed: n.params.speed, angle: n.params.angle, spread: n.params.spread }),
  });

  def('initVelocity', {
    category: 'Init', color: COL.init,
    title: { en: 'Init Velocity', ja: '初速度(XY)' },
    desc: { en: 'Set initial velocity components directly.', ja: 'X/Y成分で初速度を直接指定。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      rng('vx', 'Vel X', [-50, 50], -2000, 2000, 1, { unit: 'px/s' }),
      rng('vy', 'Vel Y', [-50, 50], -2000, 2000, 1, { unit: 'px/s' }),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'init', prop: 'velocity', vx: n.params.vx, vy: n.params.vy }),
  });

  def('initSize', {
    category: 'Init', color: COL.init,
    title: { en: 'Init Size', ja: '初期サイズ' },
    desc: { en: 'Initial particle radius (random range).', ja: '初期半径(ランダム範囲)。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [ rng('size', 'Size', [3, 8], 0, 300, 0.5, { unit: 'px' }) ],
    compile: (n, ins) => chainOut(ins, { cat: 'init', prop: 'size', size: n.params.size }),
  });

  def('initLife', {
    category: 'Init', color: COL.init,
    title: { en: 'Init Lifetime', ja: '寿命' },
    desc: { en: 'How long each particle lives (seconds).', ja: '各パーティクルの寿命(秒)。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [ rng('life', 'Life', [0.8, 1.4], 0.05, 20, 0.05, { unit: 's' }) ],
    compile: (n, ins) => chainOut(ins, { cat: 'init', prop: 'life', life: n.params.life }),
  });

  def('initColor', {
    category: 'Init', color: COL.init,
    title: { en: 'Init Color', ja: '初期色' },
    desc: { en: 'Base color; optionally pick randomly between two.', ja: 'ベース色。2色間でランダムも可。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      col('color', 'Color A', '#ffd166'),
      tog('random', 'Random A→B', false),
      col('colorB', 'Color B', '#ef476f', { when: p => p.random }),
      num('alpha', 'Alpha', 1, 0, 1, 0.01),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'init', prop: 'color', color: n.params.color, colorB: n.params.colorB, random: n.params.random, alpha: n.params.alpha }),
  });

  def('initColorHSV', {
    category: 'Init', color: COL.init,
    title: { en: 'Init Color (HSV)', ja: '初期色(HSV)' },
    desc: { en: 'Random base color within an HSV range.', ja: 'HSV範囲でランダムなベース色。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      rng('hue', 'Hue', [0, 60], 0, 360, 1, { unit: '°' }),
      rng('sat', 'Saturation', [0.7, 1], 0, 1, 0.01),
      rng('val', 'Value', [0.8, 1], 0, 1, 0.01),
      num('alpha', 'Alpha', 1, 0, 1, 0.01),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'init', prop: 'colorHSV', hue: n.params.hue, sat: n.params.sat, val: n.params.val, alpha: n.params.alpha }),
  });

  def('initRotation', {
    category: 'Init', color: COL.init,
    title: { en: 'Init Rotation', ja: '初期角度' },
    desc: { en: 'Initial sprite rotation and spin (angular vel).', ja: '初期回転角と回転速度。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      rng('rotation', 'Rotation°', [0, 360], -360, 360, 1, { unit: '°' }),
      rng('spin', 'Spin°/s', [-90, 90], -1440, 1440, 1, { unit: '°/s' }),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'init', prop: 'rotation', rotation: n.params.rotation, spin: n.params.spin }),
  });

  // =====================================================================
  //  FORCE nodes — modify velocity over time
  // =====================================================================
  def('forceGravity', {
    category: 'Force', color: COL.force,
    title: { en: 'Gravity', ja: '重力' },
    desc: { en: 'Constant downward (or any) acceleration.', ja: '一定方向(既定は下)への加速度。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      num('gx', 'Accel X', 0, -3000, 3000, 1, { unit: 'px/s²' }),
      num('gy', 'Accel Y', 300, -3000, 3000, 1, { unit: 'px/s²' }),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'force', kind: 'gravity', gx: n.params.gx, gy: n.params.gy }),
  });

  def('forceDrag', {
    category: 'Force', color: COL.force,
    title: { en: 'Drag', ja: '抵抗' },
    desc: { en: 'Air resistance that slows particles.', ja: '速度を減衰させる空気抵抗。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [ num('drag', 'Drag', 1.2, 0, 20, 0.05, { unit: '/s' }) ],
    compile: (n, ins) => chainOut(ins, { cat: 'force', kind: 'drag', drag: n.params.drag }),
  });

  def('forceTurbulence', {
    category: 'Force', color: COL.force,
    title: { en: 'Turbulence', ja: '乱流' },
    desc: { en: 'Curl-noise swirl for smoke/fire motion.', ja: 'カールノイズによる渦。煙や炎向け。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      num('strength', 'Strength', 200, 0, 3000, 1, { unit: 'px/s²' }),
      num('scale', 'Scale', 0.01, 0.001, 0.2, 0.001, { log: true }),
      num('speed', 'Evolve', 0.5, 0, 5, 0.01),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'force', kind: 'turbulence', strength: n.params.strength, scale: n.params.scale, speed: n.params.speed }),
  });

  def('forceWind', {
    category: 'Force', color: COL.force,
    title: { en: 'Wind', ja: '風' },
    desc: { en: 'Steady directional push with a little gust.', ja: '一定方向の押し+わずかな突風。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      num('angle', 'Angle°', 0, -180, 180, 1, { unit: '°' }),
      num('strength', 'Strength', 120, 0, 3000, 1, { unit: 'px/s²' }),
      num('gust', 'Gust', 0.2, 0, 2, 0.01),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'force', kind: 'wind', angle: n.params.angle, strength: n.params.strength, gust: n.params.gust }),
  });

  def('forceAttractor', {
    category: 'Force', color: COL.force,
    title: { en: 'Attractor', ja: '引力点' },
    desc: { en: 'Pull toward (or push from) a point.', ja: 'ある点へ引き寄せ/押し出す。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      num('x', 'Pos X', 0, -800, 800, 1, { unit: 'px' }),
      num('y', 'Pos Y', 0, -800, 800, 1, { unit: 'px' }),
      num('strength', 'Strength', 600, -5000, 5000, 1),
      num('radius', 'Falloff R', 200, 1, 1200, 1, { unit: 'px' }),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'force', kind: 'attractor', x: n.params.x, y: n.params.y, strength: n.params.strength, radius: n.params.radius }),
  });

  def('forceVortex', {
    category: 'Force', color: COL.force,
    title: { en: 'Vortex', ja: '渦' },
    desc: { en: 'Rotational force around a point.', ja: 'ある点を中心に回転させる力。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      num('x', 'Pos X', 0, -800, 800, 1, { unit: 'px' }),
      num('y', 'Pos Y', 0, -800, 800, 1, { unit: 'px' }),
      num('strength', 'Strength', 400, -5000, 5000, 1),
      num('inward', 'Inward', 0.2, -2, 2, 0.01),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'force', kind: 'vortex', x: n.params.x, y: n.params.y, strength: n.params.strength, inward: n.params.inward }),
  });

  def('forceRadial', {
    category: 'Force', color: COL.force,
    title: { en: 'Radial Force', ja: '放射力' },
    desc: { en: 'Accelerate outward/inward from emitter center.', ja: 'エミッタ中心から外/内へ加速。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [ num('strength', 'Strength', 300, -5000, 5000, 1) ],
    compile: (n, ins) => chainOut(ins, { cat: 'force', kind: 'radial', strength: n.params.strength }),
  });

  def('forceBounce', {
    category: 'Force', color: COL.force,
    title: { en: 'Floor Bounce', ja: '床バウンド' },
    desc: { en: 'Bounce particles off a horizontal floor.', ja: '水平な床でパーティクルを跳ね返す。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      num('floor', 'Floor Y', 200, -800, 800, 1, { unit: 'px' }),
      num('bounce', 'Bounciness', 0.5, 0, 1, 0.01),
      num('friction', 'Friction', 0.2, 0, 1, 0.01),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'force', kind: 'bounce', floor: n.params.floor, bounce: n.params.bounce, friction: n.params.friction }),
  });

  // =====================================================================
  //  OVER-LIFE nodes — animate properties across the particle's life
  // =====================================================================
  def('colorOverLife', {
    category: 'OverLife', color: COL.overlife,
    title: { en: 'Color over Life', ja: '色(寿命)' },
    desc: { en: 'Tint particles via a gradient sampled by age.', ja: '寿命に沿ってグラデーションで着色。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      grad('gradient', 'Gradient', [
        { t: 0, c: '#ffffff' }, { t: 0.3, c: '#ffcc33' }, { t: 0.7, c: '#ff3b30' }, { t: 1, c: '#3a0000' },
      ]),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'overlife', prop: 'color', gradient: n.params.gradient }),
  });

  def('alphaOverLife', {
    category: 'OverLife', color: COL.overlife,
    title: { en: 'Alpha over Life', ja: '不透明度(寿命)' },
    desc: { en: 'Fade alpha across the particle life.', ja: '寿命に沿って不透明度を変化。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [ curve('curve', 'Alpha', GROW_FADE(0, 1)) ],
    compile: (n, ins) => chainOut(ins, { cat: 'overlife', prop: 'alpha', curve: n.params.curve }),
  });

  def('sizeOverLife', {
    category: 'OverLife', color: COL.overlife,
    title: { en: 'Size over Life', ja: 'サイズ(寿命)' },
    desc: { en: 'Scale size across the life (multiplier).', ja: '寿命に沿ってサイズ倍率を変化。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [ curve('curve', 'Scale', C([{ t: 0, v: 0.2 }, { t: 0.2, v: 1 }, { t: 1, v: 0 }], 0, 1.5)) ],
    compile: (n, ins) => chainOut(ins, { cat: 'overlife', prop: 'size', curve: n.params.curve }),
  });

  def('velocityOverLife', {
    category: 'OverLife', color: COL.overlife,
    title: { en: 'Velocity over Life', ja: '速度(寿命)' },
    desc: { en: 'Scale velocity across the life (e.g. ease-out).', ja: '寿命に沿って速度を倍率変化。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [ curve('curve', 'Scale', RAMP_DOWN(0, 1)) ],
    compile: (n, ins) => chainOut(ins, { cat: 'overlife', prop: 'velocity', curve: n.params.curve }),
  });

  // =====================================================================
  //  RENDER nodes — how particles are drawn
  // =====================================================================
  def('render', {
    category: 'Render', color: COL.render,
    title: { en: 'Renderer', ja: '描画' },
    desc: { en: 'Draw particles as a procedural sprite.', ja: 'プロシージャルなスプライトで描画。' },
    inputs: [MOD_IN], outputs: [MOD_OUT],
    params: [
      sel('shape', 'Shape', 'soft', ['soft', 'circle', 'square', 'triangle', 'star', 'ring', 'spark', 'plus', 'emoji']),
      { type: 'text', name: 'emoji', label: 'Emoji/Text', default: '✨', when: p => p.shape === 'emoji' },
      sel('blend', 'Blend', 'add', ['add', 'normal', 'screen', 'lighter']),
      num('glow', 'Glow', 0.4, 0, 1, 0.01),
      num('stretch', 'Vel. Stretch', 0, 0, 8, 0.05),
      num('softness', 'Softness', 0.5, 0, 1, 0.01, { when: p => p.shape === 'soft' || p.shape === 'circle' }),
    ],
    compile: (n, ins) => chainOut(ins, { cat: 'render', shape: n.params.shape, emoji: n.params.emoji, blend: n.params.blend, glow: n.params.glow, stretch: n.params.stretch, softness: n.params.softness }),
  });

  // =====================================================================
  //  EMITTER — bundles a module chain into a spawnable emitter
  // =====================================================================
  def('emitter', {
    category: 'Emitter', color: COL.emitter,
    title: { en: 'Emitter', ja: 'エミッタ' },
    desc: { en: 'Spawns particles using the attached module chain.', ja: '接続したモジュール列でパーティクルを放出。' },
    inputs: [
      { name: 'modules', label: 'modules', type: 'mod' },
      { name: 'in', label: 'emitters', type: 'emit' },
    ],
    outputs: [ { name: 'out', label: 'out', type: 'emit' } ],
    params: [
      num('rate', 'Rate', 120, 0, 5000, 1, { unit: '/s' }),
      int('burst', 'Burst', 0, 0, 5000, { unit: 'p' }),
      num('duration', 'Emit dur', 0, 0, 30, 0.05, { unit: 's', hint: { en: '0 = continuous', ja: '0で連続' } }),
      tog('loop', 'Loop', true),
      num('delay', 'Delay', 0, 0, 10, 0.05, { unit: 's' }),
      int('max', 'Max particles', 2000, 1, 50000),
      num('ox', 'Origin X', 0, -800, 800, 1, { unit: 'px' }),
      num('oy', 'Origin Y', 0, -800, 800, 1, { unit: 'px' }),
      num('prewarm', 'Prewarm', 0, 0, 10, 0.05, { unit: 's' }),
    ],
    compile: (n, ins) => {
      const mods = ins.modules || [];
      const part = { shape: null, inits: [], forces: [], overlife: [], render: null };
      for (const m of mods) {
        if (m.cat === 'shape') part.shape = m;
        else if (m.cat === 'init') part.inits.push(m);
        else if (m.cat === 'force') part.forces.push(m);
        else if (m.cat === 'overlife') part.overlife.push(m);
        else if (m.cat === 'render') part.render = m;
      }
      const em = {
        rate: n.params.rate, burst: n.params.burst, duration: n.params.duration,
        loop: n.params.loop, delay: n.params.delay, max: n.params.max,
        ox: n.params.ox, oy: n.params.oy, prewarm: n.params.prewarm,
        shape: part.shape, inits: part.inits, forces: part.forces,
        overlife: part.overlife, render: part.render,
      };
      return { out: [...(ins.in || []), em] };
    },
  });

  // =====================================================================
  //  EFFECT — the output sink; produces the final EffectSpec
  // =====================================================================
  def('effect', {
    category: 'Output', color: COL.effect,
    singleton: true,
    title: { en: 'Effect Output', ja: 'エフェクト出力' },
    desc: { en: 'Final effect. Connect emitters here.', ja: '最終出力。エミッタを接続。' },
    inputs: [ { name: 'emitters', label: 'emitters', type: 'emit' } ],
    outputs: [],
    params: [
      col('background', 'Background', '#0a0a12'),
      num('persistence', 'Trails', 0, 0, 0.98, 0.01, { hint: { en: 'motion-blur persistence', ja: '残像(モーションブラー)' } }),
      num('timeScale', 'Time scale', 1, 0.05, 4, 0.05),
    ],
    compile: (n, ins) => ({
      spec: {
        background: n.params.background,
        persistence: n.params.persistence,
        timeScale: n.params.timeScale,
        emitters: ins.emitters || [],
      },
    }),
  });

  // ---- public lookups ----
  function title(type, lang) {
    const d = TYPES[type]; if (!d) return type;
    return (d.title && d.title[lang]) || (d.title && d.title.en) || type;
  }
  function paramDesc(type, name, lang) {
    const d = TYPES[type]; if (!d) return '';
    const pd = d.params.find(p => p.name === name);
    if (!pd || !pd.hint) return '';
    return pd.hint[lang] || pd.hint.en || '';
  }
  function nodeDesc(type, lang) {
    const d = TYPES[type]; if (!d || !d.desc) return '';
    return d.desc[lang] || d.desc.en || '';
  }

  // palette grouping order
  const CATEGORIES = ['Shape', 'Init', 'Force', 'OverLife', 'Render', 'Emitter', 'Output'];

  global.Nodes = { TYPES, title, paramDesc, nodeDesc, CATEGORIES, COL };
})(window);
