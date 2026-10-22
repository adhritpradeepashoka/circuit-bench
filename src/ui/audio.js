// Sound for buzzers and speakers: one small square-wave voice per part, made with the Web Audio API.
// Browsers only let audio start after a click — the Run button is that click. If audio isn't available
// (or the person turned it off) every call is a harmless no-op.
const KEY = 'circuitbench:sound';

export class Sound {
  constructor() {
    this.ctx = null; this.voices = new Map(); this.failed = false;
    this.enabled = true;
    try { this.enabled = globalThis.localStorage?.getItem(KEY) !== 'off'; } catch { /* private window */ }
  }
  get supported() { return !this.failed && !!(globalThis.AudioContext || globalThis.webkitAudioContext); }
  setEnabled(on) {
    this.enabled = !!on;
    try { globalThis.localStorage?.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
    if (!on) this.silence();
  }
  /** Play `freq` Hz for part `id` (0 or null stops it). */
  tone(id, freq) {
    const f = Math.max(0, Math.min(8000, Number(freq) || 0));
    if (!f || !this.enabled || !this.supported) { this.stop(id); return; }
    try {
      if (!this.ctx) { const AC = globalThis.AudioContext || globalThis.webkitAudioContext; this.ctx = new AC(); }
      if (this.ctx.state === 'suspended') this.ctx.resume?.();
      let v = this.voices.get(id);
      if (!v) {
        const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
        osc.type = 'square'; gain.gain.value = 0.035;
        osc.connect(gain).connect(this.ctx.destination); osc.start();
        v = { osc, gain }; this.voices.set(id, v);
      }
      if (Math.abs(v.osc.frequency.value - f) > 1) v.osc.frequency.setValueAtTime(f, this.ctx.currentTime);
    } catch { this.failed = true; }
  }
  stop(id) {
    const v = this.voices.get(id);
    if (!v) return;
    try { v.osc.stop(); v.osc.disconnect(); v.gain.disconnect(); } catch { /* already stopped */ }
    this.voices.delete(id);
  }
  silence() { for (const id of [...this.voices.keys()]) this.stop(id); }
}
