// Game simulation for the Operation Spacehog web port. No DOM here: main.js renders and feeds input.
// Behaviour is reconstructed from the original data files, the README and SH.EXE (see ../NOTES.md); anything approximated
// is marked "approx".

export const W = 320, H = 240, PLAY_H = 229;
export const FRAMES_PER_TICK = 80;        // one level-script tick = 80 game frames (from the exe's main loop)
export const SCROLL_DRIFT = 0.7;          // approx: world scroll speed for vx = 0 enemies / near scenery

export const SLOTS = ['SPEED', 'GUN', 'SIDE', 'BUILDUP', 'MISSILE', 'PLASMA', 'MAGMA', 'OPTION', 'ADD-ON'];   // toolbar order
export const BASE_MAX = 3, SPEED_MAX = 5, ADDON_MAX = 3;
export const CHARGE_MIN = 25;             // frames of holding fire before a release fires the BUILDUP beam
// Enemy bullet templates, from SH.EXE (table at 0xC8598, selected by the enemy's bullet type). Speeds are px per frame:
// 'aim' = speed 4 towards a random living player, 'random' = speed 2 in a random direction, 'fixed' = constant velocity.
export const BULLET_TYPES = [
  { kind: 'aim', speed: 4, spr: 'EB_RANDOM1', frames: 4 },
  { kind: 'random', speed: 2, spr: 'EB_RANDOM1', frames: 4 },
  { kind: 'fixed', vx: -10, vy: 0, spr: 'EB_LASER1', frames: 2 },
  { kind: 'fixed', vx: -6, vy: 0, spr: 'EB_LEFT', frames: 1 },
  { kind: 'fixed', vx: -8, vy: 0, spr: 'EB_BLUE', frames: 1 },
];
// The exe's trig tables: 256 angle steps per turn, amplitude 128 (cos at 0xCC858, sin at 0xCA6F4)
export const COS = Array.from({ length: 256 }, (_, i) => Math.round(Math.cos(i * 2 * Math.PI / 256) * 128));
export const SIN = Array.from({ length: 256 }, (_, i) => Math.round(Math.sin(i * 2 * Math.PI / 256) * 128));
// A weapon's bit in an enemy's immunity mask (def field +0x5C); an enemy is immune to a weapon when the bit is set. 0xFF = immune to everything.
export const WEAPON_FLAG = { gun: 1, beam: 1, side: 2, magma: 8, missile: 0x20, hell: 0x20, special: 0x10 };
export const END_DELAY = 90;              // frames between the end-of-script marker and the level-complete screen (approx)
export const PICKUP_Y = [20, 220];        // pickups are placed inside this y range (exe)

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
    this.frame = 0; this.tickFrames = 0; this.levelTime = 0; this.evIdx = 0; this.finishedFlag = false; this.endTimer = 0;
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
      case 0: case 3: case 4: case 6: case 2: {
        const def = this.defs.get(e.type); if (!def) break;
        const raw = e.raw || [], link = raw[14];                  // link: 0 = becomes the parent of what follows, -2 = part of it
        const [w] = this.frameSize(def, 0);
        let en;
        if (e.cmd_id === 6) {                                      // guardian: follows GPAT_<f6>, y = f2 + path y, loops until killed
          const path = this.paths['GPAT_' + String(raw[6]).padStart(2, '0')];
          en = this.spawn(def, path ? path[0].x : W + w / 2, e.y + (path ? path[0].y : 0), 0, 0, path || null);
          en.boss = true; en.loop = true; en.step = Math.max(1, raw[4] || 1); en.maxHp = en.hp;
        } else if (link === -2 && this.parent && !this.parent.dead) {   // part of the parent (turrets, engine flames, ...)
          en = this.spawn(def, this.parent.x + raw[12], this.parent.y + raw[13], 0, 0);
          en.parent = this.parent; en.off = [raw[12], raw[13]]; this.parent.children.push(en);
        } else if (e.cmd_id === 2) {                               // cluster: orbits a moving centre, radius 128 >> f9, f10 = start angle, f11 = turn speed
          const ang = (raw[10] || 0) & 255, sh = raw[9] || 0;
          en = this.spawn(def, W + w / 2 + (e.x_offset ?? 0) + (COS[ang] >> sh), e.y + (SIN[ang] >> sh), e.vx ?? -1, e.vy ?? 0);
          en.orbit = { ang, step: raw[11] || 0, sh };
        } else {
          en = this.spawn(def, W + w / 2 + (e.x_offset ?? 0), e.y, e.vx ?? -1, e.vy ?? 0);   // spawn centre = just off the right edge
          if (e.cmd_id === 3) en.hover = { x: raw[9], t: (raw[13] || 0) * 25, saved: 0 };       // fly in, stop at x < f9 for f13 x 25 frames, fly on
          if (e.cmd_id === 4) en.dodge = true;                                                 // jerk away when a player's line crosses within 9 px
        }
        en.bonus = bonus; en.blocking = e.bonus === 99;           // bonus 1-9 drops a pickup when shot down; 99 = guardian: freezes the level timer while alive
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
      case 9: this.finishedFlag = true; this.endTimer = END_DELAY; this.evIdx = this.level.events.length; break;   // first end marker ends the script (exe: sets 0xC0530)
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
    const used = new Set(this.enemies.filter(e => !e.dead).map(e => e.slot));
    let slot = 0; while (used.has(slot)) slot++;                       // the exe uses the lowest free of 50 slots
    const reload = f['0x50'] || 0;
    const en = {
      def, x, y, vx, vy, w, h, path, pi: 0, baseY: y, hp: Math.round(def.hp * this.hpMul()), frame: 0, age: 0, group, bonus: 0, slot,
      frames: (f['0x28'] || 0) + 1,
      reload, fc: reload ? slot % (reload + 1) : 0,                    // fire counter starts at slot % (reload + 1): staggers volleys
      gun: [f['0x48'] || 0, f['0x4c'] || 0], bullet: f['0x58'] || 0,
      imm: (f['0x5c'] ?? 0) & 0xff,                                    // weapons this enemy is immune to (WEAPON_FLAG bits); 0xFF = all
      decor: (f['0x74'] || 0) !== 0,                                   // engine flames: drawn, but not a target and harmless
      children: [], parent: null, boss: false, loop: false, step: 1, blocking: false, orbit: null, hover: null, dodge: false,
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
    // exe: the script clock only runs while no guardian (bonus 99) is alive; a tick is 80 clock frames
    if (!this.finishedFlag && !this.enemies.some(e => e.blocking && !e.dead) && ++this.tickFrames % FRAMES_PER_TICK === 0) {
      this.levelTime++; this.runEvents();
    }
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
    // exe: the first end marker ends the level at once (the screen need not be clear); the short delay is for the exit sequence
    if (this.finishedFlag && --this.endTimer <= 0 && this.players.every(p => p.out || p.dead === 0)) {
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
    // keys move by `speed` per axis; a touch drag supplies a target (inp.tx, inp.ty) and the ship closes on it at the same per-axis
    // limit, so speed upgrades matter on touch screens too
    let mx = ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) * speed, my = ((inp.down ? 1 : 0) - (inp.up ? 1 : 0)) * speed;
    if (inp.tx !== undefined && inp.tx !== null) {
      mx = Math.max(-speed, Math.min(speed, inp.tx - p.x)); my = Math.max(-speed, Math.min(speed, inp.ty - p.y));
    }
    p.x = Math.min(W - p.w / 2, Math.max(p.w / 2, p.x + mx));
    p.y = Math.min(PLAY_H - p.h / 2, Math.max(p.h / 2, p.y + my));
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
    const dmg = (magma ? 3 * w.MAGMA : 1 + w.PLASMA) * dmgMul;           // exe: gun 1 + plasma level, magma 3 x level
    const n = magma ? 1 + (w.GUN > 1 ? 1 : 0) : 1 + w.GUN;              // GUN adds a fire source
    const spread = magma ? 8 : 4;
    const shot = (x, y) => this.bullets.push({ x, y, w: bw, h: bh, vx: 7, vy: 0, dmg, spr, src: magma ? 'magma' : 'gun', pierce: magma, hit: new Set(), own: p });
    for (let i = 0; i < n; i++) shot(p.x + p.w / 2, p.y + (i - (n - 1) / 2) * spread);
    for (let i = 0; i < w.OPTION; i++) { const o = this.optionPos(i, p); shot(o.x + 4, o.y); }   // options fire too
    if (w.SIDE > 0) {                                                    // ion waves sideways (up and down)
      const k = Math.min(4, 1 + w.SIDE);
      for (const [name, vy] of [['SIDEUP' + k, -3.2], ['SIDEDOWN' + k, 3.2]]) {
        const [sw, sh2] = this.size(name);
        this.bullets.push({ x: p.x, y: p.y + vy * 2, w: sw, h: sh2, vx: 1.2, vy, dmg: w.SIDE * dmgMul, spr: name, src: 'side', pierce: false, hit: new Set(), own: p });
      }
    }
    if (w.MISSILE > 0 && p.missileCd === 0) {
      p.missileCd = 40;
      for (let i = 0; i < w.MISSILE; i++) {
        this.bullets.push({ x: p.x, y: p.y + (i % 2 ? 6 : -6), w: 8, h: 8, vx: 2 + i * 0.3, vy: i % 2 ? 1.5 : -1.5, dmg: 2 * dmgMul, spr: 'MISSILE', src: 'missile', pierce: false, hit: new Set(), home: true, own: p });
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
        for (let i = 0; i < 4; i++) this.bullets.push({ x: p.x, y: p.y + (i - 1.5) * 6, w: 22, h: 22, vx: 2.5, vy: (i - 1.5) * 1.2, dmg: 40, spr: 'BIGMISSILE1', src: 'hell', pierce: false, hit: new Set(), home: true, own: p });
        this.sfx.push('SND_EXP3'); break;
      case 'FIREWORKS':                                                    // lightning: hits everything, wipes enemy bullets
        this.flash = 10; this.ebullets = [];
        for (const en of this.enemies.slice()) if (en.x < W + 20) this.hurt(en, 20, 'special', p);
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
        let pt = en.path[en.pi];                        // position = path point, then advance (guardians step f4 points a frame, formations 1)
        if (!pt) { if (en.loop) { en.pi = 0; pt = en.path[0]; } else { this.escape(en); continue; } }
        en.x = pt.x; en.y = en.baseY + pt.y; en.pi += en.step;
      } else {
        en.x += en.vx; en.y += en.vy;
        if (en.orbit) {                                 // cluster: swap the old orbit offset for the new one around the moving centre
          const o = en.orbit;
          en.x -= COS[o.ang] >> o.sh; en.y -= SIN[o.ang] >> o.sh;
          o.ang = (o.ang + o.step) & 255;
          en.x += COS[o.ang] >> o.sh; en.y += SIN[o.ang] >> o.sh;
        }
        if (en.hover && en.x < en.hover.x && en.hover.t > 0) {   // fly in, hover (vx = 0) for the set time, then carry on
          const h = en.hover;
          if (h.saved === 0) h.saved = en.vx;
          en.vx = h.t === 1 ? h.saved : 0; h.t--;
        }
        if (en.dodge) this.dodge(en);
      }
      if (en.frames > 1 && en.age % 6 === 0) en.frame = (en.frame + 1) % en.frames;
      if (!en.parent && !en.boss && !en.path && (en.x < -en.w / 2 || en.x > 700 || en.y < -200 || en.y > 520)) { this.escape(en); continue; }
      if (en.reload > 0) {                              // exe: counter runs to `reload`, fires, resets next frame (period reload + 1)
        if (en.reload <= en.fc) en.fc = 0;
        else if (++en.fc >= en.reload) this.fireEnemy(en);
      }
      // ramming: big sprites (guardians and their parts) are mostly empty at their edges, so their hit box is shrunk in proportion
      // (the original uses pixel-perfect collision, which we approximate)
      const shrink = Math.min(30, Math.max(4, Math.min(en.w, en.h) * 0.22));
      if (!en.decor) for (const p of this.players) if (alive(p) && p.inv === 0 && rectsHit(p, en, shrink)) this.killPlayer(p);
    }
    this.enemies = this.enemies.filter(e => !e.dead);
  }

  // type 4 enemies: when a player's row passes within 9 px they jerk away vertically (speed 8, decaying by 1 per frame)
  dodge(en) {
    if (en.vy > 0) en.vy--; else if (en.vy < 0) en.vy++;
    for (const p of this.players) {
      if (!alive(p)) continue;
      const below = en.y - p.y, above = p.y - en.y;
      if (below >= 0 && below <= 9 && en.y <= 179) en.vy = 8;
      if (above >= 0 && above <= 9 && en.y > 60) en.vy = -8;
    }
  }

  fireEnemy(en) {                                       // bullet from the gun offset; behaviour comes from the bullet template
    const t = BULLET_TYPES[Math.min(BULLET_TYPES.length - 1, en.bullet)], [bw, bh] = this.size(t.spr);
    const x = en.x + en.gun[0], y = en.y + en.gun[1];
    let vx, vy;
    if (t.kind === 'aim') {                             // aimed at a random living player; direction quantised to 256 steps like the exe
      const live = this.players.filter(alive), p = live.length ? live[Math.floor(this.rand() * live.length)] : this.players[0];
      const a = Math.round(Math.atan2(p.y - y, p.x - x) * 256 / (Math.PI * 2)) & 255;
      vx = COS[a] >> 5; vy = SIN[a] >> 5;
    } else if (t.kind === 'random') {
      const a = Math.floor(this.rand() * 256); vx = COS[a] >> 6; vy = SIN[a] >> 6;
    } else { vx = t.vx; vy = t.vy; }
    this.ebullets.push({ x, y, w: bw, h: bh, vx, vy, spr: t.spr, frames: t.frames, age: 0 });
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
      b.age++;
      if (b.x - b.w / 2 > W || b.x + b.w / 2 < 0 || b.y - b.h / 2 > H || b.y + b.h / 2 < 0) { b.dead = true; continue; }   // exe: off-screen by its own size
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
      if (en.dead || en.decor || en.x < b.x - 10 || en.x > W + 10 || (en.imm & 0x60) !== 0) continue;   // exe: not enemies flagged 0x40 / missile-immune
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
    if (en.dead || en.decor) return false;
    if ((en.imm & (WEAPON_FLAG[src] ?? 0)) !== 0) return false;      // immune to this weapon (0xFF: Big Meteor, Octo's ship, ...)
    en.hp -= dmg;
    if (en.hp <= 0) this.killEnemy(en, own);
    return true;
  }

  // `auto`: a part destroyed along with its parent (the exe leaves such parts in place; we blow them up) scores and drops nothing
  killEnemy(en, own = this.players[0], auto = false) {
    en.dead = true; en.killed = true;
    this.fx.push({ x: en.x, y: en.y, frames: ['MHIT1', 'MHIT2', 'MHIT3'], speed: 4, t: 0 });
    for (let i = 0; i < (en.def.fields['0x75'] || 0); i++)           // field +0x75 = extra explosions scattered over a big sprite
      this.fx.push({ x: en.x + (this.rand() - 0.5) * en.w, y: en.y + (this.rand() - 0.5) * en.h, frames: ['MHIT1', 'MHIT2', 'MHIT3'], speed: 4, t: -(i % 8) * 2 });
    if (!auto) {
      this.sfx.push(['SND_EXP1', 'SND_EXP2', 'SND_EXP3'][Math.floor(this.rand() * 3)]);
      own.score += Math.round((en.def.score || 0) * this.scoreMul());
      if (en.group) { en.group.alive--; en.group.last = { x: en.x, y: en.y }; }
      else if (en.bonus) this.drop(en.bonus, en.x, en.y);
    } else if (en.group) en.group.alive--;
    for (const c of en.children) if (!c.dead) this.killEnemy(c, own, true);   // parts go with their parent
    if (en.boss) { this.flash = 8; this.sfx.push('SND_EXP3'); }                // guardian down
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
  drop(bonus, x, y) {                  // exe (0xD6D8): kind 1 = power token (P), 2 = special (S), 3 = extra ship (+1); 4-9 do nothing
    if (bonus < 1 || bonus > 3) return;
    const kind = bonus === 2 ? 'S' : bonus === 3 ? '1UP' : 'P';
    const [w, h] = this.size(kind === 'S' ? 'SUP000' : kind === '1UP' ? 'ONEUP' : 'PUP000');
    this.pickups.push({ kind, x: Math.min(x, W - 12), y: Math.min(PICKUP_Y[1], Math.max(PICKUP_Y[0], y)), w, h, vx: -1, age: 0 });
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
