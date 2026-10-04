// All sound is synthesised with WebAudio, so the game ships with zero asset files.

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this._noise = null;
    this.ringing = null;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  setListener(x, y, z, yaw) { this.listener.x = x; this.listener.y = y; this.listener.z = z; this.listener.yaw = yaw; }

  // returns a node to connect a source into: positional (distance + pan) or direct
  out(pos, vol = 1, maxDist = 45) {
    const c = this.ctx;
    const g = c.createGain();
    if (!pos) { g.gain.value = vol; g.connect(this.master); return g; }
    const L = this.listener;
    const dx = pos[0] - L.x, dz = pos[2] - L.z, dy = pos[1] - L.y;
    const d = Math.hypot(dx, dy, dz);
    if (d > maxDist) return null;
    const att = Math.max(0, 1 - d / maxDist);
    g.gain.value = vol * att * att;
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    if (p) {
      // right vector for yaw: (cos yaw, 0, -sin yaw)
      const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
      p.pan.value = d > 0.01 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) : 0;
      g.connect(p); p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  tone({ f = 440, f2, type = 'sine', dur = 0.15, vol = 0.3, attack = 0.005, pos, delay = 0, maxDist }) {
    if (!this.ctx) return;
    const dst = this.out(pos, vol, maxDist);
    if (!dst) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dst);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.2, vol = 0.3, filter = 'bandpass', freq = 1000, q = 1, f2, pos, delay = 0, attack = 0.002, maxDist }) {
    if (!this.ctx) return;
    const dst = this.out(pos, vol, maxDist);
    if (!dst) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this._noise;
    const fl = c.createBiquadFilter(); fl.type = filter; fl.frequency.setValueAtTime(freq, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dst);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  // --------------------------------------------------------------- game sounds
  key(digit) { this.noise({ dur: 0.05, vol: 0.35, freq: 2400 + digit * 140, q: 3 }); this.tone({ f: 600 + digit * 40, dur: 0.04, vol: 0.06, type: 'square' }); }
  backspace() { this.noise({ dur: 0.05, vol: 0.25, freq: 1200, q: 2 }); }
  kill() {
    this.noise({ dur: 0.18, vol: 0.5, filter: 'lowpass', freq: 3000, f2: 300 });
    [660, 880, 1320].forEach((f, i) => this.tone({ f, dur: 0.18, vol: 0.18, type: 'triangle', delay: i * 0.06 }));
  }
  killAt(pos) { this.noise({ dur: 0.2, vol: 0.7, filter: 'lowpass', freq: 2500, f2: 200, pos, maxDist: 70 }); this.tone({ f: 900, f2: 300, dur: 0.25, vol: 0.25, type: 'triangle', pos, maxDist: 70 }); }
  miss() { this.tone({ f: 140, dur: 0.28, vol: 0.28, type: 'square' }); this.tone({ f: 118, dur: 0.28, vol: 0.22, type: 'sawtooth' }); }
  notInSight() { this.tone({ f: 330, f2: 220, dur: 0.2, vol: 0.18, type: 'triangle' }); }
  died() { [392, 370, 349, 262].forEach((f, i) => this.tone({ f, f2: f * 0.97, dur: i === 3 ? 0.6 : 0.22, vol: 0.2, type: 'sawtooth', delay: i * 0.22 })); }
  spawn() { this.tone({ f: 440, f2: 880, dur: 0.25, vol: 0.12, type: 'sine' }); }
  throwWhoosh() { this.noise({ dur: 0.25, vol: 0.25, freq: 600, f2: 2400, q: 1.5 }); }
  bounce(pos) { this.tone({ f: 900 + Math.random() * 300, dur: 0.06, vol: 0.25, type: 'triangle', pos, maxDist: 30 }); }
  flashBang(pos) {
    this.noise({ dur: 0.9, vol: 1.0, filter: 'lowpass', freq: 5000, f2: 120, pos, maxDist: 90 });
    this.tone({ f: 70, f2: 30, dur: 0.6, vol: 0.6, pos, maxDist: 90 });
  }
  tinnitus(strength) {
    if (!this.ctx || strength <= 0.05) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 3600; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12 * strength, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 1 + strength * 3.5);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 5);
    // muffle the mix for a moment
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.volume * (1 - 0.8 * strength), t);
    this.master.gain.linearRampToValueAtTime(this.volume, t + 1 + strength * 3);
  }
  smokePop(pos) { this.noise({ dur: 2.5, vol: 0.5, filter: 'highpass', freq: 3000, pos, maxDist: 50, attack: 0.05 }); this.tone({ f: 200, f2: 90, dur: 0.2, vol: 0.3, pos, maxDist: 50 }); }
  distractBeep(pos, k) { this.tone({ f: k % 2 ? 1400 : 1050, dur: 0.12, vol: 0.55, type: 'square', pos, maxDist: 70 }); }
  shutter() { this.noise({ dur: 0.04, vol: 0.5, freq: 4000, q: 2 }); this.noise({ dur: 0.06, vol: 0.4, freq: 2500, q: 2, delay: 0.07 }); this.tone({ f: 1800, f2: 3200, dur: 0.3, vol: 0.05, delay: 0.12 }); }
  shutterAt(pos) { this.noise({ dur: 0.05, vol: 0.5, freq: 4000, q: 2, pos, maxDist: 25 }); }
  pickup() { [880, 1175].forEach((f, i) => this.tone({ f, dur: 0.12, vol: 0.15, type: 'triangle', delay: i * 0.07 })); }
  step(pos, vol = 0.18) { this.noise({ dur: 0.07, vol, filter: 'lowpass', freq: 500 + Math.random() * 200, pos, maxDist: 24 }); }
  land() { this.noise({ dur: 0.12, vol: 0.3, filter: 'lowpass', freq: 400 }); }
  jam() { this.tone({ f: 90, dur: 0.15, vol: 0.2, type: 'square' }); }
  flagTaken(mine) { (mine ? [523, 415, 330] : [523, 659, 784]).forEach((f, i) => this.tone({ f, dur: 0.2, vol: 0.2, type: 'triangle', delay: i * 0.1 })); }
  capture(good) {
    const seq = good ? [523, 659, 784, 1047] : [392, 330, 262, 196];
    seq.forEach((f, i) => this.tone({ f, dur: 0.3, vol: 0.22, type: 'triangle', delay: i * 0.12 }));
  }
  ui() { this.tone({ f: 900, dur: 0.04, vol: 0.08, type: 'triangle' }); }
  countdown(last) { this.tone({ f: last ? 1046 : 523, dur: last ? 0.4 : 0.15, vol: 0.2, type: 'triangle' }); }
  win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone({ f, dur: 0.25, vol: 0.2, type: 'triangle', delay: i * 0.12 })); }
  lose() { [392, 349, 311, 262].forEach((f, i) => this.tone({ f, dur: 0.35, vol: 0.18, type: 'sawtooth', delay: i * 0.2 })); }
  warn() { this.tone({ f: 1200, dur: 0.05, vol: 0.06, type: 'sine' }); }

  say(text) {
    try {
      if (!this.announcer || !window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 0.75; u.volume = Math.min(1, this.volume * 1.2);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* speech not available */ }
  }
}

export const audio = new AudioEngine();
