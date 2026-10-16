// Game simulation for the Operation Spacehog web port. No DOM here: main.js renders and feeds input.
// Behaviour is reconstructed from the original data files, the README and SH.EXE (see ../NOTES.md); anything approximated
// is marked "approx".

export const W = 320, H = 240, PLAY_H = 229;
export const FRAMES_PER_TICK = 80;        // one level-script tick = 80 game frames (from the exe's main loop)
export const SCROLL_DRIFT = 0.7;          // approx: world scroll speed for vx = 0 enemies / near scenery

export const SLOTS = ['SPEED', 'GUN', 'SIDE', 'BUILDUP', 'MISSILE', 'PLASMA', 'MAGMA', 'OPTION', 'ADD-ON'];   // toolbar order
export const BASE_MAX = 3, SPEED_MAX = 5, ADDON_MAX = 3;
export const CHARGE_MIN = 25;             // frames of holding fire before a release fires the BUILDUP beam
export const BULLET_SPRITES = ['EB_RANDOM1', 'EB_RANDOM2', 'EB_RANDOM3', 'EB_RANDOM4', 'EB_LEFT'];   // enemy bullet type 0-4

// Guardian attack patterns. approx / designed: the original's boss AI is not decoded, so these are phase-based attacks driven by
// the boss's remaining health (a phase applies while hp / maxHp >= minHp). `from` is an offset from the boss centre (bosses face
// left, so their front is -x). kinds: fan = n aimed bullets spread over `spread` rad, ring = n bullets all round (slowly rotating),
// spiral = one bullet every `every` frames on a rotating arm set.
export const BOSS_PATTERNS = {
  Freighter: { phases: [                                    // level 3: slow convoy ship, gets nastier as it is chipped down
    { minHp: 0.66, attacks: [] },
    { minHp: 0.33, attacks: [{ kind: 'fan', every: 140, n: 5, spread: 0.7, speed: 2.0, from: [-150, 0], spr: 1 }] },
    { minHp: 0, attacks: [{ kind: 'fan', every: 110, n: 7, spread: 0.9, speed: 2.2, from: [-150, 0], spr: 1 },
                          { kind: 'ring', every: 170, n: 12, speed: 1.5, from: [0, 0], spr: 2 }] },
  ] },
  hitarea: { phases: [                                      // level 6: Octo (parent is the invisible hit area)
    { minHp: 0.66, attacks: [{ kind: 'fan', every: 150, n: 3, spread: 0.5, speed: 2.0, from: [20, 14], spr: 3 }] },
    { minHp: 0.33, attacks: [{ kind: 'fan', every: 110, n: 5, spread: 0.8, speed: 2.2, from: [20, 14], spr: 3 },
                             { kind: 'ring', every: 200, n: 10, speed: 1.6, from: [20, 14], spr: 2 }] },
    { minHp: 0, attacks: [{ kind: 'spiral', every: 6, arms: 3, step: 0.35, speed: 1.8, from: [20, 14], spr: 0 },
                          { kind: 'fan', every: 90, n: 5, spread: 0.9, speed: 2.4, from: [20, 14], spr: 3 }] },
  ] },
};
export const MAX_ENEMY_BULLETS = 160;

export const DIFFICULTIES = ['PRACTICE', 'EASY', 'NORMAL', 'TOUGH', 'HARD', 'INSANE'];   // names from SH.EXE; setting n+1 = hp multiplier
export const START_POS = [[40, 115], [40, 85], [40, 145]];                                 // start position, by player count then index

export const SHIPS = [                      // README: Viper = fast/agile, Albatross = all-round, Bulldog = heavy
  { name: 'VIPER', sprite: 'SHIP1', speed: 3.0, cooldown: 8, special: 'BERSERK' },
  { name: 'ALBATROSS', sprite: 'SHIP2', speed: 2.4, cooldown: 9, special: 'HELLRIDERS' },
  { name: 'BULLDOG', sprite: 'SHIP3', speed: 2.0, cooldown: 10, special: 'FIREWORKS' },
];

const rectsHit = (a, b, shrink = 2) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w - shrink * 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h - shrink * 2;

const alive = (p) => !p.out && p.dead === 0;

export class Sim {
  constructor(data) {
    this.data = data;
    this.defs = new Map(data.enemies.map(e => [e.type, e]));
    this.sprites = data.sprites;
    this.paths = Object.fromEntries(Object.entries(data.paths).map(([k, v]) => [k, v.map(([x, y]) => ({ x, y }))]));
    this.spriteIndex = new Map(data.sprites.map((s, i) => [s.name, i]));
    this.state = 'title';                   // title | briefing | playing | levelclear | gameover | won
    this.levelNo = 0;
    // difficulty 0 = raw table values; 1..6 = PRACTICE..INSANE: the exe multiplies enemy hp by the setting and score by setting / 2,
    // and practice/easy (<= 2) stop after level 3 and jump to the final level (README: "practice and easy hold only 3 levels")
    this.difficulty = 0;
    this.flash = 0; this.sfx = []; this.rng = 12345;
    this.players = [this.makePlayer(0, 1, 1)];
  }

  // single-player accessors keep the original API: they all refer to player 1
  get player() { return this.players[0]; }
  get ship() { return this.players[0].ship; }
  get w() { return this.players[0].wep; }
  get score() { return this.players[0].score; } set score(v) { this.players[0].score = v; }
  get lives() { return this.players[0].lives; } set lives(v) { this.players[0].lives = v; }
  get bar() { return this.players[0].bar; } set bar(v) { this.players[0].bar = v; }
  get lock() { return this.players[0].lock; } set lock(v) { this.players[0].lock = v; }
  get specials() { return this.players[0].specials; } set specials(v) { this.players[0].specials = v; }
  get berserk() { return this.players[0].berserk; } set berserk(v) { this.players[0].berserk = v; }

  rand() { this.rng = (this.rng * 1103515245 + 12345) & 0x7fffffff; return this.rng / 0x7fffffff; }
  size(name) { const s = this.sprites[this.spriteIndex.get(name)]; return s ? [s.w, s.h] : [8, 8]; }
  hpMul() { return this.difficulty || 1; }
  scoreMul() { return this.difficulty ? this.difficulty / 2 : 1; }

  makePlayer(i, shipNo, count) {
    const ship = SHIPS[shipNo], [pw, ph] = this.size(ship.sprite), [x, y] = START_POS[count === 1 ? 0 : i + 1];
    return {
      i, ship, x, y, w: pw, h: ph, cd: 0, inv: 90, dead: 0, charge: 0, out: false, lives: 3, score: 0,
      wep: Object.fromEntries(SLOTS.map(s => [s, 0])),       // upgrade level per toolbar slot
      bar: 0,                                                // highlighted slot: 0 = none, 1..9 = SLOTS[bar - 1]
      lock: false, specials: 1, berserk: 0, trail: [], missileCd: 0, prev: { fire: false, select: false, special: false },
    };
  }

  maxLevel(slot, p = this.players[0]) { return slot === 'SPEED' ? SPEED_MAX : slot === 'ADD-ON' ? ADDON_MAX : BASE_MAX + p.wep['ADD-ON']; }

  newGame(shipNo, ship2 = null) {
    const count = ship2 === null ? 1 : 2;
    this.players = [this.makePlayer(0, shipNo, count)];
    if (count === 2) this.players.push(this.makePlayer(1, ship2, 2));
    this.levelNo = 0; this.flash = 0;
    this.loadLevel(0);
  }

  loadLevel(n) {
    this.levelNo = n;
    this.level = this.data.levels[n];
    this.frame = 0; this.levelTime = 0; this.evIdx = 0; this.finishedFlag = false;
    this.enemies = []; this.bullets = []; this.ebullets = []; this.fx = []; this.scenery = []; this.emitters = [];
    this.pickups = []; this.beams = []; this.groups = new Set(); this.parent = null;
    this.players.forEach((p, i) => {
      [p.x, p.y] = START_POS[this.players.length === 1 ? 0 : i + 1];
      Object.assign(p, { cd: 0, inv: 90, dead: 0, charge: 0, trail: [], missileCd: 0, berserk: 0, prev: { fire: false, select: false, special: false } });
    });
    this.state = 'briefing';
  }

  begin() { if (this.state === 'briefing') { this.state = 'playing'; this.runEvents(); } }

  nextLevel() {
    if (this.state !== 'levelclear') return;
    const shortcut = this.difficulty >= 1 && this.difficulty <= 2 && this.levelNo === 2;
    this.loadLevel(shortcut ? this.data.levels.length - 1 : this.levelNo + 1);
  }

  // nearest living player (enemies aim at it); falls back to player 1
  target(x, y) {
    let best = null, bd = 1e9;
    for (const p of this.players) if (alive(p)) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    return best || this.players[0];
  }

  // --- level script -------------------------------------------------------------------------------------------
  runEvents() {
    const ev = this.level.events;
    while (this.evIdx < ev.length && ev[this.evIdx].t <= this.levelTime) this.exec(ev[this.evIdx++]);
  }

  exec(e) {
    const bonus = e.bonus > 0 && e.bonus < 99 ? e.bonus : 0;          // 99 = "does not count"
    switch (e.cmd_id) {
      case 0: case 3: case 4: case 6: case 2: {     // approx: cluster / "attached" variants (2, 3, 4) spawn as plain enemies
        const def = this.defs.get(e.type); if (!def) break;
        const raw = e.raw || [], link = raw[14];                  // link: 0 = becomes the parent of what follows, -2 = attached to it
        const [w] = this.frameSize(def, 0);
        let en;
        if (e.cmd_id === 6) {                                      // guardian: follows GPAT_<f6>, y = f2 + path y, loops until killed
          const path = this.paths['GPAT_' + String(raw[6]).padStart(2, '0')];
          en = this.spawn(def, path ? path[0].x : W + w, e.y + (path ? path[0].y : 0), 0, 0, path || null);
          en.boss = true; en.loop = true; en.maxHp = en.hp;
        } else if (link === -2 && this.parent && !this.parent.dead) {   // part of the parent (turrets, engine flames, ...)
          en = this.spawn(def, this.parent.x + raw[12], this.parent.y + raw[13], 0, 0);
          en.parent = this.parent; en.off = [raw[12], raw[13]]; this.parent.children.push(en);
        } else en = this.spawn(def, W + w + (e.x_offset ?? 0), e.y, e.vx ?? -1, e.vy ?? 0);
        en.bonus = bonus;                           // dropped when this enemy is shot down
        if (link === 0 || e.cmd_id === 6) this.parent = en;
        break;
      }
      case 1: {
        const path = this.paths['PAT_' + String(e.path).padStart(2, '0')];
        const def = this.defs.get(e.type);
        if (path && def) {
          const group = { alive: 0, broken: false, done: false, bonus, last: null };
          this.groups.add(group);
          this.emitters.push({ def, path, y: e.y, left: e.count, interval: e.interval, cd: e.interval, group });
        }
        break;
      }
      case 5: {
        const bg = this.data.bgs[e.type]; if (!bg) break;
        const speed = e.layer ? SCROLL_DRIFT : 0.35;      // approx: layer 0 far / 1 near
        this.scenery.push({ idx: e.type, x: W + bg.w / 2 + (e.x_offset ?? 0), y: e.y, w: bg.w, h: bg.h, vx: -speed });
        break;
      }
      case 9: this.finishedFlag = true; this.evIdx = this.level.events.length; break;   // first end marker stops the script (exe: sets 0xC0530)
    }
  }

  frameSize(def, f) {
    const s = this.sprites[def.sprite_index + f] || this.sprites[def.sprite_index];
    return [s.w, s.h];
  }

  spawn(def, x, y, vx, vy, path = null, group = null) {
    const [w, h] = this.frameSize(def, 0);
    // approx: the original keeps vx = 0 enemies (ground turrets/cannons) moving with the world scroll, which we have not
    // decoded; drift them left at the near-scenery speed so they cross the screen and the level can finish
    if (!path && vx === 0 && vy === 0) vx = -SCROLL_DRIFT;
    const f = def.fields;
    const en = {
      def, x, y, vx, vy, w, h, path, pi: 0, baseY: y, hp: Math.round(def.hp * this.hpMul()), frame: 0, age: 0, group, bonus: 0,
      frames: (f['0x28'] || 0) + 1,
      reload: (f['0x50'] || 0) * 2, cd: 30 + Math.floor(this.rand() * 60),
      gun: [f['0x48'] || 0, f['0x4c'] || 0], bullet: f['0x58'] || 0,
      meteor: /^(Meteor|Halfmeteor)/.test(def.name || ''),    // README: meteors only die to magma or missiles
      decor: /^Engineflame/.test(def.name || ''),             // engine flames: scenery on a parent, not a target
      children: [], parent: null, boss: false, loop: false,
    };
    if (group) group.alive++;
    this.enemies.push(en);
    return en;
  }

  // --- per-frame update ---------------------------------------------------------------------------------------
  // inp: one input object (player 1) or an array [player 1, player 2]
  step(inp) {
    if (this.state !== 'playing') return;
    const inps = Array.isArray(inp) ? inp : [inp];
    this.frame++;
    if (this.frame % FRAMES_PER_TICK === 0) { this.levelTime++; this.runEvents(); }
    this.players.forEach((p, i) => this.updatePlayer(p, inps[i] || {}));
    if (this.players.every(p => p.out)) { this.state = 'gameover'; return; }
    this.updateEmitters();
    this.updateEnemies();
    this.updateBullets();
    this.updateBeams();
    this.updatePickups();
    this.checkGroups();
    for (const s of this.scenery) s.x += s.vx;
    this.scenery = this.scenery.filter(s => s.x > -s.w);
    for (const f of this.fx) f.t++;
    this.fx = this.fx.filter(f => f.t < f.frames.length * f.speed);
    for (const p of this.players) if (p.berserk > 0) p.berserk--;
    if (this.flash > 0) this.flash--;
    if (this.finishedFlag && !this.enemies.length && !this.emitters.length && this.players.every(p => p.out || p.dead === 0)) {
      this.state = this.levelNo + 1 >= this.data.levels.length ? 'won' : 'levelclear';
    }
  }

  // --- players & weapons --------------------------------------------------------------------------------------
  updatePlayer(p, inp) {
    const sh = p.ship, prev = p.prev;
    const selectEdge = inp.select && !prev.select, specialEdge = inp.special && !prev.special, fireEdge = inp.fire && !prev.fire;
    prev.select = !!inp.select; prev.special = !!inp.special; prev.fire = !!inp.fire;
    if (p.out) { if (specialEdge) this.stealShip(p); return; }      // out of ships: a partner can lend one (README: "steal ship")
    if (p.dead > 0) {
      if (--p.dead === 0) {
        if (p.lives <= 0) { p.out = true; return; }
        [p.x, p.y] = START_POS[this.players.length === 1 ? 0 : p.i + 1]; p.inv = 120;
      }
      return;
    }
    const speed = sh.speed + 0.35 * p.wep.SPEED;
    p.x = Math.min(W - p.w / 2, Math.max(p.w / 2, p.x + ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) * speed));
    p.y = Math.min(PLAY_H - p.h / 2, Math.max(p.h / 2, p.y + ((inp.down ? 1 : 0) - (inp.up ? 1 : 0)) * speed));
    p.trail.push({ x: p.x, y: p.y }); if (p.trail.length > 60) p.trail.shift();
    if (p.inv > 0) p.inv--;
    if (p.cd > 0) p.cd--;
    if (p.missileCd > 0) p.missileCd--;
    if (selectEdge) this.activateUpgrade(p);
    if (specialEdge) this.useSpecial(p);

    if (p.wep.BUILDUP > 0) {             // hold = charge, release = beam, tap = normal volley
      if (inp.fire) p.charge++;
      else {
        if (p.charge >= CHARGE_MIN) this.fireBeam(p);
        p.charge = 0;
      }
      if (fireEdge && p.cd === 0) this.volley(p);
    } else if (inp.fire && p.cd === 0) this.volley(p);
  }

  stealShip(p) {
    const donor = this.players.find(q => q !== p && !q.out && q.lives > 1);
    if (!donor) return;
    donor.lives--; p.lives = 1; p.out = false; p.dead = 0; p.inv = 120;
    [p.x, p.y] = START_POS[p.i + 1]; this.sfx.push('SND_PICKUP');
  }

  activateUpgrade(p = this.players[0]) {
    if (p.bar === 0) return;
    const slot = SLOTS[p.bar - 1];
    if (p.wep[slot] < this.maxLevel(slot, p)) { p.wep[slot]++; this.sfx.push('SND_BUILD'); }
    else this.sfx.push('SND_NA');
    p.bar = 0;
  }

  collectToken(p = this.players[0]) {
    if (p.bar < SLOTS.length) p.bar++;
    else if (!p.lock) p.lock = true;                        // README: at the end of the bar a token gives a LOCK...
    else p.specials = Math.min(5, p.specials + 1);          // ...and once locked, more specials
    this.sfx.push('SND_PICKUP');
  }

  volley(p = this.players[0]) {
    const w = p.wep, sh = p.ship;
    p.cd = Math.max(2, Math.ceil(sh.cooldown * (p.berserk > 0 ? 0.6 : 1)));
    const dmgMul = p.berserk > 0 ? 3 : 1;
    const magma = w.MAGMA > 0;
    const spr = magma ? 'MAGMA' + Math.min(4, w.MAGMA) : 'SHOT' + Math.min(6, 1 + w.PLASMA);
    const [bw, bh] = this.size(spr);
    const dmg = (magma ? 2 + 2 * w.MAGMA : 1 + w.PLASMA) * dmgMul;
    const n = magma ? 1 + (w.GUN > 1 ? 1 : 0) : 1 + w.GUN;              // GUN adds a fire source
    const spread = magma ? 8 : 4;
    const shot = (x, y) => this.bullets.push({ x, y, w: bw, h: bh, vx: 7, vy: 0, dmg, spr, src: magma ? 'magma' : 'gun', pierce: magma, hit: new Set(), own: p });
    for (let i = 0; i < n; i++) shot(p.x + p.w / 2, p.y + (i - (n - 1) / 2) * spread);
    for (let i = 0; i < w.OPTION; i++) { const o = this.optionPos(i, p); shot(o.x + 4, o.y); }   // options fire too
    if (w.SIDE > 0) {                                                    // ion waves sideways (up and down)
      const k = Math.min(4, 1 + w.SIDE);
      for (const [name, vy] of [['SIDEUP' + k, -3.2], ['SIDEDOWN' + k, 3.2]]) {
        const [sw, sh2] = this.size(name);
        this.bullets.push({ x: p.x, y: p.y + vy * 2, w: sw, h: sh2, vx: 1.2, vy, dmg: (1 + w.SIDE) * dmgMul, spr: name, src: 'side', pierce: false, hit: new Set(), own: p });
      }
    }
    if (w.MISSILE > 0 && p.missileCd === 0) {
      p.missileCd = 40;
      for (let i = 0; i < w.MISSILE; i++) {
        this.bullets.push({ x: p.x, y: p.y + (i % 2 ? 6 : -6), w: 8, h: 8, vx: 2 + i * 0.3, vy: i % 2 ? 1.5 : -1.5, dmg: 4 * dmgMul, spr: 'MISSILE', src: 'missile', pierce: false, hit: new Set(), home: true, own: p });
      }
    }
    this.sfx.push('SND_FIRE1');
  }

  optionPos(i, p = this.players[0]) {   // options trail the ship's recent path
    const t = p.trail, k = Math.max(0, t.length - 1 - (i + 1) * 12);
    return t[k] || { x: p.x, y: p.y };
  }

  fireBeam(p = this.players[0]) {
    const w = p.wep;
    const others = SLOTS.reduce((a, s) => a + (s === 'BUILDUP' ? 0 : w[s]), 0);
    const dmg = (3 + 2 * w.BUILDUP + Math.floor(others / 2)) * (p.berserk > 0 ? 2 : 1);   // README: grows with other weapons
    this.beams.push({ x: p.x + p.w / 2, t: 0, dmg, own: p });
    p.cd = 20; this.sfx.push('SND_EXP3');
  }

  useSpecial(p = this.players[0]) {
    if (p.specials <= 0 || p.dead > 0 || p.out) return;
    p.specials--;
    switch (p.ship.special) {
      case 'BERSERK': p.berserk = 360; break;                              // charged shots that hurt a lot
      case 'HELLRIDERS':                                                   // big heat-seeking missiles
        for (let i = 0; i < 4; i++) this.bullets.push({ x: p.x, y: p.y + (i - 1.5) * 6, w: 22, h: 22, vx: 2.5, vy: (i - 1.5) * 1.2, dmg: 25, spr: 'BIGMISSILE1', src: 'hell', pierce: false, hit: new Set(), home: true, own: p });
        this.sfx.push('SND_EXP3'); break;
      case 'FIREWORKS':                                                    // lightning: hits everything, wipes enemy bullets
        this.flash = 10; this.ebullets = [];
        for (const en of this.enemies.slice()) if (en.x < W + 20) this.hurt(en, 12, 'special', p);
        this.enemies = this.enemies.filter(e => !e.dead);
        this.sfx.push('SND_EXP2'); break;
    }
  }

  // --- enemies ------------------------------------------------------------------------------------------------
  updateEmitters() {
    for (const em of this.emitters) {
      if (--em.cd > 0) continue;
      em.cd = em.interval; em.left--;
      this.spawn(em.def, em.path[0].x, em.y + em.path[0].y, 0, 0, em.path, em.group);
      if (em.left === 0) em.group.done = true;
    }
    this.emitters = this.emitters.filter(em => em.left > 0);
  }

  updateEnemies() {
    for (const en of this.enemies) {
      if (en.dead) continue;
      en.age++;
      if (en.parent) {                                  // attached part: rides on its parent
        en.x = en.parent.x + en.off[0]; en.y = en.parent.y + en.off[1];
      } else if (en.path) {
        let pt = en.path[en.pi++];
        if (!pt && en.loop) { en.pi = 0; pt = en.path[en.pi++]; }
        if (!pt) { this.escape(en); continue; }
        en.x = pt.x; en.y = en.baseY + pt.y;
      } else { en.x += en.vx; en.y += en.vy; }
      if (en.frames > 1 && en.age % 6 === 0) en.frame = (en.frame + 1) % en.frames;
      if (!en.parent && !en.boss && (en.x < -90 || en.x > 700 || en.y < -200 || en.y > 520)) { this.escape(en); continue; }
      // approx: enemies with a reload value shoot while on screen; bullet types 0-3 are aimed, type 4 flies straight left
      if (en.reload > 0 && en.x > 24 && en.x < W - 8 && --en.cd <= 0) {
        en.cd = en.reload;
        const gx = en.x + en.gun[0], gy = en.y + en.gun[1];
        const spr = BULLET_SPRITES[Math.min(4, en.bullet)], [bw, bh] = this.size(spr);
        let vx = -2.5, vy = 0;
        if (en.bullet < 4) { const t = this.target(gx, gy), dx = t.x - gx, dy = t.y - gy, d = Math.hypot(dx, dy) || 1; vx = dx / d * 2.2; vy = dy / d * 2.2; }
        this.ebullets.push({ x: gx, y: gy, w: bw, h: bh, vx, vy, spr });
      }
      if (en.boss) this.bossAI(en);
      // ramming: big sprites (guardians and their parts) are mostly empty at their edges, so their hit box is shrunk in proportion
      // (the original uses pixel-perfect collision, which we approximate)
      const shrink = Math.min(30, Math.max(4, Math.min(en.w, en.h) * 0.22));
      if (!en.decor) for (const p of this.players) if (alive(p) && p.inv === 0 && rectsHit(p, en, shrink)) this.killPlayer(p);
    }
    this.enemies = this.enemies.filter(e => !e.dead);
  }

  bossPhase(en) {                      // index of the active phase for the boss's remaining health
    const ph = (BOSS_PATTERNS[en.def.name] || { phases: [] }).phases, frac = en.hp / en.maxHp;
    const i = ph.findIndex(p => frac >= p.minHp);
    return i < 0 ? ph.length - 1 : i;
  }

  bossAI(en) {
    const pat = BOSS_PATTERNS[en.def.name]; if (!pat) return;
    const idx = this.bossPhase(en);
    if (idx !== en.phase) {                                        // phase change: announce it
      if (en.phase !== undefined) { this.flash = 4; this.sfx.push('SND_EXP3'); }
      en.phase = idx;
    }
    for (const at of pat.phases[idx].attacks) {
      if (en.age % at.every !== 0) continue;
      const ox = en.x + at.from[0], oy = en.y + at.from[1];
      if (ox < 0 || ox > W + 10 || oy < -10 || oy > H || this.ebullets.length > MAX_ENEMY_BULLETS - 16) continue;   // only when visible
      const spr = BULLET_SPRITES[at.spr ?? 0], [bw, bh] = this.size(spr);
      const shoot = (ang) => this.ebullets.push({ x: ox, y: oy, w: bw, h: bh, vx: Math.cos(ang) * at.speed, vy: Math.sin(ang) * at.speed, spr });
      if (at.kind === 'fan') {
        const t = this.target(ox, oy), aim = Math.atan2(t.y - oy, t.x - ox);
        for (let i = 0; i < at.n; i++) shoot(aim + (at.n === 1 ? 0 : (i / (at.n - 1) - 0.5) * at.spread));
      } else if (at.kind === 'ring') {
        for (let i = 0; i < at.n; i++) shoot(en.age * 0.05 + (i / at.n) * Math.PI * 2);
      } else if (at.kind === 'spiral') {
        for (let i = 0; i < at.arms; i++) shoot(en.age * at.step + (i / at.arms) * Math.PI * 2);
      }
    }
  }

  escape(en) {                         // left the field alive: breaks a wave's bonus
    en.dead = true;
    for (const c of en.children) c.dead = true;
    if (en.group) { en.group.alive--; en.group.broken = true; }
  }

  updateBullets() {
    for (const b of this.bullets) {
      if (b.home) this.steer(b);
      b.x += b.vx; b.y += b.vy;
      if (b.x > W + 40 || b.x < -40 || b.y < -40 || b.y > H + 40) { b.dead = true; continue; }
      for (const en of this.enemies) {
        if (en.dead || en.decor || b.hit.has(en) || !rectsHit(b, en, 1)) continue;
        b.hit.add(en);
        this.hurt(en, b.dmg, b.src, b.own);
        this.fx.push({ x: b.x + b.w / 2, y: b.y, frames: ['IHIT1', 'IHIT2', 'IHIT3'], speed: 2, t: 0 });
        if (!b.pierce) { b.dead = true; break; }
      }
    }
    this.bullets = this.bullets.filter(b => !b.dead);
    this.enemies = this.enemies.filter(e => !e.dead);
    for (const b of this.ebullets) {
      b.x += b.vx; b.y += b.vy;
      if (b.x < -10 || b.x > W + 10 || b.y < -10 || b.y > H + 10) { b.dead = true; continue; }
      for (const p of this.players) {
        if (!alive(p)) continue;
        for (let i = 0; i < p.wep.OPTION && !b.dead; i++) {          // options absorb enemy fire
          const o = this.optionPos(i, p);
          if (rectsHit({ x: o.x, y: o.y, w: 9, h: 8 }, b, 1)) b.dead = true;
        }
        if (!b.dead && p.inv === 0 && rectsHit(p, b, 2)) { b.dead = true; this.killPlayer(p); }
        if (b.dead) break;
      }
    }
    this.ebullets = this.ebullets.filter(b => !b.dead);
  }

  steer(b) {                           // heat-seeking: turn towards the nearest enemy that is ahead of the missile
    let best = null, bd = 1e9;
    for (const en of this.enemies) {
      if (en.dead || en.decor || en.x < b.x - 10 || en.x > W + 10 || en.hp >= 9000) continue;
      const d = Math.hypot(en.x - b.x, en.y - b.y);
      if (d < bd) { bd = d; best = en; }
    }
    if (!best) { b.vx = Math.min(4, b.vx + 0.1); return; }
    const dx = best.x - b.x, dy = best.y - b.y, d = Math.hypot(dx, dy) || 1, sp = Math.min(4.5, Math.hypot(b.vx, b.vy) + 0.15);
    b.vx += (dx / d * sp - b.vx) * 0.15; b.vy += (dy / d * sp - b.vy) * 0.15;
  }

  updateBeams() {
    for (const bm of this.beams) {
      bm.t++;
      if (bm.t % 3 !== 1) continue;
      const strip = { x: bm.x + 160, y: bm.own.y, w: 320, h: 28 };
      for (const en of this.enemies.slice()) if (!en.dead && rectsHit(strip, en, 0)) this.hurt(en, bm.dmg, 'beam', bm.own);
      this.ebullets = this.ebullets.filter(b => !rectsHit(strip, b, 0));
    }
    this.beams = this.beams.filter(bm => bm.t < 14);
    this.enemies = this.enemies.filter(e => !e.dead);
  }

  // damage routing: returns true when the enemy took damage; `own` is the player credited with a kill
  hurt(en, dmg, src, own = this.players[0]) {
    if (en.dead || en.decor || en.hp >= 9000) return false;          // 9999 hp = indestructible obstacle (Big Meteor)
    if (en.meteor && (src === 'gun' || src === 'side')) return false;
    en.hp -= dmg;
    if (en.hp <= 0) this.killEnemy(en, own);
    return true;
  }

  killEnemy(en, own = this.players[0]) {
    en.dead = true; en.killed = true;
    own.score += Math.round((en.def.score || 0) * this.scoreMul());
    this.fx.push({ x: en.x, y: en.y, frames: ['MHIT1', 'MHIT2', 'MHIT3'], speed: 4, t: 0 });
    this.sfx.push(['SND_EXP1', 'SND_EXP2', 'SND_EXP3'][Math.floor(this.rand() * 3)]);
    if (en.group) { en.group.alive--; en.group.last = { x: en.x, y: en.y }; }
    else if (en.bonus) this.drop(en.bonus, en.x, en.y);
    for (const c of en.children) if (!c.dead) this.killEnemy(c, own);   // a destroyed parent takes its parts with it
    if (en.boss) {                                                       // guardian down: big explosion
      this.flash = 8;
      for (let i = 0; i < 8; i++) this.fx.push({ x: en.x + (this.rand() - 0.5) * en.w, y: en.y + (this.rand() - 0.5) * en.h, frames: ['MHIT1', 'MHIT2', 'MHIT3'], speed: 4, t: -i * 5 });
      this.sfx.push('SND_EXP3');
    }
  }

  bossStatus() {                       // for the energy bar: the live guardian, if any
    const b = this.enemies.find(e => e.boss && !e.dead);
    return b ? { hp: Math.max(0, b.hp), max: b.maxHp } : null;
  }

  checkGroups() {                      // a wave wiped out completely (nobody escaped) rewards a pickup
    for (const g of this.groups) {
      if (!g.done || g.alive > 0) continue;
      this.groups.delete(g);
      if (!g.broken && g.bonus && g.last) this.drop(g.bonus, g.last.x, g.last.y);
    }
  }

  // --- pickups ------------------------------------------------------------------------------------------------
  drop(bonus, x, y) {                  // approx: bonus 1 = power token (P), 2 = special (S), 3 = extra ship (+1)
    const kind = bonus === 2 ? 'S' : bonus === 3 ? '1UP' : 'P';
    const [w, h] = this.size(kind === 'S' ? 'SUP000' : kind === '1UP' ? 'ONEUP' : 'PUP000');
    this.pickups.push({ kind, x: Math.min(x, W - 12), y, w, h, vx: -0.5, age: 0 });
  }

  updatePickups() {                    // free to take for whoever reaches it first
    for (const pk of this.pickups) {
      pk.age++; pk.x += pk.vx;
      if (pk.x < -20) { pk.dead = true; continue; }
      const p = this.players.find(q => alive(q) && rectsHit(q, pk, 0));
      if (!p) continue;
      pk.dead = true;
      if (pk.kind === 'P') this.collectToken(p);
      else if (pk.kind === 'S') { p.specials = Math.min(5, p.specials + 1); this.sfx.push('SND_PICKUP'); }
      else { p.lives++; this.sfx.push('SND_PICKUP'); }
    }
    this.pickups = this.pickups.filter(pk => !pk.dead);
  }

  killPlayer(p = this.players[0]) {
    const w = p.wep;
    p.lives--; p.dead = 90; p.charge = 0; p.berserk = 0;
    if (p.lock) p.lock = false;                                      // LOCK protects the weapons, once
    else {                                                           // README: lose one speed, two random weapons drop a step
      if (w.SPEED > 0) w.SPEED--;
      const have = SLOTS.filter(s => s !== 'SPEED' && w[s] > 0);
      for (let i = 0; i < 2 && have.length; i++) {
        const k = Math.floor(this.rand() * have.length), s = have[k];
        w[s]--; if (!w[s]) have.splice(k, 1);
      }
    }
    this.fx.push({ x: p.x, y: p.y, frames: ['PHIT1', 'PHIT2', 'PHIT3'], speed: 8, t: 0 });
    this.sfx.push('SND_EXP2');
  }
}
