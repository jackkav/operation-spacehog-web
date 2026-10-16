// A small MIDI player: Standard MIDI File parser, a looping sequencer and a General-MIDI-flavoured Web Audio synthesizer
// (oscillators + filters, no samples, no dependencies). parseSMF() and Sequencer are pure and run under Node; Synth/MidiPlayer need
// a Web Audio context (also works with an OfflineAudioContext, which the tests use to check that the synth actually makes sound).

// --- parsing ---------------------------------------------------------------------------------------------------------
// Returns { events: [{ t (seconds), ch, k: 'on'|'off'|'prog'|'cc'|'bend', a, b }], duration, tracks }
export function parseSMF(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (String.fromCharCode(...u8.subarray(0, 4)) !== 'MThd') throw new Error('not a MIDI file');
  const ntrk = dv.getUint16(10); let div = dv.getUint16(12); if (div & 0x8000) div = 480;     // SMPTE time base unsupported
  const raw = [], tempos = [{ tick: 0, us: 500000 }]; let p = 8 + dv.getUint32(4);
  for (let tr = 0; tr < ntrk && p + 8 <= u8.length; tr++) {
    const len = dv.getUint32(p + 4), end = p + 8 + len; p += 8;
    let tick = 0, status = 0;
    const vlq = () => { let v = 0, b; do { b = u8[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
    while (p < end) {
      tick += vlq();
      let s = u8[p];
      if (s & 0x80) { p++; if (s < 0xf0) status = s; } else s = status;          // running status
      if (s === 0xff) {                                                          // meta
        const type = u8[p++], n = vlq();
        if (type === 0x51 && n === 3) tempos.push({ tick, us: (u8[p] << 16) | (u8[p + 1] << 8) | u8[p + 2] });
        p += n; if (type === 0x2f) break;
      } else if (s === 0xf0 || s === 0xf7) { p += vlq(); }                         // sysex
      else {
        const hi = s & 0xf0, ch = s & 0x0f, a = u8[p++], b = (hi === 0xc0 || hi === 0xd0) ? 0 : u8[p++];
        if (hi === 0x90 && b > 0) raw.push({ tick, ch, k: 'on', a, b });
        else if (hi === 0x80 || hi === 0x90) raw.push({ tick, ch, k: 'off', a, b });
        else if (hi === 0xc0) raw.push({ tick, ch, k: 'prog', a, b: 0 });
        else if (hi === 0xb0) raw.push({ tick, ch, k: 'cc', a, b });
        else if (hi === 0xe0) raw.push({ tick, ch, k: 'bend', a: ((b << 7) | a) - 8192, b: 0 });
      }
    }
    p = end;
  }
  tempos.sort((x, y) => x.tick - y.tick);
  const secs = (tick) => {                                                       // tempo-map aware tick -> seconds
    let t = 0, last = 0, us = 500000;
    for (const tp of tempos) { if (tp.tick > tick) break; t += (tp.tick - last) * us / 1e6 / div; last = tp.tick; us = tp.us; }
    return t + (tick - last) * us / 1e6 / div;
  };
  const events = raw.map((e) => ({ t: secs(e.tick), ch: e.ch, k: e.k, a: e.a, b: e.b, _o: e.k === 'off' ? 0 : e.k === 'on' ? 2 : 1 }));
  events.sort((x, y) => x.t - y.t || x._o - y._o);                               // at equal times: offs, then setup, then ons
  for (const e of events) delete e._o;
  return { events, duration: events.length ? events[events.length - 1].t : 0, tracks: ntrk };
}

// --- sequencing ------------------------------------------------------------------------------------------------------
export class Sequencer {
  constructor(midi, loop = true, tail = 0.5) { this.ev = midi.events; this.len = midi.duration + tail; this.loop = loop; this.pos = 0; this.i = 0; this.done = false; }
  // events in the next `dt` seconds, with `at` = offset from the start of the window; wraps around when looping
  take(dt) {
    const out = []; let off = 0, remaining = dt;
    while (remaining > 1e-12 && !this.done) {
      const stop = Math.min(this.pos + remaining, this.len);
      while (this.i < this.ev.length && this.ev[this.i].t < stop) { out.push({ at: off + this.ev[this.i].t - this.pos, ev: this.ev[this.i] }); this.i++; }
      const used = stop - this.pos; off += used; remaining -= used; this.pos = stop;
      if (this.pos >= this.len) { if (this.loop) { this.pos = 0; this.i = 0; } else this.done = true; }
    }
    return out;
  }
}

// --- synthesis -------------------------------------------------------------------------------------------------------
// One timbre per GM family (program >> 3): oscillator type(s), envelope (attack, decay, sustain, release in s), filter as a multiple of pitch
const T = (w, a, d, s, r, f, det = 0) => ({ w, a, d, s, r, f, det });
const TIMBRES = [
  T('triangle', 0.004, 0.9, 0.06, 0.3, 7),      // 0 piano
  T('sine', 0.002, 0.6, 0, 0.3, 9),             // 1 chromatic percussion
  T('square', 0.01, 0.05, 0.8, 0.08, 3),        // 2 organ
  T('sawtooth', 0.003, 0.5, 0.1, 0.15, 5),      // 3 guitar
  T('sawtooth', 0.005, 0.3, 0.6, 0.1, 3),       // 4 bass
  T('sawtooth', 0.12, 0.3, 0.8, 0.3, 4, 7),     // 5 strings
  T('sawtooth', 0.2, 0.3, 0.8, 0.4, 4, 9),      // 6 ensemble
  T('sawtooth', 0.05, 0.2, 0.7, 0.15, 4),       // 7 brass
  T('square', 0.03, 0.1, 0.7, 0.1, 3),          // 8 reed
  T('sine', 0.05, 0.1, 0.8, 0.12, 2),           // 9 pipe
  T('square', 0.01, 0.1, 0.8, 0.08, 6),         // 10 synth lead
  T('sawtooth', 0.3, 0.3, 0.8, 0.5, 3, 8),      // 11 synth pad
  T('triangle', 0.1, 0.5, 0.5, 0.4, 5),         // 12 synth fx
  T('triangle', 0.004, 0.4, 0.05, 0.2, 6),      // 13 ethnic
  T('sine', 0.002, 0.25, 0, 0.1, 6),            // 14 percussive
  T('sine', 0.1, 1.0, 0.3, 0.5, 4),             // 15 sound fx
];
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Synth {
  constructor(ctx, out, maxVoices = 48) {
    this.ctx = ctx; this.maxVoices = maxVoices;
    this.master = ctx.createGain(); this.master.gain.value = 0.5;
    this.comp = ctx.createDynamicsCompressor(); this.master.connect(this.comp); this.comp.connect(out);
    this.ch = Array.from({ length: 16 }, () => this.makeChannel());
    this.voices = [];
    const n = ctx.sampleRate, buf = ctx.createBuffer(1, n, n), d = buf.getChannelData(0);   // 1 s of white noise for drums
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  makeChannel() {
    const gain = this.ctx.createGain(), pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    gain.connect(pan || this.master); if (pan) pan.connect(this.master);
    return { gain, pan, prog: 0, vol: 100, expr: 127, bend: 0, sustain: false, held: [] };
  }

  chanGain(c) { return Math.pow(c.vol / 127, 2) * Math.pow(c.expr / 127, 2) * 0.6; }

  handle(time, e) {
    const c = this.ch[e.ch];
    switch (e.k) {
      case 'on': return e.ch === 9 ? this.drum(time, e.a, e.b) : this.noteOn(time, c, e.a, e.b);
      case 'off': return e.ch === 9 ? undefined : this.noteOff(time, c, e.a);
      case 'prog': c.prog = e.a; return undefined;
      case 'bend': c.bend = e.a; for (const v of this.voices) if (v.c === c) for (const o of v.oscs) o.detune.setValueAtTime(v.det + e.a / 8192 * 200, time); return undefined;
      case 'cc':
        if (e.a === 7) c.vol = e.b; else if (e.a === 11) c.expr = e.b;
        else if (e.a === 10 && c.pan) c.pan.pan.setValueAtTime((e.b - 64) / 64, time);
        else if (e.a === 64) { c.sustain = e.b >= 64; if (!c.sustain) for (const n of c.held.splice(0)) this.release(time, n); }
        else if (e.a === 123 || e.a === 120) this.allOff(time);
        if (e.a === 7 || e.a === 11) c.gain.gain.setValueAtTime(this.chanGain(c), time);
        return undefined;
    }
    return undefined;
  }

  noteOn(time, c, note, vel) {
    const tb = TIMBRES[c.prog >> 3], ctx = this.ctx;
    if (this.voices.length >= this.maxVoices) this.release(time, this.voices[0], 0.03);        // steal the oldest voice
    const f = hz(note), peak = Math.pow(vel / 127, 1.3) * 0.28;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = Math.min(14000, f * tb.f * (0.5 + vel / 127));
    const g = ctx.createGain(); filt.connect(g); g.connect(c.gain);
    const oscs = [];
    for (const det of tb.det ? [-tb.det, tb.det] : [0]) {
      const o = ctx.createOscillator(); o.type = tb.w; o.frequency.value = f; o.detune.value = det + c.bend / 8192 * 200;
      o.connect(filt); o.start(time); oscs.push(o);
    }
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(peak, time + tb.a);
    g.gain.setTargetAtTime(peak * tb.s, time + tb.a, tb.d / 3);
    c.gain.gain.setValueAtTime(this.chanGain(c), time);
    const v = { c, note, oscs, g, tb, det: tb.det ? tb.det : 0, off: false };
    this.voices.push(v); c.held.push(v);
    return v;
  }

  noteOff(time, c, note) {
    const v = this.voices.find((x) => x.c === c && x.note === note && !x.off); if (!v) return;
    if (c.sustain) c.held.push(v); else this.release(time, v);
  }

  release(time, v, tau = null) {
    if (v.off) return; v.off = true;
    const r = tau ?? v.tb.r;
    v.g.gain.cancelScheduledValues(time); v.g.gain.setTargetAtTime(0, time, r / 3);
    for (const o of v.oscs) { o.stop(time + r * 2.5 + 0.05); o.onended = () => { const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); }; }
  }

  allOff(time = this.ctx.currentTime) { for (const v of this.voices.slice()) this.release(time, v, 0.05); }

  // General MIDI percussion, synthesised: kick / snare / hats / toms / cymbals / clicks
  drum(time, note, vel) {
    const ctx = this.ctx, amp = Math.pow(vel / 127, 1.3) * 0.5, c = this.ch[9];
    const out = ctx.createGain(); out.connect(c.gain); c.gain.gain.setValueAtTime(this.chanGain(c), time);
    const env = (dur, peak = amp) => { out.gain.setValueAtTime(peak, time); out.gain.setTargetAtTime(0, time, dur / 4); return time + dur * 1.5; };
    const tone = (f0, f1, dur) => { const o = ctx.createOscillator(); o.frequency.setValueAtTime(f0, time); o.frequency.exponentialRampToValueAtTime(f1, time + dur); o.connect(out); o.start(time); o.stop(time + dur * 1.5); };
    const noise = (type, f, dur) => { const s = ctx.createBufferSource(); s.buffer = this.noise; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; s.connect(fl); fl.connect(out); s.start(time); s.stop(time + dur * 1.5); };
    if (note === 35 || note === 36) { tone(150, 45, 0.18); env(0.22); }
    else if (note === 38 || note === 40 || note === 37 || note === 39) { tone(220, 120, 0.08); noise('highpass', 1800, 0.18); env(0.2, amp * 0.8); }
    else if (note === 42 || note === 44) { noise('highpass', 7000, 0.05); env(0.06, amp * 0.5); }
    else if (note === 46) { noise('highpass', 6500, 0.3); env(0.3, amp * 0.5); }
    else if (note >= 41 && note <= 50 && note !== 42 && note !== 44 && note !== 46 && note !== 49) { tone(80 + (note - 41) * 22, 50 + (note - 41) * 10, 0.2); env(0.25); }
    else if (note === 49 || note === 51 || note === 52 || note === 55 || note === 57 || note === 59) { noise('highpass', 5000, 0.9); env(0.9, amp * 0.45); }
    else { noise('bandpass', 2500, 0.05); env(0.06, amp * 0.5); }
  }
}

// --- real-time player ------------------------------------------------------------------------------------------------
export class MidiPlayer {
  constructor(ctx, out) { this.ctx = ctx; this.synth = new Synth(ctx, out); this.seq = null; this.timer = null; this.next = 0; this.name = null; }

  play(midi, { loop = true, name = null, gain = 1 } = {}) {
    if (name && name === this.name && this.seq && !this.seq.done) return;            // already playing this song
    this.stop();
    this.name = name; this.synth.master.gain.value = 0.5 * gain;       // per-song level so all songs sound equally loud
    this.seq = new Sequencer(midi, loop); this.next = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.pump(), 40); this.pump();
  }

  pump() {
    const STEP = 0.05, AHEAD = 0.3;
    while (this.seq && this.next < this.ctx.currentTime + AHEAD) {
      for (const { at, ev } of this.seq.take(STEP)) this.synth.handle(this.next + at, ev);
      this.next += STEP;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.seq = null; this.name = null;
    this.synth.allOff();
    for (const c of this.synth.ch) { c.sustain = false; c.held.length = 0; c.bend = 0; c.vol = 100; c.expr = 127; }
  }
}

// schedule a whole song on an (offline) context up to `seconds`; used by tests / tooling
export function renderOffline(ctx, midi, seconds) {
  const synth = new Synth(ctx, ctx.destination);
  for (const e of midi.events) if (e.t < seconds) synth.handle(e.t, e);
  return synth;
}
