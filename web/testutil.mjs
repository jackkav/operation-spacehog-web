// Shared helpers for the simulation tests (synthetic data only).
import { Sim } from './sim.js';

export const sprites = [['SHIP1', 25, 10], ['SHIP2', 19, 15], ['SHIP3', 20, 15], ['FOE', 20, 10], ['FOE2', 20, 10], ['ROCK', 20, 10]]
  .map(([name, w, h]) => ({ name, w, h }));
export const enemy = (type, sprite_index, hp, score, extra = {}) => ({ type, name: 'e' + type, sprite_index, hp, score, fields: extra });
export const ev = (o) => ({ t: 0, cmd_id: 0, type: 0, y: 100, x_offset: 0, vx: -1, vy: 0, ...o });
export const mk = (events, extra = {}) => new Sim({
  enemies: [enemy(0, 3, 1, 50), enemy(1, 5, 9999, 0, { '0x5c': -1 }), enemy(2, 3, 2, 100, { '0x28': 1 })],   // type 1: immune to every weapon (mask 0xFF)
  sprites, bgs: [{ name: 'BG01', w: 40, h: 30 }], sounds: [],
  paths: { PAT_01: [[350, 0], [349, 5], ...Array.from({ length: 60 }, (_, i) => [348 - i * 6, 10])] },   // same [x, y] shape as game.json
  levels: [{ name: 'T', briefing: '', events }], ...extra,
});
export const start = (sim) => { sim.newGame(0); sim.begin(); };
export const run = (sim, frames, inp = {}) => { for (let i = 0; i < frames; i++) sim.step(inp); };

