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
`3,4` spawn variants (extra fields unknown; handled as plain spawns);
`5` **scenery**: `type` = index into SHBGS BG01..BG12, `f5` = layer;
`6` **guardian (boss)**: follows `GPAT_<f6>` (the exe indexes the SHLEV datafile with f6), y = `f2` + path y; the path loops while the boss lives;
`9` sets the "script finished" flag - **the first one ends the script** (later events, e.g. the trailing record in levels 3/5/6, never run).
Link field `f14`: `0` = this spawn becomes the *parent* of the spawns that follow; `-2` = this spawn is a *part* of the last parent, placed at
parent centre + (`f12`, `f13`) (turrets, engine flames, Octo's mask ...). A part dies with its parent. Bonus `f15 = 99` = does not count.
Boss layouts seen: level 3 = Freighter (GUARD1 356x58) with 5 turrets, a side turret and two engine flames; level 6 = invisible `hitarea` parent on GPAT_02
carrying Octo's ship, mask, turret, side turret and engine flame. Enemy hp is multiplied by the difficulty setting at spawn (`[0x73ACC]`, not applied here).
The main loop advances level time only while the pending-event counter `[0xC052C]` is 0; this is not modelled (our timer always runs).
Last event of every level is `cmd 9`.

**Enemy type table** (36 x 148 bytes at 0xC8FD0, built by init code at 0x1AD0-0x2A0C): name (+0x7D), sprite index into SPACEHOG.DAT (+0x24),
hp (+0x20; Big Meteor 9999 = indestructible, matches README), score (+0x34), gun offset (+0x48,+0x4C), reload (+0x50), bullet (+0x58), flags (+0x5C/+0x5D). `tools/levels.py` exports it.

**PAT_xx / GPAT_xx** (paths): array of `(int x, int y)` per game frame, terminated by exactly ten `(-1000,-1000)`.
x starts ~350 (just right of the 320-px screen) and decreases; y is relative to the emitter's `y`. PAT_01-10 are enemy paths (sine waves, loops, steps), GPAT_01-02 are guardian paths.

**TXT_xx**: level briefing text, terminated by `@` then CR/LF padding.

## Not yet decoded
- Exact semantics of cmd 2/3/4/6 extra fields (f9-f13), enemy table fields +0x28/+0x2C/+0x5C/+0x74.
- Boss attack patterns/phases (if any), the FONT format, what the final cmd 9 `type` field (e.g. 2 in level 5) means.
- All gameplay logic (weapons, AI, collision, lighting) lives only in `SH.EXE`.
- Disassembly workflow: unpack (tools/exetables.py `unpack_exe`) -> `objdump -d --triple=i386-pc-win32 -M intel` works on the unpacked COFF.

## Usage
```
python3 tools/extract.py <dir with original .DAT files> <out dir>
python3 tools/levels.py  <dir with SH.EXE + .DAT files> <levels.json>   # levels, paths, enemy table + self-check
```
Extracted assets are gitignored (`spacehog-web/extracted/`, `spacehog-web/original/`).

## More facts from SH.EXE / the data files
- **Difficulty**: the options menu lists PRACTICE, EASY, NORMAL, TOUGH, HARD, INSANE (setting 1..6, stored at `[0x73ACC]`). At spawn the exe multiplies enemy hp by the
  setting and the score by setting / 2. After level 3, settings <= 2 jump straight to the final level (message: "Practice and easy mode hold only 3 levels").
  The default setting is not known; the port defaults to NORMAL (3).
- **Hall of fame**: ten default pilots are consecutive C strings in the exe (Free Lunch Design, Maximillian Drake, Sheila Longhart, Billy 68, Kraven Drax, Shay Prumble,
  Brock Vixel, Maxim Friggot, Leloo Takenoo, Hantor Capole), scoring 50000 down to 5000 in steps of 5000 (scores taken from the `.SAV` in the DOS Games Archive build).
- **Title menu / options strings** (from the exe): "1 PLAYER GAME", "2 PLAYER GAME", OPTIONS, HALL OF FAME, CREDITS, EXIT; option rows Players, Level, Ply 1/Ply 2 controls,
  Set Graphics, Music vol, SFX vol.
- **MIDI**: SHSND.DAT `MIDI` objects are `u16 division` + 16 x (`u32 length` + raw track bytes); prefixing `MThd`/`MTrk` headers gives a format-1 SMF (`loader.js toSMF`).
  Songs: MIDI_TITLE (140 s), MIDI_INTRO (49 s), MIDI_LEVEL (86 s, opens with 20 s of drums only), MIDI_BOSS (40 s).
- **CREDIT_TEXT**: inline codes `\n` end of line, `\1`..`\7` colour, `\c` centre, `\l` large, `\s` small, `\e` end (parsed by `extras.js parseCredits`).

## Web port (`web/`)
Vanilla JS, no build step. `loader.js` unzips the original `spacehog.zip` and decodes everything in the browser (port of `tools/*.py`),
`sim.js` = DOM-free simulation, `midi.js` = MIDI player (SMF parser, sequencer, Web Audio synth), `extras.js` = options / hall of fame / credits logic,
`main.js` = canvas 320x240 renderer, screens, input, audio wiring, `index.html`.

```
node --test web/*.test.mjs                  # simulation, weapons, bosses, co-op, MIDI, persistence, full-playthrough tests
unzip web/spacehog.zip -d /tmp/sh && python3 tools/build_web.py /tmp/sh web   # optional: Python export (web/assets, gitignored) used only to cross-check loader.js
python3 -m http.server 8765 -d web          # then open http://localhost:8765
```
`web/spacehog.zip` is the author's unmodified `spacehog.zip` (SHA-256 a620d38f6e75e8e85baa41f5b5693423e14f3b5d6013aeb0323989ef63f7398d).

Controls - P1: arrows move, Space/Ctrl/Z fire (hold to charge with BUILDUP), C/Shift/Alt activate the highlighted upgrade, X craft special.
P2: WASD move, H fire, J upgrade, K special. P / Esc pause (Q quits to the menu). Menus: arrows + Enter.

Implemented: title menu (1/2 players, options, hall of fame, credits), craft select, level briefings, all 6 levels from the decoded scripts, formations/paths/scenery,
enemy animation, hp/score from the enemy table, difficulty (hp and score scaling, easy/practice shortcut), enemy fire from gun offsets, **pickups**, the **upgrade bar**
(LOCK, death penalty), meteors only hurt by magma/missiles/specials, the three craft specials, **guardian fights** (levels 3 and 6: path-following parents with attached
turrets/flames, energy bar, **phase-based attack patterns**, chain explosion), **two-player co-op** (own weapons/lives/score each, shared pickups, steal a ship with your
special key when out), **music** (the four original MIDI songs through the built-in synth, switching for title / briefing / level / boss, per-song loudness normalised),
**hall of fame** with name entry (persisted in localStorage), **options** (music on/off + volume, SFX volume, difficulty, lighting; persisted), original **credits** roll,
additive **lighting** glows. A scripted bot clears all 6 levels alone and in co-op in the tests.

**Approximations / not yet implemented** (marked `approx` in sim.js):
- Frame rate assumed 60 Hz; sprite anchors assumed to be centres; playfield assumed 320x229 above the 11-px toolbar; big sprites use a shrunk ram hit box (original: pixel-perfect).
- cmd 2 (cluster), 3, 4 are spawned as plain enemies (their extra fields are unknown); vx = vy = 0 enemies drift left at 0.7 px/frame; scenery speed per layer is a guess.
- **Boss attack patterns are designed, not decoded** (`BOSS_PATTERNS` in sim.js): the exe's boss AI was not reverse-engineered, so each guardian gets phases by remaining hp
  (fan / ring / spiral volleys) on top of its parts' normal guns. hp scaling per difficulty follows the exe; the default setting (NORMAL) is a guess.
- Pickup kinds per bonus code (1 = P, 2 = S, 3 = +1) and all weapon numbers (damage, rates, caps) are tuned by feel, not decoded from SH.EXE.
- The synth is oscillator-based General MIDI, so the music sounds like a chip-tune rendition rather than the original sound card (the exe patches GUS/SB instruments).
- Missing: intro cutscene and pilot dialogs, gamepad/mouse support, key remapping, "Set Graphics" detail levels, console/cheats.
