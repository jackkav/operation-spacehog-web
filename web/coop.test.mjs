// Two-player co-op, difficulty scaling and the practice/easy level shortcut. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { START_POS, SLOTS } from './sim.js';
import { enemy, ev, mk, run } from './testutil.mjs';

const ENEMIES = [enemy(0, 3, 4, 100), enemy(1, 5, 9999, 0)];
const level = (events) => ({ name: 'T', briefing: '', events: [...events, ev({ t: 999, cmd_id: 9 })] });
const two = (events = [], extra = {}) => {
  const sim = mk([], { enemies: ENEMIES, levels: [level(events)], ...extra });
  sim.newGame(0, 2); sim.begin(); for (const p of sim.players) p.inv = 99999; return sim;
};
const spawnAt = (sim, x, y, type = 0) => { const en = sim.spawn(sim.defs.get(type), x, y, 0, 0); en.vx = 0; en.x = x; en.y = y; return en; };
const [P1, P2] = [0, 1];

test('two players: separate ships, start positions, lives, scores and weapons', () => {
  const sim = two();
  assert.equal(sim.players.length, 2);
  assert.deepEqual(sim.players.map((p) => [p.x, p.y]), [START_POS[1], START_POS[2]]);
  assert.deepEqual(sim.players.map((p) => p.ship.name), ['VIPER', 'BULLDOG']);
  sim.players[P2].wep.GUN = 2; assert.equal(sim.players[P1].wep.GUN, 0);
  assert.deepEqual(sim.players.map((p) => p.lives), [3, 3]);
});

test('input array drives each player independently', () => {
  const sim = two(); const [a, b] = sim.players; const y0 = [a.y, b.y];
  run(sim, 10, [{ up: true }, { down: true }]);
  assert.ok(a.y < y0[0]); assert.ok(b.y > y0[1]);
  run(sim, 1, [{ fire: true }, {}]); assert.ok(sim.bullets.every((bl) => bl.own === a));
});

test('a kill is credited to the player whose shot made it', () => {
  const sim = two(); const [a, b] = sim.players;
  const foe = spawnAt(sim, 200, b.y); b.y = foe.y;
  run(sim, 120, [{}, { fire: true }]);
  assert.ok(foe.dead); assert.equal(b.score, 100); assert.equal(a.score, 0);
});

test('pickups go to whoever touches them; bars are per player', () => {
  const sim = two(); const [a, b] = sim.players;
  sim.drop(1, b.x, b.y); sim.pickups[0].vx = 0; run(sim, 1, [{}, {}]);
  assert.equal(b.bar, 1); assert.equal(a.bar, 0);
  sim.drop(1, a.x, a.y); sim.pickups[0].vx = 0; run(sim, 1, [{}, {}]);
  assert.equal(a.bar, 1); assert.equal(b.bar, 1);
});

test('dying only costs the dead player their weapons', () => {
  const sim = two(); const [a, b] = sim.players; a.wep.GUN = 2; b.wep.GUN = 2;
  sim.killPlayer(a); assert.equal(a.lives, 2); assert.equal(b.lives, 3);
  assert.ok(a.wep.GUN < 2); assert.equal(b.wep.GUN, 2);
});

test('enemy aimed fire targets the nearest living player', () => {
  const sim = two(); const [a, b] = sim.players; a.x = 40; a.y = 30; b.x = 40; b.y = 200;
  assert.equal(sim.target(200, 190), b); assert.equal(sim.target(200, 20), a);
  b.dead = 50; assert.equal(sim.target(200, 190), a, 'a dead player is not targeted');
});

test('the game continues while one player lives; game over only when both are out', () => {
  const sim = two(); const [a, b] = sim.players;
  a.lives = 1; sim.killPlayer(a); b.lives = 3;
  run(sim, 100, [{}, {}]); assert.equal(a.out, true); assert.equal(sim.state, 'playing');
  b.lives = 1; b.inv = 0; sim.killPlayer(b); run(sim, 100, [{}, {}]); assert.equal(sim.state, 'gameover');
});

test('an out player can take a ship from a partner who has more than one', () => {
  const sim = two(); const [a, b] = sim.players;
  b.lives = 0; b.dead = 1; run(sim, 3, [{}, {}]); assert.equal(b.out, true);
  a.lives = 1; run(sim, 1, [{}, { special: true }]); assert.equal(b.out, true, 'donor needs a spare ship');
  run(sim, 2, [{}, {}]); a.lives = 3; run(sim, 1, [{}, { special: true }]);
  assert.equal(b.out, false); assert.equal(b.lives, 1); assert.equal(a.lives, 2); assert.ok(b.inv > 0);
});

test('difficulty scales enemy hp by the setting and score by setting / 2; 0 means raw table values', () => {
  const raw = two(); const e0 = spawnAt(raw, 200, 100); raw.killEnemy(e0);
  assert.equal(e0.hp, 4); assert.equal(raw.players[P1].score, 100);
  for (const [d, hp, score] of [[1, 4, 50], [3, 12, 150], [6, 24, 300]]) {
    const sim = two(); sim.difficulty = d; const e = spawnAt(sim, 200, 100); assert.equal(e.hp, hp, 'hp at difficulty ' + d);
    sim.killEnemy(e); assert.equal(sim.players[P1].score, score, 'score at difficulty ' + d);
  }
});

test('practice and easy (<= 2) stop after level 3 and jump to the final level; normal continues in order', () => {
  const levels = Array.from({ length: 6 }, (_, i) => ({ name: 'L' + (i + 1), briefing: '', events: [ev({ t: 0, cmd_id: 9 })] }));
  const go = (difficulty, from) => {
    const sim = mk([], { enemies: ENEMIES, levels }); sim.difficulty = difficulty; sim.newGame(0); sim.loadLevel(from);
    sim.state = 'levelclear'; sim.nextLevel(); return sim.level.name;
  };
  assert.equal(go(1, 2), 'L6'); assert.equal(go(2, 2), 'L6');
  assert.equal(go(3, 2), 'L4'); assert.equal(go(0, 2), 'L4');
  assert.equal(go(1, 0), 'L2', 'only the third level jumps');
});

test('single-player accessors still refer to player 1', () => {
  const sim = mk([], { enemies: ENEMIES, levels: [level([])] }); sim.newGame(1);
  sim.score = 5; sim.lives = 2; sim.bar = 3; sim.lock = true; sim.specials = 4;
  const p = sim.players[0]; assert.deepEqual([p.score, p.lives, p.bar, p.lock, p.specials], [5, 2, 3, true, 4]);
  assert.equal(sim.w, p.wep); assert.equal(sim.player, p); assert.equal(SLOTS.length, 9);
});
