/* audio.js — playback of rendered buffers, WAV export, scope drawing. */
(function (global) {
  'use strict';

  class AudioEngine {
    constructor() {
      this.actx = null;
      this.source = null;
      this.lastBuffer = null;   // Float32Array
      this.sampleRate = 44100;
      this.onEnded = null;
    }

    _ensure() {
      if (!this.actx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        this.actx = new AC();
      }
      if (this.actx.state === 'suspended') this.actx.resume();
      return this.actx;
    }

    play(sig, sampleRate, loop) {
      this.stop();
      this.lastBuffer = sig;
      this.sampleRate = sampleRate;
      const stereo = sig && sig.stereo;
      const l = stereo ? sig.l : sig;
      const r = stereo ? sig.r : sig;
      const actx = this._ensure();
      const ab = actx.createBuffer(2, l.length, sampleRate);
      ab.getChannelData(0).set(l);
      ab.getChannelData(1).set(r);
      const src = actx.createBufferSource();
      src.buffer = ab;
      src.loop = !!loop;
      src.connect(actx.destination);
      src.onended = () => { if (this.source === src) { this.source = null; if (this.onEnded) this.onEnded(); } };
      src.start();
      this.source = src;
    }

    stop() {
      if (this.source) {
        try { this.source.onended = null; this.source.stop(); } catch (e) {}
        this.source = null;
      }
    }

    get isPlaying() { return !!this.source; }

    // 16-bit PCM WAV (mono or interleaved stereo)
    static encodeWAV(sig, sampleRate) {
      const stereo = !!(sig && sig.stereo);
      const l = stereo ? sig.l : sig;
      const r = stereo ? sig.r : null;
      const channels = stereo ? 2 : 1;
      const len = l.length;
      const blockAlign = channels * 2;
      const dataSize = len * blockAlign;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);
      const ws = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
      ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true);
      view.setUint16(34, 16, true);
      ws(36, 'data'); view.setUint32(40, dataSize, true);
      const enc = v => { v = Math.max(-1, Math.min(1, v)); return v < 0 ? v * 0x8000 : v * 0x7FFF; };
      let off = 44;
      for (let i = 0; i < len; i++) {
        view.setInt16(off, enc(l[i]), true); off += 2;
        if (stereo) { view.setInt16(off, enc(r[i]), true); off += 2; }
      }
      return new Blob([buffer], { type: 'audio/wav' });
    }

    exportWAV(filename) {
      if (!this.lastBuffer) return false;
      const blob = AudioEngine.encodeWAV(this.lastBuffer, this.sampleRate);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename || 'se.wav';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    }
  }

  // draw waveform onto a canvas (stereo signals are downmixed for display)
  function drawScope(canvas, sig) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // bg grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    const float32 = (sig && sig.stereo) ? window.DSP.helpers.toMono(sig) : sig;
    if (!float32 || !float32.length) return;
    const n = float32.length;
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const step = n / w;
    for (let x = 0; x < w; x++) {
      const start = Math.floor(x * step);
      const end = Math.min(n, Math.floor((x + 1) * step) + 1);
      let min = 1, max = -1;
      for (let i = start; i < end; i++) { const v = float32[i]; if (v < min) min = v; if (v > max) max = v; }
      const y1 = h / 2 - max * (h / 2) * 0.95;
      const y2 = h / 2 - min * (h / 2) * 0.95;
      ctx.moveTo(x + 0.5, y1);
      ctx.lineTo(x + 0.5, y2);
    }
    ctx.stroke();
  }

  global.AudioEngine = AudioEngine;
  global.drawScope = drawScope;
})(window);
