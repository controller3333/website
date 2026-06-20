/* main.js — bootstrap: palette, transport, render scheduling, save/load. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const INITIAL_PRESET = 'レーザーショット';
  const CATEGORY_LABELS = {
    Source: '音源',
    Modulation: '変調',
    Processor: '加工',
    Combiner: '合成',
    Stereo: 'ステレオ',
    Output: '出力',
  };

  let graph = PRESETS[INITIAL_PRESET]();
  const engine = new AudioEngine();
  let editor;
  let renderTimer = null;
  let clipboard = null;                         // copied node {type, params}
  let curVar = { pitchMul: 1, seedOffset: 0, cents: 0 };

  function status(msg) { $('status').textContent = msg; }

  function scaleBuf(b, k) { const o = new Float32Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b[i] * k; return o; }

  // pick a fresh random pitch/seed within the ±cents range
  function randomizeVariation() {
    const cents = parseFloat($('in-vary').value) || 0;
    const c = (Math.random() * 2 - 1) * cents;
    curVar = { pitchMul: Math.pow(2, c / 1200), seedOffset: Math.floor(Math.random() * 9999) + 1, cents: c };
  }

  function settings() {
    return {
      duration: Math.max(0.05, parseFloat($('in-duration').value) || 1),
      sampleRate: parseInt($('in-samplerate').value, 10) || 44100,
      loop: $('in-loop').checked,
      auto: $('in-autorender').checked,
    };
  }

  function render() {
    const s = settings();
    const t0 = performance.now();
    const out = graph.render(s.duration, s.sampleRate, curVar);
    engine.lastBuffer = out;
    engine.sampleRate = s.sampleRate;
    drawScope($('scope'), out);
    const ms = (performance.now() - t0).toFixed(1);
    const mono = (out && out.stereo) ? DSP.helpers.toMono(out) : out;
    let peak = 0; for (let i = 0; i < mono.length; i++) { const a = Math.abs(mono[i]); if (a > peak) peak = a; }
    const ch = (out && out.stereo) ? 'ステレオ' : 'モノ';
    const vary = curVar.cents ? ` · ピッチ ${curVar.cents > 0 ? '+' : ''}${curVar.cents.toFixed(0)}ct` : '';
    status(`${mono.length}サンプルを生成 (${s.duration.toFixed(2)}s @ ${s.sampleRate}, ${ch}) / ${ms}ms · ピーク ${peak.toFixed(2)}${vary}`);
    return out;
  }

  function scheduleRender() {
    if (!settings().auto) return;
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { render(); if (engine.isPlaying) play(); }, 120);
  }

  function play(forceRandom) {
    const s = settings();
    const cents = parseFloat($('in-vary').value) || 0;
    if (forceRandom || cents > 0) randomizeVariation();
    const out = render();
    engine.onEnded = () => { $('btn-play').classList.remove('playing'); };
    engine.play(out, s.sampleRate, s.loop);
    $('btn-play').classList.add('playing');
  }

  function stop() { engine.stop(); $('btn-play').classList.remove('playing'); }

  // play the signal at the currently-hovered node (Ctrl+Space)
  function auditionHoveredNode() {
    const id = editor.hoverNodeId;
    if (!id || !graph.nodes[id]) { status('ノードにカーソルを合わせて Ctrl+Space で試聴'); return; }
    const s = settings();
    if ((parseFloat($('in-vary').value) || 0) > 0) randomizeVariation();
    let sig = graph.renderNodeOutput(id, s.duration, s.sampleRate, curVar);
    // control-signal nodes (Sweep/LFO/Envelope) can far exceed ±1 — scale to a
    // safe level for monitoring so they don't blast a DC thump at the speakers.
    const mono0 = (sig && sig.stereo) ? DSP.helpers.toMono(sig) : sig;
    let peak = 0; for (let i = 0; i < mono0.length; i++) { const a = Math.abs(mono0[i]); if (a > peak) peak = a; }
    if (peak > 1) {
      const k = 0.9 / peak;
      if (sig.stereo) { sig = { stereo: true, l: scaleBuf(sig.l, k), r: scaleBuf(sig.r, k) }; }
      else sig = scaleBuf(sig, k);
    }
    engine.onEnded = () => { $('btn-play').classList.remove('playing'); };
    engine.play(sig, s.sampleRate, s.loop);
    engine.lastBuffer = sig; engine.sampleRate = s.sampleRate;
    drawScope($('scope'), sig);
    editor.flashAudition(id);
    $('btn-play').classList.add('playing');
    const norm = peak > 1 ? ' (×' + (0.9 / peak).toFixed(3) + ')' : '';
    status('試聴: ' + DSP.TYPES[graph.nodes[id].type].title + ' [' + id + '] · ピーク ' + peak.toFixed(2) + norm);
  }

  // ---- palette ----
  function buildPalette() {
    const list = $('palette-list');
    const cats = {};
    for (const type in DSP.TYPES) {
      const def = DSP.TYPES[type];
      (cats[def.category] = cats[def.category] || []).push({ type, def });
    }
    const order = ['Source', 'Modulation', 'Processor', 'Combiner', 'Stereo', 'Output'];
    for (const cat of order) {
      if (!cats[cat]) continue;
      const h = document.createElement('div');
      h.className = 'palette-cat'; h.textContent = CATEGORY_LABELS[cat] || cat;
      list.appendChild(h);
      for (const { type, def } of cats[cat]) {
        const b = document.createElement('button');
        b.className = 'palette-item';
        b.style.setProperty('--accent', def.color);
        b.textContent = def.title;
        b.disabled = def.singleton && hasType(type);
        b.addEventListener('click', () => {
          if (def.singleton && hasType(type)) { status(def.title + ' は1つだけです'); return; }
          editor.addNodeAtView(type);
          refreshPaletteDisabled();
        });
        list.appendChild(b);
      }
    }
  }
  function hasType(type) { for (const id in graph.nodes) if (graph.nodes[id].type === type) return true; return false; }
  function refreshPaletteDisabled() {
    document.querySelectorAll('.palette-item').forEach(b => {});
    // rebuild simpler: toggle output button
    const items = document.querySelectorAll('.palette-item');
    items.forEach(it => {
      if (it.textContent === DSP.TYPES.output.title) it.disabled = hasType('output');
    });
  }

  // ---- presets dropdown ----
  function buildPresetSelect() {
    const sel = $('preset-select');
    for (const name in PRESETS) {
      const o = document.createElement('option');
      o.value = name; o.textContent = name; sel.appendChild(o);
    }
  }
  function loadPreset(name) {
    if (!PRESETS[name]) return;
    graph = PRESETS[name]();
    editor.rebuild(graph);
    refreshPaletteDisabled();
    render();
    status('プリセットを読み込みました: ' + name);
  }

  // ---- save / open ----
  function saveGraph() {
    const blob = new Blob([JSON.stringify(graph.toJSON(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'se-graph.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('グラフを保存しました');
  }
  function openGraphFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        graph = Graph.fromJSON(JSON.parse(reader.result));
        editor.rebuild(graph);
        refreshPaletteDisabled();
        render();
        status('グラフを開きました: ' + file.name);
      } catch (e) { status('読み込み失敗: ' + e.message); }
    };
    reader.readAsText(file);
  }

  function pasteClipboard() {
    if (!clipboard) return;
    const pos = editor._lastMouseWorld || { x: 200, y: 200 };
    const node = editor.addNodeFromData(clipboard.type, Object.assign({}, clipboard.params), pos.x, pos.y);
    if (node) { refreshPaletteDisabled(); status('貼り付けました: ' + DSP.TYPES[clipboard.type].title); }
    else status(DSP.TYPES[clipboard.type].title + ' は1つだけです');
  }

  function clearGraph() {
    graph = new Graph();
    graph.addNode('output', 700, 200);
    editor.rebuild(graph);
    refreshPaletteDisabled();
    render();
    status('消去しました');
  }

  // ---- init ----
  function init() {
    editor = new NodeEditor({ graph, onChange: scheduleRender });
    buildPalette();
    buildPresetSelect();

    $('btn-play').addEventListener('click', () => { engine.isPlaying ? stop() : play(); });
    $('btn-stop').addEventListener('click', stop);
    $('btn-render').addEventListener('click', render);
    $('btn-export').addEventListener('click', () => {
      render();
      if (engine.exportWAV('se_' + Date.now() + '.wav')) status('WAVを書き出しました');
      else status('書き出すデータがありません');
    });
    $('btn-load-preset').addEventListener('click', () => { const v = $('preset-select').value; if (v) loadPreset(v); });
    $('preset-select').addEventListener('change', () => { const v = $('preset-select').value; if (v) loadPreset(v); });
    $('btn-save').addEventListener('click', saveGraph);
    $('btn-open').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', e => { if (e.target.files[0]) openGraphFile(e.target.files[0]); e.target.value = ''; });
    $('btn-clear').addEventListener('click', clearGraph);
    $('btn-dice').addEventListener('click', () => play(true));

    ['in-duration', 'in-samplerate'].forEach(id => $(id).addEventListener('change', scheduleRender));

    window.addEventListener('keydown', e => {
      // Ctrl+Space: audition the hovered node (handled before the input guard
      // so it also works while a param field has focus).
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') { e.preventDefault(); auditionHoveredNode(); return; }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') { e.preventDefault(); engine.isPlaying ? stop() : play(); }
      else if (e.key === 'Delete' && editor.selected) {
        const n = graph.nodes[editor.selected];
        if (n && n.type !== 'output') editor._deleteNode(editor.selected);
      }
      else if (mod && e.key.toLowerCase() === 'c' && editor.selected) {
        const n = graph.nodes[editor.selected];
        if (n) { clipboard = { type: n.type, params: Object.assign({}, n.params) }; status('コピーしました: ' + DSP.TYPES[n.type].title); }
      }
      else if (mod && e.key.toLowerCase() === 'v' && clipboard) {
        e.preventDefault();
        pasteClipboard();
      }
      else if (mod && e.key.toLowerCase() === 'd' && editor.selected) {
        e.preventDefault();
        const node = editor.duplicateNode(editor.selected);
        status(node ? '複製しました' : 'このノードは複製できません');
      }
    });

    render();
    status(`準備完了 — プリセット「${INITIAL_PRESET}」を読込済み。Spaceキーで再生`);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
