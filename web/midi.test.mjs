// MIDI parser + sequencer tests (the synth itself needs Web Audio and is checked in the browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSMF, Sequencer } from './midi.js';
import { loadGame } from './loader.js';

const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
const smf = (tracks, div = 480) => {
  const out = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, div >> 8, div & 255];
  for (const t of tracks) { out.push(0x4d, 0x54, 0x72, 0x6b, ...[t.length >>> 24, t.length >>> 16 & 255, t.length >>> 8 & 255, t.length & 255], ...t); }
  return new Uint8Array(out);
};
const END = [0, 0xff, 0x2f, 0];

test('ticks become seconds through the tempo map (120 bpm, then 240 bpm from beat 1)', () => {
  const t0 = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20,                       // 500000 us per beat
    ...vlq(480), 0xff, 0x51, 3, 0x03, 0xd0, 0x90,                       // at tick 480: 250000 us per beat
    ...END];
  const t1 = [0, 0x90, 60, 100, ...vlq(480), 0x80, 60, 0, ...vlq(480), 0x90, 62, 90, ...vlq(480), 0x80, 62, 0, ...END];
  const m = parseSMF(smf([t0, t1]));
  const times = m.events.map((e) => [e.k, e.a, +e.t.toFixed(6)]);
  assert.deepEqual(times, [['on', 60, 0], ['off', 60, 0.5], ['on', 62, 0.75], ['off', 62, 1.0]]);
  assert.equal(m.tracks, 2);
});

test('running status, note-on with velocity 0 = note off, program/controller/pitch-bend events', () => {
  const t = [0, 0xc3, 25,                                                // program 25 on channel 3
    0, 0xb3, 7, 90,                                                      // volume
    0, 0xe3, 0x00, 0x60,                                                 // bend (0x60 << 7) - 8192 = 4096
    0, 0x93, 64, 80, 10, 66, 70, 10, 64, 0, 10, 66, 0, ...END];          // running status: on, on, on(vel 0), on(vel 0)
  const ev = parseSMF(smf([t])).events;
  assert.deepEqual(ev.slice(0, 3).map((e) => [e.k, e.ch, e.a]), [['prog', 3, 25], ['cc', 3, 7], ['bend', 3, 4096]]);
  assert.deepEqual(ev.slice(3).map((e) => [e.k, e.a]), [['on', 64], ['on', 66], ['off', 64], ['off', 66]]);
});

test('at the same instant: note-offs come first, so a repeated note is not cut short', () => {
  const t = [0, 0x90, 60, 100, ...vlq(480), 0x90, 60, 100, 0, 0x80, 60, 0, ...vlq(480), 0x80, 60, 0, ...END];
  const ev = parseSMF(smf([t])).events;
  assert.deepEqual(ev.map((e) => e.k), ['on', 'off', 'on', 'off']);
});

test('sequencer: every event is delivered exactly once per pass, with offsets inside the window, and the song loops seamlessly', () => {
  const t = [0, 0x90, 60, 100, ...vlq(240), 0x80, 60, 0, ...vlq(240), 0x90, 64, 100, ...vlq(480), 0x80, 64, 0, ...END];
  const m = parseSMF(smf([t]));                                           // events at 0, .25, .5, 1.0; duration 1.0
  const seq = new Sequencer(m, true, 0.5);                                // loop length 1.5 s
  const got = [];
  for (let w = 0; w < 90; w++) for (const { at, ev } of seq.take(0.05)) { assert.ok(at >= -1e-9 && at < 0.05 + 1e-9); got.push(+(w * 0.05 + at).toFixed(3) + ':' + ev.k + ev.a); }
  const per = got.filter((g) => g.endsWith('on60')).length; assert.equal(per, 3, '4.5 s = three loops');
  assert.deepEqual(got.slice(0, 4), ['0:on60', '0.25:off60', '0.5:on64', '1:off64']);
  assert.deepEqual(got.slice(4, 6), ['1.5:on60', '1.75:off60'], 'second pass starts exactly one loop length later');
  const once = new Sequencer(m, false); let n = 0; for (let i = 0; i < 100; i++) n += once.take(0.05).length;
  assert.equal(n, 4); assert.equal(once.done, true);
});

test('the real songs parse: track counts, plausible lengths, drums on channel 10, notes in range', async () => {
  const g = await loadGame(fs.readFileSync(fileURLToPath(new URL('spacehog.zip', import.meta.url))));
  assert.deepEqual([...g.midis.keys()].sort(), ['MIDI_BOSS', 'MIDI_INTRO', 'MIDI_LEVEL', 'MIDI_TITLE']);
  for (const [name, bytes] of g.midis) {
    const m = parseSMF(bytes);
    const on = m.events.filter((e) => e.k === 'on');
    assert.ok(m.duration > 20 && m.duration < 600, `${name} lasts ${m.duration.toFixed(1)} s`);
    assert.ok(on.length > 200, name + ' has notes'); assert.ok(on.every((e) => e.a >= 0 && e.a < 128 && e.b > 0 && e.b < 128));
    assert.ok(on.some((e) => e.ch === 9), name + ' has a drum part');
    assert.ok(m.events.every((e, i, a) => i === 0 || a[i - 1].t <= e.t), 'sorted');
  }
});

test('rejects data that is not a MIDI file', () => assert.throws(() => parseSMF(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])), /not a MIDI/));
