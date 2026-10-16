# Operation Spacehog 1.01 – reverse-engineering notes

Source: https://www.dosgamesarchive.com/play/operation-spacehog (js-dos v6 + `sh_dos.zip` -> inner `spacehog.zip`).
Original is freeware (Johan Peitz / Free Lunch Design, 2000): distribute "in its original form", not in compilations.

## Executable
- `SH.EXE`: DJGPP go32 COFF, **UPX 0.40 packed** (NRV2B_LE32, call-filter 0x11). `tools/unupx.py` unpacks it.
- Unpacked: Allegro 3.11 statically linked, 538 KB image. Loads SPACEHOG/SHLEV/SHBGS/SHSND `.DAT`.
- Console password / cheat strings live in .data; datafile password is `skidmarks` (referenced in code near 0x44d5).

## Data files (`*.DAT`)
- Allegro 3.x packfile, `F_PACK_MAGIC` header (xor'd with password hash), LZSS (N=4096, F=18, THRESHOLD=2, ring zero-init, start r=N-F).
- "Old crypt": password (`skidmarks`) cycles over **flag bytes only**. `tools/alpack.py`.
- Inside: `ALL.` datafile -> N objects; each = `prop` records (NAME/ORIG/DATE) then `type[4] csize[4] usize[4] data` (all big-endian). `tools/aldat.py`.
- Types: `BMP ` (bpp,w,h,pixels), `RLE ` (bpp,w,h,size,rows of signed-count runs; <0 skip, >0 literal, 0 = EOL),
  `PAL ` (256 x r,g,b,pad, 6-bit), `SAMP` (bits u16, freq u16, len u32, unsigned PCM), `MIDI` (div u16, 16 x (len u32 + track)), `FONT`, `DATA`.
- Verified: all four files decode and parse to exact EOF; sprites, backgrounds, WAV and MIDI export correctly.

| File | Contents |
|---|---|
| SPACEHOG.DAT | 172 objs: 62 BMP, 103 RLE sprites, 3 FONT, PAL, CREDIT_TEXT/TITLE_TEXT |
| SHBGS.DAT | 31: backgrounds (BG01..), pilot portraits, boss art |
| SHSND.DAT | 15: 4 MIDI (BOSS/INTRO/LEVEL/TITLE), 10 samples |
| SHLEV.DAT | 29 `DATA` blobs: LEV_xx (level scripts, name + int32 records), PAT_xx (enemy path tables), GPAT_xx (guardian paths), TXT_xx (dialog) |

## SHLEV.DAT object formats (all little-endian int32)
Objects are index-addressed by the game (Grabber order): GPAT_00-02 (0-2), LEV_00-06 (3-9), PAT_00-10 (10-20), TXT_00-06 (21-27). `*_00` are 12-byte "Binary Data" placeholders.

**LEV_xx** = `char name[80]` (bytes after the NUL are uninitialised garbage) + `int count` + `(count+1)` x 64-byte events.
Event (16 x int32; unused fields hold defaults 1/5/10, so constant columns are filler):
| int | meaning |
|---|---|
| 0 | `time`, in level ticks. 1 tick = 80 game frames; script advances only while the scroll counter runs |
| 1 | packed bytes: `[0]=cmd`, `[1]=type`, `[2]=0 or 10` (unused/editor), `[3]=0` |
| 2 | `y` screen y |
| 3 | `x_offset`: spawn x = scroll_x + 320 + x_offset |
| 4,5 | `vx`, `vy` (cmd 0/3/4/6) |
| 14 | link mode: -1 none, -2 attach to previously spawned object |
| 15 | bonus code (0 none, 1-3 = powerup type given when the wave is wiped out; 99 = does not count) |
Commands (jump table at 0x1C728, handlers in `SH.EXE`): `0` spawn enemy `type` (enemy table index) with velocity;
`1` **formation**: emitter spawns `f7` ships of `type` every `f8` frames at y=`f2` following path `PAT_<f6>`;
`2` cluster/rotor group (`f9`,`f10` = angle in 1/256 turns, `f11` ...; semantics partly unknown);
`3,4,6` spawn enemy linked to the previously spawned object (turret on carrier etc.);
`5` **scenery**: `type` = index into SHBGS BG01..BG12, `f5` = layer; `9` sets the "script finished" flag.
Last event of every level is `cmd 9`; LEV_03/05/06 also have an earlier one.

**Enemy type table** (36 x 148 bytes at 0xC8FD0, built by init code at 0x1AD0-0x2A0C): name (+0x7D), sprite index into SPACEHOG.DAT (+0x24),
hp (+0x20; Big Meteor 9999 = indestructible, matches README), score (+0x34), gun offset (+0x48,+0x4C), reload (+0x50), bullet (+0x58), flags (+0x5C/+0x5D). `tools/levels.py` exports it.

**PAT_xx / GPAT_xx** (paths): array of `(int x, int y)` per game frame, terminated by exactly ten `(-1000,-1000)`.
x starts ~350 (just right of the 320-px screen) and decreases; y is relative to the emitter's `y`. PAT_01-10 are enemy paths (sine waves, loops, steps), GPAT_01-02 are guardian paths.

**TXT_xx**: level briefing text, terminated by `@` then CR/LF padding.

## Not yet decoded
- Exact semantics of cmd 2/3/4/6 extra fields (f9-f13), enemy table fields +0x28/+0x2C/+0x5C/+0x74.
- How guardians (GPAT) are triggered (probably a cmd 9 / `type` field), the FONT format.
- All gameplay logic (weapons, AI, collision, lighting) lives only in `SH.EXE`.
- Disassembly workflow: unpack (tools/exetables.py `unpack_exe`) -> `objdump -d --triple=i386-pc-win32 -M intel` works on the unpacked COFF.

## Usage
```
python3 tools/extract.py <dir with original .DAT files> <out dir>
python3 tools/levels.py  <dir with SH.EXE + .DAT files> <levels.json>   # levels, paths, enemy table + self-check
```
Extracted assets are gitignored (`spacehog-web/extracted/`, `spacehog-web/original/`).

## Web port (`web/`)
Vanilla JS, no build step. `loader.js` unzips the original `spacehog.zip` and decodes everything in the browser (port of `tools/*.py`),
`sim.js` = DOM-free simulation, `main.js` = canvas 320x240 renderer, input, Web Audio, `index.html`.

```
node --test web/*.test.mjs                  # simulation, weapons, full-playthrough tests (loader tests also compare with the Python tools if assets are built)
unzip web/spacehog.zip -d /tmp/sh && python3 tools/build_web.py /tmp/sh web   # optional: Python export (web/assets, gitignored) used only to cross-check loader.js
python3 -m http.server 8765 -d web          # then open http://localhost:8765
```
`web/spacehog.zip` is the author's unmodified `spacehog.zip` (SHA-256 a620d38f6e75e8e85baa41f5b5693423e14f3b5d6013aeb0323989ef63f7398d).
Controls: Left/Right + Enter to pick a craft; arrows move, Space/Ctrl/Z fire (hold to charge with BUILDUP), C/Shift/Alt activates the highlighted upgrade, X = craft special.

Implemented: title/craft select, level briefings, all 6 levels from the decoded scripts, formations/paths/scenery, enemy animation, hp/score from the enemy table,
enemy fire (aimed or straight, by bullet type) from gun offsets, **pickups** (P token, S special, +1 ship) dropped when a whole wave is destroyed or a bonus-carrying enemy dies,
the **upgrade bar** (SPEED GUN SIDE BUILDUP MISSILE PLASMA MAGMA OPTION ADD-ON, LOCK at the end of the bar, death penalty), meteors that only magma/missiles/specials hurt,
and the three craft specials (Berserk, Hellriders, Fireworks). A scripted bot clears all 6 levels in the tests.

**Approximations / not yet implemented** (marked `approx` in sim.js):
- Frame rate assumed 60 Hz; sprite anchors assumed to be centres; playfield assumed 320x229 above the 11-px toolbar.
- cmd 2 (cluster), 3, 4, 6 are spawned as plain enemies (their extra fields are unknown); vx = vy = 0 enemies drift left at 0.7 px/frame.
- Scenery speed by layer is a guess; early cmd 9 markers are ignored; guardians/bosses (GPAT, final cmd 9 types) are not spawned.
- Pickup kinds per bonus code (1 = P, 2 = S, 3 = +1) and all weapon numbers (damage, rates, caps) are tuned by feel, not decoded from SH.EXE.
- Missing: boss fights, 2 players, music (MIDI exported by the Python tools but unused), enemy lighting effects, hall of fame, options menu.
