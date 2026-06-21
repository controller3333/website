/* main.js — wires the editor, engine, transport, presets, save/load, export. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  let lang = 'en';
  let graph = new Graph();
  let editor, engine;
  const view = { cx: 0.5, cy: 0.5, scale: 1 };   // origin as fraction of canvas + zoom
  let playing = true;
  let lastT = 0, rafId = 0;
  let showOrigin = true;

  // ---------- canvas ----------
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  function resizeCanvas() {
    const wrap = $('stage-wrap');
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, r.width * dpr);
    canvas.height = Math.max(1, r.height * dpr);
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas._cssW = r.width; canvas._cssH = r.height;
  }

  function originPx() {
    return { x: canvas._cssW * view.cx, y: canvas._cssH * view.cy };
  }

  // ---------- undo / redo history ----------
  const history = { stack: [], idx: -1, max: 100 };
  let snapTimer = 0, restoring = false, clipboard = null;
  function snapshot() {
    if (restoring) return;
    const s = JSON.stringify(graph.toJSON());
    if (history.stack[history.idx] === s) return;
    history.stack = history.stack.slice(0, history.idx + 1);
    history.stack.push(s);
    if (history.stack.length > history.max) history.stack.shift();
    history.idx = history.stack.length - 1;
    updateHistButtons();
  }
  function scheduleSnapshot() { clearTimeout(snapTimer); snapTimer = setTimeout(snapshot, 450); }
  function restoreFrom(idx) {
    if (idx < 0 || idx >= history.stack.length) return;
    history.idx = idx; restoring = true;
    graph = Graph.fromJSON(JSON.parse(history.stack[idx]));
    editor.rebuild(graph); recompile();
    restoring = false; updateHistButtons();
  }
  function undo() { if (history.idx > 0) restoreFrom(history.idx - 1); }
  function redo() { if (history.idx < history.stack.length - 1) restoreFrom(history.idx + 1); }
  function updateHistButtons() {
    const u = $('btn-undo'), r = $('btn-redo');
    if (u) u.disabled = history.idx <= 0;
    if (r) r.disabled = history.idx >= history.stack.length - 1;
  }

  // ---------- compile / recompile ----------
  let recompileTimer = 0;
  function scheduleRecompile() {
    clearTimeout(recompileTimer);
    recompileTimer = setTimeout(recompile, 60);
    scheduleSnapshot();
  }
  function recompile(keepParticles) {
    const spec = graph.compile();
    engine.setSpec(spec);
    if (!keepParticles) engine.reset();
    $('stat-emitters').textContent = (spec.emitters || []).length;
    updateValidity(spec);
  }
  function resetHistory() { history.stack = []; history.idx = -1; snapshot(); }

  function updateValidity(spec) {
    const warn = $('warn');
    const issues = [];
    if (!graph.outputNode()) issues.push(lang === 'ja' ? 'Effect出力ノードがありません' : 'No Effect output node');
    else if (!(spec.emitters || []).length) issues.push(lang === 'ja' ? 'エミッタが接続されていません' : 'No emitter connected');
    else {
      spec.emitters.forEach((e, i) => { if (!e.render) issues.push((lang === 'ja' ? 'エミッタ' : 'Emitter ') + (i + 1) + (lang === 'ja' ? 'に描画ノードがありません' : ' has no Renderer')); });
    }
    if (issues.length) { warn.style.display = 'block'; warn.textContent = '⚠ ' + issues.join(' · '); }
    else warn.style.display = 'none';
  }

  // ---------- render loop ----------
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!lastT) lastT = now;
    let dt = (now - lastT) / 1000; lastT = now;
    if (dt > 0.05) dt = 0.05;            // clamp big stalls
    const spec = engine.spec;

    // background / trails
    const o = originPx();
    if (spec.persistence > 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = hexA(spec.background, 1 - spec.persistence);
      ctx.fillRect(0, 0, canvas._cssW, canvas._cssH);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = spec.background || '#0a0a12';
      ctx.fillRect(0, 0, canvas._cssW, canvas._cssH);
    }

    if (playing) engine.step(dt);
    engine.render(ctx, canvas._cssW, canvas._cssH, o.x, o.y, view.scale);

    if (showOrigin) drawOrigin(o);
    if ($('export-panel').classList.contains('open')) drawExportGuide(o);

    $('stat-count').textContent = engine.count;
    $('stat-time').textContent = engine.time.toFixed(1) + 's';
  }

  function drawOrigin(o) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(o.x - 8, o.y); ctx.lineTo(o.x + 8, o.y); ctx.moveTo(o.x, o.y - 8); ctx.lineTo(o.x, o.y + 8); ctx.stroke();
    ctx.restore();
  }

  function drawExportGuide(o) {
    const fs = parseInt($('exp-size').value, 10) || 128;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(77,208,225,.8)'; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
    ctx.strokeRect(Math.round(o.x - fs / 2) + 0.5, Math.round(o.y - fs / 2) + 0.5, fs, fs);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(77,208,225,.8)'; ctx.font = '10px sans-serif';
    ctx.fillText(fs + '×' + fs + ' capture', o.x - fs / 2, o.y - fs / 2 - 4);
    ctx.restore();
  }

  function hexA(hex, a) {
    const c = (window.VFXUtil ? VFXUtil.hexToRgb(hex) : { r: 10, g: 10, b: 18 });
    return `rgba(${c.r},${c.g},${c.b},${a})`;
  }

  // ---------- palette ----------
  function buildPalette() {
    const list = $('palette-list'); list.innerHTML = '';
    for (const cat of Nodes.CATEGORIES) {
      const types = Object.keys(Nodes.TYPES).filter(t => Nodes.TYPES[t].category === cat);
      if (!types.length) continue;
      const group = document.createElement('div'); group.className = 'pal-group';
      const h = document.createElement('div'); h.className = 'pal-cat'; h.textContent = cat;
      h.style.color = Nodes.TYPES[types[0]].color;
      group.appendChild(h);
      for (const t of types) {
        const def = Nodes.TYPES[t];
        const b = document.createElement('button'); b.className = 'pal-item';
        b.style.setProperty('--accent', def.color);
        b.textContent = Nodes.title(t, lang);
        b.title = Nodes.nodeDesc(t, lang);
        b.addEventListener('click', () => { editor.addNodeAtView(t); scheduleRecompile(); });
        group.appendChild(b);
      }
      list.appendChild(group);
    }
  }

  // ---------- context menu (right-click insert) ----------
  let menuEl = null;
  function showContextMenu(clientX, clientY) {
    hideContextMenu();
    menuEl = document.createElement('div'); menuEl.className = 'ctx-menu';
    const search = document.createElement('input'); search.className = 'ctx-search'; search.placeholder = lang === 'ja' ? 'ノード検索…' : 'search nodes…';
    menuEl.appendChild(search);
    const listWrap = document.createElement('div'); listWrap.className = 'ctx-list'; menuEl.appendChild(listWrap);
    const items = [];
    for (const cat of Nodes.CATEGORIES) {
      for (const t of Object.keys(Nodes.TYPES).filter(t => Nodes.TYPES[t].category === cat)) {
        items.push({ type: t, label: Nodes.title(t, lang), cat });
      }
    }
    const world = editor.clientToWorld(clientX, clientY);
    function render(filter) {
      listWrap.innerHTML = '';
      const f = filter.toLowerCase();
      for (const it of items) {
        if (f && !(it.label.toLowerCase().includes(f) || it.type.toLowerCase().includes(f) || it.cat.toLowerCase().includes(f))) continue;
        const b = document.createElement('button'); b.className = 'ctx-item';
        b.style.setProperty('--accent', Nodes.TYPES[it.type].color);
        b.innerHTML = `<span class="ctx-cat">${it.cat}</span>${it.label}`;
        b.addEventListener('click', () => { editor.addNodeFromData(it.type, null, world.x, world.y); scheduleRecompile(); hideContextMenu(); });
        listWrap.appendChild(b);
      }
    }
    render('');
    search.addEventListener('input', () => render(search.value));
    search.addEventListener('keydown', e => { if (e.key === 'Enter') { const first = listWrap.querySelector('.ctx-item'); if (first) first.click(); } if (e.key === 'Escape') hideContextMenu(); });
    document.body.appendChild(menuEl);
    const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    menuEl.style.left = Math.min(clientX, window.innerWidth - mw - 8) + 'px';
    menuEl.style.top = Math.min(clientY, window.innerHeight - mh - 8) + 'px';
    search.focus();
    setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
  }
  function onDocDown(e) { if (menuEl && !menuEl.contains(e.target)) hideContextMenu(); }
  function hideContextMenu() { if (menuEl) { menuEl.remove(); menuEl = null; document.removeEventListener('pointerdown', onDocDown, true); } }

  // ---------- transport ----------
  function setPlaying(p) { playing = p; $('btn-play').textContent = p ? '❚❚ Pause' : '▶ Play'; $('btn-play').classList.toggle('primary', !p); }
  function restart() { engine.reset(); engine.time = 0; }

  // ---------- presets ----------
  function buildPresetSelect() {
    const sel = $('preset-select');
    for (const name in PRESETS) { const o = document.createElement('option'); o.value = name; o.textContent = name; sel.appendChild(o); }
  }
  function loadPreset(name) {
    const data = PRESETS[name] && PRESETS[name]();
    if (!data) return;
    graph = Graph.fromJSON(data);
    editor.rebuild(graph);
    setTimeout(() => editor.fitView(), 0);
    recompile();
    resetHistory();
    restart();
  }

  // ---------- save / load ----------
  function saveGraph() {
    const data = JSON.stringify(graph.toJSON(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'vfx-graph.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function openGraphFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try { graph = Graph.fromJSON(JSON.parse(reader.result)); editor.rebuild(graph); setTimeout(() => editor.fitView(), 0); recompile(); resetHistory(); restart(); }
      catch (e) { alert('Invalid graph file'); }
    };
    reader.readAsText(file);
  }
  function clearGraph() {
    graph = new Graph();
    graph.addNode('effect', 1040, 220);
    editor.rebuild(graph); recompile(); resetHistory(); restart();
  }

  // ---------- sprite-sheet export (offscreen render of N frames) ----------
  function exportSpriteSheet() {
    const cols = parseInt($('exp-cols').value, 10) || 8;
    const rows = parseInt($('exp-rows').value, 10) || 1;
    const fs = parseInt($('exp-size').value, 10) || 128;
    const dur = parseFloat($('exp-dur').value) || 1.0;
    const fps = parseInt($('exp-fps').value, 10) || 24;
    const transparent = $('exp-alpha').checked;
    const frames = cols * rows;
    const sheet = document.createElement('canvas'); sheet.width = cols * fs; sheet.height = rows * fs;
    const sctx = sheet.getContext('2d');

    // dedicated engine instance so the live preview is untouched
    const ex = new ParticleEngine();
    ex.setSpec(graph.compile());
    ex.reset();
    const fctx = document.createElement('canvas'); fctx.width = fs; fctx.height = fs;
    const f2 = fctx.getContext('2d');
    const spec = ex.spec;
    const dt = 1 / fps;
    const frameStep = dur / frames;       // sim-seconds advanced per exported frame
    // prime: run a moment so continuous effects aren't empty on frame 0
    for (let t = 0; t < 0.25; t += dt) ex.step(dt);

    for (let i = 0; i < frames; i++) {
      // advance simulation by one export-frame worth of time (sub-stepped)
      let acc = frameStep;
      while (acc > 1e-4) { const s = Math.min(dt, acc); ex.step(s); acc -= s; }
      // draw this frame
      f2.setTransform(1, 0, 0, 1, 0, 0);
      f2.globalCompositeOperation = 'source-over';
      if (transparent) f2.clearRect(0, 0, fs, fs);
      else { f2.fillStyle = spec.background || '#000'; f2.fillRect(0, 0, fs, fs); }
      // capture at the live zoom (WYSIWYG with the on-screen guide frame)
      ex.render(f2, fs, fs, fs / 2, fs / 2, view.scale);
      const cx = (i % cols) * fs, cy = Math.floor(i / cols) * fs;
      sctx.drawImage(fctx, cx, cy);
    }
    sheet.toBlob(blob => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `vfx-sheet-${cols}x${rows}-${fs}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  }

  // ---------- WebM video export (records the live canvas in real time) ----------
  let recorder = null;
  function exportWebM() {
    if (recorder) { recorder.stop(); return; }
    if (!canvas.captureStream) { alert('WebM recording not supported in this browser'); return; }
    const dur = parseFloat($('exp-dur').value) || 2.0;
    const fps = parseInt($('exp-fps').value, 10) || 30;
    const stream = canvas.captureStream(fps);
    let mime = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'vfx-clip.webm'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      recorder = null;
      const b = $('btn-export-webm'); b.textContent = '⬇ WebM Clip'; b.classList.remove('primary');
    };
    setPlaying(true); restart();
    recorder.start();
    const b = $('btn-export-webm'); b.textContent = '■ Stop (' + dur + 's)'; b.classList.add('primary');
    setTimeout(() => { if (recorder) recorder.stop(); }, dur * 1000);
  }

  // ---------- randomize (mutate params for creative discovery) ----------
  function randomize(amount) {
    amount = amount == null ? 0.3 : amount;
    const ids = editor.selectedIds().length ? editor.selectedIds() : Object.keys(graph.nodes);
    const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    for (const id of ids) {
      const node = graph.nodes[id]; const def = Nodes.TYPES[node.type];
      for (const pd of def.params) {
        if (pd.type === 'number') {
          const span = pd.max - pd.min;
          node.params[pd.name] = clampN(node.params[pd.name] + (Math.random() - 0.5) * span * amount, pd.min, pd.max);
          if (pd.step >= 1) node.params[pd.name] = Math.round(node.params[pd.name]);
        } else if (pd.type === 'range') {
          const span = pd.max - pd.min;
          const a = node.params[pd.name].map(v => clampN(v + (Math.random() - 0.5) * span * amount, pd.min, pd.max));
          if (pd.step >= 1) { a[0] = Math.round(a[0]); a[1] = Math.round(a[1]); }
          node.params[pd.name] = a;
        } else if (pd.type === 'color') {
          node.params[pd.name] = shiftHue(node.params[pd.name], (Math.random() - 0.5) * 80 * amount * 3);
        }
      }
    }
    editor.renderAll(); scheduleRecompile(); restart();
  }
  function shiftHue(hex, deg) {
    const c = VFXUtil.hexToRgb(hex);
    let r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0, s = max === 0 ? 0 : d / max, v = max;
    if (d) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; }
    h = (h + deg + 360) % 360;
    const cc = v * s, x = cc * (1 - Math.abs((h / 60) % 2 - 1)), m = v - cc; let rr = 0, gg = 0, bb = 0;
    const hp = h / 60;
    if (hp < 1) { rr = cc; gg = x; } else if (hp < 2) { rr = x; gg = cc; } else if (hp < 3) { gg = cc; bb = x; }
    else if (hp < 4) { gg = x; bb = cc; } else if (hp < 5) { rr = x; bb = cc; } else { rr = cc; bb = x; }
    const hx = v2 => ('0' + Math.round((v2 + m) * 255).toString(16)).slice(-2);
    return '#' + hx(rr) + hx(gg) + hx(bb);
  }

  function exportPNG() {
    const tmp = document.createElement('canvas'); tmp.width = canvas.width; tmp.height = canvas.height;
    const t = tmp.getContext('2d'); t.drawImage(canvas, 0, 0);
    tmp.toBlob(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vfx-frame.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }, 'image/png');
  }

  // ---------- settings persistence ----------
  function loadSettings() {
    return fetch('/api/settings').then(r => r.json()).catch(() => ({}));
  }
  function saveSettings(s) {
    fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) }).catch(() => {});
  }

  // ---------- init ----------
  function init() {
    engine = new ParticleEngine();
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // start from a preset so the canvas is alive immediately
    graph = Graph.fromJSON(PRESETS['Fire 🔥']());

    editor = new NodeEditor({
      graph, lang,
      onChange: () => scheduleRecompile(),
      onContextMenu: (x, y) => showContextMenu(x, y),
    });

    buildPalette();
    buildPresetSelect();
    recompile();
    resetHistory();
    setTimeout(() => editor.fitView(), 30);

    // transport
    $('btn-play').addEventListener('click', () => setPlaying(!playing));
    $('btn-restart').addEventListener('click', restart);
    $('btn-undo').addEventListener('click', undo);
    $('btn-redo').addEventListener('click', redo);
    $('btn-fit').addEventListener('click', () => editor.fitView());
    $('toggle-origin').addEventListener('change', e => { showOrigin = e.target.checked; });

    // view zoom for the preview (effect scale)
    $('view-scale').addEventListener('input', e => { view.scale = parseFloat(e.target.value); $('view-scale-val').textContent = view.scale.toFixed(2) + '×'; });

    // presets
    $('btn-load-preset').addEventListener('click', () => { const v = $('preset-select').value; if (v) loadPreset(v); });
    $('preset-select').addEventListener('change', () => { const v = $('preset-select').value; if (v) loadPreset(v); });

    // save / load / clear
    $('btn-save').addEventListener('click', saveGraph);
    $('btn-open').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', e => { if (e.target.files[0]) openGraphFile(e.target.files[0]); e.target.value = ''; });
    $('btn-clear').addEventListener('click', () => { if (confirm(lang === 'ja' ? 'グラフを消去しますか？' : 'Clear the graph?')) clearGraph(); });

    // export
    $('btn-export-sheet').addEventListener('click', exportSpriteSheet);
    $('btn-export-png').addEventListener('click', exportPNG);
    $('btn-export-webm').addEventListener('click', exportWebM);
    $('btn-export-panel').addEventListener('click', () => $('export-panel').classList.toggle('open'));
    $('btn-dice').addEventListener('click', () => randomize(0.3));

    // lang toggle
    $('in-lang').addEventListener('change', e => {
      lang = e.target.checked ? 'ja' : 'en';
      editor.setLang(lang); buildPalette();
      document.documentElement.lang = lang;
      saveSettings({ lang });
    });

    // keyboard
    window.addEventListener('keydown', e => {
      const ae = document.activeElement;
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA');
      if (typing) return;
      if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
      else if (e.key === 'r' || e.key === 'R') { restart(); }
      else if (e.key === 'f' || e.key === 'F') { editor.fitView(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { editor.deleteSelected(); scheduleRecompile(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'd')) { e.preventDefault(); const id = editor.selected; if (id) editor.duplicateNode(id); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 's')) { e.preventDefault(); saveGraph(); }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) { const c = editor.copySelection(); if (c) clipboard = c; }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) { if (clipboard) { editor.pasteData(clipboard, editor.lastMouseWorld); scheduleRecompile(); } }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); editor._setSelection(Object.keys(graph.nodes)); }
    });

    // restore settings
    loadSettings().then(s => { if (s && s.lang === 'ja') { $('in-lang').checked = true; lang = 'ja'; editor.setLang(lang); buildPalette(); } });

    setPlaying(true);
    rafId = requestAnimationFrame(frame);

    // debug handle (used by automated checks; harmless in normal use)
    window.__vfx = {
      get engine() { return engine; },
      get graph() { return graph; },
      get editor() { return editor; },
      get history() { return history; },
      undo, redo, snapshot,
      step: (n, dt) => { for (let i = 0; i < (n || 1); i++) engine.step(dt || 1 / 60); },
      frame: () => frame(performance.now()),
      resize: resizeCanvas,
    };
  }

  window.addEventListener('DOMContentLoaded', init);
})();
