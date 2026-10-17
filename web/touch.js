// Touch / small-screen logic, kept free of the DOM so it can be tested: drag-anywhere movement, tap-to-action mapping for the menus,
// and how to size the canvas for any viewport. main.js wires these to pointer events.

export const W = 320, H = 240;
export const GAIN = 1.4;                       // logical pixels the ship target moves per logical pixel the finger moves

// --- drag anywhere ---------------------------------------------------------------------------------------------------
// Relative control: wherever the finger lands becomes the origin; moving it moves a *target* for the ship by the same (scaled) offset.
// The sim moves the ship towards the target at its own speed. The target is held inside `bounds`; when the finger runs past the
// edge the origin is shifted so reversing direction responds immediately (no dead travel).
export const createDrag = () => ({ id: null, sx: 0, sy: 0, ax: 0, ay: 0, tx: 0, ty: 0 });

export function dragStart(d, id, cx, cy, shipX, shipY) {
  if (d.id !== null) return false;                                   // one finger drives movement; the others are buttons
  Object.assign(d, { id, sx: cx, sy: cy, ax: shipX, ay: shipY, tx: shipX, ty: shipY });
  return true;
}

export function dragMove(d, id, cx, cy, cssScale, b) {
  if (d.id === null || id !== d.id) return null;
  let tx = d.ax + (cx - d.sx) / cssScale * GAIN, ty = d.ay + (cy - d.sy) / cssScale * GAIN;
  const cx2 = Math.min(b.maxX, Math.max(b.minX, tx)), cy2 = Math.min(b.maxY, Math.max(b.minY, ty));
  d.ax += cx2 - tx; d.ay += cy2 - ty;                                // shift the origin by the amount clamped away
  d.tx = cx2; d.ty = cy2;
  return { tx: cx2, ty: cy2 };
}

export function dragEnd(d, id) { if (id !== d.id) return false; d.id = null; return true; }

// --- canvas fitting --------------------------------------------------------------------------------------------------
// The biggest 4:3 box that fits. If that is (just over) a whole number of device pixels per game pixel, snap to it and keep pixels
// crisp; otherwise render at a higher integer multiple and let the browser scale down smoothly, which avoids uneven pixel shimmer.
export function fitCanvas(vw, vh, dpr = 1) {
  const fit = Math.min(vw / W, vh / H), target = fit * dpr, near = Math.floor(target);
  if (near >= 1 && target - near < 0.03 * near) return { cssW: W * near / dpr, cssH: H * near / dpr, backing: near, crisp: true };
  return { cssW: W * fit, cssH: H * fit, backing: Math.min(4, Math.max(1, Math.ceil(target))), crisp: false };
}

export const toLogical = (cx, cy, rect) => [(cx - rect.left) / rect.width * W, (cy - rect.top) / rect.height * H];

// --- menu hit testing ------------------------------------------------------------------------------------------------
// Row positions mirror the drawing code in main.js (text baselines); a row's tap band runs from 13 px above the baseline to 6 below.
export const TITLE_ROWS = 4, TITLE_Y = (i) => 108 + i * 18;
export const OPT_ROWS = ['MUSIC', 'MUSIC VOL', 'SFX VOL', 'LEVEL', 'LIGHTING', 'AUTO FIRE', 'MAIN MENU'], OPT_Y = (i) => 72 + i * 18;
export const craftX = (i) => 60 + i * 100;
const band = (y, base) => y >= base - 13 && y <= base + 6;

// -> null (not a menu tap) or { keys: [KeyboardEvent.code...], cursor?, optCursor?, craft?, focusName? }
export function menuTap(screen, lx, ly, st = {}) {
  if (['craft', 'options', 'hall', 'credits'].includes(screen) && lx < 34 && ly < 28) return { keys: ['Escape'] };      // back arrow
  switch (screen) {
    case 'title':
      for (let i = 0; i < TITLE_ROWS; i++) if (band(ly, TITLE_Y(i))) {
        const keys = i === 0 && lx < 110 ? ['ArrowLeft'] : i === 0 && lx > 210 ? ['ArrowRight'] : ['Enter'];
        return { cursor: i, keys };
      }
      return null;
    case 'craft':
      for (let i = 0; i < 3; i++) if (Math.abs(lx - craftX(i)) <= 48 && ly >= 80 && ly <= 165) return st.craft === i ? { keys: ['Enter'] } : { craft: i, keys: [] };
      return null;
    case 'options':
      for (let i = 0; i < OPT_ROWS.length; i++) if (band(ly, OPT_Y(i))) {
        if (i === OPT_ROWS.length - 1) return { optCursor: i, keys: ['Enter'] };               // MAIN MENU
        if (lx < 170) return { optCursor: i, keys: [] };                                       // label: just select
        return { optCursor: i, keys: [lx < 225 ? 'ArrowLeft' : 'ArrowRight'] };                // value: left half lowers, right half raises / toggles
      }
      return null;
    case 'hall': case 'credits': return { keys: ['Enter'] };
    case 'name': return lx >= 100 && lx <= 220 && ly >= 176 && ly <= 198 ? { keys: ['Enter'] } : { keys: [], focusName: true };
    case 'game':
      if (st.state === 'playing') return st.paused ? { keys: [ly > 140 && ly < 160 ? 'KeyQ' : 'KeyP'] } : null;   // paused: tap QUIT, or anywhere to resume
      return { keys: ['Enter'] };                                                                // briefing / level complete / game over / won
    default: return null;
  }
}
