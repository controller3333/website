/* main.js — bootstrap: palette, transport, render scheduling, save/load. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const DEFAULT_PRESET = 'Laser Shot';
  const PREF_VERSION = 2;

  function presetFromURL() {
    const raw = new URLSearchParams(location.search).get('preset');
    if (!raw) return DEFAULT_PRESET;
    if (PRESETS[raw]) return raw;
    if (window.PRESET_JA) {
      for (const name in PRESET_JA) if (PRESET_JA[name] === raw && PRESETS[name]) return name;
    }
    return DEFAULT_PRESET;
  }

  let currentPreset = presetFromURL();
  let graph = PRESETS[currentPreset]();
  const engine = new AudioEngine();
  let editor;
  let renderTimer = null;
  let clipboard = null;                         // copied selection { nodes:[], connections:[] }
  let curVar = { pitchMul: 1, seedOffset: 0, cents: 0 };
  let lang = 'ja';                              // node-name language ('en' | 'ja' default)

  function status(msg) { $('status').textContent = msg; }

  // ---- persisted prefs (server-side settings.json, localStorage fallback) ----
  let prefs = {};
  function hasSettingsAPI() {
    return ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  }
  function localPrefs() {
    try { return JSON.parse(localStorage.getItem('seSettings') || '{}'); }
    catch (e) { return {}; }
  }
  function loadPrefs(cb) {
    if (!hasSettingsAPI()) { cb(localPrefs()); return; }
    fetch('/api/settings')
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(s => cb(s || {}))
      .catch(() => cb(localPrefs()));
  }
  function savePrefs() {
    const body = JSON.stringify(prefs);
    try { localStorage.setItem('seSettings', body); } catch (e) {}
    if (!hasSettingsAPI()) return;
    fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
  }

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
    const ch = (out && out.stereo) ? 'stereo' : 'mono';
    const vary = curVar.cents ? ` · ${lang === 'ja' ? 'ピッチ' : 'pitch'} ${curVar.cents > 0 ? '+' : ''}${curVar.cents.toFixed(0)}ct` : '';
    if (lang === 'ja') status(`生成: ${mono.length}サンプル (${s.duration.toFixed(2)}秒 @ ${s.sampleRate}, ${ch === 'stereo' ? 'ステレオ' : 'モノ'}) ${ms}ms · ピーク ${peak.toFixed(2)}${vary}`);
    else status(`Rendered ${mono.length} smp (${s.duration.toFixed(2)}s @ ${s.sampleRate}, ${ch}) in ${ms}ms · peak ${peak.toFixed(2)}${vary}`);
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
    const nodeTitle = DSP.title(graph.nodes[id].type, lang);
    status((lang === 'ja' ? '🎧 試聴: ' : '🎧 Audition: ') + nodeTitle + ' [' + id + '] · ' + (lang === 'ja' ? 'ピーク ' : 'peak ') + peak.toFixed(2) + norm);
  }

  // ---- palette ----
  function buildPalette() {
    const list = $('palette-list');
    list.innerHTML = '';
    const cats = {};
    for (const type in DSP.TYPES) {
      const def = DSP.TYPES[type];
      (cats[def.category] = cats[def.category] || []).push({ type, def });
    }
    const order = ['Source', 'Modulation', 'Processor', 'Combiner', 'Stereo', 'Utility', 'Note', 'Output'];
    for (const cat of order) {
      if (!cats[cat]) continue;
      const h = document.createElement('div');
      h.className = 'palette-cat'; h.textContent = DSP.catName(cat, lang);
      list.appendChild(h);
      for (const { type, def } of cats[cat]) {
        const b = document.createElement('button');
        b.className = 'palette-item';
        b.style.setProperty('--accent', def.color);
        b.textContent = DSP.title(type, lang);
        b.dataset.type = type;
        b.disabled = def.singleton && hasType(type);
        b.addEventListener('click', () => {
          if (def.singleton && hasType(type)) { status(DSP.title(type, lang) + (lang === 'ja' ? ' は1つだけです' : ' is singleton')); return; }
          editor.addNodeAtView(type);
          refreshPaletteDisabled();
        });
        b.addEventListener('mouseenter', () => showTip(b, type));
        b.addEventListener('mouseleave', hideTip);
        list.appendChild(b);
      }
    }
  }

  // ---- palette tooltip ----
  let tipEl = null;
  function showTip(btn, type) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.id = 'palette-tip'; document.body.appendChild(tipEl); }
    tipEl.innerHTML = '<b></b><span></span>';
    tipEl.querySelector('b').textContent = DSP.title(type, lang);
    tipEl.querySelector('span').textContent = DSP.desc(type, lang);
    tipEl.style.display = 'block';
    const r = btn.getBoundingClientRect();
    tipEl.style.left = (r.right + 8) + 'px';
    tipEl.style.top = r.top + 'px';
    const th = tipEl.offsetHeight;
    if (r.top + th > window.innerHeight - 8) tipEl.style.top = Math.max(8, window.innerHeight - th - 8) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

  // ---- right-click context menu (insert nodes: category -> node submenu) ----
  let ctxMenuEl = null, ctxWorld = null;
  function hideCtxMenu() { if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; } }
  // keep a hovered submenu fully on-screen (flip side / shift up as needed)
  function positionSubmenu(item, sub) {
    sub.style.display = 'block';                 // measurable while hovered
    const cr = item.getBoundingClientRect();
    const sw = sub.offsetWidth, sh = sub.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight, gap = 3;
    let vx = cr.right + gap;                      // prefer opening to the right
    if (vx + sw > vw - 6) vx = cr.left - sw - gap; // else to the left
    if (vx < 6) vx = 6;
    let vy = cr.top - 5;                           // align near the item top
    if (vy + sh > vh - 6) vy = vh - 6 - sh;        // shift up if it overflows the bottom
    if (vy < 6) vy = 6;
    sub.style.left = (vx - cr.left) + 'px';
    sub.style.right = 'auto';
    sub.style.marginLeft = '0'; sub.style.marginRight = '0';
    sub.style.top = (vy - cr.top) + 'px';
    sub.style.display = '';                        // let :hover control visibility again
  }
  function showContextMenu(clientX, clientY) {
    hideCtxMenu();
    ctxWorld = editor.clientToWorld(clientX, clientY);
    const m = document.createElement('div');
    m.id = 'ctx-menu'; m.className = 'ctx-menu';
    // the native contextmenu fires after pointerup (when this menu is already up);
    // if the menu sits under the cursor (e.g. clamped upward near the screen edge)
    // its element would receive that event, so suppress the browser menu here too.
    m.addEventListener('contextmenu', e => e.preventDefault());
    if (clientX > window.innerWidth / 2) m.classList.add('flip'); // open submenus leftward
    const cats = {};
    for (const type in DSP.TYPES) { const def = DSP.TYPES[type]; (cats[def.category] = cats[def.category] || []).push({ type, def }); }
    const order = ['Source', 'Modulation', 'Processor', 'Combiner', 'Stereo', 'Utility', 'Note', 'Output'];
    for (const cat of order) {
      if (!cats[cat]) continue;
      const item = document.createElement('div'); item.className = 'ctx-cat';
      const lab = document.createElement('span'); lab.textContent = DSP.catName(cat, lang); item.appendChild(lab);
      const arr = document.createElement('span'); arr.className = 'ctx-arrow'; arr.textContent = '▸'; item.appendChild(arr);
      const sub = document.createElement('div'); sub.className = 'ctx-sub';
      for (const { type, def } of cats[cat]) {
        const b = document.createElement('div'); b.className = 'ctx-node'; b.textContent = DSP.title(type, lang);
        b.style.setProperty('--accent', def.color);
        if (def.singleton && hasType(type)) b.classList.add('disabled');
        b.addEventListener('click', e => {
          e.stopPropagation();
          if (def.singleton && hasType(type)) return;
          const node = editor.addNodeFromData(type, undefined, ctxWorld.x, ctxWorld.y);
          if (node) refreshPaletteDisabled();
          hideCtxMenu();
        });
        sub.appendChild(b);
      }
      item.appendChild(sub);
      item.addEventListener('mouseenter', () => positionSubmenu(item, sub));
      m.appendChild(item);
    }
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    let x = clientX, y = clientY;
    if (x + r.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - r.width - 8);
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - r.height - 8);
    m.style.left = x + 'px'; m.style.top = y + 'px';
    ctxMenuEl = m;
  }

  function hasType(type) { for (const id in graph.nodes) if (graph.nodes[id].type === type) return true; return false; }
  function refreshPaletteDisabled() {
    document.querySelectorAll('.palette-item').forEach(it => {
      const t = it.dataset.type;
      if (t && DSP.TYPES[t] && DSP.TYPES[t].singleton) it.disabled = hasType(t);
    });
  }

  // ---- presets dropdown ----
  function presetLabel(name) {
    return (lang === 'ja' && window.PRESET_JA && PRESET_JA[name]) ? PRESET_JA[name] : name;
  }
  function buildPresetSelect() {
    const sel = $('preset-select');
    const cur = sel.value || currentPreset;
    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = lang === 'ja' ? '— プリセット —' : '— Presets —';
    sel.appendChild(ph);
    for (const name in PRESETS) {
      const o = document.createElement('option');
      o.value = name; o.textContent = presetLabel(name); sel.appendChild(o);
    }
    sel.value = PRESETS[cur] ? cur : '';
  }
  function applyGraphHints() {
    if (graph.suggestedDuration) $('in-duration').value = graph.suggestedDuration;
    $('in-loop').checked = !!graph.suggestedLoop;
  }
  function loadPreset(name) {
    if (!PRESETS[name]) return;
    currentPreset = name;
    graph = PRESETS[name]();
    editor.rebuild(graph);
    $('preset-select').value = name;
    applyGraphHints();
    refreshPaletteDisabled();
    render();
    status((lang === 'ja' ? '読込: ' : 'Loaded preset: ') + presetLabel(name));
  }

  // ---- save / open ----
  function saveGraph() {
    const blob = new Blob([JSON.stringify(graph.toJSON(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'se-graph.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(lang === 'ja' ? 'グラフを保存しました' : 'Graph saved');
  }
  function openGraphFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        graph = Graph.fromJSON(JSON.parse(reader.result));
        editor.rebuild(graph);
        currentPreset = '';
        $('preset-select').value = '';
        refreshPaletteDisabled();
        render();
        status((lang === 'ja' ? 'グラフを開きました: ' : 'Graph loaded: ') + file.name);
      } catch (e) { status('読み込み失敗: ' + e.message); }
    };
    reader.readAsText(file);
  }

  // snapshot the current selection (nodes + the connections among them)
  function copySelection() {
    const ids = editor.selectedIds();
    if (!ids.length) return null;
    const idset = new Set(ids);
    const nodes = ids.map(id => {
      const n = graph.nodes[id]; if (!n) return null;
      return { id, type: n.type, x: n.x, y: n.y, params: Object.assign({}, n.params), attachedTo: n.attachedTo || null };
    }).filter(Boolean);
    const connections = graph.connections
      .filter(c => idset.has(c.from.node) && idset.has(c.to.node))
      .map(c => ({ from: { node: c.from.node, port: c.from.port }, to: { node: c.to.node, port: c.to.port } }));
    return { nodes, connections };
  }

  // recreate copied nodes (relative layout preserved) + their internal wiring,
  // remap ids, then select the new nodes. mode 'cursor' anchors at the pointer.
  function pasteData(data, mode) {
    if (!data || !data.nodes.length) return 0;
    const minX = Math.min(...data.nodes.map(n => n.x));
    const minY = Math.min(...data.nodes.map(n => n.y));
    let ax, ay;
    if (mode === 'cursor' && editor._lastMouseWorld) { ax = editor._lastMouseWorld.x; ay = editor._lastMouseWorld.y; }
    else { ax = minX + 28; ay = minY + 28; }
    const idMap = {}; const created = [];
    for (const nd of data.nodes) {
      const nx = Math.round(ax + (nd.x - minX)), ny = Math.round(ay + (nd.y - minY));
      const node = editor.addNodeFromData(nd.type, Object.assign({}, nd.params), nx, ny);
      if (node) { idMap[nd.id] = node.id; created.push({ src: nd, node }); }
    }
    for (const { src, node } of created) {                 // remap note attachments
      if (src.attachedTo && idMap[src.attachedTo]) { node.attachedTo = idMap[src.attachedTo]; editor._refreshNode(node); }
    }
    for (const c of data.connections) {                    // recreate internal wiring
      if (idMap[c.from.node] && idMap[c.to.node]) graph.connect(idMap[c.from.node], c.from.port, idMap[c.to.node], c.to.port);
    }
    editor._repositionAttachedNotes();
    editor.drawWires();
    const newIds = Object.values(idMap);
    if (newIds.length) editor._setSelection(newIds);
    refreshPaletteDisabled();
    scheduleRender();
    return created.length;
  }

  function clearGraph() {
    graph = new Graph();
    graph.addNode('output', 700, 200);
    editor.rebuild(graph);
    currentPreset = '';
    $('preset-select').value = '';
    refreshPaletteDisabled();
    render();
    status(lang === 'ja' ? '消去しました' : 'Cleared');
  }

  // ---- init ----
  function init() {
    editor = new NodeEditor({ graph, onChange: scheduleRender, lang, onContextMenu: (x, y) => showContextMenu(x, y) });
    buildPalette();
    buildPresetSelect();
    applyGraphHints();

    function applyLang(l) {
      lang = l;
      $('in-lang').checked = (lang === 'ja');
      editor.setLang(lang);
      buildPalette();
      buildPresetSelect();
      refreshPaletteDisabled();
    }
    $('in-lang').addEventListener('change', e => {
      applyLang(e.target.checked ? 'ja' : 'en');
      prefs.lang = lang;
      prefs.version = PREF_VERSION;
      savePrefs();
    });

    // restore persisted preferences
    loadPrefs(s => { prefs = s || {}; if (prefs.version === PREF_VERSION && prefs.lang) applyLang(prefs.lang); });

    $('btn-play').addEventListener('click', () => { engine.isPlaying ? stop() : play(); });
    $('btn-stop').addEventListener('click', stop);
    $('btn-render').addEventListener('click', render);
    $('btn-export').addEventListener('click', () => {
      render();
      if (engine.exportWAV('se_' + Date.now() + '.wav')) status(lang === 'ja' ? 'WAVを書き出しました' : 'WAV exported');
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

    // the context menu opens via the editor's onContextMenu callback (right-click
    // without dragging on empty canvas); just handle dismissal here.
    window.addEventListener('pointerdown', e => { if (ctxMenuEl && !ctxMenuEl.contains(e.target)) hideCtxMenu(); });
    window.addEventListener('wheel', () => hideCtxMenu(), { passive: true });

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') { hideCtxMenu(); }
      // Ctrl+Space: audition the hovered node (handled before the input guard
      // so it also works while a param field has focus).
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') { e.preventDefault(); auditionHoveredNode(); return; }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') { e.preventDefault(); engine.isPlaying ? stop() : play(); }
      else if (e.key === 'Delete') {
        editor.deleteSelected();
        refreshPaletteDisabled();
      }
      else if (mod && e.key.toLowerCase() === 'c') {
        const data = copySelection();
        if (data) { clipboard = data; status((lang === 'ja' ? 'コピー: ' : 'Copied: ') + data.nodes.length + (lang === 'ja' ? '個' : ' node(s)')); }
      }
      else if (mod && e.key.toLowerCase() === 'v' && clipboard) {
        e.preventDefault();
        const n = pasteData(clipboard, 'cursor');
        status((lang === 'ja' ? '貼り付け: ' : 'Pasted: ') + n + (lang === 'ja' ? '個' : ' node(s)'));
      }
      else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const n = pasteData(copySelection(), 'offset');
        status((lang === 'ja' ? '複製: ' : 'Duplicated: ') + n + (lang === 'ja' ? '個' : ' node(s)'));
      }
    });

    render();
    status((lang === 'ja' ? '準備完了 — プリセット「' : 'Ready — preset "') + presetLabel(currentPreset) + (lang === 'ja' ? '」を読込済み。Spaceで再生' : '" loaded. Space to play'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
