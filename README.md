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
| Arrows | move (Left/Right + Enter on the title screen to pick a craft) |
| Space / Ctrl / Z | fire (hold to charge once you own BUILDUP) |
| C / Shift / Alt | activate the highlighted upgrade on the toolbar |
| X | your craft's special weapon |

Shoot down whole waves to earn power tokens, move the toolbar cursor along SPEED → ADD-ON and activate what you want.

## Status
Playable end to end (6 levels, pickups, the full upgrade bar, three craft with specials). Still missing: boss fights, two players, music.
Several behaviours are approximations of the original; see [NOTES.md](NOTES.md) for the reverse-engineered formats and a list of what is guessed.

## Development
```
node --test web/*.test.mjs        # needs Node 18+
python3 -m http.server 8765 -d web
```
`tools/` holds the Python reverse-engineering tools (UPX unpack, packfile/datafile decoder, level/enemy extraction) that the JS loader was ported from.

## Credits and rights
Operation Spacehog © 1998–2000 Johan Peitz / Free Lunch Design (freeware; its readme allows distribution "in its original form").
Music by Aaron Hankla, character design by Andreas Qassim. Built with Allegro 3.11. This project is an unofficial fan port and is not affiliated with the author.
