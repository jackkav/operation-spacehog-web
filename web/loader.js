// Loads Operation Spacehog's data straight from the author's original, unmodified spacehog.zip (freeware, distributed "in its
// original form"). Nothing is converted ahead of time: this module unzips, unpacks SH.EXE (UPX), decrypts/decompresses the
// Allegro datafiles and decodes sprites, sounds, levels and paths in the browser. Pure JS, no DOM (runs under Node too).
// Formats are documented in ../NOTES.md; this is a port of tools/*.py.

const PASSWORD = new TextEncoder().encode('skidmarks');
const latin1 = (b) => new TextDecoder('latin1').decode(b);
const cstr = (b) => latin1(b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)));

// --- zip -------------------------------------------------------------------------------------------------------------
async function inflateRaw(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function unzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = u8.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true), name = latin1(u8.subarray(p + 46, p + 46 + nl)).toUpperCase();
    const dataStart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = u8.subarray(dataStart, dataStart + csize);
    files[name] = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : (() => { throw new Error('zip method ' + method); })();
    p += 46 + nl + el + cl;
  }
  return files;
}

// --- Allegro 3.x packfile (LZSS; "old crypt" xors only the flag bytes with the password) -----------------------------
export function alUnpack(data, password = PASSWORD) {
  const N = 4096, F = 18, TH = 2;
  const ring = new Uint8Array(N); let r = N - F, s = 4, pp = 0;     // skip the 4-byte magic
  let out = new Uint8Array(data.length * 4), o = 0;
  const put = (b) => { if (o === out.length) { const g = new Uint8Array(out.length * 2); g.set(out); out = g; } out[o++] = b; ring[r] = b; r = (r + 1) & (N - 1); };
  while (s < data.length) {
    let flags = data[s++] ^ password[pp]; pp = (pp + 1) % password.length;
    for (let k = 0; k < 8 && s < data.length; k++, flags >>= 1) {
      if (flags & 1) put(data[s++]);
      else {
        if (s + 1 >= data.length) { s = data.length; break; }
        let i = data[s], j = data[s + 1]; s += 2;
        i |= (j & 0xf0) << 4; j = (j & 0x0f) + TH;
        for (let q = 0; q <= j; q++) put(ring[(i + q) & (N - 1)]);
      }
    }
  }
  return out.subarray(0, o);
}

// --- Allegro datafile ------------------------------------------------------------------------------------------------
export function alParse(raw) {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (latin1(raw.subarray(0, 4)) !== 'ALL.') throw new Error('not a datafile');
  const n = dv.getUint32(4), objs = []; let p = 8;
  for (let i = 0; i < n; i++) {
    const props = {};
    while (latin1(raw.subarray(p, p + 4)) === 'prop') {
      const sz = dv.getUint32(p + 8);
      props[latin1(raw.subarray(p + 4, p + 8))] = raw.subarray(p + 12, p + 12 + sz); p += 12 + sz;
    }
    const type = latin1(raw.subarray(p, p + 4)), csz = dv.getInt32(p + 4); p += 12;
    objs.push({ type, name: props.NAME ? cstr(props.NAME) : '', data: raw.subarray(p, p + csz) }); p += csz;
  }
  if (p !== raw.length) throw new Error('datafile size mismatch');
  return objs;
}

// --- SH.EXE: UPX 0.40 (NRV2B) unpack + enemy table -------------------------------------------------------------------
function nrv2b(src) {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let s = 0, bb = 0, out = new Uint8Array(1 << 20), o = 0, last = 1;
  const getbit = () => {
    let carry = bb >>> 31; bb = (bb << 1) >>> 0;
    if (bb === 0) { bb = dv.getUint32(s, true); s += 4; carry = bb >>> 31; bb = ((bb << 1) | 1) >>> 0; }
    return carry;
  };
  const push = (b) => { if (o === out.length) { const g = new Uint8Array(out.length * 2); g.set(out); out = g; } out[o++] = b; };
  for (;;) {
    while (getbit()) push(src[s++]);
    let m = 1;
    do { m = m * 2 + getbit(); } while (!getbit());
    if (m === 2) m = last;
    else {
      m = (m - 3) * 256 + src[s++];
      if ((m >>> 0) === 0xffffffff) break;
      last = ++m;
    }
    let l = getbit(); l = l * 2 + getbit();
    if (l === 0) { l = 1; do { l = l * 2 + getbit(); } while (!getbit()); l += 2; }
    if (m > 0xd00) l++;
    for (let q = 0; q <= l; q++) push(out[o - m]);
  }
  return out.subarray(0, o);
}

const EXE_PAYLOAD = 0xac4, FILTER_END = 0x6d656, VA_BASE = 0x1000;
const ENEMY_BASE = 0xc8fd0, ENEMY_STRIDE = 148, INIT_LO = 0x1ad0, INIT_HI = 0x2a0c;

export function unpackExe(exe) {
  const d = nrv2b(exe.subarray(EXE_PAYLOAD)).slice();
  const dv = new DataView(d.buffer);
  for (let cur = 0; cur < FILTER_END;) {                       // undo UPX call-trick filter 0x11
    const p = d.indexOf(0xe8, cur);
    if (p < 0 || p >= FILTER_END) break;
    if (d[p + 1] === 0x11) {
      const v = (d[p + 2] << 16) | (d[p + 3] << 8) | d[p + 4];
      dv.setUint32(p + 1, (v - (p + 1 + VA_BASE)) >>> 0, true); cur = p + 5;
    } else cur = p + 1;
  }
  return d;
}

export function enemyTable(img) {
  const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
  const fields = new Map(), names = new Map();
  for (let i = INIT_LO - VA_BASE; i < INIT_HI - VA_BASE;) {
    let a, v;
    if (img[i] === 0xc7 && img[i + 1] === 0x05) { a = dv.getUint32(i + 2, true); v = dv.getInt32(i + 6, true); i += 10; }
    else if (img[i] === 0xc6 && img[i + 1] === 0x05) { a = dv.getUint32(i + 2, true); v = dv.getInt8(i + 6); i += 7; }
    else if (img[i] === 0x68 && img[i + 5] === 0x68 && img[i + 10] === 0xe8) {   // push src; push dst; call strcpy
      const src = dv.getUint32(i + 1, true), dst = dv.getUint32(i + 6, true);
      const t = Math.floor((dst - ENEMY_BASE) / ENEMY_STRIDE), o = (dst - ENEMY_BASE) % ENEMY_STRIDE;
      if (t >= 0 && t < 40 && o === 0x7d) names.set(t, cstr(img.subarray(src - VA_BASE)));
      i += 15; continue;
    } else { i++; continue; }
    const t = Math.floor((a - ENEMY_BASE) / ENEMY_STRIDE), o = (a - ENEMY_BASE) % ENEMY_STRIDE;
    if (a >= ENEMY_BASE && t < 40) { if (!fields.has(t)) fields.set(t, {}); fields.get(t)[o] = v; }
  }
  return { fields, names };
}

// --- bitmaps / sound -------------------------------------------------------------------------------------------------
function readPal(d) {
  return Array.from({ length: 256 }, (_, i) => [0, 1, 2].map((k) => (d[i * 4 + k] << 2) | (d[i * 4 + k] >> 4)));
}

function decodeBitmap(o, pal) {
  const dv = new DataView(o.data.buffer, o.data.byteOffset, o.data.byteLength);
  const bpp = dv.getUint16(0), w = dv.getUint16(2), h = dv.getUint16(4);
  if (bpp !== 8) throw new Error('unsupported bpp ' + bpp);
  let idx;
  if (o.type === 'BMP ') idx = o.data.subarray(6, 6 + w * h);
  else {                                                         // RLE: >0 literal run, <0 skip, 0 = end of row
    idx = new Uint8Array(w * h); let p = 10, y = 0, x = 0;
    while (y < h) {
      const c = dv.getInt8(p++);
      if (c === 0) { y++; x = 0; } else if (c < 0) x += -c; else { idx.set(o.data.subarray(p, p + c), y * w + x); p += c; x += c; }
    }
  }
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < idx.length; i++) {
    const c = pal[idx[i]]; rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = idx[i] ? 255 : 0;   // index 0 = transparent
  }
  return { w, h, rgba };
}

function decodeSample(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const bits = dv.getUint16(0), freq = dv.getUint16(2), len = dv.getUint32(4);
  const f = new Float32Array(len);                                // Allegro samples are unsigned
  if (bits === 8) for (let i = 0; i < len; i++) f[i] = (d[8 + i] - 128) / 128;
  else for (let i = 0; i < len; i++) f[i] = (dv.getUint16(8 + i * 2, true) - 32768) / 32768;
  return { freq, samples: f };
}

// --- levels ----------------------------------------------------------------------------------------------------------
const CMD = { 0: 'spawn', 1: 'formation', 2: 'cluster', 3: 'spawn_alt', 4: 'spawn_alt', 5: 'scenery', 6: 'guardian', 9: 'end_script' };

function decodePath(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), pts = [];
  for (let i = 0; i + 8 <= d.length; i += 8) pts.push([dv.getInt32(i, true), dv.getInt32(i + 4, true)]);
  let n = pts.findIndex(([x, y]) => x === -1000 && y === -1000); if (n < 0) n = pts.length;
  if (pts.length - n !== 10 || pts.slice(n).some(([x, y]) => x !== -1000 || y !== -1000)) throw new Error('path terminator');
  return pts.slice(0, n);
}

function decodeLevel(d, enemyNames, sceneryNames) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const count = dv.getInt32(80, true);
  if (d.length !== 84 + 64 * (count + 1)) throw new Error('level size');
  const events = [];
  for (let i = 0; i <= count; i++) {
    const v = Array.from({ length: 16 }, (_, k) => dv.getInt32(84 + 64 * i + k * 4, true));
    const cmd = v[1] & 0xff, type = (v[1] >> 8) & 0xff;
    const e = { t: v[0], cmd: CMD[cmd] ?? cmd, cmd_id: cmd, type };
    if ([0, 1, 2, 3, 4, 6].includes(cmd)) e.enemy = enemyNames.has(type) ? enemyNames.get(type) : type;
    if (cmd === 5) e.scenery = type < sceneryNames.length ? sceneryNames[type] : type;
    e.y = v[2];
    if (cmd === 1) Object.assign(e, { path: v[6], count: v[7], interval: v[8], bonus: v[15] });
    else if ([0, 2, 3, 4, 6].includes(cmd)) Object.assign(e, { x_offset: v[3], vx: v[4], vy: v[5], bonus: v[15] });
    else if (cmd === 5) Object.assign(e, { x_offset: v[3], layer: v[5] });
    e.raw = v;
    events.push(e);
  }
  return { name: cstr(d.subarray(0, 80)), events };
}

// --- top level -------------------------------------------------------------------------------------------------------
export async function loadGame(zipBytes) {
  const files = await unzip(zipBytes);
  for (const f of ['SH.EXE', 'SPACEHOG.DAT', 'SHBGS.DAT', 'SHLEV.DAT', 'SHSND.DAT']) if (!files[f]) throw new Error('missing ' + f + ' in zip');
  const dat = (n) => alParse(alUnpack(files[n + '.DAT']));
  const main = dat('SPACEHOG'), bgs = dat('SHBGS'), lev = dat('SHLEV'), snd = dat('SHSND');
  const pal = readPal(main.find((o) => o.type === 'PAL ').data);

  const images = new Map(), bgImages = [], samples = new Map();
  const sprites = main.map((o) => {
    if (o.type !== 'BMP ' && o.type !== 'RLE ') return { name: o.name, w: 0, h: 0 };
    const im = decodeBitmap(o, pal); images.set(o.name, im); return { name: o.name, w: im.w, h: im.h };
  });
  const bgList = bgs.map((o) => {
    if (o.type !== 'BMP ' && o.type !== 'RLE ') return { name: o.name, w: 0, h: 0 };
    const im = decodeBitmap(o, pal); bgImages[bgs.indexOf(o)] = im; return { name: o.name, w: im.w, h: im.h };
  });
  for (const o of snd) if (o.type === 'SAMP') samples.set(o.name, decodeSample(o.data));

  const { fields, names } = enemyTable(unpackExe(files['SH.EXE']));
  const enemies = [...new Set([...fields.keys(), ...names.keys()])].sort((a, b) => a - b).map((t) => {
    const f = fields.get(t) ?? {}, sp = f[0x24];
    return {
      type: t, name: names.get(t) ?? null, sprite: sp !== undefined && sp < sprites.length ? sprites[sp].name : null,
      sprite_index: sp ?? null, hp: f[0x20] ?? null, score: f[0x34] ?? null,
      fields: Object.fromEntries(Object.entries(f).sort((a, b) => a[0] - b[0]).map(([k, v]) => ['0x' + Number(k).toString(16), v])),
    };
  });
  const enemyNames = new Map(enemies.map((e) => [e.type, e.name]));
  const sceneryNames = bgList.map((b) => b.name).filter((n) => /^BG\d+$/.test(n));
  const levObj = Object.fromEntries(lev.map((o) => [o.name, o.data]));
  const levels = [1, 2, 3, 4, 5, 6].map((n) => {
    const L = decodeLevel(levObj['LEV_0' + n], enemyNames, sceneryNames);
    L.briefing = latin1(levObj['TXT_0' + n].subarray(0, levObj['TXT_0' + n].indexOf(0x40))); L.id = n;
    return L;
  });
  const paths = Object.fromEntries(Object.entries(levObj).filter(([k, v]) => /^G?PAT_/.test(k) && v.length > 12).map(([k, v]) => [k, decodePath(v)]));

  return {
    data: { enemies, levels, paths, sprites, bgs: bgList, sounds: [...samples.keys()] },
    images, bgImages, samples,
  };
}
