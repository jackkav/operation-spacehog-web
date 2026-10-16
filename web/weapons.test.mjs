// Tests for pickups, the upgrade bar, weapons, specials and the death penalty. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SLOTS, BASE_MAX, CHARGE_MIN, W } from './sim.js';
import { enemy, ev, mk, start, run } from './testutil.mjs';

const named = (e, name) => ({ ...e, name });
const ENEMIES = [enemy(0, 3, 1, 50), enemy(1, 5, 9999, 0), named(enemy(2, 3, 4, 10), 'Meteor 1'), enemy(3, 3, 6, 70)];
const idle = (events = []) => mk([...events, ev({ t: 999, cmd_id: 9 })], { enemies: ENEMIES });
const field = (sim) => { start(sim); sim.player.inv = 99999; return sim; };
const pin = (en, x, y) => { en.vx = 0; en.vy = 0; en.x = x; en.y = y; return en; };
const spawnAt = (sim, type, x, y) => pin(sim.spawn(sim.defs.get(type), x, y, 0, 0), x, y);
const idx = (name) => SLOTS.indexOf(name) + 1;

test('tokens move the bar cursor; Select upgrades the highlighted slot once per press and resets the cursor', () => {
  const sim = field(idle());
  sim.collectToken(); sim.collectToken(); assert.equal(sim.bar, idx('GUN'));
  run(sim, 3, { select: true });                               // held for 3 frames = one press
  assert.equal(sim.w.GUN, 1); assert.equal(sim.bar, 0);
  sim.step({}); run(sim, 1, { select: true }); assert.equal(sim.w.GUN, 1, 'bar was empty, nothing to apply');
});

test('a slot stops at BASE_MAX; ADD-ON raises the cap for every weapon', () => {
  const sim = field(idle()); sim.w.GUN = BASE_MAX;
  sim.bar = idx('GUN'); run(sim, 1, { select: true }); assert.equal(sim.w.GUN, BASE_MAX);
  sim.step({}); sim.bar = idx('ADD-ON'); run(sim, 1, { select: true }); assert.equal(sim.w['ADD-ON'], 1);
  sim.step({}); sim.bar = idx('GUN'); run(sim, 1, { select: true }); assert.equal(sim.w.GUN, BASE_MAX + 1);
});

test('a token at the end of the bar gives LOCK; once locked, more specials', () => {
  const sim = field(idle());
  for (let i = 0; i < SLOTS.length; i++) sim.collectToken();
  assert.equal(sim.bar, SLOTS.length); assert.equal(sim.lock, false);
  sim.collectToken(); assert.equal(sim.lock, true); assert.equal(sim.specials, 1);
  sim.collectToken(); assert.equal(sim.specials, 2);
});

test('dying costs one speed and drops two weapons one step; LOCK prevents that once', () => {
  const sim = field(idle()); Object.assign(sim.w, { SPEED: 2, GUN: 2, MAGMA: 1, OPTION: 3 });
  sim.lock = true; sim.killPlayer();
  assert.deepEqual([sim.w.SPEED, sim.w.GUN, sim.w.MAGMA, sim.w.OPTION], [2, 2, 1, 3]); assert.equal(sim.lock, false);
  sim.player.dead = 0; sim.killPlayer();
  const lost = (2 - sim.w.GUN) + (1 - sim.w.MAGMA) + (3 - sim.w.OPTION);
  assert.equal(sim.w.SPEED, 1); assert.equal(lost, 2, 'exactly two weapon levels lost');
  sim.player.dead = 0; Object.assign(sim.w, { SPEED: 0, GUN: 0, MAGMA: 0, OPTION: 0 }); sim.killPlayer();
  assert.deepEqual(Object.values(sim.w).every((v) => v === 0), true, 'cannot go below zero');
});

test('wiping out a whole formation drops a token at the last kill; one escapee cancels it', () => {
  const formation = ev({ cmd_id: 1, type: 3, path: 1, count: 3, interval: 1, y: 60, bonus: 1 });
  let sim = field(idle([formation])); run(sim, 4);
  assert.equal(sim.enemies.length, 3); sim.pickups.length = 0;
  const last = sim.enemies.at(-1); const where = { x: last.x, y: last.y };
  for (const en of sim.enemies.slice()) sim.killEnemy(en);
  sim.enemies = []; run(sim, 1);
  assert.equal(sim.pickups.length, 1); assert.equal(sim.pickups[0].kind, 'P'); assert.ok(Math.abs(sim.pickups[0].y - where.y) < 1);

  sim = field(idle([formation])); run(sim, 4);
  const [a, b] = sim.enemies; sim.killEnemy(a); sim.killEnemy(b);
  run(sim, 200);                                                  // the third ship flies off the end of its path
  assert.equal(sim.pickups.length, 0);
});

test('bonus codes on single enemies: 1 = P token, 2 = special, 3 = extra ship, 99 = nothing; pickups work on contact', () => {
  const sim = field(idle());
  const kill = (bonus) => {                                          // go through the real script path
    sim.exec(ev({ type: 0, bonus, x_offset: -300 }));
    const en = pin(sim.enemies.at(-1), 200, 30); sim.killEnemy(en); sim.enemies = [];
  };
  kill(0); kill(99); assert.equal(sim.pickups.length, 0);
  kill(1); kill(2); kill(3); assert.deepEqual(sim.pickups.map((p) => p.kind), ['P', 'S', '1UP']);
  for (const pk of sim.pickups) { pk.x = sim.player.x; pk.y = sim.player.y; pk.vx = 0; }
  const lives = sim.lives; run(sim, 1);
  assert.equal(sim.pickups.length, 0); assert.equal(sim.bar, 1); assert.equal(sim.specials, 2); assert.equal(sim.lives, lives + 1);
});

test('meteors shrug off the plain gun but die to magma, missiles and special attacks; obstacles never die', () => {
  const sim = field(idle()); sim.player.y = 100;
  const rock = spawnAt(sim, 2, 150, 100);
  run(sim, 120, { fire: true }); assert.equal(rock.hp, 4, 'gun does nothing to a meteor');
  sim.w.MAGMA = 1; run(sim, 120, { fire: true }); assert.equal(rock.dead, true);
  const m2 = spawnAt(sim, 2, 150, 100); sim.w.MAGMA = 0; sim.w.MISSILE = 1; run(sim, 200, { fire: true }); assert.equal(m2.dead, true);
  const wall = spawnAt(sim, 1, 150, 100); sim.w.MAGMA = 3; run(sim, 100, { fire: true }); assert.equal(wall.hp, 9999);
});

test('GUN adds fire sources, PLASMA adds damage, MAGMA pierces through a line of enemies', () => {
  const sim = field(idle());
  sim.volley(); assert.equal(sim.bullets.length, 1); sim.bullets = []; sim.player.cd = 0;
  sim.w.GUN = 2; sim.volley(); assert.equal(sim.bullets.length, 3); sim.bullets = []; sim.player.cd = 0;
  sim.w.PLASMA = 2; sim.volley(); assert.equal(sim.bullets[0].dmg, 3);
  const s2 = field(idle()); s2.player.y = 100; s2.w.MAGMA = 1;
  const a = spawnAt(s2, 3, 120, 100), b = spawnAt(s2, 3, 200, 100);
  const hp = a.hp; s2.volley(); run(s2, 40);
  assert.ok(a.hp < hp && b.hp < hp, 'one magma shot hurt both');
});

test('OPTION pods fire extra shots and absorb enemy bullets', () => {
  const sim = field(idle()); sim.w.OPTION = 1; run(sim, 30);
  sim.volley(); assert.equal(sim.bullets.length, 2);
  const o = sim.optionPos(0); sim.ebullets.push({ x: o.x, y: o.y, w: 6, h: 6, vx: 0, vy: 0 });
  run(sim, 1); assert.equal(sim.ebullets.length, 0);
});

test('BUILDUP: tapping fires a normal volley, holding charges, releasing a full charge fires a beam that hits everything in the row', () => {
  const sim = field(idle()); sim.w.BUILDUP = 1; sim.player.y = 100;
  const foe = spawnAt(sim, 3, 250, 100), off = spawnAt(sim, 3, 250, 180);
  run(sim, CHARGE_MIN - 5, { fire: true });
  assert.equal(sim.beams.length, 0); assert.equal(sim.bullets.filter((b) => b.src === 'gun').length >= 1, true);
  run(sim, 1, {}); assert.equal(sim.beams.length, 0, 'released too early');
  run(sim, CHARGE_MIN + 1, { fire: true }); run(sim, 1, {});
  assert.equal(sim.beams.length, 1); run(sim, 5);
  assert.ok(foe.hp < 6 || foe.dead); assert.equal(off.hp, 6, 'enemy outside the beam row is untouched');
});

test('missiles home in on enemies off the ship\'s line of fire', () => {
  const sim = field(idle()); sim.player.y = 150; sim.w.MISSILE = 1;
  const foe = spawnAt(sim, 3, 220, 40);
  sim.volley(); run(sim, 120);
  assert.ok(foe.dead || foe.hp < 6, 'missile found the target');
});

test('craft specials: FIREWORKS hurts everything on screen and clears enemy fire; HELLRIDERS homes; BERSERK triples damage; none left = nothing', () => {
  let sim = mk([ev({ t: 999, cmd_id: 9 })], { enemies: ENEMIES }); sim.newGame(2); sim.begin(); sim.player.inv = 99999;
  const a = spawnAt(sim, 3, 150, 60), b = spawnAt(sim, 3, 250, 180); sim.ebullets.push({ x: 100, y: 100, w: 6, h: 6, vx: 0, vy: 0 });
  run(sim, 1, { special: true });
  assert.ok(a.dead && b.dead); assert.equal(sim.ebullets.length, 0); assert.equal(sim.specials, 0);
  const before = sim.score; run(sim, 2); run(sim, 1, { special: true }); assert.equal(sim.specials, 0); assert.equal(sim.score, before);

  sim = mk([ev({ t: 999, cmd_id: 9 })], { enemies: ENEMIES }); sim.newGame(1); sim.begin(); sim.player.inv = 99999; sim.player.y = 160;
  const t = spawnAt(sim, 3, 250, 40); run(sim, 1, { special: true }); run(sim, 150); assert.ok(t.dead, 'hellriders found the target');

  sim = mk([ev({ t: 999, cmd_id: 9 })], { enemies: ENEMIES }); sim.newGame(0); sim.begin(); sim.player.inv = 99999;
  run(sim, 1, { special: true }); assert.ok(sim.berserk > 0); sim.player.cd = 0; sim.volley(); assert.equal(sim.bullets.at(-1).dmg, 3);
});
