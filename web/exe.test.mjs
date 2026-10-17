// Behaviours decoded from SH.EXE (see ../NOTES.md "Decoded from the exe"). Synthetic data; every expectation is a rule read from the machine code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COS, SIN, BULLET_TYPES, W } from './sim.js';
import { sprites, enemy, ev, mk, start, run } from './testutil.mjs';

const SPR = [...sprites, { name: 'EB_RANDOM1', w: 6, h: 6 }, { name: 'EB_LASER1', w: 11, h: 3 }, { name: 'EB_LEFT', w: 11, h: 5 }, { name: 'EB_BLUE', w: 12, h: 15 }];
const ENEMIES = [
  enemy(0, 3, 4, 100),
  enemy(1, 3, 4, 100, { '0x50': 5, '0x58': 2 }),                  // reload 5, bullet type 2 (laser, vx -10)
  enemy(2, 3, 4, 100, { '0x50': 5, '0x58': 0, '0x48': -7, '0x4c': 3 }),   // aimed, gun offset (-7, +3)
  enemy(3, 3, 4, 100, { '0x50': 5, '0x58': 1 }),                  // random direction
  enemy(4, 3, 4, 100, { '0x5c': 8 }), enemy(5, 3, 4, 100, { '0x5c': 2 }), enemy(6, 3, 4, 100, { '0x5c': -1 }), enemy(7, 3, 4, 100, { '0x5c': 0x40 }),
];
const raw = (o = {}) => Object.assign(Array(16).fill(0), { 14: -1 }, o);
const mkE = (events = []) => mk([...events, ev({ t: 999, cmd_id: 9 })], { enemies: ENEMIES, sprites: SPR });
const field = (sim) => { start(sim); sim.player.inv = 99999; return sim; };
const pin = (en, x, y) => { en.vx = 0; en.vy = 0; en.x = x; en.y = y; return en; };
const spawn = (sim, type, x, y) => pin(sim.spawn(sim.defs.get(type), x, y, 0, 0), x, y);

test('enemy fire: every reload + 1 frames, first volley staggered by slot % (reload + 1), even with the enemy off screen', () => {
  const sim = field(mkE()); sim.player.x = 300; sim.player.y = 200;
  const a = spawn(sim, 1, 400, 20), b = spawn(sim, 1, 410, 40);          // slots 0 and 1, both well off the right edge
  assert.deepEqual([a.slot, b.slot], [0, 1]);
  const fired = { a: [], b: [] };
  for (let f = 1; f <= 18; f++) {
    const before = sim.ebullets.length; sim.updateEnemies();
    const made = sim.ebullets.slice(before); for (const e of made) fired[Math.round(e.y) === 20 ? 'a' : 'b'].push(f);
    sim.ebullets.length = 0;
  }
  assert.deepEqual(fired.a, [5, 11, 17], 'slot 0: counter 0 -> fires on the 5th update, then every 6th');
  assert.deepEqual(fired.b, [4, 10, 16], 'slot 1 starts one count ahead');
});

test('bullet templates: laser = vx -10, aimed = speed 4 towards a living player, random = about speed 2 (integer shifts floor negatives), from the gun offset', () => {
  const sim = field(mkE()); sim.player.x = 100; sim.player.y = 103;     // level with the aimer's gun (y 100 + 3)
  const laser = spawn(sim, 1, 200, 50); sim.fireEnemy(laser);
  let b = sim.ebullets.pop(); assert.deepEqual([b.vx, b.vy, b.spr, b.frames], [-10, 0, 'EB_LASER1', 2]);
  const aimer = spawn(sim, 2, 200, 100); sim.fireEnemy(aimer);
  b = sim.ebullets.pop(); assert.deepEqual([b.x, b.y], [193, 103], 'spawns at enemy + gun offset');
  assert.deepEqual([b.vx, b.vy], [-4, 0], 'player is straight to the left: full speed 4');
  const rnd = spawn(sim, 3, 200, 100);
  for (let i = 0; i < 40; i++) { sim.fireEnemy(rnd); b = sim.ebullets.pop(); assert.ok(Math.abs(b.vx) <= 2 && Math.abs(b.vy) <= 2, 'components stay within [-2, 2] (floor of cos/sin * 128 >> 6)'); assert.equal(b.spr, 'EB_RANDOM1'); }
  assert.deepEqual(BULLET_TYPES.map((t) => t.kind), ['aim', 'random', 'fixed', 'fixed', 'fixed']);
  assert.deepEqual(BULLET_TYPES.slice(2).map((t) => t.vx), [-10, -6, -8]);
});

test('aimed shots only target living players', () => {
  const sim = mkE(); sim.newGame(0, 2); sim.begin(); for (const p of sim.players) p.inv = 99999;
  sim.players[0].x = 50; sim.players[0].y = 50; sim.players[1].x = 50; sim.players[1].y = 200; sim.players[0].dead = 99;
  const en = spawn(sim, 2, 200, 100);
  for (let i = 0; i < 20; i++) { sim.fireEnemy(en); const b = sim.ebullets.pop(); assert.ok(b.vy > 0, 'must head for the survivor below'); }
});

test('enemy bullets disappear only once completely off screen (their own size)', () => {
  const sim = field(mkE()); sim.player.x = 300; sim.player.y = 200;
  sim.ebullets.push({ x: -1.5, y: 100, w: 6, h: 6, vx: -1, vy: 0, spr: 'EB_RANDOM1', frames: 1, age: 0 });
  sim.updateBullets(); assert.equal(sim.ebullets.length, 1, 'x = -2.5: its right edge (x + 3) is still at +0.5');
  sim.updateBullets(); assert.equal(sim.ebullets.length, 0, 'x = -3.5: fully gone');
});

test('cluster (cmd 2) orbits a moving centre: radius 128 >> f9, start angle f10, turn speed f11 per frame', () => {
  const sim = field(mkE([ev({ cmd_id: 2, type: 0, y: 100, x_offset: 0, vx: -1, vy: 0, raw: raw({ 9: 1, 10: 64, 11: 2 }) })]));
  const en = sim.enemies[0], w = 20;
  assert.equal(en.x, W + w / 2 + (COS[64] >> 1)); assert.equal(en.y, 100 + (SIN[64] >> 1));      // start on the ring at angle 64
  const x0 = en.x, y0 = en.y; let ang = 64;
  for (let n = 1; n <= 30; n++) {
    sim.updateEnemies(); ang = (ang + 2) & 255;
    assert.equal(en.x, x0 - n + (COS[ang] >> 1) - (COS[64] >> 1)); assert.equal(en.y, y0 + (SIN[ang] >> 1) - (SIN[64] >> 1));
  }
  const hub = mkE([ev({ cmd_id: 2, type: 0, y: 100, vx: -1, raw: raw({ 9: 40, 10: 0, 11: 1 }) })]); start(hub);
  hub.player.inv = 99999; const h = hub.enemies[0], hx = h.x; run(hub, 10); assert.equal(h.x, hx - 10, 'f9 = 40 shifts the radius away: a hub that just drifts');
});

test('hover (cmd 3): flies in, stops once x < f9 for f13 x 25 frames, then flies on at its old speed', () => {
  const sim = field(mkE([ev({ cmd_id: 3, type: 0, y: 100, x_offset: 0, vx: -2, vy: 0, raw: raw({ 9: 250, 13: 2 }) })]));
  const en = sim.enemies[0]; const xs = [];
  for (let i = 0; i < 160; i++) { sim.updateEnemies(); xs.push(en.x); }
  const stopped = xs.map((x, i) => i > 0 && x === xs[i - 1]);
  const runLen = stopped.filter(Boolean).length;
  assert.ok(Math.abs(runLen - 49) <= 1, 'hover lasts f13 x 25 = 50 frames, got ' + runLen);
  assert.ok(xs.at(-1) < xs[stopped.indexOf(true)] - 20, 'then it leaves');
  assert.ok(Math.abs(xs[xs.length - 1] - xs[xs.length - 2] + 2) < 1e-9, 'at its original vx of -2');
});

test('dodge (cmd 4): jerks away vertically (speed 8, decaying) when a player\'s row is within 9 px; not near the screen edges', () => {
  const sim = field(mkE([ev({ cmd_id: 4, type: 0, y: 100, x_offset: -200, vx: -1, vy: 0, raw: raw() })]));
  const en = sim.enemies[0]; sim.player.y = 95;                              // player 5 px above the enemy
  sim.updateEnemies(); assert.equal(en.vy, 8, 'enemy below the player is pushed down');
  const before = en.y; sim.updateEnemies(); assert.equal(en.vy > 0 && en.vy < 8, true, 'decays by 1 per frame');
  assert.ok(en.y > before);
  const hi = field(mkE([ev({ cmd_id: 4, type: 0, y: 40, x_offset: -200, vx: -1, vy: 0, raw: raw() })])); hi.player.y = 45;
  hi.updateEnemies(); assert.equal(hi.enemies[0].vy, 0, 'no dodging upwards near the top (y <= 60)');
  const far = field(mkE([ev({ cmd_id: 4, type: 0, y: 100, x_offset: -200, vx: -1, vy: 0, raw: raw() })])); far.player.y = 150;
  far.updateEnemies(); assert.equal(far.enemies[0].vy, 0, 'player row 50 px away: nothing');
});

test('immunity mask: a weapon bit set means no damage from that weapon; 0xFF is immune to all', () => {
  const sim = field(mkE());
  const hits = (type) => { const out = {}; for (const src of ['gun', 'side', 'magma', 'missile', 'special', 'beam']) { const e = spawn(sim, type, 200, 100); out[src] = sim.hurt(e, 1, src); e.dead = true; } return out; };
  assert.deepEqual(hits(0), { gun: true, side: true, magma: true, missile: true, special: true, beam: true });
  assert.deepEqual(hits(4), { gun: true, side: true, magma: false, missile: true, special: true, beam: true }, 'octopus: immune to magma');
  assert.deepEqual(hits(5), { gun: true, side: false, magma: true, missile: true, special: true, beam: true }, 'barrel: immune to side shots');
  assert.deepEqual(hits(6), { gun: false, side: false, magma: false, missile: false, special: false, beam: false }, '0xFF: nothing hurts it');
  assert.deepEqual(hits(7), { gun: true, side: true, magma: true, missile: true, special: true, beam: true }, '0x40 only means "not a missile target"');
});

test('weapon damage numbers from the exe: gun 1 + plasma, side = level, magma 3 x level, missile 2, Hellriders 40, Fireworks 20', () => {
  const sim = field(mkE()); const p = sim.player;
  const dmgOf = (src) => sim.bullets.filter((b) => b.src === src).map((b) => b.dmg);
  p.wep.PLASMA = 2; p.wep.SIDE = 2; p.wep.MISSILE = 1; sim.volley(p);
  assert.deepEqual(dmgOf('gun'), [3]); assert.deepEqual(dmgOf('side'), [2, 2]); assert.deepEqual(dmgOf('missile'), [2]);
  sim.bullets = []; p.cd = 0; p.wep.MAGMA = 2; sim.volley(p); assert.deepEqual(dmgOf('magma'), [6]);
  sim.bullets = []; sim.newGame(1); sim.begin(); sim.player.inv = 99999; sim.useSpecial(sim.player); assert.deepEqual(dmgOf('hell'), [40, 40, 40, 40]);
  sim.newGame(2); sim.begin(); sim.player.inv = 99999;
  const weak = spawn(sim, 0, 100, 100), tough = spawn(sim, 0, 150, 100); weak.hp = 20; tough.hp = 21; sim.useSpecial(sim.player);
  assert.ok(weak.dead, 'fireworks deal exactly 20 to every enemy: hp 20 dies'); assert.equal(tough.hp, 1);
});

test('pickups drift left 1 px per frame and are placed inside y 20..220; bonus kinds above 3 drop nothing', () => {
  const sim = field(mkE()); sim.drop(1, 100, 5); sim.drop(2, 100, 400); sim.drop(3, 100, 120); sim.drop(4, 100, 120); sim.drop(9, 100, 120); sim.drop(0, 100, 120);
  assert.deepEqual(sim.pickups.map((q) => q.y), [20, 220, 120]); assert.equal(sim.pickups.length, 3);
  const x0 = sim.pickups[0].x; sim.pickups[0].x += 0; for (const q of sim.pickups) q.y = 300; run(sim, 10); assert.equal(sim.pickups[0].x, x0 - 10);
});

test('guardian paths advance f4 points per frame (so f4 = 2 moves twice as fast) and wrap at the end', () => {
  const GP = Array.from({ length: 10 }, (_, i) => [300 - i * 10, 0]);
  const run1 = (step) => { const sim = mk([ev({ cmd_id: 6, type: 1, y: 0, raw: raw({ 4: step, 6: 1, 14: 0, 15: 99 }), bonus: 99 }), ev({ t: 999, cmd_id: 9 })], { enemies: ENEMIES, sprites: SPR, paths: { GPAT_01: GP } });
    start(sim); sim.player.inv = 99999; const b = sim.enemies[0]; const xs = []; for (let i = 0; i < 8; i++) { sim.updateEnemies(); xs.push(b.x); } return xs; };
  assert.deepEqual(run1(1), [300, 290, 280, 270, 260, 250, 240, 230]);
  assert.deepEqual(run1(2), [300, 280, 260, 240, 220, 300, 280, 260], 'two points per frame, then wraps');
});
