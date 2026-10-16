import { Sim, SHIPS, SLOTS, W, H, PLAY_H, CHARGE_MIN } from './sim.js';
import { loadGame } from './loader.js';

const FPS = 60;                       // assumed: 320x240 VGA mode runs at 60 Hz (original frame limiter not decoded)
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
ctx.font = '8px monospace'; ctx.fillStyle = '#9ac'; ctx.textAlign = 'center'; ctx.fillText('UNPACKING ORIGINAL GAME FILES...', W / 2, H / 2);
const resp = await fetch('spacehog.zip');                 // the author's original, unmodified zip
const game = await loadGame(await resp.arrayBuffer());   // decoded here in the browser, nothing is pre-converted
const data = game.data;
const toBitmap = (im) => createImageBitmap(new ImageData(im.rgba, im.w, im.h));
const img = {}, bgImg = [];
await Promise.all([
  ...[...game.images].map(async ([n, im]) => { img[n] = await toBitmap(im); }),
  ...game.bgImages.map(async (im, i) => { if (im) bgImg[i] = await toBitmap(im); }),
]);

// --- audio (context created on first key press) -----------------------------------------------------------------
let ac = null; const buffers = {};
function initAudio() {
  if (ac) return;
  ac = new AudioContext();
  for (const [n, s] of game.samples) { const b = ac.createBuffer(1, s.samples.length, s.freq); b.copyToChannel(s.samples, 0); buffers[n] = b; }
}
function play(n) {
  if (!ac || !buffers[n]) return;
  const s = ac.createBufferSource(); s.buffer = buffers[n];
  const g = ac.createGain(); g.gain.value = 0.35; s.connect(g).connect(ac.destination); s.start();
}

// --- input ------------------------------------------------------------------------------------------------------
const keys = new Set(); const pressed = new Set();
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ControlLeft', 'AltLeft', 'AltRight'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code); initAudio();
});
addEventListener('keyup', e => keys.delete(e.code));
const input = () => ({
  left: keys.has('ArrowLeft'), right: keys.has('ArrowRight'), up: keys.has('ArrowUp'), down: keys.has('ArrowDown'),
  fire: keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('Space') || keys.has('KeyZ'),
  select: ['KeyC', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight'].some(k => keys.has(k)),   // activate the highlighted upgrade
  special: keys.has('KeyX'),                                                                   // craft special weapon
});

// --- game -------------------------------------------------------------------------------------------------------
const sim = new Sim(data);
let shipNo = 1;
const text = (s, x, y, color = '#ddd', align = 'left') => {
  ctx.font = '8px monospace'; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y);
};
const drawC = (name, x, y, f = 0) => {                       // sprites are anchored at their centre
  const s = data.sprites[sim.spriteIndex.get(name) + f] ?? data.sprites[sim.spriteIndex.get(name)];
  const im = img[s.name]; if (im) ctx.drawImage(im, Math.round(x - s.w / 2), Math.round(y - s.h / 2));
};
const wrapLayer = (name, speed) => {
  const im = img[name], off = Math.floor((sim.frame * speed) % W);
  ctx.drawImage(im, -off, 0); ctx.drawImage(im, W - off, 0);
};

function wrapText(s, max) {
  const out = []; let line = '';
  for (const w of s.split(' ')) { if ((line + ' ' + w).length > max) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; }
  return out.concat(line);
}

// x ranges of the nine upgrade slots inside TOOLBAR.png (measured from the original sprite), drawn at x = 1
const SLOT_X = [[63, 86], [89, 106], [109, 124], [128, 158], [162, 189], [193, 221], [224, 251], [253, 280], [283, 307]];
function drawBar() {
  SLOTS.forEach((s, i) => {
    const [x0, x1] = SLOT_X[i], lv = sim.w[s];
    ctx.fillStyle = '#5f5';
    for (let k = 0; k < lv; k++) ctx.fillRect(1 + x0 + k * 4, PLAY_H - 3, 3, 2);          // upgrade level pips above the slot
    if (sim.bar === i + 1) { ctx.strokeStyle = '#fd3'; ctx.lineWidth = 1; ctx.strokeRect(1 + x0 + 0.5, PLAY_H + 0.5, x1 - x0, 10); }
  });
  if (sim.bar > SLOTS.length) { ctx.strokeStyle = '#6af'; ctx.strokeRect(1 + SLOT_X[8][0] + 0.5, PLAY_H + 0.5, SLOT_X[8][1] - SLOT_X[8][0], 10); }
}

function render() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (sim.state === 'title') {
    drawC('TITLE', W / 2, 60);
    text('CHOOSE YOUR CRAFT  (LEFT/RIGHT)', W / 2, 120, '#fc4', 'center');
    SHIPS.forEach((s, i) => {
      const x = 60 + i * 100;
      drawC(s.sprite, x, 150);
      text(s.name, x, 175, i === shipNo ? '#fff' : '#777', 'center');
      if (i === shipNo) text('^', x, 185, '#fc4', 'center');
    });
    text('ENTER START  ARROWS MOVE  SPACE FIRE', W / 2, 205, '#9ac', 'center');
    text('C / SHIFT: ACTIVATE UPGRADE   X: SPECIAL', W / 2, 217, '#9ac', 'center');
    return;
  }
  if (sim.state === 'briefing') {
    text('LEVEL ' + (sim.levelNo + 1) + ': ' + sim.level.name.toUpperCase(), W / 2, 60, '#fc4', 'center');
    wrapText(sim.level.briefing, 44).forEach((l, i) => text(l, W / 2, 90 + i * 11, '#ddd', 'center'));
    text('PRESS ENTER', W / 2, 200, '#9ac', 'center');
    return;
  }
  wrapLayer('BKG_STARS1', 0.4); wrapLayer('BKG_STARS2', 0.9);
  for (const s of sim.scenery) if (bgImg[s.idx]) ctx.drawImage(bgImg[s.idx], Math.round(s.x - s.w / 2), Math.round(s.y - s.h / 2));
  for (const e of sim.enemies) drawC(sim.sprites[e.def.sprite_index].name, e.x, e.y, e.frame);
  for (const pk of sim.pickups) drawC(pk.kind === 'S' ? 'SUP000' : pk.kind === '1UP' ? 'ONEUP' : 'PUP' + String(Math.floor(pk.age / 3) % 18).padStart(3, '0'), pk.x, pk.y);
  const p = sim.player;
  for (const bm of sim.beams) {                                      // BUILDUP beam: a 320x30 sprite fading out
    const im = img.BUILDUP, x = Math.round(bm.x), len = Math.max(0, W - x);
    ctx.globalAlpha = 1 - bm.t / 14; ctx.drawImage(im, 0, 0, len, 30, x, Math.round(p.y - 15), len, 30); ctx.globalAlpha = 1;
  }
  for (const b of sim.bullets) drawC(b.spr, b.x, b.y);
  for (const b of sim.ebullets) drawC(b.spr, b.x, b.y);
  if (p.dead === 0 && (p.inv === 0 || sim.frame % 6 < 3)) {
    for (let i = 0; i < sim.w.OPTION; i++) { const o = sim.optionPos(i); drawC('OPTION', o.x, o.y); }
    drawC(sim.ship.sprite, p.x, p.y);
    if (sim.berserk > 0 && sim.frame % 4 < 2) { ctx.fillStyle = 'rgba(255,60,20,0.35)'; ctx.fillRect(Math.round(p.x - p.w / 2), Math.round(p.y - p.h / 2), p.w, p.h); }
    if (p.charge > 4) { ctx.fillStyle = p.charge >= CHARGE_MIN ? '#8f8' : '#486'; ctx.fillRect(Math.round(p.x - 10), Math.round(p.y + p.h / 2 + 2), Math.min(20, p.charge * 20 / CHARGE_MIN), 2); }
  }
  for (const f of sim.fx) drawC(f.frames[Math.min(f.frames.length - 1, Math.floor(f.t / f.speed))], f.x, f.y);
  if (sim.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${sim.flash / 14})`; ctx.fillRect(0, 0, W, PLAY_H); }
  ctx.drawImage(img.TOOLBAR, 1, PLAY_H);
  drawBar();
  text('SCORE ' + String(sim.score).padStart(7, '0'), 6, 9, '#fff');
  text('SHIPS ' + Math.max(0, sim.lives), W / 2, 9, '#fff', 'center');
  text('LVL ' + (sim.levelNo + 1), W - 6, 9, '#fff', 'right');
  text(sim.ship.special + ' x' + sim.specials + ' [X]', 6, 19, sim.specials ? '#fc4' : '#765');
  if (sim.lock) text('LOCK', W - 6, 19, '#6af', 'right');
  const banner = { levelclear: 'LEVEL COMPLETED', gameover: 'GAME OVER', won: 'YOU SAVED EARTH!' }[sim.state];
  if (banner) {
    text(banner, W / 2, 110, '#fc4', 'center'); text('PRESS ENTER', W / 2, 130, '#9ac', 'center');
  }
}

function onKeys() {
  if (sim.state === 'title') {
    if (pressed.has('ArrowLeft')) shipNo = (shipNo + 2) % 3;
    if (pressed.has('ArrowRight')) shipNo = (shipNo + 1) % 3;
    if (pressed.has('Enter')) { sim.newGame(shipNo); play('SND_SELECT'); }
  } else if (pressed.has('Enter')) {
    if (sim.state === 'briefing') sim.begin();
    else if (sim.state === 'levelclear') sim.nextLevel();
    else if (sim.state === 'gameover' || sim.state === 'won') sim.state = 'title';
  }
  pressed.clear();
}

let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(100, now - last); last = now;
  onKeys();
  while (acc >= 1000 / FPS) { sim.step(input()); acc -= 1000 / FPS; }
  for (const s of sim.sfx.splice(0)) play(s);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__sim = sim;     // handy for debugging in the console
