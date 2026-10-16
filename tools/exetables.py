"""Unpack SH.EXE (UPX 0.40 / NRV2B) and pull the enemy-type table out of its init code.

The table (30+ entries x 148 bytes) lives in .bss at 0xC8FD0 and is filled by straight-line init code
(`mov [abs], imm` and `strcpy(name)` calls) that we read straight from the machine code bytes.
"""
import struct, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from unupx import nrv2b_le32

PAYLOAD = 0xAC4          # start of the packed stream (.data raw offset in the packed exe, incl. 2048-byte stub)
FILTER_END = 0x6D656     # UPX call-trick filter 0x11 covers [0, FILTER_END) of the image
VA_BASE = 0x1000
ENEMY_BASE, ENEMY_STRIDE = 0xC8FD0, 148
INIT_RANGE = (0x1AD0, 0x2A0C)   # VA range of the enemy init code (ends where the cluster spawner starts)


def unpack_exe(path):
    d = bytearray(nrv2b_le32(open(path, 'rb').read()[PAYLOAD:], 0))
    cur = 0
    while cur < FILTER_END:
        p = d.find(b'\xe8', cur, FILTER_END)
        if p < 0: break
        if d[p + 1] == 0x11:
            v = (d[p + 2] << 16) | (d[p + 3] << 8) | d[p + 4]
            d[p + 1:p + 5] = struct.pack('<I', (v - (p + 1 + VA_BASE)) & 0xffffffff)
            cur = p + 5
        else:
            cur = p + 1
    return bytes(d)


def cstr(img, va):
    o = va - VA_BASE
    return img[o:img.index(b'\0', o)].decode('latin1')


def enemy_table(img):
    lo, hi = INIT_RANGE[0] - VA_BASE, INIT_RANGE[1] - VA_BASE
    fields, names = {}, {}
    i = lo
    while i < hi:
        b = img[i:i + 2]
        if b == b'\xc7\x05':
            a, v = struct.unpack_from('<Ii', img, i + 2); w = 4; i += 10
        elif b == b'\xc6\x05':
            a = struct.unpack_from('<I', img, i + 2)[0]; v = struct.unpack_from('<b', img, i + 6)[0]; w = 1; i += 7
        elif img[i] == 0x68 and img[i + 5] == 0x68 and img[i + 10] == 0xe8:     # push src; push dst; call strcpy
            src, dst = struct.unpack_from('<I', img, i + 1)[0], struct.unpack_from('<I', img, i + 6)[0]
            t, o = divmod(dst - ENEMY_BASE, ENEMY_STRIDE)
            if 0 <= t < 40 and o == 0x7d: names[t] = cstr(img, src)
            i += 15; continue
        else:
            i += 1; continue
        t, o = divmod(a - ENEMY_BASE, ENEMY_STRIDE)
        if 0 <= t < 40: fields.setdefault(t, {})[o] = v
    return fields, names
