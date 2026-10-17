// Run: node --test web/sim.test.mjs      (synthetic data only, no game assets needed)
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAMES_PER_TICK, SCROLL_DRIFT, END_DELAY, W } from './sim.js';

import { sprites, enemy, ev, mk, start, run } from './testutil.mjs';

test('events fire when the level timer reaches their time (80 frames per tick)', () => {
  const sim = mk([ev({ t: 2 }), ev({ t: 3, cmd_id: 9 })]); start(sim);
  run(sim, 2 * FRAMES_PER_TICK - 1); assert.equal(sim.enemies.length, 0);
  run(sim, 1); assert.equal(sim.enemies.length, 1);
});

test('a plain spawn is centred just off the right edge: x = 320 + width / 2 + x_offset', () => {
  const sim = mk([ev({ x_offset: 7 }), ev({ t: 1, cmd_id: 9 })]); start(sim);
  const e = sim.enemies[0];
  assert.equal(e.x, W + 10 + 7); assert.equal(e.y, 100);
  run(sim, 5); assert.equal(sim.enemies[0].x, W + 17 - 5);          // vx = -1
});

test('formation emitter spawns `count` ships `interval` frames apart and ships follow the path one point per frame', () => {
  const sim = mk([ev({ cmd_id: 1, path: 1, count: 3, interval: 10, y: 60 }), ev({ t: 50, cmd_id: 9 })]); start(sim);
  run(sim, 10); assert.equal(sim.enemies.length, 1);
  assert.deepEqual([sim.enemies[0].x, sim.enemies[0].y], [350, 60]);      // path[0] at spawn
  run(sim, 1); assert.deepEqual([sim.enemies[0].x, sim.enemies[0].y], [349, 65]);
  run(sim, 19); assert.equal(sim.emitters.length, 0, 'emitter is done after `count` ships');
  assert.equal(sim.enemies.length, 3);
  run(sim, 100); assert.equal(sim.enemies.length, 0, 'ships leave when the path ends');
});

test('player bullets use enemy hp; kills add score; hp 9999 is indestructible', () => {
  const sim = mk([ev({ type: 2, x_offset: -250 }), ev({ type: 1, y: 160, x_offset: -250, vx: 0 }), ev({ t: 5, cmd_id: 9 })]); start(sim);
  sim.player.x = 20; sim.player.y = 100; sim.player.inv = 9999;
  const [two, rock] = sim.enemies; two.vx = 0; rock.vx = 0;
  two.x = 150; two.y = 100; rock.x = 150; rock.y = 160;
  run(sim, 12, { fire: true });
  assert.equal(sim.enemies.includes(two), true, 'hp 2 enemy needs two hits');
  run(sim, 60, { fire: true });
  assert.equal(sim.enemies.includes(two), false); assert.equal(sim.score, 100);
  sim.player.y = 160; run(sim, 80, { fire: true });
  assert.equal(sim.enemies.includes(rock), true); assert.equal(sim.score, 100);
});

test('touching an enemy costs a life, then invulnerability; no lives left -> game over', () => {
  const sim = mk([ev({ type: 1, x_offset: -300, vx: 0 }), ev({ t: 99, cmd_id: 9 })]); start(sim);
  sim.enemies[0].vx = 0;                                   // pin the obstacle (plain vx = 0 spawns drift)
  sim.player.inv = 0; sim.enemies[0].x = sim.player.x; sim.enemies[0].y = sim.player.y;
  run(sim, 1); assert.equal(sim.lives, 2);
  run(sim, 200); assert.equal(sim.lives, 2, 'respawn is invulnerable');
  sim.lives = 0; sim.player.inv = 0; sim.player.dead = 0; sim.enemies[0].x = sim.player.x; sim.enemies[0].y = sim.player.y;
  run(sim, 120); assert.equal(sim.state, 'gameover');
});

test('the first end marker ends the level after a short delay, even with enemies still on screen; the last level -> won', () => {
  const sim = mk([ev({ x_offset: -300 }), ev({ t: 1, cmd_id: 9 }), ev({ t: 2, cmd_id: 0, type: 0 })]); start(sim);
  sim.enemies[0].x = 5; sim.enemies[0].vx = 0;                                 // an enemy lingers on screen
  run(sim, FRAMES_PER_TICK); assert.equal(sim.finishedFlag, true); assert.equal(sim.state, 'playing', 'still in the exit delay');
  run(sim, END_DELAY + 2); assert.equal(sim.state, 'won');
});

test('ship stays inside the play field', () => {
  const sim = mk([ev({ t: 99, cmd_id: 9 })]); start(sim);
  run(sim, 400, { left: true, up: true });
  assert.equal(sim.player.x, sim.player.w / 2); assert.equal(sim.player.y, sim.player.h / 2);
  run(sim, 800, { right: true, down: true });
  assert.equal(sim.player.x, W - sim.player.w / 2); assert.equal(sim.player.y, 229 - sim.player.h / 2);
});

test('enemy animation cycles through its extra frames', () => {
  const sim = mk([ev({ type: 2, x_offset: -300, vx: 0 }), ev({ t: 5, cmd_id: 9 })]); start(sim);
  const e = sim.enemies[0]; assert.equal(e.frames, 2);
  run(sim, 6); assert.equal(e.frame, 1); run(sim, 6); assert.equal(e.frame, 0);
});

test('stationary (vx = vy = 0) enemies drift with the scroll so they cannot block level completion', () => {
  const sim = mk([ev({ vx: 0, vy: 0 }), ev({ t: 1, cmd_id: 9 })]); start(sim);
  const x0 = sim.enemies[0].x; run(sim, 10);
  assert.ok(Math.abs(sim.enemies[0].x - (x0 - 10 * SCROLL_DRIFT)) < 1e-9);
  run(sim, 800); assert.equal(sim.state, 'won');
});

test('touch target movement: closes on the target at the ship speed per axis, stops there, stays in bounds, and speed upgrades help', () => {
  const sim = mk([ev({ t: 99, cmd_id: 9 })]); start(sim); const p = sim.player; p.x = 100; p.y = 100;
  const speed = sim.ship.speed;
  sim.step({ tx: 200, ty: 100 }); assert.equal(p.x, 100 + speed); assert.equal(p.y, 100);
  sim.step({ tx: 200, ty: 130 }); assert.equal(p.y, 100 + speed, 'vertical limited too');
  run(sim, 200, { tx: 150, ty: 60 }); assert.deepEqual([p.x, p.y], [150, 60], 'lands exactly on the target and stays');
  run(sim, 400, { tx: -50, ty: 999 }); assert.equal(p.x, p.w / 2); assert.equal(p.y, 229 - p.h / 2);
  const fast = mk([ev({ t: 99, cmd_id: 9 })]); start(fast); fast.player.x = 100; fast.player.y = 100; fast.player.wep.SPEED = 3;
  fast.step({ tx: 300, ty: 100 }); assert.ok(fast.player.x - 100 > speed, 'SPEED upgrade raises the cap');
  sim.player.x = 50; sim.step({ tx: undefined, left: true }); assert.equal(p.x, 50 - speed, 'no target: keys still work');
});

test('two players can use targets and keys at once', () => {
  const sim = mk([ev({ t: 99, cmd_id: 9 })]); sim.newGame(0, 1); sim.begin();
  const [a, b] = sim.players; a.x = 100; a.y = 100; b.x = 100; b.y = 150;
  sim.step([{ tx: 160, ty: 100 }, { right: true }]);
  assert.equal(a.x, 100 + a.ship.speed); assert.equal(b.x, 100 + b.ship.speed);
});
