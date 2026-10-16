// Guardian / parent-child tests. Synthetic data only (events carry the same `raw` int array the real loader produces).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAMES_PER_TICK } from './sim.js';
import { sprites, enemy, ev, mk, start, run } from './testutil.mjs';

const SPR = [...sprites, { name: 'BOSS', w: 300, h: 60 }, { name: 'PART', w: 10, h: 10 }, { name: 'FLAME', w: 20, h: 6 }];   // indices 6, 7, 8
const named = (e, name) => ({ ...e, name });
const ENEMIES = [
  enemy(0, 3, 1, 50),
  enemy(10, 6, 40, 1000),                                    // guardian
  enemy(11, 7, 3, 100),                                      // turret-like part
  named(enemy(12, 8, 1, 0), 'Engineflame'),
];
const GPAT = Array.from({ length: 6 }, (_, i) => [300 - i * 10, i * 2]);        // [x, y] like game.json; 6 points
const mkB = (events) => mk([...events, ev({ t: 999, cmd_id: 9 })], { enemies: ENEMIES, sprites: SPR, paths: { PAT_01: [[350, 0]], GPAT_01: GPAT } });
const raw = (f6, f12 = 0, f13 = 0, f14 = -1, f15 = 0) => { const r = Array(16).fill(0); r[6] = f6; r[12] = f12; r[13] = f13; r[14] = f14; r[15] = f15; return r; };
const boss = (o = {}) => ev({ cmd_id: 6, type: 10, y: -20, raw: raw(1, 0, 0, 0, 99), bonus: 99, ...o });
const part = (f12, f13, type = 11, bonus = 0) => ev({ cmd_id: 0, type, bonus, raw: raw(1, f12, f13, -2, bonus) });
const field = (sim) => { start(sim); sim.player.inv = 99999; return sim; };

test('a guardian (cmd 6) follows GPAT_<f6> with y = f2 + path y, and loops the path instead of leaving', () => {
  const sim = field(mkB([boss()]));
  const b = sim.enemies[0];
  assert.ok(b.boss); assert.deepEqual([b.x, b.y], [300, -20]);
  run(sim, 1); assert.deepEqual([b.x, b.y], [300, -20], 'first step consumes path[0]');
  run(sim, 1); assert.deepEqual([b.x, b.y], [290, -18]);
  run(sim, 40);                                                     // many path lengths later
  assert.equal(sim.enemies.includes(b), true, 'guardian never escapes');
  assert.ok(b.x >= 250 && b.x <= 300);
  assert.deepEqual(sim.bossStatus(), { hp: 40, max: 40 });
});

test('parts (link -2) ride on the last parent at their offsets and are not culled when off screen', () => {
  const sim = field(mkB([boss({ raw: raw(1, 0, 0, 0, 99) }), part(-157, -33), part(78, 33)]));
  const [b, p1, p2] = sim.enemies; assert.equal(b.children.length, 2);
  run(sim, 3);
  assert.deepEqual([p1.x, p1.y], [b.x - 157, b.y - 33]); assert.deepEqual([p2.x, p2.y], [b.x + 78, b.y + 33]);
  b.pi = 0; b.path = [[-300, 0]].map(([x, y]) => ({ x, y })); run(sim, 5);          // parent far off to the left
  assert.equal(sim.enemies.includes(p1), true, 'parts only leave with their parent');
});

test('killing the guardian destroys its parts, scores everything and drops part bonuses', () => {
  const sim = field(mkB([boss(), part(0, 0, 11, 1), part(30, 0, 11, 2)]));
  const b = sim.enemies[0];
  sim.killEnemy(b); sim.enemies = sim.enemies.filter((e) => !e.dead);
  assert.equal(sim.enemies.length, 0); assert.equal(sim.score, 1000 + 100 + 100);
  assert.deepEqual(sim.pickups.map((p) => p.kind).sort(), ['P', 'S']);
  assert.ok(sim.flash > 0);
});

test('a part can die alone without hurting the guardian', () => {
  const sim = field(mkB([boss(), part(0, 0)]));
  const [b, p] = sim.enemies; sim.hurt(p, 99, 'gun'); sim.enemies = sim.enemies.filter((e) => !e.dead);
  assert.equal(sim.enemies.includes(b), true); assert.equal(b.hp, 40); assert.equal(sim.score, 100);
});

test('engine flames are decoration: bullets pass through, they do not hurt the ship, and they vanish with the parent', () => {
  const sim = field(mkB([boss(), part(0, 0, 12)]));
  const [b, flame] = sim.enemies; sim.player.x = flame.x; sim.player.y = flame.y;
  run(sim, 2); assert.equal(sim.lives, 3, 'no collision damage from a flame');
  assert.equal(sim.hurt(flame, 99, 'beam'), false); assert.ok(!flame.dead);
  sim.killEnemy(b); assert.equal(flame.dead, true); assert.equal(sim.score, 1000, 'flame has no score');
});

test('a normal parent that leaves the screen takes its parts with it and scores nothing', () => {
  const sim = field(mkB([ev({ cmd_id: 0, type: 0, x_offset: -300, vx: -1, raw: raw(1, 0, 0, 0) }), part(5, 0)]));
  const [par, child] = sim.enemies; par.x = -80; run(sim, 40);
  assert.equal(sim.enemies.length, 0); assert.equal(child.dead, true); assert.equal(sim.score, 0);
});

test('the first end marker stops the script; the level then ends only when the guardian is dead', () => {
  const marker = ev({ t: 2, cmd_id: 9 });
  const late = ev({ t: 3, cmd_id: 0, type: 0 });                      // after the marker: must never run
  const sim = mk([boss({ t: 1 }), marker, late, ev({ t: 5, cmd_id: 9 })], { enemies: ENEMIES, sprites: SPR, paths: { GPAT_01: GPAT } });
  start(sim); sim.player.inv = 99999;
  run(sim, 5 * FRAMES_PER_TICK);
  assert.equal(sim.finishedFlag, true); assert.equal(sim.enemies.filter((e) => e.def.type === 0).length, 0, 'later events ignored');
  assert.equal(sim.state, 'playing', 'guardian still alive');
  sim.killEnemy(sim.enemies.find((e) => e.boss)); run(sim, 2);
  assert.equal(sim.state, 'won');
});

test('a part with no parent (should not happen in real data) spawns as a plain enemy', () => {
  const sim = field(mkB([part(10, 10)]));
  assert.equal(sim.enemies.length, 1); assert.equal(sim.enemies[0].parent, null);
});
