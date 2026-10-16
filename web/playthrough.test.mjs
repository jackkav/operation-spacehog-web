// End-to-end smoke test: a simple bot plays all six real levels from the original zip, collecting pickups and activating upgrades.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadGame } from './loader.js';
import { Sim, SLOTS } from './sim.js';

test('a bot can play every level of the real game to the end, and pickups/upgrades are exercised', async () => {
  const g = await loadGame(fs.readFileSync(fileURLToPath(new URL('spacehog.zip', import.meta.url))));
  const sim = new Sim(g.data); sim.newGame(1);
  let tokens = 0, upgrades = 0, frames = 0;
  for (let L = 0; L < 6; L++) {
    sim.begin();
    for (let f = 0; sim.state === 'playing' && f < 30000; f++, frames++) {
      const p = sim.player; let tgt = null, grab = null;
      for (const e of sim.enemies) if (e.hp < 9000 && !e.meteor && e.x > p.x && (!tgt || e.x < tgt.x)) tgt = e;
      for (const pk of sim.pickups) if (!grab || pk.x < grab.x) grab = pk;
      const ty = grab && grab.x > p.x ? grab.y : tgt ? tgt.y : 115;
      const before = [sim.bar, sim.w.GUN + sim.w.PLASMA + sim.w.MISSILE + sim.w.OPTION];
      sim.step({ fire: f % 8 < 4, up: ty < p.y - 3, down: ty > p.y + 3, right: !!grab && grab.x > p.x + 4, select: sim.bar >= 2 && f % 2 === 0, special: sim.specials > 1 && f % 300 === 0 });
      if (sim.bar > before[0]) tokens++;
      if (sim.w.GUN + sim.w.PLASMA + sim.w.MISSILE + sim.w.OPTION > before[1]) upgrades++;
      if (sim.lives <= 0 && sim.state === 'playing') sim.lives = 3;           // keep the bot alive: we test progression, not skill
    }
    assert.ok(['levelclear', 'won'].includes(sim.state), `level ${L + 1} ended in state ${sim.state}`);
    if (sim.state === 'levelclear') sim.nextLevel();
  }
  assert.equal(sim.state, 'won');
  assert.ok(tokens > 5, 'bot collected power tokens: ' + tokens);
  assert.ok(upgrades > 3, 'bot activated upgrades: ' + upgrades);
  assert.ok(SLOTS.every((s) => sim.w[s] >= 0));
});
