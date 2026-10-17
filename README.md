# Operation Spacehog – web port

A browser port of **Operation Spacehog** (2000), the freeware horizontal shoot-'em-up by Johan Peitz / Free Lunch Design.
Original game page: https://www.dosgamesarchive.com/play/operation-spacehog

**Play:** https://jackkav.github.io/operation-spacehog-web/

This is *not* a DOS emulator. The game logic is a re-implementation in JavaScript, driven by the original game's own data:
the site ships the author's **unmodified `spacehog.zip`** and the browser unpacks it at load time (UPX-packed `SH.EXE`,
encrypted/compressed Allegro datafiles → sprites, sounds, six level scripts, enemy paths and the enemy table).
No converted or re-hosted copies of the game's art or audio are published here.

## Controls
| Key | Action |
|---|---|
| Player 1 | arrows move, Space / Ctrl / Z fire (hold to charge once you own BUILDUP), C / Shift / Alt activate the highlighted upgrade, X craft special |
| Player 2 | W A S D move, H fire, J activate upgrade, K craft special |
| Menus | arrows + Enter (Left/Right on the title switches 1 / 2 players) |
| P / Esc | pause (Q then quits to the menu) |

Shoot down whole waves to earn power tokens, move the toolbar cursor along SPEED → ADD-ON and activate what you want.

## Status
Playable end to end: 6 levels, guardian fights with attack patterns, pickups, the full upgrade bar, three craft with specials, two-player co-op, the original music (via a built-in MIDI synth), hall of fame, options and credits. Guardians behave as in the original (decoded from the executable: they are ordinary enemies with a path and gun parts). Still missing: intro cutscene, gamepad/mouse, key remapping.
Several behaviours are approximations of the original; see [NOTES.md](NOTES.md) for the reverse-engineered formats and a list of what is guessed.

## Development
```
node --test web/*.test.mjs        # needs Node 18+
python3 -m http.server 8765 -d web
```
URL switches for testing: `?mute=1` (no sound at all), `?touch=1` (force the touch controls on a desktop browser).
`tools/` holds the Python reverse-engineering tools (UPX unpack, packfile/datafile decoder, level/enemy extraction, and `pseudo.py`, a small decompiler helper) that the JS loader and the game rules were derived from.

## Credits and rights
Operation Spacehog © 1998–2000 Johan Peitz / Free Lunch Design (freeware; its readme allows distribution "in its original form").
Music by Aaron Hankla, character design by Andreas Qassim. Built with Allegro 3.11. This project is an unofficial fan port and is not affiliated with the author.
