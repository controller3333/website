/* editor.js — node editor UI: render nodes, drag, connect, params, pan/zoom. */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const OPTION_LABELS = {
    sine: 'サイン',
    square: '矩形',
    saw: 'ノコギリ',
    triangle: '三角',
    white: 'ホワイト',
    pink: 'ピンク',
    brown: 'ブラウン',
    linear: '直線',
    exp: '急変化',
    log: 'なだらか',
    lowpass: 'ローパス',
    highpass: 'ハイパス',
    bandpass: 'バンドパス',
    tanh: '滑らか',
    clip: 'クリップ',
    fold: '折り返し',
  };

  class NodeEditor {
    constructor(opts) {
      this.graph = opts.graph;
      this.worldEl = document.getElementById('world');
      this.nodesEl = document.getElementById('nodes');
      this.wiresEl = document.getElementById('wires');
      this.wrapEl = document.getElementById('canvas-wrap');
      this.onChange = opts.onChange || function () {};
      this.selected = null;

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
      this.drawWires();
    }

    _renderNode(node) {
      const def = DSP.TYPES[node.type];
      const el = document.createElement('div');
      el.className = 'node';
      el.style.left = node.x + 'px';
      el.style.top = node.y + 'px';
      el.dataset.id = node.id;
      el.style.setProperty('--accent', def.color);

      // header
      const header = document.createElement('div');
      header.className = 'node-header';
      header.innerHTML = `<span class="node-title">${def.title}</span>`;
      if (def.category !== 'Output') {
        const del = document.createElement('button');
        del.className = 'node-del'; del.textContent = '×'; del.title = '削除';
        del.addEventListener('pointerdown', e => e.stopPropagation());
        del.addEventListener('click', e => { e.stopPropagation(); this._deleteNode(node.id); });
        header.appendChild(del);
      }
      el.appendChild(header);

      // body: ports + params
      const body = document.createElement('div');
      body.className = 'node-body';

      // input ports column
      const inCol = document.createElement('div');
      inCol.className = 'ports in';
      for (const port of def.inputs) inCol.appendChild(this._renderPort(node, 'in', port));
      // output ports column
      const outCol = document.createElement('div');
      outCol.className = 'ports out';
      for (const port of def.outputs) outCol.appendChild(this._renderPort(node, 'out', port));

      const portRow = document.createElement('div');
      portRow.className = 'port-row';
      portRow.appendChild(inCol);
      portRow.appendChild(outCol);
      body.appendChild(portRow);

      // params
      if (def.params.length) {
        const params = document.createElement('div');
        params.className = 'params';
        for (const pd of def.params) params.appendChild(this._renderParam(node, pd));
        body.appendChild(params);
      }

      el.appendChild(body);

      header.addEventListener('pointerdown', e => this._startNodeDrag(e, node, el));
      el.addEventListener('pointerdown', () => this._select(node.id));

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
      label.className = 'port-label'; label.textContent = port.label;
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
      label.className = 'param-label'; label.textContent = pd.label;
      row.appendChild(label);

      if (pd.type === 'select') {
        const sel = document.createElement('select');
        for (const o of pd.options) {
          const opt = document.createElement('option');
          opt.value = o; opt.textContent = OPTION_LABELS[o] || o; sel.appendChild(opt);
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
      return row;
    }

    _select(id) {
      if (this.selected && this.nodeEls[this.selected]) this.nodeEls[this.selected].classList.remove('selected');
      this.selected = id;
      if (id && this.nodeEls[id]) this.nodeEls[id].classList.add('selected');
    }

    _deleteNode(id) {
      this.graph.removeNode(id);
      const el = this.nodeEls[id];
      if (el) el.remove();
      delete this.nodeEls[id];
      this.drawWires();
      this.onChange();
    }

    // ---- node dragging ----
    _startNodeDrag(e, node, el) {
      if (e.button !== 0) return;
      e.preventDefault();
      this._select(node.id);
      el.classList.add('dragging');
      const start = this.clientToWorld(e.clientX, e.clientY);
      this.drag = {
        kind: 'node', node, el,
        offX: start.x - node.x, offY: start.y - node.y,
      };
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

    // ---- global pointer handling ----
    _bind() {
      // pan with background drag (left on empty) or right/middle drag
      this.wrapEl.addEventListener('pointerdown', e => {
        if (e.target.closest('.node')) return;
        if (e.button === 0 || e.button === 1 || e.button === 2) {
          e.preventDefault();
          this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: this.pan.x, py: this.pan.y };
          this._select(null);
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
        d.node.x = Math.round(w.x - d.offX);
        d.node.y = Math.round(w.y - d.offY);
        d.el.style.left = d.node.x + 'px';
        d.el.style.top = d.node.y + 'px';
        this.drawWires();
      } else if (d.kind === 'pan') {
        this.pan.x = d.px + (e.clientX - d.sx);
        this.pan.y = d.py + (e.clientY - d.sy);
        this._applyTransform();
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
      if (d.kind === 'node' && d.el) { d.el.classList.remove('dragging'); this.onChange(); }
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

    rebuild(graph) {
      if (graph) this.graph = graph;
      this.renderAll();
    }
  }

  global.NodeEditor = NodeEditor;
})(window);
