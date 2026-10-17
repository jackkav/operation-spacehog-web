import { Sim, SHIPS, SLOTS, W, H, PLAY_H, CHARGE_MIN, DIFFICULTIES } from './sim.js';
import { loadGame } from './loader.js';
import { MidiPlayer, parseSMF } from './midi.js';
import { loadOptions, saveOptions, loadHall, saveHall, qualifies, addScore, parseCredits, MAX_NAME } from './extras.js';
import { createDrag, dragStart, dragMove, dragEnd, fitCanvas, toLogical, menuTap, TITLE_Y, OPT_ROWS, OPT_Y, craftX } from './touch.js';

const FPS = 60;                       // assumed: 320x240 VGA mode runs at 60 Hz (original frame limiter not decoded)
const SFX_GAIN = 0.35;                // sound-effect gain at volume 10; the default volume 2 gives 0.07 (20% of the original 0.35)
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const body = document.body;
let cssScale = 1;                      // CSS pixels per game pixel (for converting finger movement)
function fit() {                       // biggest 4:3 box that fits; crisp integer scale when possible, else a higher backing resolution downsampled smoothly
  const f = fitCanvas(innerWidth, innerHeight, devicePixelRatio || 1);
  canvas.width = W * f.backing; canvas.height = H * f.backing;                 // (resizing resets the context state)
  canvas.style.width = f.cssW + 'px'; canvas.style.height = f.cssH + 'px'; canvas.style.imageRendering = f.crisp ? 'pixelated' : 'auto';
  ctx.setTransform(f.backing, 0, 0, f.backing, 0, 0); ctx.imageSmoothingEnabled = false;
  cssScale = f.cssW / W;
  body.classList.toggle('portrait', innerHeight > innerWidth * 1.05);
}
fit(); addEventListener('resize', fit); addEventListener('orientationchange', () => setTimeout(fit, 150));

// --- boot: unpack the original game files ------------------------------------------------------------------------
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
const songs = new Map([...game.midis].map(([n, b]) => [n, parseSMF(b)]));
const creditLines = parseCredits(game.texts.CREDIT_TEXT || '');

// --- persistent options and hall of fame ------------------------------------------------------------------------
const mem = {}; const memStore = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
const store = (() => { try { const s = window.localStorage; s.getItem('x'); return s; } catch { return memStore; } })();
let opts = loadOptions(store);
let hall = loadHall(store, game.hallNames);
const saveOpts = () => { saveOptions(store, opts); applyAudioLevels(); };

// --- audio (context created on the first key press) -------------------------------------------------------------
let ac = null, midiOut = null, player = null; const buffers = {};
// songs differ ~5x in loudness (measured by rendering them offline); these factors even them out to the same RMS
const SONG_GAIN = { MIDI_BOSS: 0.8, MIDI_INTRO: 4, MIDI_LEVEL: 2.2, MIDI_TITLE: 1.2 };
function applyAudioLevels() { if (midiOut) midiOut.gain.value = opts.music ? opts.musicVol / 10 : 0; }
const MUTED = /[?&](mute|nosound)\b/.test(location.search);    // ?mute=1 (testing): never create an audio context, so nothing is played
function initAudio() {
  if (MUTED) return;
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  ac = new AudioContext();
  for (const [n, s] of game.samples) { const b = ac.createBuffer(1, s.samples.length, s.freq); b.copyToChannel(s.samples, 0); buffers[n] = b; }
  midiOut = ac.createGain(); midiOut.connect(ac.destination);
  player = new MidiPlayer(ac, midiOut); applyAudioLevels(); syncMusic();
}
function play(n) {
  if (!ac || !buffers[n] || opts.sfxVol === 0) return;
  const s = ac.createBufferSource(); s.buffer = buffers[n];
  const g = ac.createGain(); g.gain.value = opts.sfxVol / 10 * SFX_GAIN; s.connect(g).connect(ac.destination); s.start();
}
function wantedSong() {
  if (ui.screen === 'game') {
    if (sim.state === 'playing') return sim.bossStatus() ? 'MIDI_BOSS' : 'MIDI_LEVEL';
    if (sim.state === 'briefing' || sim.state === 'levelclear') return 'MIDI_INTRO';
  }
  return 'MIDI_TITLE';
}
function syncMusic() {
  if (!player) return;
  if (!opts.music) { player.stop(); return; }
  const name = wantedSong(); if (player.name !== name) player.play(songs.get(name), { name, gain: SONG_GAIN[name] ?? 1 });
}

// --- input ------------------------------------------------------------------------------------------------------
const keys = new Set(), pressed = new Set(); let typed = [];
const nameInput = document.getElementById('nameInput');
const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ControlLeft', 'AltLeft', 'AltRight', 'Tab']);
let touchMode = matchMedia('(pointer: coarse)').matches || /[?&]touch\b/.test(location.search);   // also switched on by the first finger
let lastTouch = touchMode;                                                                        // last input came from a finger (enables autofire)
addEventListener('keydown', (e) => {
  if (e.target === nameInput && e.key !== 'Enter') return;                                        // the name field types for itself
  lastTouch = false;
  if (BLOCK.has(e.code)) e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code);
  if (e.key.length === 1 || e.key === 'Backspace') typed.push(e.key);
  keys.add(e.code); initAudio();
});
addEventListener('keyup', (e) => keys.delete(e.code));
const any = (...c) => c.some((k) => keys.has(k));
const touchHeld = { fire: false, select: false, special: false };                                // on-screen buttons
const drag = createDrag();                                                                        // drag-anywhere movement (one finger)
const p1Input = () => {
  const i = {
    left: keys.has('ArrowLeft'), right: keys.has('ArrowRight'), up: keys.has('ArrowUp'), down: keys.has('ArrowDown'),
    // touch autofire pulses the gun (3 frames on, 3 off); holding FIRE fires continuously, which also charges the BUILDUP beam
    fire: any('ControlLeft', 'ControlRight', 'Space', 'KeyZ') || touchHeld.fire || (lastTouch && opts.autofire && tick % 6 < 3),
    select: any('KeyC', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight') || touchHeld.select, special: keys.has('KeyX') || touchHeld.special,
  };
  if (drag.id !== null) { i.tx = drag.tx; i.ty = drag.ty; }                                       // ship flies towards the drag target
  return i;
};
const p2Input = () => ({ left: keys.has('KeyA'), right: keys.has('KeyD'), up: keys.has('KeyW'), down: keys.has('KeyS'), fire: keys.has('KeyH'), select: keys.has('KeyJ'), special: keys.has('KeyK') });
const hit = (...c) => c.some((k) => pressed.has(k));

for (const [id, k] of [['b-fire', 'fire'], ['b-select', 'select'], ['b-special', 'special']]) {
  const el = document.getElementById(id);
  const set = (v) => (e) => { e.preventDefault(); touchHeld[k] = v; el.classList.toggle('down', v); if (v) { lastTouch = true; touchMode = true; initAudio(); } };
  el.addEventListener('pointerdown', (e) => { try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer: nothing to capture */ } set(true)(e); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, set(false));
}
document.getElementById('b-pause').addEventListener('pointerdown', (e) => { e.preventDefault(); pressed.add('KeyP'); initAudio(); });

addEventListener('pointerdown', (e) => {
  initAudio();
  if (e.pointerType === 'touch' || e.pointerType === 'pen') { touchMode = true; lastTouch = true; }
  if (e.target.closest && e.target.closest('.btn, #fs, #nameInput')) return;                      // buttons handle themselves
  const playing = ui.screen === 'game' && sim.state === 'playing' && !ui.paused;
  if (playing) {                                                                                  // drag anywhere: the finger's landing point is the origin
    const p = sim.players[0];
    if (touchMode && dragStart(drag, e.pointerId, e.clientX, e.clientY, p.x, p.y)) document.getElementById('hint').classList.add('gone');
    return;
  }
  const [lx, ly] = toLogical(e.clientX, e.clientY, canvas.getBoundingClientRect());              // otherwise it is a menu tap (mouse clicks work too)
  const a = menuTap(ui.screen, lx, ly, { craft: ui.craft[0], state: sim.state, paused: ui.paused });
  if (!a) return;
  if (a.cursor !== undefined) ui.cursor = a.cursor;
  if (a.optCursor !== undefined) ui.optCursor = a.optCursor;
  if (a.craft !== undefined) ui.craft[0] = a.craft;
  for (const k of a.keys) pressed.add(k);
  if (a.focusName || ui.screen === 'name') nameInput.focus();
});
addEventListener('pointermove', (e) => {
  const p = sim.players[0];
  dragMove(drag, e.pointerId, e.clientX, e.clientY, cssScale, { minX: p.w / 2, maxX: W - p.w / 2, minY: p.h / 2, maxY: PLAY_H - p.h / 2 });
});
for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, (e) => dragEnd(drag, e.pointerId));

nameInput.addEventListener('input', () => { nameInput.value = nameInput.value.replace(/[^\w .'-]/g, '').slice(0, MAX_NAME); ui.name = nameInput.value; });

// pause when the page is hidden, the window loses focus, or the phone is held upright
const autoPause = () => { keys.clear(); touchHeld.fire = touchHeld.select = touchHeld.special = false; drag.id = null; if (ui.screen === 'game' && sim.state === 'playing') ui.paused = true; };
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
addEventListener('blur', autoPause);

const fsBtn = document.getElementById('fs');
if (!document.documentElement.requestFullscreen) fsBtn.remove();                                  // e.g. iPhone Safari
else {
  fsBtn.addEventListener('click', async () => { try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); await screen.orientation?.lock?.('landscape'); } catch { /* optional */ } });
  document.addEventListener('fullscreenchange', () => { body.classList.toggle('fullscreen', !!document.fullscreenElement); fit(); });
}

// --- game + ui state ---------------------------------------------------------------------------------------------
const sim = new Sim(data);
const ui = { screen: 'title', cursor: 0, players: 1, craft: [1, 0], locked: [false, false], optCursor: 0, credY: H, paused: false, newRank: -1, nameQueue: [], name: '' };
const MENU = ['PLAYERS', 'OPTIONS', 'HALL OF FAME', 'CREDITS'];

const glow = (() => {                                              // soft light sprite for the lighting effect
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32); return c;
})();
const tinted = {};                                                 // glow sprites per colour, made on first use
function glowSprite(color) {
  if (tinted[color]) return tinted[color];
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
  g.drawImage(glow, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, 32, 32);
  return (tinted[color] = c);
}
const light = (x, y, size, color, alpha = 0.6) => { ctx.globalAlpha = alpha; ctx.drawImage(glowSprite(color), Math.round(x - size / 2), Math.round(y - size / 2), size, size); };

// --- drawing helpers --------------------------------------------------------------------------------------------
const text = (s, x, y, color = '#ddd', align = 'left', px = 8) => {
  ctx.font = px + 'px monospace'; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y);
};
const backArrow = () => { if (touchMode) text('< BACK', 5, 14, '#9ac'); };                // tap target: top-left corner
const drawC = (name, x, y, f = 0) => {                              // sprites are anchored at their centre
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
const starfield = (t) => {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  for (const [n, sp] of [['BKG_STARS1', 0.4], ['BKG_STARS2', 0.9]]) { const off = Math.floor((t * sp) % W); ctx.drawImage(img[n], -off, 0); ctx.drawImage(img[n], W - off, 0); }
};

// --- menu screens ------------------------------------------------------------------------------------------------
let tick = 0;
const COLORS = ['#fd3', '#5df'];                                     // player 1 / player 2 accents
const SLOT_X = [[63, 86], [89, 106], [109, 124], [128, 158], [162, 189], [193, 221], [224, 251], [253, 280], [283, 307]];   // toolbar slots (x from toolbar origin)

function drawTitle() {
  starfield(tick);
  drawC('TITLE', W / 2, 52);
  MENU.forEach((label, i) => {
    const y = TITLE_Y(i), sel = ui.cursor === i;
    const s = i === 0 ? ui.players + ' PLAYER GAME' : label;
    text((sel ? '> ' : '  ') + s + (sel ? ' <' : '  '), W / 2, y, sel ? '#fff' : '#789', 'center', 10);
  });
  if (touchMode) {
    text('TAP A ROW.  TAP THE LEFT / RIGHT SIDE OF "PLAYERS"', W / 2, 206, '#9ac', 'center');
    text('TO SWITCH 1 / 2 PLAYERS (TOUCH CONTROLS PLAYER 1)', W / 2, 218, '#678', 'center');
  } else {
    text('UP/DOWN + ENTER.  LEFT/RIGHT CHANGES 1/2 PLAYERS', W / 2, 206, '#9ac', 'center');
    text('P1: ARROWS  SPACE FIRE  C UPGRADE  X SPECIAL', W / 2, 218, '#678', 'center');
    text('P2: WASD  H FIRE  J UPGRADE  K SPECIAL', W / 2, 228, '#678', 'center');
  }
}

function drawCraft() {
  starfield(tick);
  text('CHOOSE YOUR CRAFT', W / 2, 40, '#fc4', 'center', 10);
  const n = ui.players;
  SHIPS.forEach((s, i) => {
    const x = craftX(i);
    drawC(s.sprite, x, 110);
    text(s.name, x, 135, '#ccd', 'center');
    text(s.special, x, 146, '#789', 'center');
  });
  for (let p = 0; p < n; p++) {
    const x = craftX(ui.craft[p]);
    text(ui.locked[p] ? 'P' + (p + 1) + ' READY' : 'P' + (p + 1) + ' ^', x, 160 + p * 12, COLORS[p], 'center');
  }
  text(touchMode ? 'TAP A CRAFT, TAP IT AGAIN TO FLY' : n === 1 ? 'LEFT/RIGHT, ENTER TO FLY' : 'P1: LEFT/RIGHT + ENTER    P2: A/D + H', W / 2, 205, '#9ac', 'center');
  if (!touchMode) text('ESC: BACK', W / 2, 220, '#678', 'center');
  backArrow();
}

const optValue = (i) => [opts.music ? 'ON' : 'OFF', '#'.repeat(opts.musicVol) + '.'.repeat(10 - opts.musicVol), '#'.repeat(opts.sfxVol) + '.'.repeat(10 - opts.sfxVol),
  DIFFICULTIES[opts.difficulty - 1], opts.lighting ? 'ON' : 'OFF', opts.autofire ? 'ON' : 'OFF', ''][i];
function drawOptions() {
  starfield(tick);
  text('OPTIONS', W / 2, 40, '#fc4', 'center', 12);
  OPT_ROWS.forEach((label, i) => {
    const y = OPT_Y(i), sel = ui.optCursor === i;
    text(label, 60, y, sel ? '#fff' : '#789');
    const v = optValue(i);
    if (v) text(sel ? '< ' + v + ' >' : v, 172, y, sel ? '#fd3' : '#9ab');
  });
  if (opts.difficulty <= 2) text('PRACTICE AND EASY HOLD ONLY 3 LEVELS.', W / 2, 205, '#f96', 'center');
  text(touchMode ? 'TAP A ROW. TAP < OR > TO CHANGE.  AUTO FIRE: TOUCH ONLY' : 'UP/DOWN SELECT   LEFT/RIGHT CHANGE   ESC BACK', W / 2, 222, '#9ac', 'center');
  backArrow();
}

function drawHall() {
  starfield(tick);
  text('HALL OF FAME', W / 2, 36, '#fc4', 'center', 12);
  hall.forEach((e, i) => {
    const y = 66 + i * 15, c = i === ui.newRank ? '#fd3' : '#cde';
    text(String(i + 1).padStart(2, ' ') + '.', 40, y, c); text(e.name, 66, y, c); text(String(e.score).padStart(8, ' '), 276, y, c, 'right');
    const s = SHIPS[e.ship]; if (s && img[s.sprite]) ctx.drawImage(img[s.sprite], 282, y - 9);
  });
  text(touchMode ? 'TAP TO GO BACK' : 'ENTER / ESC: BACK', W / 2, 228, '#9ac', 'center');
}

function drawCredits() {
  starfield(tick);
  let y = ui.credY;
  for (const l of creditLines) {
    const px = l.size === 'large' ? 16 : l.size === 'small' ? 9 : 10;
    if (y > -16 && y < H + 16) {
      ctx.font = px + 'px monospace';
      let w = 0; for (const s of l.spans) w += ctx.measureText(s.text).width;
      let x = W / 2 - w / 2;
      for (const s of l.spans) { text(s.text, x, y, s.color, 'left', px); x += ctx.measureText(s.text).width; }
    }
    y += l.spans.length ? px + 4 : 8;
  }
  if (y < -10) ui.screen = 'title';
  if (!touchMode) text('ESC: BACK', W - 6, H - 4, '#567', 'right');
  backArrow();
}

function drawName() {
  starfield(tick);
  const who = ui.nameQueue[0], p = sim.players[who];
  text('NEW HIGH SCORE!', W / 2, 70, '#fc4', 'center', 12);
  text('PLAYER ' + (who + 1) + ', ENTER YOUR NAME.', W / 2, 100, '#ddd', 'center', 10);
  text(String(p.score).padStart(8, ' ') + ' POINTS', W / 2, 120, '#fff', 'center', 10);
  text(ui.name + (tick % 40 < 20 ? '_' : ' '), W / 2, 156, COLORS[who] || '#fd3', 'center', 12);
  if (touchMode) {
    text('TAP THE SCREEN TO TYPE', W / 2, 172, '#9ac', 'center');
    ctx.strokeStyle = '#fd3'; ctx.lineWidth = 1; ctx.strokeRect(100.5, 180.5, 119, 18); text('DONE', W / 2, 193, '#fd3', 'center', 10);
  } else text('TYPE, BACKSPACE TO FIX, ENTER TO CONFIRM', W / 2, 206, '#9ac', 'center');
}

// --- gameplay screen ---------------------------------------------------------------------------------------------
function drawBar(p, k) {
  SLOTS.forEach((s, i) => {
    const [x0, x1] = SLOT_X[i], lv = p.wep[s];
    ctx.fillStyle = k === 0 ? '#5f5' : '#5df';
    for (let j = 0; j < lv; j++) ctx.fillRect(1 + x0 + j * 4, PLAY_H - 3 - k * 3, 3, 2);          // upgrade level pips above the slot
    if (p.bar === i + 1) { ctx.strokeStyle = COLORS[k]; ctx.lineWidth = 1; ctx.strokeRect(1 + x0 + 0.5 + k, PLAY_H + 0.5 + k, x1 - x0 - 2 * k, 10 - 2 * k); }
  });
  if (p.bar > SLOTS.length) { ctx.strokeStyle = '#6af'; ctx.strokeRect(1 + SLOT_X[8][0] + 0.5, PLAY_H + 0.5, SLOT_X[8][1] - SLOT_X[8][0], 10); }
}

function drawLights() {                                              // additive glows: shots, pickups, explosions
  ctx.globalCompositeOperation = 'lighter';
  for (const b of sim.bullets) light(b.x, b.y, 20 + b.h * 2, b.src === 'magma' ? '#f80' : '#4f6', 0.5);
  for (const b of sim.ebullets) light(b.x, b.y, 18, '#f44', 0.5);
  for (const pk of sim.pickups) light(pk.x, pk.y, 34, pk.kind === 'S' ? '#fa3' : pk.kind === '1UP' ? '#c6f' : '#5f7', 0.55);
  for (const f of sim.fx) if (f.t >= 0) light(f.x, f.y, Math.max(8, 46 - f.t / f.speed * 6), f.frames[0] === 'MHIT1' ? '#fb4' : '#8cf', 0.55);
  for (const bm of sim.beams) light(bm.x + 60, bm.own.y, 120, '#5f8', 0.25 * (1 - bm.t / 14));
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}

function drawGame() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (sim.state === 'briefing') {
    text('LEVEL ' + (sim.levelNo + 1) + ': ' + sim.level.name.toUpperCase(), W / 2, 60, '#fc4', 'center', 10);
    wrapText(sim.level.briefing, 44).forEach((l, i) => text(l, W / 2, 90 + i * 11, '#ddd', 'center'));
    text(touchMode ? 'TAP TO START' : 'PRESS ENTER', W / 2, 200, '#9ac', 'center');
    return;
  }
  wrapLayer('BKG_STARS1', 0.4); wrapLayer('BKG_STARS2', 0.9);
  for (const s of sim.scenery) if (bgImg[s.idx]) ctx.drawImage(bgImg[s.idx], Math.round(s.x - s.w / 2), Math.round(s.y - s.h / 2));
  for (const e of sim.enemies) drawC(sim.sprites[e.def.sprite_index].name, e.x, e.y, e.frame);
  for (const pk of sim.pickups) drawC(pk.kind === 'S' ? 'SUP000' : pk.kind === '1UP' ? 'ONEUP' : 'PUP' + String(pk.age % 18).padStart(3, '0'), pk.x, pk.y);
  for (const bm of sim.beams) {                                      // BUILDUP beam: a 320x30 sprite fading out
    const x = Math.round(bm.x), len = Math.max(0, W - x);
    ctx.globalAlpha = 1 - bm.t / 14; ctx.drawImage(img.BUILDUP, 0, 0, len, 30, x, Math.round(bm.own.y - 15), len, 30); ctx.globalAlpha = 1;
  }
  for (const b of sim.bullets) drawC(b.spr, b.x, b.y);
  for (const b of sim.ebullets) drawC(b.spr, b.x, b.y, Math.floor(b.age / 3) % (b.frames || 1));
  for (const p of sim.players) {
    if (p.out || p.dead > 0 || !(p.inv === 0 || sim.frame % 6 < 3)) continue;
    for (let i = 0; i < p.wep.OPTION; i++) { const o = sim.optionPos(i, p); drawC('OPTION', o.x, o.y); }
    drawC(p.ship.sprite, p.x, p.y);
    if (p.berserk > 0 && sim.frame % 4 < 2) { ctx.fillStyle = 'rgba(255,60,20,0.35)'; ctx.fillRect(Math.round(p.x - p.w / 2), Math.round(p.y - p.h / 2), p.w, p.h); }
    if (p.charge > 4) { ctx.fillStyle = p.charge >= CHARGE_MIN ? '#8f8' : '#486'; ctx.fillRect(Math.round(p.x - 10), Math.round(p.y + p.h / 2 + 2), Math.min(20, p.charge * 20 / CHARGE_MIN), 2); }
    if (sim.players.length > 1) text('P' + (p.i + 1), p.x, p.y - p.h / 2 - 3, COLORS[p.i], 'center', 7);
  }
  for (const f of sim.fx) if (f.t >= 0) drawC(f.frames[Math.min(f.frames.length - 1, Math.floor(f.t / f.speed))], f.x, f.y);
  if (opts.lighting) drawLights();
  if (sim.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${sim.flash / 14})`; ctx.fillRect(0, 0, W, PLAY_H); }
  ctx.drawImage(img.TOOLBAR, 1, PLAY_H);
  sim.players.forEach((p, k) => drawBar(p, k));
  const boss = sim.bossStatus();
  if (boss) {                                                        // guardian energy bar
    ctx.fillStyle = '#400'; ctx.fillRect(80, 34, 160, 4);
    ctx.fillStyle = '#f33'; ctx.fillRect(80, 34, Math.round(160 * boss.hp / boss.max), 4);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(79.5, 33.5, 161, 5);
  }
  sim.players.forEach((p, k) => {                                    // per-player HUD block: left for P1, right for P2
    const x = k === 0 ? 6 : W - 6, al = k === 0 ? 'left' : 'right';
    text((sim.players.length > 1 ? 'P' + (k + 1) + ' ' : 'SCORE ') + String(p.score).padStart(7, '0'), x, 9, COLORS[k], al);
    text('SHIPS ' + Math.max(0, p.lives) + (p.lock ? '  LOCK' : ''), x, 19, p.out ? '#a55' : '#fff', al);
    text(p.ship.special + ' x' + p.specials, x, 29, p.specials ? '#fc4' : '#765', al);
  });
  text('LVL ' + (sim.levelNo + 1), W / 2, 9, '#9ac', 'center');
  const banner = { levelclear: 'LEVEL COMPLETED', gameover: 'GAME OVER', won: 'YOU SAVED EARTH!' }[sim.state];
  if (banner) { text(banner, W / 2, 110, '#fc4', 'center', 12); text(touchMode ? 'TAP TO CONTINUE' : 'PRESS ENTER', W / 2, 130, '#9ac', 'center'); }
  if (ui.paused) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H); text('PAUSED', W / 2, 110, '#fff', 'center', 14); text(touchMode ? 'TAP TO RESUME' : 'P / ESC: RESUME    Q: QUIT TO MENU', W / 2, 130, '#9ac', 'center'); if (touchMode) text('QUIT TO MENU', W / 2, 154, '#f96', 'center', 10); }
}

const SCREENS = { title: drawTitle, craft: drawCraft, options: drawOptions, hall: drawHall, credits: drawCredits, name: drawName, game: drawGame };
const render = () => SCREENS[ui.screen]();

// --- flow -------------------------------------------------------------------------------------------------------
function startGame() {
  sim.difficulty = opts.difficulty;
  sim.newGame(ui.craft[0], ui.players === 2 ? ui.craft[1] : null);
  ui.screen = 'game'; ui.paused = false; play('SND_SELECT');
}

function finishGame() {                                              // after game over / victory: record high scores
  ui.nameQueue = sim.players.map((p, i) => [p, i]).filter(([p]) => qualifies(hall, p.score)).sort((a, b) => b[0].score - a[0].score).map(([, i]) => i);
  ui.newRank = -1; nextNameOrHall();
}
function nextNameOrHall() {
  if (ui.nameQueue.length) { ui.screen = 'name'; ui.name = ''; typed = []; nameInput.value = ''; if (touchMode) nameInput.focus(); }
  else ui.screen = ui.newRank >= 0 ? 'hall' : 'title';
}

function handleKeys() {
  const up = hit('ArrowUp', 'KeyW'), down = hit('ArrowDown', 'KeyS'), left = hit('ArrowLeft', 'KeyA'), right = hit('ArrowRight', 'KeyD');
  const enter = hit('Enter', 'NumpadEnter'), esc = hit('Escape');
  switch (ui.screen) {
    case 'title':
      if (up) ui.cursor = (ui.cursor + MENU.length - 1) % MENU.length;
      if (down) ui.cursor = (ui.cursor + 1) % MENU.length;
      if (ui.cursor === 0 && (left || right)) ui.players = ui.players === 1 ? 2 : 1;
      if (enter) {
        if (ui.cursor === 0) { ui.screen = 'craft'; ui.locked = [false, false]; }
        else if (ui.cursor === 1) { ui.screen = 'options'; ui.optCursor = 0; }
        else if (ui.cursor === 2) { ui.screen = 'hall'; ui.newRank = -1; }
        else { ui.screen = 'credits'; ui.credY = H; }
      }
      break;
    case 'craft': {
      if (esc) { ui.screen = 'title'; break; }
      const n = ui.players;
      if (!ui.locked[0]) { if (hit('ArrowLeft')) ui.craft[0] = (ui.craft[0] + 2) % 3; if (hit('ArrowRight')) ui.craft[0] = (ui.craft[0] + 1) % 3; if (enter) ui.locked[0] = true; }
      if (n === 2 && !ui.locked[1]) { if (hit('KeyA')) ui.craft[1] = (ui.craft[1] + 2) % 3; if (hit('KeyD')) ui.craft[1] = (ui.craft[1] + 1) % 3; if (hit('KeyH')) ui.locked[1] = true; }
      if (ui.locked[0] && (n === 1 || ui.locked[1])) startGame();
      break;
    }
    case 'options':
      if (esc) ui.screen = 'title';
      if (up) ui.optCursor = (ui.optCursor + OPT_ROWS.length - 1) % OPT_ROWS.length;
      if (down) ui.optCursor = (ui.optCursor + 1) % OPT_ROWS.length;
      if (left || right || enter) {
        const d = right || enter ? 1 : -1, c = ui.optCursor;
        if (c === 0) opts.music = !opts.music;
        else if (c === 1) opts.musicVol = Math.min(10, Math.max(0, opts.musicVol + d));
        else if (c === 2) { opts.sfxVol = Math.min(10, Math.max(0, opts.sfxVol + d)); play('SND_FIRE1'); }
        else if (c === 3) opts.difficulty = Math.min(6, Math.max(1, opts.difficulty + d));
        else if (c === 4) opts.lighting = !opts.lighting;
        else if (c === 5) opts.autofire = !opts.autofire;
        else if (c === 6 && enter) ui.screen = 'title';
        saveOpts(); syncMusic();
      }
      break;
    case 'hall': case 'credits': if (enter || esc) ui.screen = 'title'; break;
    case 'name': {
      for (const k of typed.splice(0)) {
        if (k === 'Backspace') ui.name = ui.name.slice(0, -1);
        else if (/^[\w .'-]$/.test(k) && ui.name.length < MAX_NAME) ui.name += k;
      }
      if (enter) {
        const who = ui.nameQueue.shift(), p = sim.players[who];
        const r = addScore(hall, { name: ui.name || 'PILOT', score: p.score, ship: SHIPS.indexOf(p.ship) });
        hall = r.hall; saveHall(store, hall); ui.newRank = r.rank; nameInput.blur();
        nextNameOrHall();
      }
      break;
    }
    case 'game':
      if (sim.state === 'playing') {
        if (hit('KeyP', 'Escape')) ui.paused = !ui.paused;
        if (ui.paused && hit('KeyQ')) { ui.screen = 'title'; ui.paused = false; sim.state = 'title'; }
      } else if (enter) {
        if (sim.state === 'briefing') sim.begin();
        else if (sim.state === 'levelclear') sim.nextLevel();
        else if (sim.state === 'gameover' || sim.state === 'won') finishGame();
      }
      break;
  }
  pressed.clear();
}

let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(100, now - last); last = now;
  handleKeys();
  if (touchMode && body.classList.contains('portrait')) autoPause();
  const playing = ui.screen === 'game' && sim.state === 'playing' && !ui.paused;
  body.classList.toggle('touch', touchMode); body.classList.toggle('play', playing); body.classList.toggle('menu', !playing);
  while (acc >= 1000 / FPS) {
    tick++;
    if (ui.screen === 'credits') ui.credY -= 0.45;
    if (ui.screen === 'game' && sim.state === 'playing' && !ui.paused) sim.step(sim.players.length === 2 ? [p1Input(), p2Input()] : p1Input());
    acc -= 1000 / FPS;
  }
  for (const s of sim.sfx.splice(0)) play(s);
  syncMusic();
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__sim = sim; window.__ui = ui; window.__touch = { held: touchHeld, drag };     // handy for debugging in the console
window.__music = () => ({ ctx: ac && ac.state, song: player && player.name, voices: player ? player.synth.voices.length : 0, gain: midiOut && midiOut.gain.value });
