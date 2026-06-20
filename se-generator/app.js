(() => {
  const TAU = Math.PI * 2;
  const WORLD_W = 2400;
  const WORLD_H = 1500;

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const secToSamples = (s, sr) => Math.max(1, Math.round(s * sr));

  const els = {
    palette: $("palette"),
    presetSelect: $("presetSelect"),
    loadBtn: $("loadBtn"),
    saveBtn: $("saveBtn"),
    openBtn: $("openBtn"),
    openFile: $("openFile"),
    clearBtn: $("clearBtn"),
    playBtn: $("playBtn"),
    stopBtn: $("stopBtn"),
    renderBtn: $("renderBtn"),
    wavBtn: $("wavBtn"),
    lengthInput: $("lengthInput"),
    rateSelect: $("rateSelect"),
    loopCheck: $("loopCheck"),
    autoCheck: $("autoCheck"),
    workspace: $("workspace"),
    world: $("world"),
    nodes: $("nodes"),
    wires: $("wires"),
    waveform: $("waveform"),
    status: $("status"),
  };

  const nodeDefs = {
    oscillator: {
      name: "オシレーター",
      group: "Source",
      color: "#3f83f8",
      inputs: [
        { id: "fm", label: "FM", kind: "control" },
        { id: "pm", label: "PM", kind: "control" },
      ],
      outputs: [{ id: "out", label: "出力", kind: "audio" }],
      params: [
        { id: "wave", label: "波形", type: "select", value: "sine", options: ["sine", "tri", "saw", "square"] },
        { id: "freq", label: "周波数", type: "number", value: 220, min: 10, max: 12000, step: 1, unit: "Hz" },
        { id: "fmAmount", label: "FM量", type: "number", value: 0, min: -2400, max: 2400, step: 1, unit: "Hz" },
        { id: "pmAmount", label: "PM量", type: "number", value: 0, min: -12, max: 12, step: 0.001 },
        { id: "phase", label: "位相", type: "number", value: 0, min: 0, max: 1, step: 0.001 },
      ],
    },
    noise: {
      name: "ノイズ",
      group: "Source",
      color: "#6865f2",
      inputs: [],
      outputs: [{ id: "out", label: "出力", kind: "audio" }],
      params: [
        { id: "color", label: "色", type: "select", value: "white", options: ["white", "pink", "brown"] },
        { id: "seed", label: "シード", type: "number", value: 1103, min: 1, max: 9999, step: 1 },
      ],
    },
    sample: {
      name: "サンプル",
      group: "Source",
      color: "#64748b",
      inputs: [],
      outputs: [{ id: "out", label: "出力", kind: "audio" }],
      params: [
        { id: "file", label: "ファイル", type: "file" },
        { id: "level", label: "音量", type: "number", value: 1, min: 0, max: 2, step: 0.01 },
        { id: "pitch", label: "ピッチ", type: "number", value: 0, min: -24, max: 24, step: 0.1, unit: "st" },
        { id: "start", label: "開始", type: "number", value: 0, min: 0, max: 10, step: 0.001, unit: "s" },
        { id: "reverse", label: "逆再生", type: "checkbox", value: false },
      ],
    },
    lfo: {
      name: "LFO",
      group: "Modulation",
      color: "#8b5cf6",
      inputs: [],
      outputs: [{ id: "out", label: "出力", kind: "control" }],
      params: [
        { id: "wave", label: "波形", type: "select", value: "sine", options: ["sine", "tri", "saw", "square"] },
        { id: "rate", label: "速度", type: "number", value: 6, min: 0.01, max: 60, step: 0.01, unit: "Hz" },
        { id: "depth", label: "深さ", type: "number", value: 1, min: -5000, max: 5000, step: 0.01 },
        { id: "offset", label: "中心", type: "number", value: 0, min: -5000, max: 5000, step: 0.01 },
      ],
    },
    sweep: {
      name: "スイープ",
      group: "Modulation",
      color: "#d946ef",
      inputs: [],
      outputs: [{ id: "out", label: "出力", kind: "control" }],
      params: [
        { id: "start", label: "開始値", type: "number", value: 1000, min: -12000, max: 12000, step: 1 },
        { id: "end", label: "終了値", type: "number", value: 100, min: -12000, max: 12000, step: 1 },
        { id: "time", label: "時間", type: "number", value: 0.4, min: 0.001, max: 20, step: 0.001, unit: "s" },
        { id: "curve", label: "カーブ", type: "select", value: "linear", options: ["linear", "exp", "log"] },
      ],
    },
    envelope: {
      name: "エンベロープ",
      group: "Modulation",
      color: "#e9479e",
      inputs: [
        { id: "in", label: "入力", kind: "audio" },
      ],
      outputs: [{ id: "out", label: "出力", kind: "audio" }],
      params: [
        { id: "attack", label: "立上り", type: "number", value: 0.005, min: 0, max: 5, step: 0.001, unit: "s" },
        { id: "decay", label: "減衰", type: "number", value: 0.08, min: 0, max: 5, step: 0.001, unit: "s" },
        { id: "sustain", label: "保持", type: "number", value: 0, min: 0, max: 1, step: 0.001 },
        { id: "release", label: "余韻", type: "number", value: 0.05, min: 0, max: 5, step: 0.001, unit: "s" },
        { id: "gate", label: "ゲート", type: "number", value: 0.08, min: 0.001, max: 20, step: 0.001, unit: "s" },
      ],
    },
    gain: {
      name: "ゲイン",
      group: "Processor",
      color: "#14b8a6",
      inputs: [
        { id: "in", label: "入力", kind: "audio" },
        { id: "cv", label: "CV", kind: "control" },
      ],
      outputs: [{ id: "out", label: "出力", kind: "audio" }],
      params: [
        { id: "gain", label: "倍率", type: "number", value: 1, min: 0, max: 4, step: 0.01 },
        { id: "cvAmount", label: "CV量", type: "number", value: 0, min: -4, max: 4, step: 0.01 },
      ],
    },
    filter: {
      name: "フィルター",
      group: "Processor",
      color: "#14b8a6",
      inputs: [
        { id: "in", label: "入力", kind: "audio" },
        { id: "cutoffCV", label: "カットCV", kind: "control" },
      ],
      outputs: [{ id: "out", label: "出力", kind: "audio" }],
      params: [
        { id: "type", label: "種類", type: "select", value: "lowpass", options: ["lowpass", "highpass", "bandpass"] },
        { id: "cutoff", label: "カット", type: "number", value: 1800, min: 20, max: 20000, step: 1, unit: "Hz" },
        { id: "q", label: "Q", type: "number", value: 0.5, min: 0.05, max: 12, step: 0.01 },
        { id: "cvAmount", label: "CV量", type: "number", value: 0, min: -12000, max: 12000, step: 1, unit: "Hz" },
      ],
    },
    distortion: {
      name: "歪み",
      group: "Processor",
      color: "#f58a1f",
      inputs: [{ id: "in", label: "入力", kind: "audio" }],
      outputs: [{ id: "out", label: "出力", kind: "audio" }],
      params: [
        { id: "drive", label: "強さ", type: "number", value: 1.5, min: 0.1, max: 20, step: 0.01 },
        { id: "tone", label: "明るさ", type: "number", value: 7000, min: 200, max: 20000, step: 1, unit: "Hz" },
        { id: "mix", label: "混ぜ量", type: "number", value: 0.6, min: 0, max: 1, step: 0.01 },
      ],
    },
    bitcrush: {
      name: "ビット削り",
      group: "Processor",
      color: "#e4c928",
      inputs: [{ id: "in", label: "入力", kind: "audio" }],
      outputs: [{ id: "out", label: "出力", kind: "audio" }],
      params: [
        { id: "bits", label: "ビット", type: "number", value: 8, min: 2, max: 16, step: 1 },
        { id: "rate", label: "レート", type: "number", value: 11025, min: 500, max: 44100, step: 1, unit: "Hz" },
        { id: "mix", label: "混ぜ量", type: "number", value: 0.5, min: 0, max: 1, step: 0.01 },
      ],
    },
    delay: {
      name: "ディレイ",
      group: "Processor",
      color: "#22a7f0",
      inputs: [{ id: "in", label: "入力", kind: "audio" }],
      outputs: [{ id: "out", label: "出力", kind: "audio" }],
      params: [
        { id: "time", label: "間隔", type: "number", value: 0.12, min: 0.001, max: 2, step: 0.001, unit: "s" },
        { id: "feedback", label: "反復", type: "number", value: 0.25, min: 0, max: 0.95, step: 0.01 },
        { id: "mix", label: "混ぜ量", type: "number", value: 0.25, min: 0, max: 1, step: 0.01 },
      ],
    },
    reverb: {
      name: "リバーブ",
      group: "Processor",
      color: "#0ea5e9",
      inputs: [{ id: "in", label: "入力", kind: "audio" }],
      outputs: [{ id: "out", label: "出力", kind: "audio" }],
      params: [
        { id: "room", label: "広さ", type: "number", value: 0.35, min: 0, max: 1, step: 0.01 },
        { id: "damp", label: "吸音", type: "number", value: 0.5, min: 0, max: 1, step: 0.01 },
        { id: "mix", label: "混ぜ量", type: "number", value: 0.25, min: 0, max: 1, step: 0.01 },
      ],
    },
    mixer: {
      name: "ミキサー",
      group: "Combiner",
      color: "#7ed10b",
      inputs: [
        { id: "a", label: "A", kind: "mix" },
        { id: "b", label: "B", kind: "mix" },
        { id: "c", label: "C", kind: "mix" },
        { id: "d", label: "D", kind: "mix" },
      ],
      outputs: [{ id: "out", label: "出力", kind: "mix" }],
      params: [
        { id: "levelA", label: "A音量", type: "number", value: 1, min: 0, max: 2, step: 0.01 },
        { id: "levelB", label: "B音量", type: "number", value: 1, min: 0, max: 2, step: 0.01 },
        { id: "levelC", label: "C音量", type: "number", value: 1, min: 0, max: 2, step: 0.01 },
        { id: "levelD", label: "D音量", type: "number", value: 1, min: 0, max: 2, step: 0.01 },
      ],
    },
    ringmod: {
      name: "リング変調",
      group: "Combiner",
      color: "#84cc16",
      inputs: [
        { id: "carrier", label: "入力", kind: "audio" },
        { id: "mod", label: "変調", kind: "audio" },
      ],
      outputs: [{ id: "out", label: "出力", kind: "audio" }],
      params: [
        { id: "depth", label: "深さ", type: "number", value: 0.5, min: 0, max: 1, step: 0.01 },
      ],
    },
    output: {
      name: "出力",
      group: "Output",
      color: "#ff4b4b",
      inputs: [{ id: "in", label: "入力", kind: "audio" }],
      outputs: [],
      params: [
        { id: "master", label: "全体音量", type: "number", value: 0.9, min: 0, max: 1.5, step: 0.01 },
        { id: "normalize", label: "正規化", type: "checkbox", value: true },
      ],
    },
  };

  let state = null;
  let nodeSerial = 1;
  let selectedNodeId = null;
  let drag = null;
  let pan = null;
  let connectionDrag = null;
  let rendered = null;
  let audioCtx = null;
  let sourceNode = null;
  const sampleStore = new Map();

  function defaultsFor(type) {
    const params = {};
    for (const p of nodeDefs[type].params) {
      if (p.type !== "file") params[p.id] = p.value;
    }
    return params;
  }

  function makeNode(type, x, y, params = {}, id = null) {
    const nodeId = id || `n${nodeSerial++}`;
    return {
      id: nodeId,
      type,
      x,
      y,
      params: { ...defaultsFor(type), ...params },
      fileName: "",
    };
  }

  function blankState() {
    nodeSerial = 1;
    const out = makeNode("output", 920, 320, { master: 0.9, normalize: true }, "out");
    return {
      version: 1,
      length: 1.2,
      sampleRate: 44100,
      view: { x: 168, y: 0, scale: 1 },
      nodes: [out],
      connections: [],
    };
  }

  function connect(from, fromPort, to, toPort) {
    state.connections = state.connections.filter((c) => !(c.to === to && c.toPort === toPort));
    state.connections.push({ from, fromPort, to, toPort });
  }

  function buildPresetFootstep() {
    nodeSerial = 1;
    const nodes = [
      makeNode("noise", 80, 120, { color: "brown", seed: 3102 }, "noise1"),
      makeNode("filter", 300, 110, { type: "lowpass", cutoff: 720, q: 0.45 }, "filter1"),
      makeNode("envelope", 520, 112, { attack: 0.002, decay: 0.13, sustain: 0, release: 0.03, gate: 0.05 }, "env1"),
      makeNode("oscillator", 80, 380, { wave: "sine", freq: 86, phase: 0.1 }, "osc1"),
      makeNode("sweep", 80, 610, { start: 45, end: -34, time: 0.16, curve: "exp" }, "sweep1"),
      makeNode("envelope", 300, 382, { attack: 0.001, decay: 0.09, sustain: 0, release: 0.025, gate: 0.04 }, "env2"),
      makeNode("mixer", 740, 240, { levelA: 0.95, levelB: 0.55, levelC: 0, levelD: 0 }, "mix1"),
      makeNode("output", 970, 275, { master: 0.9, normalize: true }, "out"),
    ];
    return {
      version: 1,
      length: 1.1,
      sampleRate: 44100,
      view: { x: 188, y: 16, scale: 1 },
      nodes,
      connections: [
        { from: "noise1", fromPort: "out", to: "filter1", toPort: "in" },
        { from: "filter1", fromPort: "out", to: "env1", toPort: "in" },
        { from: "env1", fromPort: "out", to: "mix1", toPort: "a" },
        { from: "sweep1", fromPort: "out", to: "osc1", toPort: "fm" },
        { from: "osc1", fromPort: "out", to: "env2", toPort: "in" },
        { from: "env2", fromPort: "out", to: "mix1", toPort: "b" },
        { from: "mix1", fromPort: "out", to: "out", toPort: "in" },
      ],
    };
  }

  function buildPresetKeyring() {
    nodeSerial = 1;
    const nodes = [
      makeNode("noise", 80, 120, { color: "white", seed: 5522 }, "noise1"),
      makeNode("filter", 300, 120, { type: "highpass", cutoff: 4200, q: 0.3 }, "filter1"),
      makeNode("envelope", 520, 120, { attack: 0, decay: 0.28, sustain: 0, release: 0.025, gate: 0.045 }, "env1"),
      makeNode("oscillator", 80, 390, { wave: "sine", freq: 4120, phase: 0.2 }, "osc1"),
      makeNode("lfo", 80, 610, { wave: "sine", rate: 19, depth: 720, offset: 0 }, "lfo1"),
      makeNode("envelope", 300, 390, { attack: 0, decay: 0.36, sustain: 0, release: 0.02, gate: 0.03 }, "env2"),
      makeNode("delay", 520, 390, { time: 0.065, feedback: 0.28, mix: 0.32 }, "delay1"),
      makeNode("mixer", 760, 250, { levelA: 0.8, levelB: 0.36, levelC: 0, levelD: 0 }, "mix1"),
      makeNode("output", 990, 295, { master: 0.9, normalize: true }, "out"),
    ];
    return {
      version: 1,
      length: 0.85,
      sampleRate: 44100,
      view: { x: 188, y: 18, scale: 1 },
      nodes,
      connections: [
        { from: "noise1", fromPort: "out", to: "filter1", toPort: "in" },
        { from: "filter1", fromPort: "out", to: "env1", toPort: "in" },
        { from: "env1", fromPort: "out", to: "mix1", toPort: "a" },
        { from: "lfo1", fromPort: "out", to: "osc1", toPort: "fm" },
        { from: "osc1", fromPort: "out", to: "env2", toPort: "in" },
        { from: "env2", fromPort: "out", to: "delay1", toPort: "in" },
        { from: "delay1", fromPort: "out", to: "mix1", toPort: "b" },
        { from: "mix1", fromPort: "out", to: "out", toPort: "in" },
      ],
    };
  }

  function buildPresetWoodChip() {
    nodeSerial = 1;
    const nodes = [
      makeNode("noise", 80, 120, { color: "brown", seed: 8431 }, "noise1"),
      makeNode("filter", 300, 120, { type: "bandpass", cutoff: 1450, q: 1.2 }, "filter1"),
      makeNode("envelope", 520, 120, { attack: 0.001, decay: 0.17, sustain: 0, release: 0.04, gate: 0.055 }, "env1"),
      makeNode("oscillator", 80, 390, { wave: "tri", freq: 190, phase: 0 }, "osc1"),
      makeNode("sweep", 80, 610, { start: 0, end: -130, time: 0.18, curve: "exp" }, "sweep1"),
      makeNode("envelope", 300, 390, { attack: 0.001, decay: 0.08, sustain: 0, release: 0.03, gate: 0.045 }, "env2"),
      makeNode("mixer", 760, 250, { levelA: 0.78, levelB: 0.32, levelC: 0, levelD: 0 }, "mix1"),
      makeNode("output", 990, 295, { master: 0.9, normalize: true }, "out"),
    ];
    return {
      version: 1,
      length: 0.75,
      sampleRate: 44100,
      view: { x: 188, y: 18, scale: 1 },
      nodes,
      connections: [
        { from: "noise1", fromPort: "out", to: "filter1", toPort: "in" },
        { from: "filter1", fromPort: "out", to: "env1", toPort: "in" },
        { from: "env1", fromPort: "out", to: "mix1", toPort: "a" },
        { from: "sweep1", fromPort: "out", to: "osc1", toPort: "fm" },
        { from: "osc1", fromPort: "out", to: "env2", toPort: "in" },
        { from: "env2", fromPort: "out", to: "mix1", toPort: "b" },
        { from: "mix1", fromPort: "out", to: "out", toPort: "in" },
      ],
    };
  }

  function buildPresetBackdoor() {
    nodeSerial = 1;
    const nodes = [
      makeNode("noise", 80, 115, { color: "pink", seed: 7391 }, "noise1"),
      makeNode("filter", 300, 115, { type: "lowpass", cutoff: 1300, q: 0.6 }, "filter1"),
      makeNode("envelope", 520, 115, { attack: 0.035, decay: 0.42, sustain: 0.18, release: 0.2, gate: 0.42 }, "env1"),
      makeNode("oscillator", 80, 390, { wave: "tri", freq: 145, fmAmount: 0, pmAmount: 1.8 }, "osc1"),
      makeNode("sweep", 80, 610, { start: 0.8, end: -0.9, time: 0.72, curve: "linear" }, "sweep1"),
      makeNode("envelope", 300, 390, { attack: 0.08, decay: 0.28, sustain: 0.12, release: 0.22, gate: 0.58 }, "env2"),
      makeNode("delay", 520, 390, { time: 0.18, feedback: 0.18, mix: 0.2 }, "delay1"),
      makeNode("mixer", 760, 250, { levelA: 0.55, levelB: 0.45, levelC: 0, levelD: 0 }, "mix1"),
      makeNode("output", 990, 295, { master: 0.86, normalize: true }, "out"),
    ];
    return {
      version: 1,
      length: 1.6,
      sampleRate: 44100,
      view: { x: 188, y: 18, scale: 1 },
      nodes,
      connections: [
        { from: "noise1", fromPort: "out", to: "filter1", toPort: "in" },
        { from: "filter1", fromPort: "out", to: "env1", toPort: "in" },
        { from: "env1", fromPort: "out", to: "mix1", toPort: "a" },
        { from: "sweep1", fromPort: "out", to: "osc1", toPort: "pm" },
        { from: "osc1", fromPort: "out", to: "env2", toPort: "in" },
        { from: "env2", fromPort: "out", to: "delay1", toPort: "in" },
        { from: "delay1", fromPort: "out", to: "mix1", toPort: "b" },
        { from: "mix1", fromPort: "out", to: "out", toPort: "in" },
      ],
    };
  }

  function buildPresetHeartCore() {
    nodeSerial = 1;
    const nodes = [
      makeNode("oscillator", 90, 115, { wave: "sine", freq: 96, phase: 0.05 }, "osc1"),
      makeNode("lfo", 90, 365, { wave: "sine", rate: 5.2, depth: 0.85, offset: 0 }, "lfo1"),
      makeNode("gain", 320, 115, { gain: 0.75, cvAmount: 0 }, "gain1"),
      makeNode("oscillator", 90, 610, { wave: "sine", freq: 432, pmAmount: 2.8, phase: 0.25 }, "osc2"),
      makeNode("envelope", 320, 610, { attack: 0.18, decay: 0.6, sustain: 0.28, release: 0.75, gate: 1.25 }, "env1"),
      makeNode("reverb", 540, 355, { room: 0.62, damp: 0.38, mix: 0.42 }, "reverb1"),
      makeNode("mixer", 780, 265, { levelA: 0.9, levelB: 0.36, levelC: 0, levelD: 0 }, "mix1"),
      makeNode("output", 1010, 305, { master: 0.82, normalize: true }, "out"),
    ];
    return {
      version: 1,
      length: 2.15,
      sampleRate: 44100,
      view: { x: 188, y: 18, scale: 1 },
      nodes,
      connections: [
        { from: "osc1", fromPort: "out", to: "gain1", toPort: "in" },
        { from: "gain1", fromPort: "out", to: "mix1", toPort: "a" },
        { from: "lfo1", fromPort: "out", to: "osc2", toPort: "pm" },
        { from: "osc2", fromPort: "out", to: "env1", toPort: "in" },
        { from: "env1", fromPort: "out", to: "reverb1", toPort: "in" },
        { from: "reverb1", fromPort: "out", to: "mix1", toPort: "b" },
        { from: "mix1", fromPort: "out", to: "out", toPort: "in" },
      ],
    };
  }

  const presets = {
    "木の足音": buildPresetFootstep,
    "鍵束": buildPresetKeyring,
    "木片落下": buildPresetWoodChip,
    "裏口の物音": buildPresetBackdoor,
    "心核共鳴": buildPresetHeartCore,
  };

  const groupLabels = {
    Source: "音源",
    Modulation: "変調",
    Processor: "加工",
    Combiner: "合成",
    Output: "出力",
  };

  const optionLabels = {
    sine: "サイン",
    tri: "三角",
    saw: "ノコギリ",
    square: "矩形",
    white: "ホワイト",
    pink: "ピンク",
    brown: "ブラウン",
    linear: "直線",
    exp: "急変化",
    log: "なだらか",
    lowpass: "低域通過",
    highpass: "高域通過",
    bandpass: "帯域通過",
  };

  function buildPalette() {
    els.palette.innerHTML = "<h2>ノード</h2>";
    const groups = ["Source", "Modulation", "Processor", "Combiner", "Output"];
    for (const group of groups) {
      const wrap = document.createElement("div");
      wrap.className = "palette-group";
      const title = document.createElement("div");
      title.className = "palette-group-title";
      title.textContent = groupLabels[group] || group;
      wrap.appendChild(title);
      Object.entries(nodeDefs)
        .filter(([, def]) => def.group === group)
        .forEach(([type, def]) => {
          const btn = document.createElement("button");
          btn.className = "palette-btn";
          btn.style.borderLeftColor = def.color;
          btn.textContent = def.name;
          btn.addEventListener("click", () => {
            const p = screenToWorld(els.workspace.clientWidth / 2, els.workspace.clientHeight / 2);
            const node = makeNode(type, clamp(p.x - 80, 0, WORLD_W - 190), clamp(p.y - 70, 0, WORLD_H - 260));
            state.nodes.push(node);
            selectedNodeId = node.id;
            syncControls();
            renderUI();
            scheduleRender();
          });
          wrap.appendChild(btn);
        });
      els.palette.appendChild(wrap);
    }
  }

  function buildPresetSelect() {
    els.presetSelect.innerHTML = "";
    for (const name of Object.keys(presets)) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      els.presetSelect.appendChild(opt);
    }
  }

  function loadPreset(name) {
    state = cloneProject(presets[name]());
    sampleStore.clear();
    selectedNodeId = null;
    updateSerialFromState();
    syncControls();
    renderUI();
    scheduleRender(true);
    setStatus(`${name}を読み込みました`);
  }

  function cloneProject(project) {
    return JSON.parse(JSON.stringify(project));
  }

  function updateSerialFromState() {
    let max = 0;
    for (const n of state.nodes) {
      const m = /^n(\d+)$/.exec(n.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    nodeSerial = max + 1;
  }

  function syncControls() {
    els.lengthInput.value = state.length;
    els.rateSelect.value = String(state.sampleRate);
    applyView();
  }

  function applyView() {
    els.world.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`;
    requestAnimationFrame(renderConnections);
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function renderUI() {
    els.nodes.innerHTML = "";
    for (const node of state.nodes) {
      els.nodes.appendChild(renderNodeCard(node));
    }
    renderConnections();
  }

  function renderNodeCard(node) {
    const def = nodeDefs[node.type];
    const el = document.createElement("article");
    el.className = `node${node.id === selectedNodeId ? " selected" : ""}`;
    el.dataset.nodeId = node.id;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;

    const header = document.createElement("div");
    header.className = "node-header";
    header.style.background = def.color;
    header.innerHTML = `<span>${def.name}</span>`;
    const close = document.createElement("button");
    close.className = "node-close";
    close.type = "button";
    close.textContent = "×";
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      removeNode(node.id);
    });
    header.appendChild(close);
    header.addEventListener("pointerdown", (ev) => startNodeDrag(ev, node));
    el.appendChild(header);

    const ports = document.createElement("div");
    ports.className = "ports";
    const inCol = document.createElement("div");
    const outCol = document.createElement("div");
    for (const input of def.inputs) {
      inCol.appendChild(portRow(node, input, "in"));
    }
    for (const output of def.outputs) {
      outCol.appendChild(portRow(node, output, "out"));
    }
    ports.appendChild(inCol);
    ports.appendChild(outCol);
    el.appendChild(ports);

    const params = document.createElement("div");
    params.className = "params";
    for (const param of def.params) {
      params.appendChild(renderParam(node, param, def.color));
    }
    el.appendChild(params);

    el.addEventListener("pointerdown", () => {
      selectedNodeId = node.id;
      document.querySelectorAll(".node").forEach((n) => n.classList.toggle("selected", n.dataset.nodeId === node.id));
    });
    return el;
  }

  function portRow(node, port, direction) {
    const row = document.createElement("div");
    row.className = `port-row ${direction}`;
    const dot = document.createElement("span");
    dot.className = `port ${direction}`;
    dot.dataset.nodeId = node.id;
    dot.dataset.portId = port.id;
    dot.dataset.direction = direction;
    dot.dataset.kind = port.kind || "audio";
    dot.title = `${nodeDefs[node.type].name}.${port.label}`;
    dot.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      if (direction === "out") beginConnection(ev, dot);
    });
    dot.addEventListener("pointerup", (ev) => {
      ev.stopPropagation();
      if (direction === "in") finishConnection(dot);
    });
    const label = document.createElement("span");
    label.textContent = port.label;
    if (direction === "in") {
      row.appendChild(dot);
      row.appendChild(label);
    } else {
      row.appendChild(label);
      row.appendChild(dot);
    }
    return row;
  }

  function renderParam(node, param, color) {
    const wrap = document.createElement("div");
    wrap.className = "param";
    wrap.style.color = color;
    const label = document.createElement("label");
    label.textContent = param.label;
    if (param.unit) {
      const unit = document.createElement("span");
      unit.textContent = param.unit;
      label.appendChild(unit);
    }
    wrap.appendChild(label);

    if (param.type === "select") {
      const select = document.createElement("select");
      for (const opt of param.options) {
        const option = document.createElement("option");
        option.value = opt;
        option.textContent = optionLabels[opt] || opt;
        select.appendChild(option);
      }
      select.value = node.params[param.id] ?? param.value;
      select.addEventListener("change", () => {
        node.params[param.id] = select.value;
        scheduleRender();
      });
      wrap.appendChild(select);
      return wrap;
    }

    if (param.type === "checkbox") {
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = Boolean(node.params[param.id]);
      check.addEventListener("change", () => {
        node.params[param.id] = check.checked;
        scheduleRender();
      });
      wrap.appendChild(check);
      return wrap;
    }

    if (param.type === "file") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*";
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        await loadSampleForNode(node, file);
        renderUI();
        scheduleRender(true);
      });
      wrap.appendChild(input);
      if (node.fileName) {
        const labelFile = document.createElement("label");
        labelFile.textContent = node.fileName;
        labelFile.style.marginTop = "5px";
        wrap.appendChild(labelFile);
      }
      return wrap;
    }

    const row = document.createElement("div");
    row.className = "row";
    const range = document.createElement("input");
    range.type = "range";
    range.min = param.min;
    range.max = param.max;
    range.step = param.step;
    range.value = node.params[param.id] ?? param.value;
    const num = document.createElement("input");
    num.type = "number";
    num.min = param.min;
    num.max = param.max;
    num.step = param.step;
    num.value = range.value;
    const update = (value) => {
      const next = clamp(Number(value), Number(param.min), Number(param.max));
      node.params[param.id] = next;
      range.value = String(next);
      num.value = formatNumber(next);
      scheduleRender();
    };
    range.addEventListener("input", () => update(range.value));
    num.addEventListener("change", () => update(num.value));
    row.appendChild(range);
    row.appendChild(num);
    wrap.appendChild(row);
    return wrap;
  }

  function formatNumber(value) {
    if (Math.abs(value) >= 100) return String(Math.round(value));
    if (Math.abs(value) >= 10) return String(Math.round(value * 10) / 10);
    return String(Math.round(value * 1000) / 1000);
  }

  function removeNode(id) {
    state.nodes = state.nodes.filter((n) => n.id !== id);
    state.connections = state.connections.filter((c) => c.from !== id && c.to !== id);
    sampleStore.delete(id);
    selectedNodeId = null;
    renderUI();
    scheduleRender();
  }

  function startNodeDrag(ev, node) {
    if (ev.button !== 0) return;
    const p = clientToWorld(ev.clientX, ev.clientY);
    drag = { node, dx: p.x - node.x, dy: p.y - node.y };
    ev.currentTarget.setPointerCapture(ev.pointerId);
    document.addEventListener("pointermove", onNodeDrag);
    document.addEventListener("pointerup", endNodeDrag, { once: true });
  }

  function onNodeDrag(ev) {
    if (!drag) return;
    const p = clientToWorld(ev.clientX, ev.clientY);
    drag.node.x = clamp(p.x - drag.dx, 0, WORLD_W - 180);
    drag.node.y = clamp(p.y - drag.dy, 0, WORLD_H - 220);
    const el = document.querySelector(`[data-node-id="${drag.node.id}"]`);
    if (el) {
      el.style.left = `${drag.node.x}px`;
      el.style.top = `${drag.node.y}px`;
    }
    renderConnections();
  }

  function endNodeDrag() {
    drag = null;
    document.removeEventListener("pointermove", onNodeDrag);
  }

  function beginConnection(ev, dot) {
    const start = portPosition(dot);
    connectionDrag = {
      from: dot.dataset.nodeId,
      fromPort: dot.dataset.portId,
      start,
      point: start,
    };
    dot.setPointerCapture(ev.pointerId);
    document.addEventListener("pointermove", onConnectionMove);
    document.addEventListener("pointerup", cancelConnection, { once: true });
    renderConnections();
  }

  function onConnectionMove(ev) {
    if (!connectionDrag) return;
    connectionDrag.point = clientToWorld(ev.clientX, ev.clientY);
    renderConnections();
  }

  function finishConnection(dot) {
    if (!connectionDrag) return;
    const fromNode = connectionDrag.from;
    const fromPort = connectionDrag.fromPort;
    const toNode = dot.dataset.nodeId;
    const toPort = dot.dataset.portId;
    if (fromNode !== toNode) {
      connect(fromNode, fromPort, toNode, toPort);
      scheduleRender();
    }
    connectionDrag = null;
    document.removeEventListener("pointermove", onConnectionMove);
    renderConnections();
  }

  function cancelConnection() {
    if (!connectionDrag) return;
    setTimeout(() => {
      connectionDrag = null;
      document.removeEventListener("pointermove", onConnectionMove);
      renderConnections();
    }, 0);
  }

  function renderConnections() {
    const existing = Array.from(els.wires.querySelectorAll("path"));
    for (const p of existing) p.remove();
    for (let i = 0; i < state.connections.length; i++) {
      const c = state.connections[i];
      const from = findPort(c.from, c.fromPort, "out");
      const to = findPort(c.to, c.toPort, "in");
      if (!from || !to) continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.classList.add("wire");
      path.setAttribute("d", bezier(portPosition(from), portPosition(to)));
      path.addEventListener("dblclick", () => {
        state.connections.splice(i, 1);
        renderConnections();
        scheduleRender();
      });
      els.wires.appendChild(path);
    }
    if (connectionDrag) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.classList.add("wire", "hot");
      path.setAttribute("d", bezier(connectionDrag.start, connectionDrag.point));
      els.wires.appendChild(path);
    }
  }

  function findPort(nodeId, portId, direction) {
    return document.querySelector(`.port[data-node-id="${nodeId}"][data-port-id="${portId}"][data-direction="${direction}"]`);
  }

  function bezier(a, b) {
    const dx = Math.max(60, Math.abs(b.x - a.x) * 0.45);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }

  function portPosition(el) {
    const r = el.getBoundingClientRect();
    const wr = els.world.getBoundingClientRect();
    const s = state.view.scale;
    return {
      x: (r.left + r.width / 2 - wr.left) / s,
      y: (r.top + r.height / 2 - wr.top) / s,
    };
  }

  function clientToWorld(clientX, clientY) {
    const wr = els.world.getBoundingClientRect();
    const s = state.view.scale;
    return {
      x: (clientX - wr.left) / s,
      y: (clientY - wr.top) / s,
    };
  }

  function screenToWorld(x, y) {
    const rect = els.workspace.getBoundingClientRect();
    return clientToWorld(rect.left + x, rect.top + y);
  }

  function bindWorkspace() {
    els.workspace.addEventListener("contextmenu", (ev) => ev.preventDefault());
    els.workspace.addEventListener("pointerdown", (ev) => {
      if (!shouldStartPan(ev)) return;
      startPan(ev);
    });
    els.workspace.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const delta = wheelDeltaPixels(ev);
      if (ev.ctrlKey || ev.metaKey) {
        zoomAt(ev, delta.y);
      } else {
        const horizontal = ev.shiftKey && delta.x === 0 ? delta.y : delta.x;
        const vertical = ev.shiftKey && delta.x === 0 ? 0 : delta.y;
        state.view.x -= horizontal;
        state.view.y -= vertical;
      }
      applyView();
    }, { passive: false });
  }

  function isBackgroundTarget(target) {
    return target === els.workspace
      || target === els.world
      || target === els.nodes
      || target === els.wires
      || target.classList?.contains("wire");
  }

  function shouldStartPan(ev) {
    if (ev.button === 1 || ev.button === 2) return true;
    return ev.button === 0 && isBackgroundTarget(ev.target);
  }

  function startPan(ev) {
    ev.preventDefault();
    pan = {
      x: ev.clientX,
      y: ev.clientY,
      viewX: state.view.x,
      viewY: state.view.y,
    };
    els.workspace.classList.add("panning");
    document.addEventListener("pointermove", onPan);
    document.addEventListener("pointerup", endPan, { once: true });
  }

  function wheelDeltaPixels(ev) {
    const unit = ev.deltaMode === WheelEvent.DOM_DELTA_LINE ? 18
      : ev.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 240
        : 1;
    return {
      x: ev.deltaX * unit,
      y: ev.deltaY * unit,
    };
  }

  function zoomAt(ev, deltaY) {
    const old = state.view.scale;
    const next = clamp(old * (deltaY < 0 ? 1.08 : 0.925), 0.35, 2.4);
    const rect = els.workspace.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const wx = (mx - state.view.x) / old;
    const wy = (my - state.view.y) / old;
    state.view.scale = next;
    state.view.x = mx - wx * next;
    state.view.y = my - wy * next;
  }

  function onPan(ev) {
    if (!pan) return;
    state.view.x = pan.viewX + ev.clientX - pan.x;
    state.view.y = pan.viewY + ev.clientY - pan.y;
    applyView();
  }

  function endPan() {
    pan = null;
    els.workspace.classList.remove("panning");
    document.removeEventListener("pointermove", onPan);
  }

  async function loadSampleForNode(node, file) {
    if (!audioCtx) audioCtx = new AudioContext();
    const ab = await file.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(ab.slice(0));
    const channels = decoded.numberOfChannels;
    const len = decoded.length;
    const mono = new Float32Array(len);
    for (let ch = 0; ch < channels; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < len; i++) mono[i] += data[i] / channels;
    }
    sampleStore.set(node.id, { data: mono, sampleRate: decoded.sampleRate, name: file.name });
    node.fileName = file.name;
    setStatus(`サンプルを読み込みました: ${file.name}`);
  }

  function scheduleRender(force = false) {
    rendered = null;
    if (!els.autoCheck.checked && !force) {
      drawWaveform(null);
      return;
    }
    window.clearTimeout(scheduleRender.timer);
    scheduleRender.timer = window.setTimeout(() => {
      try {
        rendered = renderProject();
        drawWaveform(rendered.samples);
        setStatus(`${rendered.samples.length}サンプルを生成しました (${rendered.sampleRate} Hz)`);
      } catch (err) {
        setStatus(`生成エラー: ${err.message}`);
      }
    }, force ? 0 : 120);
  }

  function renderProject() {
    const sampleRate = Number(state.sampleRate);
    const length = clamp(Number(state.length) || 1, 0.05, 20);
    const n = secToSamples(length, sampleRate);
    const cache = new Map();
    const output = state.nodes.find((node) => node.type === "output") || state.nodes[state.nodes.length - 1];
    const samples = renderNode(output.id, cache, [], n, sampleRate);
    return { samples, sampleRate };
  }

  function zero(n) {
    return new Float32Array(n);
  }

  function renderNode(id, cache, stack, n, sr) {
    if (cache.has(id)) return cache.get(id);
    if (stack.includes(id)) return zero(n);
    const node = state.nodes.find((item) => item.id === id);
    if (!node) return zero(n);
    const params = node.params || {};
    const nextStack = stack.concat(id);
    let out;
    switch (node.type) {
      case "oscillator":
        out = dspOscillator(node, params, cache, nextStack, n, sr);
        break;
      case "noise":
        out = dspNoise(params, n);
        break;
      case "sample":
        out = dspSample(node, params, n, sr);
        break;
      case "lfo":
        out = dspLfo(params, n, sr);
        break;
      case "sweep":
        out = dspSweep(params, n, sr);
        break;
      case "envelope":
        out = dspEnvelope(node, params, cache, nextStack, n, sr);
        break;
      case "gain":
        out = dspGain(node, params, cache, nextStack, n, sr);
        break;
      case "filter":
        out = dspFilter(node, params, cache, nextStack, n, sr);
        break;
      case "distortion":
        out = dspDistortion(getInput(node.id, "in", cache, nextStack, n, sr), params, sr);
        break;
      case "bitcrush":
        out = dspBitcrush(getInput(node.id, "in", cache, nextStack, n, sr), params, sr);
        break;
      case "delay":
        out = dspDelay(getInput(node.id, "in", cache, nextStack, n, sr), params, sr);
        break;
      case "reverb":
        out = dspReverb(getInput(node.id, "in", cache, nextStack, n, sr), params, sr);
        break;
      case "mixer":
        out = dspMixer(node, params, cache, nextStack, n, sr);
        break;
      case "ringmod":
        out = dspRingMod(node, params, cache, nextStack, n, sr);
        break;
      case "output":
        out = dspOutput(getInput(node.id, "in", cache, nextStack, n, sr), params);
        break;
      default:
        out = zero(n);
    }
    cache.set(id, out);
    return out;
  }

  function findInputConnection(nodeId, portId) {
    return state.connections.find((c) => c.to === nodeId && c.toPort === portId);
  }

  function hasInput(nodeId, portId) {
    return Boolean(findInputConnection(nodeId, portId));
  }

  function getInput(nodeId, portId, cache, stack, n, sr) {
    const c = findInputConnection(nodeId, portId);
    if (!c) return zero(n);
    return renderNode(c.from, cache, stack, n, sr);
  }

  function waveAt(type, phase) {
    const p = phase - Math.floor(phase);
    switch (type) {
      case "square":
        return p < 0.5 ? 1 : -1;
      case "saw":
        return p * 2 - 1;
      case "tri":
        return 1 - 4 * Math.abs(Math.round(p - 0.25) - (p - 0.25));
      case "sine":
      default:
        return Math.sin(TAU * p);
    }
  }

  function dspOscillator(node, params, cache, stack, n, sr) {
    const fm = getInput(node.id, "fm", cache, stack, n, sr);
    const pm = getInput(node.id, "pm", cache, stack, n, sr);
    const out = new Float32Array(n);
    let phase = Number(params.phase || 0);
    const base = Number(params.freq || 220);
    const fmAmt = Number(params.fmAmount || 0);
    const pmAmt = Number(params.pmAmount || 0);
    for (let i = 0; i < n; i++) {
      const freq = clamp(base + fm[i] * fmAmt, 0, sr * 0.45);
      phase += freq / sr;
      out[i] = waveAt(params.wave, phase + pm[i] * pmAmt);
    }
    return out;
  }

  function dspLfo(params, n, sr) {
    const out = new Float32Array(n);
    const rate = Math.max(0.001, Number(params.rate || 1));
    const depth = Number(params.depth || 1);
    const offset = Number(params.offset || 0);
    for (let i = 0; i < n; i++) {
      out[i] = offset + depth * waveAt(params.wave, i * rate / sr);
    }
    return out;
  }

  function dspSweep(params, n, sr) {
    const out = new Float32Array(n);
    const start = Number(params.start || 0);
    const end = Number(params.end || 0);
    const time = Math.max(0.001, Number(params.time || 1));
    const limit = secToSamples(time, sr);
    for (let i = 0; i < n; i++) {
      const t = clamp(i / limit, 0, 1);
      let v;
      if (params.curve === "exp") {
        const shaped = t * t;
        v = start + (end - start) * shaped;
      } else if (params.curve === "log") {
        const shaped = Math.sqrt(t);
        v = start + (end - start) * shaped;
      } else {
        v = start + (end - start) * t;
      }
      out[i] = v;
    }
    return out;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dspNoise(params, n) {
    const random = mulberry32(Number(params.seed || 1));
    const out = new Float32Array(n);
    if (params.color === "brown") {
      let last = 0;
      for (let i = 0; i < n; i++) {
        last = clamp(last + (random() * 2 - 1) * 0.08, -1, 1);
        out[i] = last;
      }
      return out;
    }
    if (params.color === "pink") {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const white = random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
      return out;
    }
    for (let i = 0; i < n; i++) out[i] = random() * 2 - 1;
    return out;
  }

  function dspEnvelope(node, params, cache, stack, n, sr) {
    const inputConnected = hasInput(node.id, "in");
    const input = inputConnected ? getInput(node.id, "in", cache, stack, n, sr) : null;
    const out = new Float32Array(n);
    const attack = Math.max(0, Number(params.attack || 0));
    const decay = Math.max(0, Number(params.decay || 0));
    const sustain = clamp(Number(params.sustain || 0), 0, 1);
    const release = Math.max(0, Number(params.release || 0));
    const gate = Math.max(0.001, Number(params.gate || 0.001));
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let e;
      if (attack > 0 && t < attack) {
        e = t / attack;
      } else if (decay > 0 && t < attack + decay) {
        e = 1 - (1 - sustain) * ((t - attack) / decay);
      } else if (t < gate) {
        e = sustain;
      } else if (release > 0 && t < gate + release) {
        e = sustain * (1 - (t - gate) / release);
      } else {
        e = 0;
      }
      out[i] = (inputConnected ? input[i] : 1) * e;
    }
    return out;
  }

  function dspGain(node, params, cache, stack, n, sr) {
    const input = getInput(node.id, "in", cache, stack, n, sr);
    const cv = getInput(node.id, "cv", cache, stack, n, sr);
    const out = new Float32Array(n);
    const gain = Number(params.gain || 0);
    const cvAmt = Number(params.cvAmount || 0);
    for (let i = 0; i < n; i++) out[i] = input[i] * (gain + cv[i] * cvAmt);
    return out;
  }

  function dspFilter(node, params, cache, stack, n, sr) {
    const input = getInput(node.id, "in", cache, stack, n, sr);
    const cv = getInput(node.id, "cutoffCV", cache, stack, n, sr);
    const out = new Float32Array(n);
    let low = 0;
    let low2 = 0;
    let prevHigh = 0;
    const type = params.type || "lowpass";
    for (let i = 0; i < n; i++) {
      const cutoff = clamp(Number(params.cutoff || 1000) + cv[i] * Number(params.cvAmount || 0), 20, sr * 0.45);
      const alpha = 1 - Math.exp(-TAU * cutoff / sr);
      low += alpha * (input[i] - low);
      const high = input[i] - low;
      low2 += alpha * (high - low2);
      if (type === "highpass") out[i] = high;
      else if (type === "bandpass") out[i] = low2 - prevHigh * 0.05;
      else out[i] = low;
      prevHigh = high;
    }
    return out;
  }

  function onePoleLowpass(input, cutoff, sr) {
    const out = new Float32Array(input.length);
    const alpha = 1 - Math.exp(-TAU * cutoff / sr);
    let y = 0;
    for (let i = 0; i < input.length; i++) {
      y += alpha * (input[i] - y);
      out[i] = y;
    }
    return out;
  }

  function dspDistortion(input, params, sr) {
    const drive = Math.max(0.1, Number(params.drive || 1));
    const mix = clamp(Number(params.mix || 0), 0, 1);
    const tone = clamp(Number(params.tone || 7000), 200, sr * 0.45);
    const wetRaw = new Float32Array(input.length);
    const norm = Math.tanh(drive);
    for (let i = 0; i < input.length; i++) wetRaw[i] = Math.tanh(input[i] * drive) / norm;
    const wet = onePoleLowpass(wetRaw, tone, sr);
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] * (1 - mix) + wet[i] * mix;
    return out;
  }

  function dspBitcrush(input, params, sr) {
    const bits = clamp(Math.round(Number(params.bits || 8)), 2, 16);
    const rate = clamp(Number(params.rate || sr), 100, sr);
    const mix = clamp(Number(params.mix || 0), 0, 1);
    const hold = Math.max(1, Math.round(sr / rate));
    const levels = Math.pow(2, bits - 1);
    const out = new Float32Array(input.length);
    let held = 0;
    for (let i = 0; i < input.length; i++) {
      if (i % hold === 0) held = Math.round(input[i] * levels) / levels;
      out[i] = input[i] * (1 - mix) + held * mix;
    }
    return out;
  }

  function dspDelay(input, params, sr) {
    const delay = secToSamples(Number(params.time || 0.1), sr);
    const feedback = clamp(Number(params.feedback || 0), 0, 0.95);
    const mix = clamp(Number(params.mix || 0), 0, 1);
    const buf = new Float32Array(delay + 1);
    const out = new Float32Array(input.length);
    let idx = 0;
    for (let i = 0; i < input.length; i++) {
      const delayed = buf[idx];
      const dry = input[i];
      out[i] = dry * (1 - mix) + delayed * mix;
      buf[idx] = dry + delayed * feedback;
      idx = (idx + 1) % buf.length;
    }
    return out;
  }

  function dspReverb(input, params, sr) {
    const room = clamp(Number(params.room || 0), 0, 1);
    const damp = clamp(Number(params.damp || 0.5), 0, 1);
    const mix = clamp(Number(params.mix || 0), 0, 1);
    const delays = [0.031, 0.047, 0.071, 0.113].map((d) => secToSamples(d + room * 0.045, sr));
    const gains = [0.45, 0.34, 0.26, 0.19].map((g) => g * (0.35 + room * 0.75));
    const wet = new Float32Array(input.length);
    for (let d = 0; d < delays.length; d++) {
      const delay = delays[d];
      const gain = gains[d];
      let last = 0;
      for (let i = delay; i < input.length; i++) {
        last += (input[i - delay] - last) * (1 - damp * 0.78);
        wet[i] += last * gain;
      }
    }
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] * (1 - mix) + wet[i] * mix;
    return out;
  }

  function dspMixer(node, params, cache, stack, n, sr) {
    const out = new Float32Array(n);
    const ports = ["a", "b", "c", "d"];
    const levels = ["levelA", "levelB", "levelC", "levelD"];
    for (let p = 0; p < ports.length; p++) {
      const input = getInput(node.id, ports[p], cache, stack, n, sr);
      const level = Number(params[levels[p]] ?? 1);
      for (let i = 0; i < n; i++) out[i] += input[i] * level;
    }
    return out;
  }

  function dspRingMod(node, params, cache, stack, n, sr) {
    const carrier = getInput(node.id, "carrier", cache, stack, n, sr);
    const mod = getInput(node.id, "mod", cache, stack, n, sr);
    const depth = clamp(Number(params.depth || 0), 0, 1);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = carrier[i] * (1 - depth + depth * mod[i]);
    return out;
  }

  function dspSample(node, params, n, sr) {
    const item = sampleStore.get(node.id);
    const out = new Float32Array(n);
    if (!item) return out;
    const data = item.data;
    const start = secToSamples(Number(params.start || 0), item.sampleRate);
    const pitch = Math.pow(2, Number(params.pitch || 0) / 12);
    const step = (item.sampleRate / sr) * pitch;
    const level = Number(params.level || 1);
    const reverse = Boolean(params.reverse);
    for (let i = 0; i < n; i++) {
      const pos = reverse ? data.length - 1 - start - i * step : start + i * step;
      if (pos < 0 || pos >= data.length - 1) break;
      const a = Math.floor(pos);
      const f = pos - a;
      out[i] = (data[a] * (1 - f) + data[a + 1] * f) * level;
    }
    return out;
  }

  function dspOutput(input, params) {
    const out = new Float32Array(input.length);
    const master = Number(params.master || 1);
    let peak = 0;
    for (let i = 0; i < input.length; i++) {
      const v = input[i] * master;
      out[i] = v;
      peak = Math.max(peak, Math.abs(v));
    }
    if (params.normalize && peak > 0.00001) {
      const gain = 0.86 / peak;
      for (let i = 0; i < out.length; i++) out[i] *= gain;
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 1.05) / Math.tanh(1.05);
    return out;
  }

  function drawWaveform(samples) {
    const canvas = els.waveform;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#080d13";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#1f2a38";
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    if (!samples || samples.length === 0) return;
    ctx.strokeStyle = "#24d39a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const step = Math.max(1, Math.floor(samples.length / w));
    for (let x = 0; x < w; x++) {
      let lo = 1;
      let hi = -1;
      const start = x * step;
      for (let i = 0; i < step && start + i < samples.length; i++) {
        const v = samples[start + i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const y1 = h / 2 - hi * h * 0.45;
      const y2 = h / 2 - lo * h * 0.45;
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
    }
    ctx.stroke();
  }

  async function playRendered() {
    stopPlayback();
    if (!rendered) rendered = renderProject();
    drawWaveform(rendered.samples);
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    const buffer = audioCtx.createBuffer(1, rendered.samples.length, rendered.sampleRate);
    buffer.copyToChannel(rendered.samples, 0);
    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.loop = els.loopCheck.checked;
    sourceNode.connect(audioCtx.destination);
    sourceNode.start();
    sourceNode.onended = () => {
      sourceNode = null;
    };
    setStatus("再生中");
  }

  function stopPlayback() {
    if (sourceNode) {
      try {
        sourceNode.stop();
      } catch (_) {
        // Already stopped.
      }
      sourceNode.disconnect();
      sourceNode = null;
    }
    setStatus("停止しました");
  }

  function exportWav() {
    if (!rendered) rendered = renderProject();
    const blob = encodeWav(rendered.samples, rendered.sampleRate);
    const name = `${safeName(els.presetSelect.value || "sound")}_${Date.now()}.wav`;
    downloadBlob(blob, name);
    setStatus(`WAVを書き出しました: ${name}`);
  }

  function safeName(name) {
    return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").replace(/^_+|_+$/g, "") || "sound";
  }

  function encodeWav(samples, sr) {
    const bytes = 44 + samples.length * 2;
    const buffer = new ArrayBuffer(bytes);
    const view = new DataView(buffer);
    writeString(view, 0, "RIFF");
    view.setUint32(4, bytes - 8, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, "data");
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (const sample of samples) {
      const v = clamp(sample, -1, 1);
      view.setInt16(offset, v < 0 ? v * 32768 : v * 32767, true);
      offset += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function writeString(view, offset, text) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportProject() {
    const project = cloneProject(state);
    for (const node of project.nodes) {
      if (node.type === "sample") node.fileName = node.fileName || "";
    }
    return project;
  }

  function saveProject() {
    const blob = new Blob([JSON.stringify(exportProject(), null, 2)], { type: "application/json" });
    downloadBlob(blob, `se_graph_${Date.now()}.json`);
    setStatus("プロジェクトを保存しました");
  }

  function loadProject(project) {
    if (!project || !Array.isArray(project.nodes)) throw new Error("プロジェクトファイルとして読み込めません");
    state = {
      version: 1,
      length: Number(project.length) || 1.2,
      sampleRate: Number(project.sampleRate) || 44100,
      view: project.view || { x: 168, y: 0, scale: 1 },
      nodes: project.nodes.map((n) => ({
        id: String(n.id),
        type: nodeDefs[n.type] ? n.type : "output",
        x: Number(n.x) || 0,
        y: Number(n.y) || 0,
        params: { ...defaultsFor(nodeDefs[n.type] ? n.type : "output"), ...(n.params || {}) },
        fileName: n.fileName || "",
      })),
      connections: Array.isArray(project.connections) ? project.connections.map((c) => ({ ...c })) : [],
    };
    sampleStore.clear();
    updateSerialFromState();
    syncControls();
    renderUI();
    scheduleRender(true);
    setStatus("プロジェクトを開きました");
  }

  function bindToolbar() {
    els.lengthInput.addEventListener("change", () => {
      state.length = clamp(Number(els.lengthInput.value) || 1, 0.05, 20);
      els.lengthInput.value = state.length;
      scheduleRender();
    });
    els.rateSelect.addEventListener("change", () => {
      state.sampleRate = Number(els.rateSelect.value);
      scheduleRender();
    });
    els.autoCheck.addEventListener("change", () => scheduleRender(true));
    els.loadBtn.addEventListener("click", () => loadPreset(els.presetSelect.value));
    els.clearBtn.addEventListener("click", () => {
      state = blankState();
      sampleStore.clear();
      selectedNodeId = null;
      syncControls();
      renderUI();
      scheduleRender(true);
      setStatus("消去しました");
    });
    els.renderBtn.addEventListener("click", () => {
      rendered = renderProject();
      drawWaveform(rendered.samples);
      setStatus(`${rendered.samples.length}サンプルを生成しました`);
    });
    els.playBtn.addEventListener("click", () => {
      try {
        rendered = renderProject();
        playRendered();
      } catch (err) {
        setStatus(`再生エラー: ${err.message}`);
      }
    });
    els.stopBtn.addEventListener("click", stopPlayback);
    els.wavBtn.addEventListener("click", () => {
      try {
        exportWav();
      } catch (err) {
        setStatus(`WAVエラー: ${err.message}`);
      }
    });
    els.saveBtn.addEventListener("click", saveProject);
    els.openBtn.addEventListener("click", () => els.openFile.click());
    els.openFile.addEventListener("change", async () => {
      const file = els.openFile.files && els.openFile.files[0];
      if (!file) return;
      const text = await file.text();
      loadProject(JSON.parse(text));
      els.openFile.value = "";
    });
  }

  function init() {
    buildPalette();
    buildPresetSelect();
    bindToolbar();
    bindWorkspace();
    loadPreset("木の足音");
  }

  init();
})();
