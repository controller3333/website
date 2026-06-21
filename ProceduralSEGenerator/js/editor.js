/* editor.js — node editor UI: render nodes, drag, connect, params, pan/zoom. */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  class NodeEditor {
    constructor(opts) {
      this.graph = opts.graph;
      this.worldEl = document.getElementById('world');
      this.nodesEl = document.getElementById('nodes');
      this.wiresEl = document.getElementById('wires');
      this.wrapEl = document.getElementById('canvas-wrap');
      this.onChange = opts.onChange || function () {};
      this.onContextMenu = opts.onContextMenu || null;
      this.selected = null;          // primary selected id (for copy/duplicate)
      this.sel = new Set();          // full multi-selection
      this.lang = opts.lang || 'en';

      this.pan = { x: 40, y: 40 };
      this.zoom = 1;

      this.nodeEls = {};        // id -> element
      this.portEls = {};        // "id:dir:port" -> port dot element
      this.drag = null;         // active node/port/pan drag state

      this._bind();
      this.renderAll();
      this._applyTransform();
    }

    // ---- coordinate helpers ----
    clientToWorld(cx, cy) {
      const r = this.wrapEl.getBoundingClientRect();
      return {
        x: (cx - r.left - this.pan.x) / this.zoom,
        y: (cy - r.top - this.pan.y) / this.zoom,
      };
    }

    _applyTransform() {
      this.worldEl.style.transform =
        `translate(${this.pan.x}px,${this.pan.y}px) scale(${this.zoom})`;
    }

    // ---- full rebuild ----
    renderAll() {
      this.nodesEl.innerHTML = '';
      this.nodeEls = {};
      this.portEls = {};
      for (const id in this.graph.nodes) this._renderNode(this.graph.nodes[id]);
      this._repositionAttachedNotes();
      this.drawWires();
    }

    _renderNode(node) {
      const def = DSP.TYPES[node.type];
      const isNote = !!def.annotation;
      const el = document.createElement('div');
      el.className = 'node' + (isNote ? ' note-node' : '');
      el.style.left = node.x + 'px';
      el.style.top = node.y + 'px';
      el.dataset.id = node.id;
      el.style.setProperty('--accent', def.color);

      // header
      const header = document.createElement('div');
      header.className = 'node-header';
      header.innerHTML = `<span class="node-title">${DSP.title(node.type, this.lang)}</span>`;
      if (isNote && node.attachedTo) {
        const unlink = document.createElement('button');
        unlink.className = 'node-link'; unlink.textContent = '⛓'; unlink.title = this.lang === 'ja' ? '連結を解除' : 'Detach';
        unlink.addEventListener('pointerdown', e => e.stopPropagation());
        unlink.addEventListener('click', e => { e.stopPropagation(); this._detachNote(node.id); });
        header.appendChild(unlink);
      }
      if (def.category !== 'Output') {
        const del = document.createElement('button');
        del.className = 'node-del'; del.textContent = '×'; del.title = this.lang === 'ja' ? '削除' : 'Delete';
        del.addEventListener('pointerdown', e => e.stopPropagation());
        del.addEventListener('click', e => { e.stopPropagation(); this._deleteNode(node.id); });
        header.appendChild(del);
      }
      el.appendChild(header);

      // body: ports + params
      const body = document.createElement('div');
      body.className = 'node-body';

      if (!isNote) {
        const inCol = document.createElement('div');
        inCol.className = 'ports in';
        for (const port of def.inputs) inCol.appendChild(this._renderPort(node, 'in', port));
        const outCol = document.createElement('div');
        outCol.className = 'ports out';
        for (const port of def.outputs) outCol.appendChild(this._renderPort(node, 'out', port));
        const portRow = document.createElement('div');
        portRow.className = 'port-row';
        portRow.appendChild(inCol);
        portRow.appendChild(outCol);
        body.appendChild(portRow);
      }

      // params
      if (def.params.length) {
        const params = document.createElement('div');
        params.className = 'params';
        for (const pd of def.params) params.appendChild(this._renderParam(node, pd));
        body.appendChild(params);
      }

      el.appendChild(body);

      el.addEventListener('pointerdown', e => this._onNodePointerDown(e, node));

      this.nodesEl.appendChild(el);
      this.nodeEls[node.id] = el;
      return el;
    }

    _renderPort(node, dir, port) {
      const wrap = document.createElement('div');
      wrap.className = 'port ' + dir;
      const dot = document.createElement('div');
      dot.className = 'port-dot';
      dot.dataset.node = node.id; dot.dataset.port = port.name; dot.dataset.dir = dir;
      const label = document.createElement('span');
      label.className = 'port-label';
      label.textContent = (window.DSP && DSP.portLabel) ? DSP.portLabel(port.label, this.lang) : port.label;
      if (dir === 'in') { wrap.appendChild(dot); wrap.appendChild(label); }
      else { wrap.appendChild(label); wrap.appendChild(dot); }
      dot.addEventListener('pointerdown', e => this._startPortDrag(e, node, dir, port.name));
      this.portEls[node.id + ':' + dir + ':' + port.name] = dot;
      return wrap;
    }

    _renderParam(node, pd) {
      const row = document.createElement('div');
      row.className = 'param';
      const label = document.createElement('label');
      const labelText = (window.DSP && DSP.paramLabel) ? DSP.paramLabel(node.type, pd.name, pd.label, this.lang) : pd.label;
      label.className = 'param-label'; label.textContent = labelText;
      row.appendChild(label);

      if (pd.type === 'select') {
        const sel = document.createElement('select');
        for (const o of pd.options) {
          const opt = document.createElement('option');
          opt.value = o;
          opt.textContent = (window.DSP && DSP.optionLabel) ? DSP.optionLabel(o, this.lang) : o;
          sel.appendChild(opt);
        }
        sel.value = node.params[pd.name];
        sel.addEventListener('change', () => { node.params[pd.name] = sel.value; this.onChange(); });
        sel.addEventListener('pointerdown', e => e.stopPropagation());
        row.appendChild(sel);
      } else if (pd.type === 'toggle') {
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.className = 'param-toggle';
        cb.checked = !!node.params[pd.name];
        cb.addEventListener('change', () => { node.params[pd.name] = cb.checked; this.onChange(); });
        cb.addEventListener('pointerdown', e => e.stopPropagation());
        label.classList.add('inline');
        row.appendChild(cb);
      } else if (pd.type === 'text') {
        const inp = document.createElement('input');
        inp.type = 'text'; inp.className = 'param-text';
        inp.value = (node.params[pd.name] !== undefined && node.params[pd.name] !== null) ? node.params[pd.name] : '';
        inp.addEventListener('change', () => { node.params[pd.name] = inp.value; this.onChange(); });
        inp.addEventListener('pointerdown', e => e.stopPropagation());
        row.appendChild(inp);
      } else if (pd.type === 'textarea') {
        if (!pd.label) row.removeChild(label);
        const ta = document.createElement('textarea');
        ta.className = 'param-textarea'; ta.rows = 2;
        ta.value = (node.params[pd.name] !== undefined && node.params[pd.name] !== null) ? node.params[pd.name] : '';
        const commit = () => { node.params[pd.name] = ta.value; this._repositionAttachedNotes(); this.onChange(); };
        ta.addEventListener('input', () => { node.params[pd.name] = ta.value; this._repositionAttachedNotes(); });
        ta.addEventListener('change', commit);
        ta.addEventListener('pointerdown', e => e.stopPropagation());
        // let the wheel scroll the memo instead of zooming the canvas
        ta.addEventListener('wheel', e => e.stopPropagation());
        row.appendChild(ta);
      } else { // number -> slider + numeric readout
        const ctrl = document.createElement('div');
        ctrl.className = 'param-num';
        const slider = document.createElement('input');
        slider.type = 'range';
        const valEl = document.createElement('input');
        valEl.type = 'number';
        valEl.className = 'param-val';
        valEl.min = pd.min; valEl.max = pd.max; valEl.step = pd.step;

        const useLog = pd.log && pd.min > 0;
        const toSlider = v => useLog
          ? (Math.log(v / pd.min) / Math.log(pd.max / pd.min)) * 1000
          : ((v - pd.min) / (pd.max - pd.min)) * 1000;
        const fromSlider = s => useLog
          ? pd.min * Math.pow(pd.max / pd.min, s / 1000)
          : pd.min + (s / 1000) * (pd.max - pd.min);
        const quant = v => {
          if (pd.step >= 1) return Math.round(v);
          const dec = (pd.step.toString().split('.')[1] || '').length;
          return parseFloat(v.toFixed(Math.max(dec, 3)));
        };

        slider.min = 0; slider.max = 1000; slider.step = 1;
        slider.value = toSlider(node.params[pd.name]);
        valEl.value = node.params[pd.name];

        const commit = (v, fromText) => {
          v = Math.max(pd.min, Math.min(pd.max, v));
          if (!fromText) v = quant(v);
          node.params[pd.name] = v;
          valEl.value = v;
          slider.value = toSlider(v);
          this.onChange();
        };
        slider.addEventListener('input', () => commit(fromSlider(parseFloat(slider.value)), false));
        valEl.addEventListener('change', () => commit(parseFloat(valEl.value) || 0, true));
        slider.addEventListener('pointerdown', e => e.stopPropagation());
        valEl.addEventListener('pointerdown', e => e.stopPropagation());

        ctrl.appendChild(slider);
        ctrl.appendChild(valEl);
        if (pd.unit) { const u = document.createElement('span'); u.className = 'param-unit'; u.textContent = pd.unit; ctrl.appendChild(u); }
        row.appendChild(ctrl);
      }
      // hover tooltip describing this parameter
      const dtxt = (window.DSP && DSP.paramDesc) ? DSP.paramDesc(node.type, pd.name, this.lang) : '';
      if (dtxt || labelText) {
        row.addEventListener('mouseenter', () => this._showParamTip(row, labelText || pd.name, dtxt));
        row.addEventListener('mouseleave', () => this._hideParamTip());
      }
      return row;
    }

    _showParamTip(row, title, body) {
      if (!this._ptip) { this._ptip = document.createElement('div'); this._ptip.className = 'ui-tip'; document.body.appendChild(this._ptip); }
      const t = this._ptip;
      t.innerHTML = '';
      const b = document.createElement('b'); b.textContent = title; t.appendChild(b);
      if (body) { const s = document.createElement('span'); s.textContent = body; t.appendChild(s); }
      t.style.display = 'block';
      // anchor to the whole node (not the param row) so the tip never covers the
      // slider / number controls. prefer right of node, else left, else above/below.
      const nodeEl = (row.closest && row.closest('.node')) || row;
      const nr = nodeEl.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      const tw = t.offsetWidth, th = t.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = nr.right + 24, top = rr.top - 2;
      if (left + tw > vw - 8) {                 // no room on the right -> left of node
        left = nr.left - tw - 16;
        if (left < 8) {                         // no room either side -> above (else below)
          left = Math.min(Math.max(8, nr.left), vw - tw - 8);
          top = (nr.top - th - 8 >= 8) ? nr.top - th - 8 : nr.bottom + 8;
        }
      }
      top = Math.max(8, Math.min(top, vh - th - 8));
      t.style.left = left + 'px'; t.style.top = top + 'px';
    }
    _hideParamTip() { if (this._ptip) this._ptip.style.display = 'none'; }

    // ---- selection (multi) ----
    _setSelection(ids) {
      const next = new Set(ids);
      for (const id of this.sel) if (!next.has(id) && this.nodeEls[id]) this.nodeEls[id].classList.remove('selected');
      for (const id of next) if (this.nodeEls[id]) this.nodeEls[id].classList.add('selected');
      this.sel = next;
      this.selected = ids.length ? ids[ids.length - 1] : null;
    }
    _selectOnly(id) { this._setSelection(id ? [id] : []); }
    _select(id) { this._selectOnly(id); }            // back-compat alias
    _selectAdd(id) { if (!this.sel.has(id)) { this.sel.add(id); if (this.nodeEls[id]) this.nodeEls[id].classList.add('selected'); this.selected = id; } }
    _deselectOne(id) { this.sel.delete(id); if (this.nodeEls[id]) this.nodeEls[id].classList.remove('selected'); this.selected = this.sel.size ? [...this.sel].pop() : null; }
    _clearSelection() { for (const id of this.sel) if (this.nodeEls[id]) this.nodeEls[id].classList.remove('selected'); this.sel.clear(); this.selected = null; }
    selectedIds() { return [...this.sel]; }
    deleteSelected() {
      const ids = [...this.sel].filter(id => this.graph.nodes[id] && this.graph.nodes[id].type !== 'output');
      for (const id of ids) this._deleteNode(id);
    }

    _deleteNode(id) {
      // detach any notes that were pinned to this node
      for (const nid in this.graph.nodes) {
        const n = this.graph.nodes[nid];
        if (n.attachedTo === id) { n.attachedTo = null; if (this.nodeEls[nid]) this._refreshNode(n); }
      }
      this.graph.removeNode(id);
      this.sel.delete(id);
      if (this.selected === id) this.selected = this.sel.size ? [...this.sel].pop() : null;
      const el = this.nodeEls[id];
      if (el) el.remove();
      delete this.nodeEls[id];
      this.drawWires();
      this.onChange();
    }

    // re-render a single node element in place (e.g. after attach/detach/lang)
    _refreshNode(node) {
      const old = this.nodeEls[node.id];
      if (old) old.remove();
      const el = this._renderNode(node);
      if (this.sel.has(node.id)) el.classList.add('selected');
    }

    // ---- node pointer down: select (+ shift toggle) and start drag (group-aware) ----
    _onNodePointerDown(e, node) {
      const onHeader = !!(e.target.closest && e.target.closest('.node-header'));
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (additive) {
        if (this.sel.has(node.id)) this._deselectOne(node.id); else this._selectAdd(node.id);
      } else if (!this.sel.has(node.id)) {
        this._selectOnly(node.id);
      }
      // left-drag on the header moves the node (or the whole selection)
      if (!additive && onHeader && e.button === 0) {
        e.preventDefault();
        const group = this.sel.size > 1 && this.sel.has(node.id);
        if (node.attachedTo && !group) { node.attachedTo = null; this._refreshNode(node); this.onChange(); } // detach note to move
        const ids = group ? [...this.sel] : [node.id];
        const start = this.clientToWorld(e.clientX, e.clientY);
        const items = ids.filter(id => this.graph.nodes[id]).map(id => {
          const n = this.graph.nodes[id];
          return { id, node: n, el: this.nodeEls[id], offX: start.x - n.x, offY: start.y - n.y };
        });
        items.forEach(it => it.el && it.el.classList.add('dragging'));
        this.drag = { kind: 'node', items };
      }
    }

    // ---- port -> wire dragging ----
    _startPortDrag(e, node, dir, port) {
      e.preventDefault(); e.stopPropagation();
      // if dragging from an input that already has a connection, pick it up
      if (dir === 'in') {
        const existing = this.graph.connections.find(c => c.to.node === node.id && c.to.port === port);
        if (existing) {
          this.graph.disconnect(existing.id);
          this.drag = { kind: 'wire', fromNode: existing.from.node, fromPort: existing.from.port, fromDir: 'out' };
          const tmp = this._tempWire();
          this.drag.tmp = tmp;
          this.drawWires();
          this.onChange();
          return;
        }
      }
      this.drag = { kind: 'wire', fromNode: node.id, fromPort: port, fromDir: dir, tmp: this._tempWire() };
    }

    _tempWire() {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('class', 'wire temp');
      this.wiresEl.appendChild(path);
      return path;
    }

    _updateSelRect(x0, y0, x1, y1) {
      if (!this._selRect) return;
      const r = this.wrapEl.getBoundingClientRect();
      this._selRect.style.left = (Math.min(x0, x1) - r.left) + 'px';
      this._selRect.style.top = (Math.min(y0, y1) - r.top) + 'px';
      this._selRect.style.width = Math.abs(x1 - x0) + 'px';
      this._selRect.style.height = Math.abs(y1 - y0) + 'px';
    }

    // ---- global pointer handling ----
    _bind() {
      this.wrapEl.addEventListener('pointerdown', e => {
        // clicking the canvas commits/blurs a focused field (Length, preset, etc.).
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) ae.blur();
        if (e.target.closest('.node')) return;
        if (e.button === 1 || e.button === 2) {        // middle/right drag = pan; right w/o drag = menu
          e.preventDefault();
          this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: this.pan.x, py: this.pan.y, btn: e.button, moved: false, downX: e.clientX, downY: e.clientY };
        } else if (e.button === 0) {                   // left drag = rubber-band selection
          e.preventDefault();
          const additive = e.shiftKey || e.ctrlKey || e.metaKey;
          this._selBase = additive ? new Set(this.sel) : new Set();
          if (!additive) this._clearSelection();
          this._selRect = document.createElement('div');
          this._selRect.className = 'sel-rect';
          this.wrapEl.appendChild(this._selRect);
          this._updateSelRect(e.clientX, e.clientY, e.clientX, e.clientY);
          this.drag = { kind: 'select', sx: e.clientX, sy: e.clientY };
        }
      });
      this.wrapEl.addEventListener('contextmenu', e => e.preventDefault());

      window.addEventListener('pointermove', e => this._onMove(e));
      window.addEventListener('pointerup', e => this._onUp(e));

      // remember last cursor position (world coords) for paste placement,
      // and which node the cursor is over (for Ctrl+Space node auditioning)
      this.wrapEl.addEventListener('pointermove', e => {
        this._lastMouseWorld = this.clientToWorld(e.clientX, e.clientY);
        const nodeEl = e.target.closest ? e.target.closest('.node') : null;
        this.hoverNodeId = nodeEl ? nodeEl.dataset.id : null;
      });
      this.wrapEl.addEventListener('pointerleave', () => { this.hoverNodeId = null; });

      // zoom
      this.wrapEl.addEventListener('wheel', e => {
        e.preventDefault();
        const r = this.wrapEl.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const wx = (mx - this.pan.x) / this.zoom, wy = (my - this.pan.y) / this.zoom;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.zoom = Math.max(0.3, Math.min(2.5, this.zoom * factor));
        this.pan.x = mx - wx * this.zoom;
        this.pan.y = my - wy * this.zoom;
        this._applyTransform();
        this.drawWires();
      }, { passive: false });
    }

    _onMove(e) {
      const d = this.drag;
      if (!d) return;
      if (d.kind === 'node') {
        const w = this.clientToWorld(e.clientX, e.clientY);
        for (const it of d.items) {
          it.node.x = Math.round(w.x - it.offX);
          it.node.y = Math.round(w.y - it.offY);
          if (it.el) { it.el.style.left = it.node.x + 'px'; it.el.style.top = it.node.y + 'px'; }
          this._repositionAttachedNotes(it.id);
        }
        if (d.items.length === 1 && DSP.TYPES[d.items[0].node.type].annotation) this._highlightAttachTarget(d.items[0].node);
        this.drawWires();
      } else if (d.kind === 'pan') {
        this.pan.x = d.px + (e.clientX - d.sx);
        this.pan.y = d.py + (e.clientY - d.sy);
        if (Math.abs(e.clientX - d.sx) > 4 || Math.abs(e.clientY - d.sy) > 4) d.moved = true;
        this._applyTransform();
      } else if (d.kind === 'select') {
        this._updateSelRect(d.sx, d.sy, e.clientX, e.clientY);
        const left = Math.min(d.sx, e.clientX), right = Math.max(d.sx, e.clientX);
        const top = Math.min(d.sy, e.clientY), bottom = Math.max(d.sy, e.clientY);
        const ids = new Set(this._selBase);
        for (const id in this.graph.nodes) {
          const el = this.nodeEls[id]; if (!el) continue;
          const nr = el.getBoundingClientRect();
          if (!(nr.right < left || nr.left > right || nr.bottom < top || nr.top > bottom)) ids.add(id);
        }
        this._setSelection([...ids]);
      } else if (d.kind === 'wire') {
        const from = this._portCenter(d.fromNode, d.fromDir, d.fromPort);
        const to = this.clientToWorld(e.clientX, e.clientY);
        d.tmp.setAttribute('d', this._wirePath(from, to, d.fromDir === 'out'));
        // hover highlight
        const tgt = document.elementFromPoint(e.clientX, e.clientY);
        this._setHover(tgt && tgt.classList.contains('port-dot') ? tgt : null, d);
      }
    }

    _onUp(e) {
      const d = this.drag;
      if (!d) { return; }
      if (d.kind === 'node') {
        d.items.forEach(it => it.el && it.el.classList.remove('dragging'));
        if (d.items.length === 1 && DSP.TYPES[d.items[0].node.type].annotation) { this._clearAttachHighlight(); this._tryAttachNote(d.items[0].node); }
        this.onChange();
      }
      if (d.kind === 'pan') {
        // a right-click without dragging opens the insert context menu
        if (d.btn === 2 && !d.moved && this.onContextMenu) this.onContextMenu(d.downX, d.downY);
      }
      if (d.kind === 'select') {
        if (this._selRect) { this._selRect.remove(); this._selRect = null; }
      }
      if (d.kind === 'wire') {
        if (d.tmp) d.tmp.remove();
        this._setHover(null);
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
      // valid target = opposite direction
      if (dot && d && ((d.fromDir === 'out' && dot.dataset.dir === 'in') || (d.fromDir === 'in' && dot.dataset.dir === 'out'))) {
        dot.classList.add('port-hover');
        this._hoverDot = dot;
      } else {
        this._hoverDot = null;
      }
    }

    // center of a port dot in world coords
    _portCenter(nodeId, dir, port) {
      const dot = this.portEls[nodeId + ':' + dir + ':' + port];
      const node = this.graph.nodes[nodeId];
      if (!dot || !node) return { x: node ? node.x : 0, y: node ? node.y : 0 };
      const r = dot.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return this.clientToWorld(cx, cy);
    }

    _wirePath(a, b, outward) {
      const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
      const c1x = a.x + (outward ? dx : -dx);
      const c2x = b.x + (outward ? -dx : dx);
      return `M ${a.x} ${a.y} C ${c1x} ${a.y} ${c2x} ${b.y} ${b.x} ${b.y}`;
    }

    drawWires() {
      // size svg to cover world content
      this.wiresEl.innerHTML = '';
      for (const c of this.graph.connections) {
        const a = this._portCenter(c.from.node, 'out', c.from.port);
        const b = this._portCenter(c.to.node, 'in', c.to.port);
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('class', 'wire');
        path.setAttribute('d', this._wirePath(a, b, true));
        const def = DSP.TYPES[this.graph.nodes[c.from.node].type];
        path.setAttribute('stroke', def.color);
        path.dataset.id = c.id;
        path.addEventListener('click', ev => { ev.stopPropagation(); this.graph.disconnect(c.id); this.drawWires(); this.onChange(); });
        this.wiresEl.appendChild(path);
      }
    }

    // add a node near center of current view
    addNodeAtView(type) {
      const r = this.wrapEl.getBoundingClientRect();
      const w = this.clientToWorld(r.left + r.width / 2 - 90, r.top + 80 + Math.random() * 60);
      const node = this.graph.addNode(type, Math.round(w.x), Math.round(w.y));
      this._renderNode(node);
      this.drawWires();
      this.onChange();
      return node;
    }

    // create a node from explicit type+params (used by paste); returns node or null
    addNodeFromData(type, params, x, y) {
      const def = DSP.TYPES[type];
      if (!def) return null;
      if (def.singleton && this._typeExists(type)) return null;
      const node = this.graph.addNode(type, Math.round(x), Math.round(y), params);
      this._renderNode(node);
      this._select(node.id);
      this.drawWires();
      this.onChange();
      return node;
    }

    duplicateNode(id) {
      const n = this.graph.nodes[id];
      if (!n) return null;
      return this.addNodeFromData(n.type, Object.assign({}, n.params), n.x + 28, n.y + 28);
    }

    _typeExists(type) {
      for (const k in this.graph.nodes) if (this.graph.nodes[k].type === type) return true;
      return false;
    }

    // briefly highlight a node being auditioned
    flashAudition(id) {
      if (this._audEl) this._audEl.classList.remove('auditioning');
      const el = this.nodeEls[id];
      if (!el) return;
      el.classList.add('auditioning');
      this._audEl = el;
      clearTimeout(this._audTimer);
      this._audTimer = setTimeout(() => {
        if (this._audEl) { this._audEl.classList.remove('auditioning'); this._audEl = null; }
      }, 800);
    }

    // ---- Note attachment ----
    // find the node whose top edge a (free) note is hovering over, to attach to
    _findAttachTarget(noteNode) {
      const noteEl = this.nodeEls[noteNode.id];
      if (!noteEl) return null;
      const cx = noteNode.x + noteEl.offsetWidth / 2;
      const noteBottom = noteNode.y + noteEl.offsetHeight;
      let best = null, bestDy = 1e9;
      for (const id in this.graph.nodes) {
        const n = this.graph.nodes[id];
        if (id === noteNode.id) continue;
        if (DSP.TYPES[n.type].annotation) continue; // notes don't attach to notes
        const el = this.nodeEls[id]; if (!el) continue;
        const w = el.offsetWidth;
        if (cx < n.x - 12 || cx > n.x + w + 12) continue;       // note center over node
        const dy = Math.abs(noteBottom - n.y);                   // note bottom near node top
        if (dy < 55 && dy < bestDy) { bestDy = dy; best = n; }
      }
      return best;
    }

    _tryAttachNote(noteNode) {
      const target = this._findAttachTarget(noteNode);
      if (!target) return;
      noteNode.attachedTo = target.id;
      this._refreshNode(noteNode);
      this._repositionAttachedNotes(target.id);
    }

    _detachNote(id) {
      const n = this.graph.nodes[id];
      if (!n) return;
      n.attachedTo = null;
      this._refreshNode(n);
      this.onChange();
    }

    // place attached notes just above their target's top edge (in sync on move)
    _repositionAttachedNotes(targetId) {
      for (const id in this.graph.nodes) {
        const n = this.graph.nodes[id];
        if (!n.attachedTo) continue;
        if (targetId && n.attachedTo !== targetId) continue;
        const target = this.graph.nodes[n.attachedTo];
        const tEl = this.nodeEls[n.attachedTo], nEl = this.nodeEls[id];
        if (!target || !tEl || !nEl) { n.attachedTo = null; if (nEl) this._refreshNode(n); continue; }
        n.x = target.x;
        n.y = target.y - nEl.offsetHeight - 6;
        nEl.style.left = n.x + 'px';
        nEl.style.top = n.y + 'px';
      }
    }

    _highlightAttachTarget(noteNode) {
      const t = this._findAttachTarget(noteNode);
      const el = t ? this.nodeEls[t.id] : null;
      if (this._attachHi && this._attachHi !== el) this._attachHi.classList.remove('attach-target');
      if (el) { el.classList.add('attach-target'); this._attachHi = el; } else this._attachHi = null;
    }
    _clearAttachHighlight() {
      if (this._attachHi) { this._attachHi.classList.remove('attach-target'); this._attachHi = null; }
    }

    setLang(lang) {
      this.lang = lang;
      this.renderAll();
    }

    rebuild(graph) {
      if (graph) this.graph = graph;
      this.renderAll();
    }
  }

  global.NodeEditor = NodeEditor;
})(window);
