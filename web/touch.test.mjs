import test from 'node:test';
import assert from 'node:assert/strict';
import { GAIN, createDrag, dragStart, dragMove, dragEnd, fitCanvas, toLogical, menuTap, TITLE_Y, OPT_Y, OPT_ROWS, craftX } from './touch.js';

const B = { minX: 12, maxX: 308, minY: 8, maxY: 220 };

test('drag anywhere is relative: the ship target moves by the finger offset (scaled by GAIN and the display scale), wherever the finger lands', () => {
  const d = createDrag(); assert.ok(dragStart(d, 7, 600, 300, 100, 100));
  let t = dragMove(d, 7, 600, 300, 2, B); assert.deepEqual(t, { tx: 100, ty: 100 }, 'no movement yet: target stays at the ship');
  t = dragMove(d, 7, 640, 270, 2, B);                                 // finger 40 right, 30 up in CSS px at 2 css px per game px
  assert.ok(Math.abs(t.tx - (100 + 20 * GAIN)) < 1e-9); assert.ok(Math.abs(t.ty - (100 - 15 * GAIN)) < 1e-9);
});

test('only the first finger drives movement; other fingers and ids are ignored; lifting stops the drag', () => {
  const d = createDrag(); assert.ok(dragStart(d, 1, 0, 0, 50, 50));
  assert.equal(dragStart(d, 2, 10, 10, 60, 60), false); assert.equal(dragMove(d, 2, 99, 99, 1, B), null);
  assert.equal(dragEnd(d, 2), false); assert.equal(d.id, 1);
  assert.ok(dragEnd(d, 1)); assert.equal(d.id, null); assert.equal(dragMove(d, 1, 5, 5, 1, B), null);
  assert.ok(dragStart(d, 3, 0, 0, 80, 80), 'a new drag can start after the first ended');
});

test('pushing past the edge clamps the target and shifts the origin, so reversing responds at once', () => {
  const d = createDrag(); dragStart(d, 1, 0, 0, 300, 100);
  let t = dragMove(d, 1, 400, 0, 1, B); assert.equal(t.tx, B.maxX, 'clamped at the right bound');
  t = dragMove(d, 1, 400 - 10, 0, 1, B);                              // finger reverses by just 10 css px
  assert.ok(Math.abs(t.tx - (B.maxX - 10 * GAIN)) < 1e-9, 'moves back immediately, not after retracing the 100 px overshoot');
  t = dragMove(d, 1, -3000, 0, 1, B); assert.equal(t.tx, B.minX);
  t = dragMove(d, 1, -3000 + 20, 0, 1, B); assert.ok(Math.abs(t.tx - (B.minX + 20 * GAIN)) < 1e-9);
  const v = dragMove(d, 1, 0, 9999, 1, B); assert.equal(v.ty, B.maxY);
});

test('canvas fitting: snaps to crisp integer scale when it (nearly) fits, else renders at a higher integer multiple and downsamples', () => {
  assert.deepEqual(fitCanvas(1280, 960, 1), { cssW: 1280, cssH: 960, backing: 4, crisp: true });
  assert.deepEqual(fitCanvas(640, 480, 1), { cssW: 640, cssH: 480, backing: 2, crisp: true });
  const phone = fitCanvas(812, 375, 2);                               // landscape phone, 2x density: 3.125 device px per game px
  assert.equal(phone.crisp, false); assert.ok(Math.abs(phone.cssW - 500) < 1e-9 && Math.abs(phone.cssH - 375) < 1e-9); assert.equal(phone.backing, 4);
  const never = fitCanvas(321, 241, 1); assert.equal(never.crisp, true); assert.equal(never.cssW, 320);
  for (const [w, h, r] of [[812, 375, 2], [844, 390, 3], [667, 375, 2], [1024, 768, 2], [300, 200, 1], [360, 800, 3]]) {
    const f = fitCanvas(w, h, r); assert.ok(f.cssW <= w + 1e-9 && f.cssH <= h + 1e-9, `${w}x${h} overflows`); assert.ok(f.backing >= 1 && f.backing <= 4);
    assert.ok(Math.abs(f.cssW / f.cssH - 4 / 3) < 1e-9);
  }
});

test('pointer to logical coordinates', () => {
  assert.deepEqual(toLogical(150, 100, { left: 50, top: 25, width: 400, height: 300 }), [80, 60]);
});

test('title menu taps: rows select and activate; the players row has left / right zones', () => {
  assert.deepEqual(menuTap('title', 160, TITLE_Y(1)), { cursor: 1, keys: ['Enter'] });
  assert.deepEqual(menuTap('title', 160, TITLE_Y(3) - 5), { cursor: 3, keys: ['Enter'] });
  assert.deepEqual(menuTap('title', 60, TITLE_Y(0)), { cursor: 0, keys: ['ArrowLeft'] });
  assert.deepEqual(menuTap('title', 260, TITLE_Y(0)), { cursor: 0, keys: ['ArrowRight'] });
  assert.deepEqual(menuTap('title', 160, TITLE_Y(0)), { cursor: 0, keys: ['Enter'] });
  assert.equal(menuTap('title', 160, 20), null); assert.equal(menuTap('title', 160, TITLE_Y(3) + 20), null);
});

test('craft select: tap a ship to pick it, tap the picked one to fly; the back arrow leaves', () => {
  assert.deepEqual(menuTap('craft', craftX(2), 110, { craft: 1 }), { craft: 2, keys: [] });
  assert.deepEqual(menuTap('craft', craftX(2), 110, { craft: 2 }), { keys: ['Enter'] });
  assert.deepEqual(menuTap('craft', 10, 10, { craft: 0 }), { keys: ['Escape'] });
  assert.equal(menuTap('craft', 160, 200, { craft: 0 }), null);
});

test('options: tapping a label selects the row, the value zone lowers (left) or raises/toggles (right), MAIN MENU leaves', () => {
  assert.deepEqual(menuTap('options', 90, OPT_Y(1)), { optCursor: 1, keys: [] });
  assert.deepEqual(menuTap('options', 190, OPT_Y(1)), { optCursor: 1, keys: ['ArrowLeft'] });
  assert.deepEqual(menuTap('options', 260, OPT_Y(2)), { optCursor: 2, keys: ['ArrowRight'] });
  assert.deepEqual(menuTap('options', 100, OPT_Y(OPT_ROWS.length - 1)), { optCursor: OPT_ROWS.length - 1, keys: ['Enter'] });
  assert.deepEqual(menuTap('options', 10, 10), { keys: ['Escape'] });
});

test('game-state taps: continue screens = Enter; while playing taps belong to the drag; paused resumes or quits; name entry focuses the keyboard', () => {
  for (const state of ['briefing', 'levelclear', 'gameover', 'won']) assert.deepEqual(menuTap('game', 100, 100, { state }), { keys: ['Enter'] });
  assert.equal(menuTap('game', 100, 100, { state: 'playing', paused: false }), null);
  assert.deepEqual(menuTap('game', 100, 100, { state: 'playing', paused: true }), { keys: ['KeyP'] });
  assert.deepEqual(menuTap('game', 160, 150, { state: 'playing', paused: true }), { keys: ['KeyQ'] });
  assert.deepEqual(menuTap('name', 160, 100), { keys: [], focusName: true }); assert.deepEqual(menuTap('name', 160, 188), { keys: ['Enter'] });
  for (const s of ['hall', 'credits']) assert.deepEqual(menuTap(s, 160, 100), { keys: ['Enter'] });
});
