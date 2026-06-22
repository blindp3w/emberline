// Emberline — synthesized sound via the Web Audio API. No audio files.
//
// Everything routes through a master gain so the mute toggle is a single
// switch. The AudioContext is created lazily and resumed on the first user
// gesture (required by iOS Safari / Chrome autoplay policies).

const STORE_KEY = 'emberline.muted';

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.swellOsc = null;
    this.swellGain = null;
    this.muted = localStorage.getItem(STORE_KEY) === '1';
  }

  // Call from a user-gesture handler (tap / key / start button).
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
  }

  get isMuted() {
    return this.muted;
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem(STORE_KEY, this.muted ? '1' : '0');
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, t, 0.05);
    }
    return this.muted;
  }

  _now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // --- One-shot voices ------------------------------------------------------

  // Soft synth pulse on jump: a quick upward pitch blip.
  jump() {
    if (!this.ctx) return;
    const t = this._now();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.exponentialRampToValueAtTime(560, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.24);
  }

  // A short airy whoosh for sliding.
  slide() {
    if (!this.ctx) return;
    const t = this._now();
    const noise = this._noiseBurst(0.18);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.18);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(t);
    noise.stop(t + 0.2);
  }

  // Warm chime on emberlight pickup: two stacked sine partials, bell-like.
  pickup() {
    if (!this.ctx) return;
    const t = this._now();
    const freqs = [880, 1320]; // root + fifth-ish
    freqs.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const peak = 0.32 / (i + 1);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.52);
    });
  }

  // Darker hit on collision: detuned saw thud sliding downward.
  hit() {
    if (!this.ctx) return;
    const t = this._now();
    const osc = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = 'sawtooth';
    sub.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.5);
    sub.frequency.setValueAtTime(110, t);
    sub.frequency.exponentialRampToValueAtTime(36, t + 0.5);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.6, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain).connect(this.master);
    osc.start(t); sub.start(t);
    osc.stop(t + 0.62); sub.stop(t + 0.62);
  }

  // --- Continuous swell -----------------------------------------------------
  // A low drone whose pitch/level rises with normalized speed [0..1].
  startSwell() {
    if (!this.ctx || this.swellOsc) return;
    const t = this._now();
    this.swellOsc = this.ctx.createOscillator();
    this.swellGain = this.ctx.createGain();
    this.swellOsc.type = 'sawtooth';
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    this.swellOsc.frequency.value = 55;
    this.swellGain.gain.value = 0.0001;
    this.swellOsc.connect(filter).connect(this.swellGain).connect(this.master);
    this.swellOsc.start(t);
    this._swellFilter = filter;
  }

  // intensity in [0..1]
  setSwell(intensity) {
    if (!this.swellOsc) return;
    const t = this._now();
    const i = Math.max(0, Math.min(1, intensity));
    this.swellOsc.frequency.setTargetAtTime(50 + i * 70, t, 0.3);
    this._swellFilter.frequency.setTargetAtTime(280 + i * 900, t, 0.3);
    this.swellGain.gain.setTargetAtTime(0.04 + i * 0.16, t, 0.3);
  }

  stopSwell() {
    if (!this.swellOsc) return;
    const t = this._now();
    this.swellGain.gain.setTargetAtTime(0.0001, t, 0.2);
    const osc = this.swellOsc;
    osc.stop(t + 0.6);
    this.swellOsc = null;
    this.swellGain = null;
    this._swellFilter = null;
  }

  _noiseBurst(duration) {
    const len = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    return src;
  }
}
