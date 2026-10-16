// Menu-side logic that does not touch the DOM: persistent options, the hall of fame, and the credits-text parser.
// Storage is any object with getItem/setItem (localStorage in the browser); every access is guarded because storage can be
// missing or blocked (private windows) and must never break the game.

export const DEFAULT_OPTIONS = { music: true, musicVol: 4, sfxVol: 2, difficulty: 3, lighting: true };   // difficulty: 1..6 = PRACTICE..INSANE
export const HALL_SIZE = 10;
export const MAX_NAME = 14;
const OPT_KEY = 'spacehog.options.v1', HALL_KEY = 'spacehog.hall.v1';

const clampInt = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);

export function sanitizeOptions(o) {
  const d = DEFAULT_OPTIONS; o = o && typeof o === 'object' ? o : {};
  return {
    music: typeof o.music === 'boolean' ? o.music : d.music,
    musicVol: clampInt(o.musicVol, 0, 10, d.musicVol), sfxVol: clampInt(o.sfxVol, 0, 10, d.sfxVol),
    difficulty: clampInt(o.difficulty, 1, 6, d.difficulty), lighting: typeof o.lighting === 'boolean' ? o.lighting : d.lighting,
  };
}

function read(store, key) { try { return JSON.parse(store.getItem(key)); } catch { return null; } }
function write(store, key, v) { try { store.setItem(key, JSON.stringify(v)); return true; } catch { return false; } }

export const loadOptions = (store) => sanitizeOptions(read(store, OPT_KEY));
export const saveOptions = (store, o) => write(store, OPT_KEY, sanitizeOptions(o));

// The original ships ten pilots (names are in SH.EXE) scoring 50000 down to 5000.
export const defaultHall = (names) => names.slice(0, HALL_SIZE).map((name, i) => ({ name, score: 50000 - i * 5000, ship: i % 3 }));

export function sanitizeHall(list, names) {
  if (!Array.isArray(list)) return defaultHall(names);
  const ok = list.filter((e) => e && typeof e.name === 'string' && Number.isFinite(e.score) && e.score >= 0)
    .map((e) => ({ name: e.name.slice(0, MAX_NAME), score: Math.floor(e.score), ship: clampInt(e.ship, 0, 2, 0) }));
  return ok.length ? ok.sort((a, b) => b.score - a.score).slice(0, HALL_SIZE) : defaultHall(names);
}

export const loadHall = (store, names) => sanitizeHall(read(store, HALL_KEY), names);
export const saveHall = (store, hall) => write(store, HALL_KEY, hall);

// does `score` earn a place? (zero never does; ties go below existing entries)
export const qualifies = (hall, score) => score > 0 && (hall.length < HALL_SIZE || score > hall[hall.length - 1].score);

// returns { hall, rank } with rank = 0-based position of the new entry, or -1 when it did not make the list
export function addScore(hall, entry) {
  if (!qualifies(hall, entry.score)) return { hall, rank: -1 };
  const e = { name: (entry.name || 'PILOT').trim().slice(0, MAX_NAME) || 'PILOT', score: Math.floor(entry.score), ship: clampInt(entry.ship, 0, 2, 0) };
  let rank = hall.findIndex((x) => e.score > x.score); if (rank < 0) rank = hall.length;
  const next = [...hall.slice(0, rank), e, ...hall.slice(rank)].slice(0, HALL_SIZE);
  return { hall: next, rank };
}

// --- credits text ----------------------------------------------------------------------------------------------------
// CREDIT_TEXT uses inline codes: "\n" ends a line, "\1".."\7" pick a colour, "\c" centre, "\l" large type, "\s" small type, "\e" end.
export const CREDIT_COLORS = { 1: '#ffffff', 2: '#ffcc44', 3: '#9aa6b8', 4: '#ffe98a', 5: '#d6e2f0', 6: '#6fb0ff', 7: '#ff8c4a' };

export function parseCredits(text) {
  const lines = [];
  for (const seg of text.replace(/\r?\n/g, '').split('\\n')) {
    if (seg.startsWith('\\e')) break;
    const line = { spans: [], size: 'normal' }; let color = 1, buf = '';
    const flush = () => { if (buf) line.spans.push({ text: buf, color: CREDIT_COLORS[color] }); buf = ''; };
    for (let i = 0; i < seg.length; i++) {
      if (seg[i] === '\\' && i + 1 < seg.length) {
        const c = seg[++i];
        if (c >= '0' && c <= '9') { flush(); color = Number(c) || 1; }
        else if (c === 'l') line.size = 'large'; else if (c === 's') line.size = 'small';   // 'c' (centre) is the default layout
      } else buf += seg[i];
    }
    flush(); lines.push(line);
  }
  return lines;
}
