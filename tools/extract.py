"""Extract assets from the original Operation Spacehog 1.01 data files.

usage: python3 extract.py <dir with SPACEHOG.DAT etc> <out dir>

Output: out/<datafile>/<NAME>.png|.wav|.mid|.bin , plus a contact sheet per file.
"""
import os, struct, sys, zlib
sys.path.insert(0, os.path.dirname(__file__))
from alpack import unpack
from aldat import parse

PASSWORD = b'skidmarks'   # found in SH.EXE (after UPX unpack); Allegro "old crypt" xors LZSS flag bytes with it


def png(path, w, h, rgba):
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\0' + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def decode_bmp(d):
    bpp, w, h = struct.unpack('>HHH', d[:6])
    assert bpp == 8, bpp
    return w, h, d[6:6 + w * h]            # palette indices; 0 = transparent when drawn masked


def decode_rle(d):
    bpp, w, h, size = struct.unpack('>HHHi', d[:10])
    assert bpp == 8, bpp
    px = bytearray(w * h)                  # 0 = transparent
    p, y, x = 10, 0, 0
    while y < h:
        c = struct.unpack('b', d[p:p + 1])[0]; p += 1
        if c == 0: y += 1; x = 0
        elif c < 0: x += -c
        else: px[y * w + x:y * w + x + c] = d[p:p + c]; p += c; x += c
    return w, h, bytes(px)


def read_pal(d):                           # 256 x (r,g,b,pad), 6-bit VGA values
    return [tuple((v << 2) | (v >> 4) for v in d[i * 4:i * 4 + 3]) for i in range(256)]


def to_rgba(px, pal, transparent0):
    out = bytearray()
    for i in px:
        r, g, b = pal[i]
        out += bytes((r, g, b, 0 if (transparent0 and i == 0) else 255))
    return out


def write_wav(path, d):
    bits, freq, n = struct.unpack('>HHI', d[:8])
    data = d[8:]
    if bits == 16:                         # Allegro 16-bit samples are unsigned; WAV wants signed LE
        s = struct.unpack('<%dH' % (len(data) // 2), data)
        data = struct.pack('<%dh' % len(s), *[v - 32768 for v in s])
    hdr = b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, freq, freq * bits // 8, bits // 8, bits) \
        + b'data' + struct.pack('<I', len(data))
    open(path, 'wb').write(hdr + data)


def write_mid(path, d):
    div = struct.unpack('>H', d[:2])[0]; p = 2; tracks = []
    for _ in range(16):
        n = struct.unpack('>I', d[p:p + 4])[0]; p += 4
        if n: tracks.append(d[p:p + n])
        p += n
    out = b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks), div)
    for t in tracks: out += b'MTrk' + struct.pack('>I', len(t)) + t
    open(path, 'wb').write(out)


def contact_sheet(path, sprites, pal):
    cols = 16; cell = max(max(w, h) for w, h, _ in sprites) + 4
    cell = min(cell, 96)
    rows = (len(sprites) + cols - 1) // cols
    W, H = cols * cell, rows * cell
    img = bytearray(b'\x30\x30\x40\xff' * (W * H))
    for n, (w, h, px) in enumerate(sprites):
        ox, oy = (n % cols) * cell + 2, (n // cols) * cell + 2
        for y in range(min(h, cell - 4)):
            for x in range(min(w, cell - 4)):
                i = px[y * w + x]
                if i:
                    o = ((oy + y) * W + ox + x) * 4
                    img[o:o + 3] = bytes(pal[i])
    png(path, W, H, img)


def main(src, dst):
    pal = None
    files = {n: parse(unpack(open(os.path.join(src, n + '.DAT'), 'rb').read(), PASSWORD))[0]
             for n in ('SPACEHOG', 'SHBGS', 'SHLEV', 'SHSND')}
    pal = read_pal(next(o['data'] for o in files['SPACEHOG'] if o['type'] == 'PAL '))
    for fname, objs in files.items():
        out = os.path.join(dst, fname); os.makedirs(out, exist_ok=True)
        sheet = []
        for o in objs:
            name = o['props'].get('NAME', b'').rstrip(b'\0').decode('latin1'); t = o['type']
            if t in ('BMP ', 'RLE '):
                w, h, px = decode_bmp(o['data']) if t == 'BMP ' else decode_rle(o['data'])
                png(os.path.join(out, name + '.png'), w, h, to_rgba(px, pal, t == 'RLE '))
                sheet.append((w, h, px))
            elif t == 'SAMP': write_wav(os.path.join(out, name + '.wav'), o['data'])
            elif t == 'MIDI': write_mid(os.path.join(out, name + '.mid'), o['data'])
            elif t != 'info': open(os.path.join(out, name + '.' + t.strip().lower()), 'wb').write(o['data'])
        if sheet: contact_sheet(os.path.join(dst, fname + '_sheet.png'), sheet, pal)
        print(fname, len(objs), 'objects')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
