/* graph.js — graph model + compilation to an EffectSpec.
 *
 * The graph holds nodes & connections. Unlike a render-to-buffer audio graph,
 * a VFX graph *compiles* into a plain-data EffectSpec (emitters + modules) that
 * the ParticleEngine then simulates frame by frame. Compile once, simulate many.
 *
 * Topology (chain-of-modules):
 *   Shape -> Init -> Force -> OverLife -> Render   (a "module chain")
 *      the chain feeds an Emitter's `modules` input;
 *   Emitter -> Emitter -> ...                      (an "emitter chain")
 *      the chain feeds the Effect (output) node's `emitters` input.
 */
(function (global) {
  'use strict';

  let _uid = 1;
  function uid(prefix) { return (prefix || 'n') + (_uid++); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  class Graph {
    constructor() {
      this.nodes = {};        // id -> { id, type, x, y, params }
      this.connections = [];  // { id, from:{node,port}, to:{node,port} }
    }

    addNode(type, x, y, params) {
      const def = Nodes.TYPES[type];
      if (!def) throw new Error('unknown node type: ' + type);
      const id = uid(type + '_');
      const p = {};
      for (const pd of def.params) {
        p[pd.name] = (params && pd.name in params) ? clone(params[pd.name]) : clone(pd.default);
      }
      const node = { id, type, x: x | 0, y: y | 0, params: p };
      this.nodes[id] = node;
      return node;
    }

    removeNode(id) {
      delete this.nodes[id];
      this.connections = this.connections.filter(c => c.from.node !== id && c.to.node !== id);
    }

    // a connection feeds exactly one input port (replace existing on that port).
    // light type-checking: ports must share the same `type` tag (if both declare one).
    connect(fromNode, fromPort, toNode, toPort) {
      if (fromNode === toNode) return null;
      if (!this._typesMatch(fromNode, fromPort, toNode, toPort)) return null;
      if (this._wouldCycle(fromNode, toNode)) return null;
      this.connections = this.connections.filter(c => !(c.to.node === toNode && c.to.port === toPort));
      const conn = { id: uid('c_'), from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } };
      this.connections.push(conn);
      return conn;
    }

    _portDef(nodeId, dir, portName) {
      const n = this.nodes[nodeId]; if (!n) return null;
      const def = Nodes.TYPES[n.type]; if (!def) return null;
      const list = dir === 'out' ? def.outputs : def.inputs;
      return (list || []).find(p => p.name === portName) || null;
    }

    _typesMatch(fromNode, fromPort, toNode, toPort) {
      const a = this._portDef(fromNode, 'out', fromPort);
      const b = this._portDef(toNode, 'in', toPort);
      if (!a || !b) return false;
      if (a.type && b.type && a.type !== b.type) return false;
      return true;
    }

    disconnect(connId) {
      this.connections = this.connections.filter(c => c.id !== connId);
    }

    _wouldCycle(fromNode, toNode) {
      const seen = new Set();
      const stack = [toNode];
      while (stack.length) {
        const cur = stack.pop();
        if (cur === fromNode) return true;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const c of this.connections) if (c.from.node === cur) stack.push(c.to.node);
      }
      return false;
    }

    outputNode() {
      for (const id in this.nodes) if (this.nodes[id].type === 'effect') return this.nodes[id];
      return null;
    }

    // compile -> EffectSpec ({ background, emitters:[...], ...globals })
    compile() {
      const out = this.outputNode();
      const empty = { background: '#0a0a12', emitters: [], persistence: 0, timeScale: 1 };
      if (!out) return empty;
      const cache = {};
      const res = this._eval(out.id, cache, new Set());
      return (res && res.spec) ? res.spec : empty;
    }

    // compile just the sub-graph feeding one node (for previewing a partial chain)
    compileNode(nodeId) {
      const node = this.nodes[nodeId];
      if (!node) return null;
      const res = this._eval(nodeId, {}, new Set());
      return res || null;
    }

    _eval(id, cache, stack) {
      if (cache[id]) return cache[id];
      if (stack.has(id)) return {}; // cycle guard
      stack.add(id);
      const node = this.nodes[id];
      const def = Nodes.TYPES[node.type];
      const ins = {};
      for (const port of (def.inputs || [])) {
        const conn = this.connections.find(c => c.to.node === id && c.to.port === port.name);
        if (conn && this.nodes[conn.from.node]) {
          const src = this._eval(conn.from.node, cache, stack);
          ins[port.name] = src[conn.from.port] != null ? src[conn.from.port] : null;
        } else ins[port.name] = null;
      }
      let res;
      try { res = def.compile(node, ins) || {}; }
      catch (e) { console.error('node compile error', node.type, e); res = {}; }
      cache[id] = res;
      stack.delete(id);
      return res;
    }

    toJSON() {
      return {
        version: 1,
        app: 'ProceduralVFXGenerator',
        nodes: Object.values(this.nodes).map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, params: clone(n.params) })),
        connections: this.connections.map(c => ({ id: c.id, from: c.from, to: c.to })),
      };
    }

    static fromJSON(data) {
      const g = new Graph();
      let maxN = 0;
      for (const n of data.nodes || []) {
        if (!Nodes.TYPES[n.type]) continue;
        // merge stored params over current defaults so older saves stay valid
        const def = Nodes.TYPES[n.type];
        const params = {};
        for (const pd of def.params) {
          params[pd.name] = (n.params && pd.name in n.params) ? clone(n.params[pd.name]) : clone(pd.default);
        }
        g.nodes[n.id] = { id: n.id, type: n.type, x: n.x, y: n.y, params };
        const num = parseInt(String(n.id).replace(/\D/g, ''), 10); if (num > maxN) maxN = num;
      }
      for (const c of data.connections || []) {
        if (!g.nodes[c.from.node] || !g.nodes[c.to.node]) continue;
        g.connections.push({ id: c.id || uid('c_'), from: c.from, to: c.to });
      }
      _uid = Math.max(_uid, maxN + 1);
      return g;
    }
  }

  global.Graph = Graph;
})(window);
