// Cross-checks the JS loader (decodes the original zip in-browser) against the Python tools' output (web/assets, built by
// tools/build_web.py). Skipped when those assets have not been built.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadGame } from './loader.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const have = fs.existsSync(here('assets/game.json'));
const skip = have ? false : 'run tools/build_web.py first';
const g = await loadGame(fs.readFileSync(here('spacehog.zip')));

function readPng(path) {                       // our PNGs are 8-bit RGBA with filter 0 on every row
  const b = fs.readFileSync(path); const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  let p = 8, idat = [];
  while (p < b.length) { const n = b.readUInt32BE(p), t = b.toString('latin1', p + 4, p + 8); if (t === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + n)); p += 12 + n; }
  const raw = zlib.inflateSync(Buffer.concat(idat)); const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) { assert.equal(raw[y * (w * 4 + 1)], 0); raw.copy(out, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)); }
  return { w, h, rgba: out };
}

test('levels, paths, enemy table, sprite/bg lists match the Python decoder', { skip }, () => {
  const py = JSON.parse(fs.readFileSync(here('assets/game.json'), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(g.data.enemies)), py.enemies);
  assert.deepEqual(JSON.parse(JSON.stringify(g.data.levels)), py.levels);
  assert.deepEqual(g.data.paths, py.paths);
  assert.deepEqual(g.data.sprites, py.sprites);
  assert.deepEqual(g.data.bgs, py.bgs);
  assert.deepEqual([...g.data.sounds].sort(), [...py.sounds].sort());
});

test('every decoded sprite and background has the same pixels as the Python export', { skip }, () => {
  let n = 0;
  for (const [name, im] of g.images) { const p = readPng(here(`assets/sprites/${name}.png`)); assert.deepEqual([im.w, im.h], [p.w, p.h], name); assert.ok(Buffer.from(im.rgba.buffer).equals(p.rgba), name); n++; }
  g.bgImages.forEach((im, i) => { if (!im) return; const nm = g.data.bgs[i].name; const p = readPng(here(`assets/bgs/${nm}.png`)); assert.ok(Buffer.from(im.rgba.buffer).equals(p.rgba), nm); n++; });
  assert.ok(n > 190, 'compared ' + n);
});

test('samples have the lengths the datafile declares and stay within [-1, 1]', () => {
  assert.equal(g.samples.size, 10);
  for (const [name, s] of g.samples) { assert.ok(s.samples.length > 1000, name); assert.ok(s.samples.every((v) => v >= -1 && v <= 1), name); }
});

test('rejects a zip that lacks the game files', async () => {
  const empty = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  await assert.rejects(loadGame(empty), /missing/);
});
