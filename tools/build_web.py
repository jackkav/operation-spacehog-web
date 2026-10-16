"""Build web/assets from the original game files.

usage: python3 build_web.py <dir with SH.EXE + *.DAT> <web dir>
Writes <web>/assets/{sprites,bgs,snd}/*, <web>/assets/game.json  (all gitignored: it is the original game's art/audio).
"""
import json, os, struct, sys
sys.path.insert(0, os.path.dirname(__file__))
import extract as X
import levels as LV


def png_size(path):
    return struct.unpack('>II', open(path, 'rb').read()[16:24])


def main(src, web):
    A = os.path.join(web, 'assets')
    for d in ('sprites', 'bgs', 'snd'): os.makedirs(os.path.join(A, d), exist_ok=True)
    files = {n: LV.parse(LV.unpack(open(os.path.join(src, n + '.DAT'), 'rb').read(), X.PASSWORD))[0]
             for n in ('SPACEHOG', 'SHBGS', 'SHSND')}
    pal = X.read_pal(next(o['data'] for o in files['SPACEHOG'] if o['type'] == 'PAL '))
    sprites, bgs = [], []
    for fname, outdir, names in (('SPACEHOG', 'sprites', sprites), ('SHBGS', 'bgs', bgs)):
        for o in files[fname]:
            nm = LV.name(o['props']['NAME']); t = o['type']
            if t in ('BMP ', 'RLE '):
                w, h, px = X.decode_bmp(o['data']) if t == 'BMP ' else X.decode_rle(o['data'])
                X.png(os.path.join(A, outdir, nm + '.png'), w, h, X.to_rgba(px, pal, True))   # index 0 = transparent
                names.append({'name': nm, 'w': w, 'h': h})
            else:
                names.append({'name': nm, 'w': 0, 'h': 0})          # keep indices aligned with the datafile order
    snds = []
    for o in files['SHSND']:
        nm = LV.name(o['props']['NAME'])
        if o['type'] == 'SAMP': X.write_wav(os.path.join(A, 'snd', nm + '.wav'), o['data']); snds.append(nm)
    enemies, levels, paths = LV.main(src, os.path.join(A, 'game.json.tmp'))
    LV.selfcheck(enemies, levels, paths)
    os.remove(os.path.join(A, 'game.json.tmp'))
    json.dump({'enemies': enemies, 'levels': levels, 'paths': paths, 'sprites': sprites, 'bgs': bgs, 'sounds': snds},
              open(os.path.join(A, 'game.json'), 'w'))
    print('built', len(sprites), 'sprites,', len(bgs), 'bgs,', len(snds), 'sounds')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
