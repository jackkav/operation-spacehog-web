import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OPTIONS, defaultHall, loadOptions, saveOptions, loadHall, saveHall, qualifies, addScore, parseCredits, sanitizeHall, MAX_NAME, HALL_SIZE } from './extras.js';
import { loadGame } from './loader.js';

const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const fakeStore = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, m }; };

test('options round-trip, and junk or out-of-range values fall back to safe ones', () => {
  const s = fakeStore(); assert.deepEqual(loadOptions(s), DEFAULT_OPTIONS);
  saveOptions(s, { music: false, musicVol: 9, sfxVol: 0, difficulty: 5, lighting: false, autofire: false });
  assert.deepEqual(loadOptions(s), { music: false, musicVol: 9, sfxVol: 0, difficulty: 5, lighting: false, autofire: false });
  saveOptions(s, { music: 'yes', musicVol: 99, sfxVol: -4, difficulty: 0, lighting: 1, autofire: 'no' });
  assert.deepEqual(loadOptions(s), { ...DEFAULT_OPTIONS, musicVol: 10, sfxVol: 0, difficulty: 1 });
  assert.deepEqual(loadOptions(fakeStore({ 'spacehog.options.v1': '{not json' })), DEFAULT_OPTIONS);
});

test('storage that throws never breaks anything', () => {
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadOptions(bad), DEFAULT_OPTIONS); assert.equal(saveOptions(bad, DEFAULT_OPTIONS), false);
  assert.equal(loadHall(bad, NAMES).length, 10); assert.equal(saveHall(bad, []), false);
});

test('default hall: the original ten names scoring 50000 down to 5000', () => {
  const h = defaultHall(NAMES); assert.equal(h.length, 10); assert.deepEqual([h[0].score, h[9].score], [50000, 5000]);
  assert.ok(h.every((e, i) => i === 0 || e.score < h[i - 1].score));
});

test('qualifying and ranking: ties rank below existing entries, zero never qualifies, the list stays at ten', () => {
  const h = defaultHall(NAMES);
  assert.equal(qualifies(h, 0), false); assert.equal(qualifies(h, 5000), false, 'tie with last place does not qualify'); assert.equal(qualifies(h, 5001), true);
  let r = addScore(h, { name: 'ZED', score: 60000, ship: 1 }); assert.equal(r.rank, 0); assert.equal(r.hall.length, 10); assert.equal(r.hall[0].name, 'ZED'); assert.equal(r.hall.at(-1).name, 'I');
  r = addScore(h, { name: 'MID', score: 30000 }); assert.equal(r.rank, 5, 'below the existing 30000');
  r = addScore(h, { name: 'LOW', score: 100 }); assert.equal(r.rank, -1); assert.equal(r.hall, h);
  r = addScore(h, { name: '   ', score: 99999 }); assert.equal(r.hall[0].name, 'PILOT');
  r = addScore(h, { name: 'x'.repeat(40), score: 99999 }); assert.equal(r.hall[0].name.length, MAX_NAME);
});

test('a saved hall of fame survives a reload; corrupt data is replaced by the defaults', () => {
  const s = fakeStore(); const r = addScore(defaultHall(NAMES), { name: 'ME', score: 77777, ship: 2 });
  saveHall(s, r.hall); const back = loadHall(s, NAMES); assert.deepEqual(back, r.hall); assert.equal(back.length, HALL_SIZE);
  assert.deepEqual(loadHall(fakeStore({ 'spacehog.hall.v1': '[1,2,{"name":5}]' }), NAMES), defaultHall(NAMES));
  assert.deepEqual(sanitizeHall([{ name: 'a', score: 5 }, { name: 'b', score: 9 }], NAMES).map((e) => e.name), ['b', 'a'], 'sorted');
});

test('credits parser: codes become colours/sizes, line ends become lines, \\e stops it', () => {
  const lines = parseCredits('\\n\r\n\\2\\sGame Design:\\n\r\n\\4J\\5ohan \\4P\\5eitz\\n\r\n\\7\\c\\sOPERATION\\l SPACEHOG\\n\r\n\\e\r\nignored');
  assert.equal(lines[0].spans.length, 0, 'blank line');
  assert.deepEqual(lines[1].spans, [{ text: 'Game Design:', color: '#ffcc44' }]); assert.equal(lines[1].size, 'small');
  assert.deepEqual(lines[2].spans.map((s) => s.text), ['J', 'ohan ', 'P', 'eitz']);
  assert.deepEqual(lines[2].spans.map((s) => s.color), ['#ffe98a', '#d6e2f0', '#ffe98a', '#d6e2f0']);
  assert.equal(lines[3].size, 'large'); assert.equal(lines.length, 4);
});

test('the real credits and hall names parse out of the original files', async () => {
  const g = await loadGame(fs.readFileSync(fileURLToPath(new URL('spacehog.zip', import.meta.url))));
  assert.equal(g.hallNames.length, 10); assert.equal(g.hallNames[0], 'Free Lunch Design'); assert.equal(g.hallNames[9], 'Hantor Capole');
  const text = parseCredits(g.texts.CREDIT_TEXT).map((l) => l.spans.map((s) => s.text).join('')).join('\n');
  assert.ok(text.includes('Johan Peitz') && text.includes('Aaron Hankla') && text.includes('Shawn Hargreaves for Allegro'));
});
