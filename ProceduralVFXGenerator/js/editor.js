/* editor.js — node editor UI: render nodes, drag, connect, params, pan/zoom.
 * Adapted from the sibling SE generator's editor, generalized to the `Nodes`
 * registry and extended with color / gradient / curve / range param widgets. */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const REG = () => global.Nodes;

  class NodeEditor {
    constructor(opts) {
      this.graph = opts.graph;
      this.worldEl = document.getElementById('world');
      this.nodesEl = document.getElementById('nodes');
      this.wiresEl = document.getElementById('wires');
      this.wrapEl = document.getElementById('canvas-wrap');
      this.onChange = opts.onChange || function () {};
      this.onContextMenu = opts.onContextMenu || null;
      this.lang = opts.lang || 'en';
      this.selected = null;
      this.sel = new Set();
      this.pan = { x: 60, y: 60 };
      this.zoom = 1;
      this.nodeEls = {};
      this.portEls = {};
      this.drag = null;
      this._bind();
      this.renderAll();
      this._applyTransform();
    }

    clientToWorld(cx, cy) {
      const r = this.wrapEl.getBoundingClientRect();
      return { x: (cx - r.left - this.pan.x) / this.zoom, y: (cy - r.top - this.pan.y) / this.zoom };
    }
    _applyTransform() { this.worldEl.style.transform = `translate(${this.pan.x}px,${this.pan.y}px) scale(${this.zoom})`; }

    renderAll() {
      this.nodesEl.innerHTML = '';
      this.nodeEls = {}; this.portEls = {};
      for (const id in this.graph.nodes) this._renderNode(this.graph.nodes[id]);
      this.drawWires();
    }

    _renderNode(node) {
      const def = REG().TYPES[node.type];
      const el = document.createElement('div');
      el.className = 'node';
      el.style.left = node.x + 'px'; el.style.top = node.y + 'px';
      el.dataset.id = node.id;
      el.style.setProperty('--accent', def.color);

      const header = document.createElement('div');
      header.className = 'node-header';
      const cat = document.createElement('span'); cat.className = 'node-cat'; cat.textContent = def.category;
      const titleEl = document.createElement('span'); titleEl.className = 'node-title'; titleEl.textContent = REG().title(node.type, this.lang);
      header.appendChild(titleEl); header.appendChild(cat);
      if (!def.singleton) {
        const del = document.createElement('button');
        del.className = 'node-del'; del.textContent = '×'; del.title = this.lang === 'ja' ? '削除' : 'Delete';
        del.addEventListener('pointerdown', e => e.stopPropagation());
        del.addEventListener('click', e => { e.stopPropagation(); this._deleteNode(node.id); });
        header.appendChild(del);
      }
      el.appendChild(header);

      const body = document.createElement('div'); body.className = 'node-body';
      const inCol = document.createElement('div'); inCol.className = 'ports in';
      for (const port of (def.inputs || [])) inCol.appendChild(this._renderPort(node, 'in', port));
      const outCol = document.createElement('div'); outCol.className = 'ports out';
      for (const port of (def.outputs || [])) outCol.appendChild(this._renderPort(node, 'out', port));
      const portRow = document.createElement('div'); portRow.className = 'port-row';
      portRow.appendChild(inCol); portRow.appendChild(outCol);
      body.appendChild(portRow);

      if (def.params.length) {
        const params = document.createElement('div'); params.className = 'params';
        params.dataset.for = node.id;
        for (const pd of def.params) {
          const row = this._renderParam(node, pd);
          if (pd.when && !pd.when(node.params)) row.style.display = 'none';
          row.dataset.param = pd.name;
          params.appendChild(row);
        }
        body.appendChild(params);
      }
      el.appendChild(body);
      el.addEventListener('pointerdown', e => this._onNodePointerDown(e, node));
      this.nodesEl.appendChild(el);
      this.nodeEls[node.id] = el;
      return el;
    }

    // re-evaluate `when` visibility for a node's params after a value changes
    _refreshParamVisibility(node) {
      const def = REG().TYPES[node.type];
      const wrap = this.nodesEl.querySelector(`.params[data-for="${node.id}"]`);
      if (!wrap) return;
      for (const pd of def.params) {
        if (!pd.when) continue;
        const row = wrap.querySelector(`.param[data-param="${pd.name}"]`);
        if (row) row.style.display = pd.when(node.params) ? '' : 'none';
      }
    }

    _renderPort(node, dir, port) {
      const wrap = document.createElement('div');
      wrap.className = 'port ' + dir;
      const dot = document.createElement('div');
      dot.className = 'port-dot type-' + (port.type || 'any');
      dot.dataset.node = node.id; dot.dataset.port = port.name; dot.dataset.dir = dir;
      const label = document.createElement('span');
      label.className = 'port-label'; label.textContent = port.label;
      if (dir === 'in') { wrap.appendChild(dot); wrap.appendChild(label); }
      else { wrap.appendChild(label); wrap.appendChild(dot); }
      dot.addEventListener('pointerdown', e => this._startPortDrag(e, node, dir, port.name));
      this.portEls[node.id + ':' + dir + ':' + port.name] = dot;
      return wrap;
    }

    _changed(node) { this._refreshParamVisibility(node); this.onChange(); }

    _renderParam(node, pd) {
      const row = document.createElement('div'); row.className = 'param param-' + pd.type;
      const stop = e => e.stopPropagation();

      if (pd.type === 'toggle') {
        const lab = document.createElement('label'); lab.className = 'param-label inline'; lab.textContent = pd.label;
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'param-toggle';
        cb.checked = !!node.params[pd.name];
        cb.addEventListener('change', () => { node.params[pd.name] = cb.checked; this._changed(node); });
        cb.addEventListener('pointerdown', stop);
        row.appendChild(lab); row.appendChild(cb);
        return row;
      }

      const label = document.createElement('label'); label.className = 'param-label'; label.textContent = pd.label;
      row.appendChild(label);

      if (pd.type === 'select') {
        const s = document.createElement('select');
        for (const o of pd.options) { const opt = document.createElement('option'); opt.value = o; opt.textContent = o; s.appendChild(opt); }
        s.value = node.params[pd.name];
        s.addEventListener('change', () => { node.params[pd.name] = s.value; this._changed(node); });
        s.addEventListener('pointerdown', stop);
        row.appendChild(s);
      } else if (pd.type === 'text') {
        const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'param-text';
        inp.value = node.params[pd.name] == null ? '' : node.params[pd.name];
        inp.addEventListener('input', () => { node.params[pd.name] = inp.value; this._changed(node); });
        inp.addEventListener('pointerdown', stop);
        row.appendChild(inp);
      } else if (pd.type === 'color') {
        const c = document.createElement('input'); c.type = 'color'; c.className = 'param-color';
        c.value = node.params[pd.name];
        c.addEventListener('input', () => { node.params[pd.name] = c.value; this._changed(node); });
        c.addEventListener('pointerdown', stop);
        row.appendChild(c);
      } else if (pd.type === 'range') {
        row.appendChild(this._rangeWidget(node, pd, stop));
      } else if (pd.type === 'gradient') {
        label.classList.add('full');
        row.appendChild(this._gradientWidget(node, pd, stop));
      } else if (pd.type === 'curve') {
        label.classList.add('full');
        row.appendChild(this._curveWidget(node, pd, stop));
      } else { // number
        row.appendChild(this._numberWidget(node, pd, pd.name, v => v, stop));
      }
      return row;
    }

    // --- number slider + readout. getKey writes node.params[key] = value ---
    _numberWidget(node, pd, getInitial, _ignore, stop) {
      const ctrl = document.createElement('div'); ctrl.className = 'param-num';
      const slider = document.createElement('input'); slider.type = 'range';
      const valEl = document.createElement('input'); valEl.type = 'number'; valEl.className = 'param-val';
      valEl.min = pd.min; valEl.max = pd.max; valEl.step = pd.step;
      const useLog = pd.log && pd.min > 0;
      const toSlider = v => useLog ? (Math.log(v / pd.min) / Math.log(pd.max / pd.min)) * 1000 : ((v - pd.min) / (pd.max - pd.min)) * 1000;
      const fromSlider = s => useLog ? pd.min * Math.pow(pd.max / pd.min, s / 1000) : pd.min + (s / 1000) * (pd.max - pd.min);
      const quant = v => { if (pd.step >= 1) return Math.round(v); const dec = (pd.step.toString().split('.')[1] || '').length; return parseFloat(v.toFixed(Math.max(dec, 3))); };
      const cur = node.params[pd.name];
      slider.min = 0; slider.max = 1000; slider.step = 1; slider.value = toSlider(cur); valEl.value = cur;
      const commit = (v, fromText) => {
        v = Math.max(pd.min, Math.min(pd.max, v));
        if (!fromText) v = quant(v);
        node.params[pd.name] = v; valEl.value = v; slider.value = toSlider(v);
        this._changed(node);
      };
      slider.addEventListener('input', () => commit(fromSlider(parseFloat(slider.value)), false));
      valEl.addEventListener('change', () => commit(parseFloat(valEl.value) || 0, true));
      slider.addEventListener('pointerdown', stop); valEl.addEventListener('pointerdown', stop);
      ctrl.appendChild(slider); ctrl.appendChild(valEl);
      if (pd.unit) { const u = document.createElement('span'); u.className = 'param-unit'; u.textContent = pd.unit; ctrl.appendChild(u); }
      return ctrl;
    }

    // --- range: two number inputs [min,max] ---
    _rangeWidget(node, pd, stop) {
      const ctrl = document.createElement('div'); ctrl.className = 'param-range';
      const mk = (idx) => {
        const inp = document.createElement('input'); inp.type = 'number';
        inp.min = pd.min; inp.max = pd.max; inp.step = pd.step;
        inp.value = node.params[pd.name][idx];
        inp.addEventListener('change', () => {
          let v = parseFloat(inp.value) || 0; v = Math.max(pd.min, Math.min(pd.max, v));
          const arr = node.params[pd.name].slice(); arr[idx] = v; node.params[pd.name] = arr;
          inp.value = v; this._changed(node);
        });
        inp.addEventListener('pointerdown', stop);
        return inp;
      };
      const sep = document.createElement('span'); sep.className = 'range-sep'; sep.textContent = '–';
      ctrl.appendChild(mk(0)); ctrl.appendChild(sep); ctrl.appendChild(mk(1));
      if (pd.unit) { const u = document.createElement('span'); u.className = 'param-unit'; u.textContent = pd.unit; ctrl.appendChild(u); }
      return ctrl;
    }

    // --- gradient editor: draggable color stops ---
    _gradientWidget(node, pd, stop) {
      const ctrl = document.createElement('div'); ctrl.className = 'grad-widget';
      const bar = document.createElement('div'); bar.className = 'grad-bar';
      const picker = document.createElement('input'); picker.type = 'color'; picker.className = 'grad-picker';
      ctrl.appendChild(bar); ctrl.appendChild(picker);
      ctrl.addEventListener('pointerdown', stop); ctrl.addEventListener('wheel', stop);
      const get = () => node.params[pd.name];
      const sortStops = () => { const a = get().slice().sort((x, y) => x.t - y.t); node.params[pd.name] = a; };
      let activeIdx = 0;
      const redraw = () => {
        const stops = get();
        bar.style.background = `linear-gradient(to right, ${stops.map(s => `${s.c} ${(s.t * 100).toFixed(1)}%`).join(', ')})`;
        bar.querySelectorAll('.grad-stop').forEach(e => e.remove());
        stops.forEach((s, i) => {
          const h = document.createElement('div'); h.className = 'grad-stop' + (i === activeIdx ? ' active' : '');
          h.style.left = (s.t * 100) + '%'; h.style.background = s.c; h.dataset.i = i;
          h.addEventListener('pointerdown', ev => { ev.stopPropagation(); activeIdx = i; picker.value = s.c; startStopDrag(ev, i); redraw(); });
          h.addEventListener('dblclick', ev => { ev.stopPropagation(); if (get().length > 2) { const a = get().slice(); a.splice(i, 1); node.params[pd.name] = a; activeIdx = 0; redraw(); this._changed(node); } });
          bar.appendChild(h);
        });
      };
      const startStopDrag = (ev, i) => {
        const move = e => {
          const r = bar.getBoundingClientRect();
          let t = (e.clientX - r.left) / r.width; t = Math.max(0, Math.min(1, t));
          const a = get().slice(); a[i] = { t, c: a[i].c }; node.params[pd.name] = a;
          redraw(); this._changed(node);
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); sortStops(); activeIdx = get().findIndex(s => Math.abs(s.t - get()[activeIdx].t) < 1e-9); redraw(); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      };
      bar.addEventListener('dblclick', e => {
        const r = bar.getBoundingClientRect(); const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        const c = global.VFXUtil ? rgbToHex(global.VFXUtil.sampleGradient(get(), t)) : '#ffffff';
        const a = get().slice(); a.push({ t, c }); node.params[pd.name] = a; sortStops();
        activeIdx = get().findIndex(s => s.t === t); picker.value = c; redraw(); this._changed(node);
      });
      picker.addEventListener('input', () => { const a = get().slice(); if (a[activeIdx]) { a[activeIdx] = { t: a[activeIdx].t, c: picker.value }; node.params[pd.name] = a; redraw(); this._changed(node); } });
      picker.value = get()[0] ? get()[0].c : '#ffffff';
      redraw();
      const hint = document.createElement('div'); hint.className = 'mini-hint'; hint.textContent = this.lang === 'ja' ? 'ダブルクリックで追加/削除' : 'dbl-click add / remove';
      ctrl.appendChild(hint);
      return ctrl;
    }

    // --- curve editor: draggable points on a mini canvas ---
    _curveWidget(node, pd, stop) {
      const ctrl = document.createElement('div'); ctrl.className = 'curve-widget';
      const cv = document.createElement('canvas'); cv.width = 180; cv.height = 70; cv.className = 'curve-canvas';
      ctrl.appendChild(cv);
      const ftRow = document.createElement('div'); ftRow.className = 'curve-ft';
      const mkFT = (key, lbl) => {
        const w = document.createElement('label'); w.className = 'ft';
        const t = document.createElement('span'); t.textContent = lbl;
        const inp = document.createElement('input'); inp.type = 'number'; inp.step = 'any';
        inp.value = node.params[pd.name][key]; inp.title = lbl;
        inp.addEventListener('change', () => { const c = JSON.parse(JSON.stringify(node.params[pd.name])); c[key] = parseFloat(inp.value) || 0; node.params[pd.name] = c; draw(); this._changed(node); });
        inp.addEventListener('pointerdown', stop);
        w.appendChild(t); w.appendChild(inp); return w;
      };
      ftRow.appendChild(mkFT('from', this.lang === 'ja' ? '開始' : 'from'));
      ftRow.appendChild(mkFT('to', this.lang === 'ja' ? '終了' : 'to'));
      ctrl.appendChild(ftRow);
      ctrl.addEventListener('pointerdown', stop); ctrl.addEventListener('wheel', stop);
      const get = () => node.params[pd.name];
      const PAD = 6;
      const toPx = (t, v) => ({ x: PAD + t * (cv.width - 2 * PAD), y: cv.height - PAD - v * (cv.height - 2 * PAD) });
      const fromPx = (x, y) => ({ t: (x - PAD) / (cv.width - 2 * PAD), v: (cv.height - PAD - y) / (cv.height - 2 * PAD) });
      const ctx = cv.getContext('2d');
      const draw = () => {
        const pts = get().points;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, cv.height / 2); ctx.lineTo(cv.width, cv.height / 2); ctx.stroke();
        ctx.strokeStyle = pd.accent || '#f06292'; ctx.lineWidth = 2; ctx.beginPath();
        pts.forEach((p, i) => { const q = toPx(p.t, p.v); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
        ctx.stroke();
        ctx.fillStyle = '#fff';
        pts.forEach(p => { const q = toPx(p.t, p.v); ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2); ctx.fill(); });
      };
      const hitTest = (mx, my) => { const pts = get().points; for (let i = 0; i < pts.length; i++) { const q = toPx(pts[i].t, pts[i].v); if (Math.hypot(q.x - mx, q.y - my) < 8) return i; } return -1; };
      cv.addEventListener('pointerdown', e => {
        e.stopPropagation();
        const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
        let idx = hitTest(mx, my);
        if (e.button === 2) { if (idx > 0 && idx < get().points.length - 1) { const c = JSON.parse(JSON.stringify(get())); c.points.splice(idx, 1); node.params[pd.name] = c; draw(); this._changed(node); } return; }
        if (idx < 0) { // add
          const np = fromPx(mx, my); const c = JSON.parse(JSON.stringify(get()));
          c.points.push({ t: Math.max(0, Math.min(1, np.t)), v: Math.max(0, Math.min(1, np.v)) });
          c.points.sort((a, b) => a.t - b.t); node.params[pd.name] = c;
          idx = c.points.findIndex(p => p.t === Math.max(0, Math.min(1, np.t)));
          draw(); this._changed(node);
        }
        const isEnd = idx === 0 || idx === get().points.length - 1;
        const move = ev => {
          const np = fromPx(ev.clientX - r.left, ev.clientY - r.top);
          const c = JSON.parse(JSON.stringify(get()));
          c.points[idx].v = Math.max(0, Math.min(1, np.v));
          if (!isEnd) c.points[idx].t = Math.max(0, Math.min(1, np.t));
          c.points.sort((a, b) => a.t - b.t);
          node.params[pd.name] = c; draw(); this._changed(node);
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      });
      cv.addEventListener('contextmenu', e => e.preventDefault());
      draw();
      const hint = document.createElement('div'); hint.className = 'mini-hint'; hint.textContent = this.lang === 'ja' ? 'クリックで点追加 / 右クリで削除' : 'click add / right-click remove';
      ctrl.appendChild(hint);
      return ctrl;
    }

    // ---- selection ----
    _setSelection(ids) {
      const next = new Set(ids);
      for (const id of this.sel) if (!next.has(id) && this.nodeEls[id]) this.nodeEls[id].classList.remove('selected');
      for (const id of next) if (this.nodeEls[id]) this.nodeEls[id].classList.add('selected');
      this.sel = next; this.selected = ids.length ? ids[ids.length - 1] : null;
    }
    _selectOnly(id) { this._setSelection(id ? [id] : []); }
    _selectAdd(id) { if (!this.sel.has(id)) { this.sel.add(id); if (this.nodeEls[id]) this.nodeEls[id].classList.add('selected'); this.selected = id; } }
    _deselectOne(id) { this.sel.delete(id); if (this.nodeEls[id]) this.nodeEls[id].classList.remove('selected'); this.selected = this.sel.size ? [...this.sel].pop() : null; }
    _clearSelection() { for (const id of this.sel) if (this.nodeEls[id]) this.nodeEls[id].classList.remove('selected'); this.sel.clear(); this.selected = null; }
    selectedIds() { return [...this.sel]; }
    deleteSelected() { const ids = [...this.sel].filter(id => this.graph.nodes[id] && !REG().TYPES[this.graph.nodes[id].type].singleton); for (const id of ids) this._deleteNode(id); }

    _deleteNode(id) {
      this.graph.removeNode(id);
      this.sel.delete(id);
      if (this.selected === id) this.selected = this.sel.size ? [...this.sel].pop() : null;
      const el = this.nodeEls[id]; if (el) el.remove();
      delete this.nodeEls[id];
      this.drawWires(); this.onChange();
    }

    _onNodePointerDown(e, node) {
      const onHeader = !!(e.target.closest && e.target.closest('.node-header'));
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (additive) { if (this.sel.has(node.id)) this._deselectOne(node.id); else this._selectAdd(node.id); }
      else if (!this.sel.has(node.id)) this._selectOnly(node.id);
      if (!additive && onHeader && e.button === 0) {
        e.preventDefault();
        const group = this.sel.size > 1 && this.sel.has(node.id);
        const ids = group ? [...this.sel] : [node.id];
        const start = this.clientToWorld(e.clientX, e.clientY);
        const items = ids.filter(id => this.graph.nodes[id]).map(id => { const n = this.graph.nodes[id]; return { id, node: n, el: this.nodeEls[id], offX: start.x - n.x, offY: start.y - n.y }; });
        items.forEach(it => it.el && it.el.classList.add('dragging'));
        this.drag = { kind: 'node', items };
      }
    }

    _startPortDrag(e, node, dir, port) {
      e.preventDefault(); e.stopPropagation();
      if (dir === 'in') {
        const existing = this.graph.connections.find(c => c.to.node === node.id && c.to.port === port);
        if (existing) {
          this.graph.disconnect(existing.id);
          this.drag = { kind: 'wire', fromNode: existing.from.node, fromPort: existing.from.port, fromDir: 'out', tmp: this._tempWire() };
          this.drawWires(); this.onChange(); return;
        }
      }
      this.drag = { kind: 'wire', fromNode: node.id, fromPort: port, fromDir: dir, tmp: this._tempWire() };
    }

    _tempWire() { const path = document.createElementNS(NS, 'path'); path.setAttribute('class', 'wire temp'); this.wiresEl.appendChild(path); return path; }

    _updateSelRect(x0, y0, x1, y1) {
      if (!this._selRect) return;
      const r = this.wrapEl.getBoundingClientRect();
      this._selRect.style.left = (Math.min(x0, x1) - r.left) + 'px';
      this._selRect.style.top = (Math.min(y0, y1) - r.top) + 'px';
      this._selRect.style.width = Math.abs(x1 - x0) + 'px';
      this._selRect.style.height = Math.abs(y1 - y0) + 'px';
    }

    _bind() {
      this.wrapEl.addEventListener('pointerdown', e => {
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) ae.blur();
        if (e.target.closest('.node')) return;
        if (e.button === 1 || e.button === 2) {
          e.preventDefault();
          this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: this.pan.x, py: this.pan.y, btn: e.button, moved: false, downX: e.clientX, downY: e.clientY };
        } else if (e.button === 0) {
          e.preventDefault();
          const additive = e.shiftKey || e.ctrlKey || e.metaKey;
          this._selBase = additive ? new Set(this.sel) : new Set();
          if (!additive) this._clearSelection();
          this._selRect = document.createElement('div'); this._selRect.className = 'sel-rect';
          this.wrapEl.appendChild(this._selRect);
          this._updateSelRect(e.clientX, e.clientY, e.clientX, e.clientY);
          this.drag = { kind: 'select', sx: e.clientX, sy: e.clientY };
        }
      });
      this.wrapEl.addEventListener('contextmenu', e => e.preventDefault());
      window.addEventListener('pointermove', e => this._onMove(e));
      window.addEventListener('pointerup', e => this._onUp(e));
      this.wrapEl.addEventListener('pointermove', e => { this._lastMouseWorld = this.clientToWorld(e.clientX, e.clientY); });
      this.wrapEl.addEventListener('wheel', e => {
        e.preventDefault();
        const r = this.wrapEl.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const wx = (mx - this.pan.x) / this.zoom, wy = (my - this.pan.y) / this.zoom;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.zoom = Math.max(0.25, Math.min(2.5, this.zoom * factor));
        this.pan.x = mx - wx * this.zoom; this.pan.y = my - wy * this.zoom;
        this._applyTransform(); this.drawWires();
      }, { passive: false });
    }

    _onMove(e) {
      const d = this.drag; if (!d) return;
      if (d.kind === 'node') {
        const w = this.clientToWorld(e.clientX, e.clientY);
        for (const it of d.items) { it.node.x = Math.round(w.x - it.offX); it.node.y = Math.round(w.y - it.offY); if (it.el) { it.el.style.left = it.node.x + 'px'; it.el.style.top = it.node.y + 'px'; } }
        this.drawWires();
      } else if (d.kind === 'pan') {
        this.pan.x = d.px + (e.clientX - d.sx); this.pan.y = d.py + (e.clientY - d.sy);
        if (Math.abs(e.clientX - d.sx) > 4 || Math.abs(e.clientY - d.sy) > 4) d.moved = true;
        this._applyTransform();
      } else if (d.kind === 'select') {
        this._updateSelRect(d.sx, d.sy, e.clientX, e.clientY);
        const left = Math.min(d.sx, e.clientX), right = Math.max(d.sx, e.clientX);
        const top = Math.min(d.sy, e.clientY), bottom = Math.max(d.sy, e.clientY);
        const ids = new Set(this._selBase);
        for (const id in this.graph.nodes) { const el = this.nodeEls[id]; if (!el) continue; const nr = el.getBoundingClientRect(); if (!(nr.right < left || nr.left > right || nr.bottom < top || nr.top > bottom)) ids.add(id); }
        this._setSelection([...ids]);
      } else if (d.kind === 'wire') {
        const from = this._portCenter(d.fromNode, d.fromDir, d.fromPort);
        const to = this.clientToWorld(e.clientX, e.clientY);
        d.tmp.setAttribute('d', this._wirePath(from, to, d.fromDir === 'out'));
        const tgt = document.elementFromPoint(e.clientX, e.clientY);
        this._setHover(tgt && tgt.classList.contains('port-dot') ? tgt : null, d);
      }
    }

    _onUp(e) {
      const d = this.drag; if (!d) return;
      if (d.kind === 'node') { d.items.forEach(it => it.el && it.el.classList.remove('dragging')); this.onChange(); }
      if (d.kind === 'pan') { if (d.btn === 2 && !d.moved && this.onContextMenu) this.onContextMenu(d.downX, d.downY); }
      if (d.kind === 'select') { if (this._selRect) { this._selRect.remove(); this._selRect = null; } }
      if (d.kind === 'wire') {
        if (d.tmp) d.tmp.remove(); this._setHover(null);
        const tgt = document.elementFromPoint(e.clientX, e.clientY);
        if (tgt && tgt.classList.contains('port-dot')) {
          const tn = tgt.dataset.node, tp = tgt.dataset.port, td = tgt.dataset.dir;
          let ok = null;
          if (d.fromDir === 'out' && td === 'in') ok = this.graph.connect(d.fromNode, d.fromPort, tn, tp);
          else if (d.fromDir === 'in' && td === 'out') ok = this.graph.connect(tn, tp, d.fromNode, d.fromPort);
          if (ok) this.onChange();
        }
        this.drawWires();
      }
      this.drag = null;
    }

    _setHover(dot, d) {
      if (this._hoverDot && this._hoverDot !== dot) this._hoverDot.classList.remove('port-hover');
      if (dot && d && ((d.fromDir === 'out' && dot.dataset.dir === 'in') || (d.fromDir === 'in' && dot.dataset.dir === 'out'))) { dot.classList.add('port-hover'); this._hoverDot = dot; }
      else this._hoverDot = null;
    }

    _portCenter(nodeId, dir, port) {
      const dot = this.portEls[nodeId + ':' + dir + ':' + port];
      const node = this.graph.nodes[nodeId];
      if (!dot || !node) return { x: node ? node.x : 0, y: node ? node.y : 0 };
      const r = dot.getBoundingClientRect();
      return this.clientToWorld(r.left + r.width / 2, r.top + r.height / 2);
    }

    _wirePath(a, b, outward) {
      const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
      const c1x = a.x + (outward ? dx : -dx); const c2x = b.x + (outward ? -dx : dx);
      return `M ${a.x} ${a.y} C ${c1x} ${a.y} ${c2x} ${b.y} ${b.x} ${b.y}`;
    }

    drawWires() {
      this.wiresEl.innerHTML = '';
      for (const c of this.graph.connections) {
        const a = this._portCenter(c.from.node, 'out', c.from.port);
        const b = this._portCenter(c.to.node, 'in', c.to.port);
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('class', 'wire'); path.setAttribute('d', this._wirePath(a, b, true));
        const def = REG().TYPES[this.graph.nodes[c.from.node].type];
        path.setAttribute('stroke', def.color); path.dataset.id = c.id;
        path.addEventListener('click', ev => { ev.stopPropagation(); this.graph.disconnect(c.id); this.drawWires(); this.onChange(); });
        this.wiresEl.appendChild(path);
      }
    }

    addNodeAtView(type) {
      const r = this.wrapEl.getBoundingClientRect();
      const w = this.clientToWorld(r.left + r.width / 2 - 90, r.top + 100 + Math.random() * 60);
      return this.addNodeFromData(type, null, Math.round(w.x), Math.round(w.y));
    }
    addNodeFromData(type, params, x, y) {
      const def = REG().TYPES[type]; if (!def) return null;
      if (def.singleton && this._typeExists(type)) return null;
      const node = this.graph.addNode(type, Math.round(x), Math.round(y), params);
      this._renderNode(node); this._selectOnly(node.id); this.drawWires(); this.onChange();
      return node;
    }
    duplicateNode(id) { const n = this.graph.nodes[id]; if (!n || REG().TYPES[n.type].singleton) return null; return this.addNodeFromData(n.type, JSON.parse(JSON.stringify(n.params)), n.x + 28, n.y + 28); }

    // ---- copy / paste (returns/consumes a plain clipboard object) ----
    copySelection() {
      const ids = [...this.sel].filter(id => this.graph.nodes[id] && !REG().TYPES[this.graph.nodes[id].type].singleton);
      if (!ids.length) return null;
      const set = new Set(ids);
      const nodes = ids.map(id => { const n = this.graph.nodes[id]; return { id, type: n.type, x: n.x, y: n.y, params: JSON.parse(JSON.stringify(n.params)) }; });
      const conns = this.graph.connections.filter(c => set.has(c.from.node) && set.has(c.to.node)).map(c => ({ from: { ...c.from }, to: { ...c.to } }));
      return { nodes, conns };
    }
    pasteData(clip, at) {
      if (!clip || !clip.nodes || !clip.nodes.length) return;
      let minX = 1e9, minY = 1e9;
      for (const n of clip.nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); }
      const dx = (at ? at.x : minX + 30) - minX, dy = (at ? at.y : minY + 30) - minY;
      const idmap = {}, newIds = [];
      for (const n of clip.nodes) {
        const def = REG().TYPES[n.type]; if (!def || (def.singleton && this._typeExists(n.type))) continue;
        const node = this.graph.addNode(n.type, Math.round(n.x + dx), Math.round(n.y + dy), n.params);
        idmap[n.id] = node.id; this._renderNode(node); newIds.push(node.id);
      }
      for (const c of clip.conns || []) { if (idmap[c.from.node] && idmap[c.to.node]) this.graph.connect(idmap[c.from.node], c.from.port, idmap[c.to.node], c.to.port); }
      this._setSelection(newIds); this.drawWires(); this.onChange();
    }
    get lastMouseWorld() { return this._lastMouseWorld; }
    _typeExists(type) { for (const k in this.graph.nodes) if (this.graph.nodes[k].type === type) return true; return false; }

    setLang(lang) { this.lang = lang; this.renderAll(); }
    rebuild(graph) { if (graph) this.graph = graph; this.renderAll(); }
    fitView() {
      const ids = Object.keys(this.graph.nodes); if (!ids.length) return;
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (const id of ids) { const el = this.nodeEls[id]; const n = this.graph.nodes[id]; const w = el ? el.offsetWidth : 180, h = el ? el.offsetHeight : 120; minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h); }
      const r = this.wrapEl.getBoundingClientRect();
      const zx = (r.width - 80) / (maxX - minX), zy = (r.height - 80) / (maxY - minY);
      this.zoom = Math.max(0.25, Math.min(1.2, Math.min(zx, zy)));
      this.pan.x = 40 - minX * this.zoom + (r.width - 80 - (maxX - minX) * this.zoom) / 2;
      this.pan.y = 40 - minY * this.zoom;
      this._applyTransform(); this.drawWires();
    }
  }

  function rgbToHex(c) {
    const h = v => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2);
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }

  global.NodeEditor = NodeEditor;
})(window);
