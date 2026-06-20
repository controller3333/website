/* graph.js — graph model + offline evaluation.
 *
 * Graph holds nodes & connections, and renders the output node into a
 * single Float32Array by recursively pulling inputs (memoized per render).
 */
(function (global) {
  'use strict';

  let _uid = 1;
  function uid(prefix) { return (prefix || 'n') + (_uid++); }

  class Graph {
    constructor() {
      this.nodes = {};        // id -> { id, type, x, y, params }
      this.connections = [];  // { id, from:{node,port}, to:{node,port} }
    }

    addNode(type, x, y, params) {
      const def = DSP.TYPES[type];
      if (!def) throw new Error('unknown node type: ' + type);
      const id = uid(type + '_');
      const p = {};
      for (const pd of def.params) p[pd_name(pd)] = (params && pd_name(pd) in params) ? params[pd_name(pd)] : pd.default;
      const node = { id, type, x: x | 0, y: y | 0, params: p };
      this.nodes[id] = node;
      return node;
    }

    removeNode(id) {
      delete this.nodes[id];
      this.connections = this.connections.filter(c => c.from.node !== id && c.to.node !== id);
    }

    // a connection feeds exactly one input port (replace existing on that port)
    connect(fromNode, fromPort, toNode, toPort) {
      if (fromNode === toNode) return null;
      if (this._wouldCycle(fromNode, toNode)) return null;
      this.connections = this.connections.filter(c => !(c.to.node === toNode && c.to.port === toPort));
      const conn = { id: uid('c_'), from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } };
      this.connections.push(conn);
      return conn;
    }

    disconnect(connId) {
      this.connections = this.connections.filter(c => c.id !== connId);
    }

    // adding edge from->to: cycle if `from` is reachable from `to`
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
      for (const id in this.nodes) if (this.nodes[id].type === 'output') return this.nodes[id];
      return null;
    }

    // render -> mono Float32Array OR stereo { stereo:true, l, r }
    // opts: { pitchMul, seedOffset } feed per-render variation into nodes.
    render(duration, sampleRate, opts) {
      opts = opts || {};
      const length = Math.max(1, Math.round(duration * sampleRate));
      const ctx = {
        sampleRate, length, duration,
        pitchMul: opts.pitchMul || 1,
        seedOffset: opts.seedOffset || 0,
      };
      const out = this.outputNode();
      if (!out) return new Float32Array(length);
      const cache = {};
      const result = this._eval(out.id, ctx, cache, new Set());
      return (result && result.out) ? result.out : new Float32Array(length);
    }

    // render a single node's primary output (for auditioning that node's signal)
    renderNodeOutput(nodeId, duration, sampleRate, opts) {
      opts = opts || {};
      const length = Math.max(1, Math.round(duration * sampleRate));
      const ctx = {
        sampleRate, length, duration,
        pitchMul: opts.pitchMul || 1,
        seedOffset: opts.seedOffset || 0,
      };
      const node = this.nodes[nodeId];
      if (!node) return new Float32Array(length);
      const def = DSP.TYPES[node.type];
      const res = this._eval(nodeId, ctx, {}, new Set());
      const port = (def.outputs && def.outputs[0] && def.outputs[0].name) || 'out';
      return res[port] || res.out || new Float32Array(length);
    }

    _eval(id, ctx, cache, stack) {
      if (cache[id]) return cache[id];
      if (stack.has(id)) return {}; // cycle guard
      stack.add(id);
      const node = this.nodes[id];
      const def = DSP.TYPES[node.type];
      const ins = {};
      for (const port of def.inputs) {
        const conn = this.connections.find(c => c.to.node === id && c.to.port === port.name);
        if (conn && this.nodes[conn.from.node]) {
          const src = this._eval(conn.from.node, ctx, cache, stack);
          let sig = src[conn.from.port] || null;
          // mono-only nodes auto-downmix any incoming stereo signal
          if (sig && sig.stereo && !def.stereoAware) sig = DSP.helpers.toMono(sig);
          ins[port.name] = sig;
        } else ins[port.name] = null;
      }
      let res;
      try { res = def.process(node, ins, ctx) || {}; }
      catch (e) { console.error('node process error', node.type, e); res = {}; }
      cache[id] = res;
      stack.delete(id);
      return res;
    }

    toJSON() {
      return {
        version: 1,
        nodes: Object.values(this.nodes).map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, params: n.params })),
        connections: this.connections.map(c => ({ id: c.id, from: c.from, to: c.to })),
      };
    }

    static fromJSON(data) {
      const g = new Graph();
      let maxN = 0;
      for (const n of data.nodes || []) {
        g.nodes[n.id] = { id: n.id, type: n.type, x: n.x, y: n.y, params: Object.assign({}, n.params) };
        const num = parseInt(String(n.id).replace(/\D/g, ''), 10); if (num > maxN) maxN = num;
      }
      for (const c of data.connections || []) {
        g.connections.push({ id: c.id || uid('c_'), from: c.from, to: c.to });
      }
      _uid = Math.max(_uid, maxN + 1);
      return g;
    }
  }

  function pd_name(pd) { return pd.name; }

  global.Graph = Graph;
})(window);
