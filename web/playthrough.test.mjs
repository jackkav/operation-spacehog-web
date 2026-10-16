// End-to-end smoke test: simple bots play all six real levels from the original zip at NORMAL difficulty (enemy hp x3),
// collecting pickups and activating upgrades; once with one player, once co-op with two. The bots are invulnerable (they do not dodge).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadGame } from './loader.js';
import { Sim, SLOTS } from './sim.js';

const zip = fs.readFileSync(fileURLToPath(new URL('spacehog.zip', import.meta.url)));

function bot(sim, p, f) {                          // chase the nearest target / pickup, fire in bursts, upgrade when the bar has moved
  let tgt = null, grab = null;
  for (const e of sim.enemies) if (e.hp < 9000 && !e.meteor && !e.decor && e.x > p.x && (!tgt || e.x < tgt.x)) tgt = e;
  for (const pk of sim.pickups) if (!grab || pk.x < grab.x) grab = pk;
  const ty = grab && grab.x > p.x ? grab.y : tgt ? tgt.y : 115 + (p.i ? 30 : -30);
  return { fire: f % 8 < 4, up: ty < p.y - 3, down: ty > p.y + 3, right: !!grab && grab.x > p.x + 4, select: p.bar >= 2 && f % 2 === 0, special: p.specials > 1 && f % 300 === 0 };
}

async function playAll(nPlayers) {
  const g = await loadGame(zip);
  const sim = new Sim(g.data); sim.difficulty = 3;
  sim.newGame(1, nPlayers === 2 ? 2 : null);
  let tokens = 0, upgrades = 0; const bossLevels = [];
  const total = (p) => p.wep.GUN + p.wep.PLASMA + p.wep.MISSILE + p.wep.OPTION;
  for (let L = 0; L < 6; L++) {
    sim.begin();
    for (let f = 0; sim.state === 'playing' && f < 40000; f++) {
      if (sim.bossStatus() && !bossLevels.includes(L + 1)) bossLevels.push(L + 1);
      const before = sim.players.map((p) => [p.bar, total(p)]);
      sim.step(sim.players.map((p) => bot(sim, p, f)));
      sim.players.forEach((p, i) => { if (p.bar > before[i][0]) tokens++; if (total(p) > before[i][1]) upgrades++; });
      for (const p of sim.players) p.inv = Math.max(p.inv, 5);                    // bots never dodge: this tests progression, not skill (death/respawn have unit tests)
    }
    assert.ok(['levelclear', 'won'].includes(sim.state), `${nPlayers}P: level ${L + 1} ended in state ${sim.state}`);
    if (sim.state === 'levelclear') sim.nextLevel();
  }
  return { sim, tokens, upgrades, bossLevels };
}

test('1 player: a bot plays every level of the real game at normal difficulty, beats both guardians, and uses pickups/upgrades', async () => {
  const { sim, tokens, upgrades, bossLevels } = await playAll(1);
  assert.equal(sim.state, 'won'); assert.deepEqual(bossLevels, [3, 6]);
  assert.ok(tokens > 5, 'power tokens collected: ' + tokens); assert.ok(upgrades >= 3, 'upgrades activated: ' + upgrades);
  assert.ok(sim.score > 10000 && SLOTS.every((s) => sim.w[s] >= 0));
});

test('2 players: two bots clear the whole game together and both score', async () => {
  const { sim, bossLevels } = await playAll(2);
  assert.equal(sim.state, 'won'); assert.deepEqual(bossLevels, [3, 6]);
  assert.ok(sim.players.every((p) => p.score > 1000), 'scores: ' + sim.players.map((p) => p.score));
});
