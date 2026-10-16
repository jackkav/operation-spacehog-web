"""Decode levels, paths, briefings and the enemy-type table to JSON.

usage: python3 levels.py <dir with original files incl. SH.EXE and *.DAT> <out.json>
"""
import json, os, struct, sys
sys.path.insert(0, os.path.dirname(__file__))
from alpack import unpack
from aldat import parse
from exetables import unpack_exe, enemy_table
from extract import PASSWORD

CMD = {0: 'spawn', 1: 'formation', 2: 'cluster', 3: 'spawn_attached', 4: 'spawn_attached', 5: 'scenery', 6: 'spawn_attached', 9: 'end_script'}   # 9 sets the 'script finished' flag (0xC0530); some levels have an earlier one
FIELD_NAMES = {   # only fields whose meaning was confirmed in the exe or by data; others stay raw in 'raw'
    0: 'time', 1: 'packed', 2: 'y', 3: 'x_offset', 4: 'vx', 5: 'vy', 14: 'link', 15: 'bonus',
}


def name(b): return b.rstrip(b'\0').decode('latin1')


def load(src):
    objs = {}
    for f in ('SPACEHOG', 'SHBGS', 'SHLEV'):
        objs[f] = parse(unpack(open(os.path.join(src, f + '.DAT'), 'rb').read(), PASSWORD))[0]
    return objs


def decode_path(d):
    p = struct.unpack('<%di' % (len(d) // 4), d[:len(d) // 4 * 4])
    pts = list(zip(p[0::2], p[1::2]))
    n = next((i for i, q in enumerate(pts) if q == (-1000, -1000)), len(pts))
    assert all(q == (-1000, -1000) for q in pts[n:]) and len(pts) - n == 10, 'path terminator'
    return [list(q) for q in pts[:n]]


def decode_level(d, enemy_names, scenery_names):
    nm = name(d[:80].split(b'\0')[0])
    count = struct.unpack('<i', d[80:84])[0]
    assert len(d) == 84 + 64 * (count + 1), 'level size'
    events = []
    for i in range(count + 1):
        v = struct.unpack('<16i', d[84 + 64 * i:148 + 64 * i])
        cmd, typ = v[1] & 0xff, (v[1] >> 8) & 0xff
        e = {'t': v[0], 'cmd': CMD.get(cmd, cmd), 'cmd_id': cmd, 'type': typ}
        if cmd in (0, 1, 2, 3, 4, 6): e['enemy'] = enemy_names.get(typ, typ)
        if cmd == 5: e['scenery'] = scenery_names[typ] if typ < len(scenery_names) else typ
        e['y'] = v[2]
        if cmd == 1: e.update(path=v[6], count=v[7], interval=v[8], bonus=v[15])
        elif cmd in (0, 2, 3, 4, 6): e.update(x_offset=v[3], vx=v[4], vy=v[5], bonus=v[15])
        elif cmd == 5: e.update(x_offset=v[3], layer=v[5])
        e['raw'] = list(v)
        events.append(e)
    return {'name': nm, 'events': events}


def main(src, out):
    img = unpack_exe(os.path.join(src, 'SH.EXE'))
    fields, names = enemy_table(img)
    objs = load(src)
    spr = [name(o['props']['NAME']) for o in objs['SPACEHOG']]
    bgs = [name(o['props']['NAME']) for o in objs['SHBGS']]
    enemies = []
    for t in sorted(set(fields) | set(names)):
        f = fields.get(t, {}); sp = f.get(0x24)
        enemies.append({'type': t, 'name': names.get(t), 'sprite': spr[sp] if sp is not None and sp < len(spr) else None,
                        'sprite_index': sp, 'hp': f.get(0x20), 'score': f.get(0x34),
                        'fields': {hex(k): v for k, v in sorted(f.items())}})
    en = {e['type']: e['name'] for e in enemies}
    lev = {name(o['props']['NAME']): o['data'] for o in objs['SHLEV']}
    levels = []
    for n in range(1, 7):
        L = decode_level(lev['LEV_%02d' % n], en, [b for b in bgs if b.startswith('BG') and b[2:].isdigit()])
        L['briefing'] = lev['TXT_%02d' % n].split(b'@')[0].decode('latin1')
        L['id'] = n
        levels.append(L)
    paths = {k: decode_path(v) for k, v in lev.items() if k.startswith(('PAT_', 'GPAT_')) and len(v) > 12}
    json.dump({'enemies': enemies, 'levels': levels, 'paths': paths}, open(out, 'w'), indent=1)
    return enemies, levels, paths


def selfcheck(enemies, levels, paths):
    types = {e['type'] for e in enemies}
    for L in levels:
        ev = L['events']
        assert [e['t'] for e in ev] == sorted(e['t'] for e in ev), L['name'] + ': events not time-ordered'
        assert ev[-1]['cmd_id'] == 9, L['name'] + ': last event must be end_script'
        for e in ev:
            if e['cmd_id'] in (0, 1, 2, 3, 4, 6): assert e['type'] in types, (L['name'], e)
            if e['cmd_id'] == 5: assert e['type'] < 12, (L['name'], e)
            if e['cmd_id'] == 1: assert ('PAT_%02d' % e['path']) in paths, (L['name'], e)
    print('selfcheck ok:', sum(len(L['events']) for L in levels), 'events,', len(paths), 'paths,', len(enemies), 'enemy types')


if __name__ == '__main__':
    selfcheck(*main(sys.argv[1], sys.argv[2]))
