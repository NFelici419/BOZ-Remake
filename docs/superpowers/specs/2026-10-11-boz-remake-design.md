# BOZ Remake — Design

**Date:** 2026-10-11
**Status:** Approved in conversation; awaiting written-spec review

## 1. Purpose

A personal-preservation remake of *Call of Duty: Black Ops Zombies* (2012
mobile, Marmalade engine). The original only runs as 32-bit ARM code and
cannot be ported to 64-bit (see §9), so the game is rebuilt in Godot 4 using
the original game's own assets and data. Not for distribution.

### Goals (first milestone set)

- **Map:** Kino der Toten only, "done properly" — the full round loop:
  zombie rounds, barricades, points, wall-buys, doors/debris, Mystery Box,
  perks, power switch, teleporter, Pack-a-Punch, power-ups, HUD, main menu,
  pause, game-over, settings.
- **Platform:** Retroid Pocket 6 (Android, Snapdragon 8 Gen 2, 1080p),
  with native controller support.
- **Gameplay:** faithful to the mobile original by default (its rules,
  weapon stats, zombie counts, pacing), with options to adjust.
- **Players:** solo only, but structured so co-op can be added later.
- **Assets:** converted from the original files by a tool we build; nothing
  is hand-recreated.

### Non-goals (for now)

Other maps (Ascension, Call of the Dead, Tutorial), Dead Ops Arcade, online
or split-screen co-op, easter eggs, leaderboards/achievements, on-screen
touch gameplay controls, and a Windows build (possible later; not targeted).

## 2. Source material

All source files live in `D:\Documents\COD-BOZ-Partially-Decompiled-master\retroid-backup\`
and are never modified or committed:

| File | Origin | Size (bytes) |
|---|---|---|
| `blackops_dxt.dz` | Activision CDN, `PROD/CODBOZ/1_0_8/` | 341,884,481 |
| `blackops_atitc.dz` | Activision CDN, `PROD/CODBOZ/1_0_8/` (same size as the copy on the Retroid) | 342,388,603 |
| `com.activision.boz-1.0.8.apk` | Pulled from the Retroid over adb | 48,199,686 |

`blackops_dxt.dz` is the primary source (PC-native DXT textures). The APK
supplies `boz.s3e` (game code + embedded config), `blackops_loader.dz`
(UI bootstrap, localisation), and MP3 music.

Known formats:

- **`.dz`** — Marmalade "DTRZ" archive: name table, then compressed file
  data. Kino-relevant entries include `kino*.group.bin`, `*_shared.group.bin`
  (alley, atrium, balcony, bar, dressing room, lobby, stage, theatre,
  teleporter wormhole, …), `weapons_kino`, `arms_kino`,
  `weapon_projectiles_kino`, `snd_player_*`, `ingame`, `shared`, `fixed`,
  `frontend`, `visualeffects`, `pickups`, `shaders`, `cameras`, `misc`.
- **`.group.bin`** — Marmalade IwResManager binary resource group: resources
  tagged by numeric class ID followed by class-specific serialised data.
  No public parser exists. The authoritative deserialisers are in the ARM
  code inside `boz.s3e`.

## 3. Repository layout

```
D:\Documents\BOZ-Remake\
├── converter\            TypeScript (Node.js) CLI — §4
├── game\                 Godot 4 project — §5
│   └── assets\converted\ converter output (gitignored, regenerable)
└── docs\                 specs, plans, playtest checklists
```

`.gitignore` excludes `game/assets/converted/`, any extracted archive
contents, and any original-data slices, so no Activision data enters git
history. The path to the source files is configured in one local,
gitignored settings file (`converter/local.json`).

## 4. Asset converter

A command-line tool in **TypeScript on Node.js** (Node 24 is installed;
binary handling via `Buffer`; tests via `node:test`). It runs in stages,
each writing to disk so it can be inspected and tested on its own:

1. **Unpack** — `.dz` → individual files + `manifest.json` (name, offset,
   compressed/uncompressed size, flags).
2. **Parse** — each `.group.bin` → list of resources (class ID, name, byte
   range). Every class ID encountered is counted.
3. **Decode** — one class at a time, in this order:
   1. textures → DDS (DXT kept as-is) or PNG
   2. models → glTF 2.0 (geometry, UVs, materials)
   3. map sectors / statics / dynamics → glTF scenes + JSON placements
   4. lightmaps → textures + UV2 on geometry
   5. sounds → OGG
   6. weapon / zombie / round / price data → JSON
4. **Report** — per-map coverage report (JSON + HTML): what converted, what
   failed, and why.

**Rules**

- Original files are opened read-only. Every output records its source file
  and byte offset (provenance).
- An unknown class is reported and its raw bytes dumped for investigation;
  it is never guessed at silently.
- Scope is Kino plus the shared groups Kino needs.
- When guessing a format fails, its deserialiser in `boz.s3e` is decompiled
  (Ghidra) and the format is read from the code.

## 5. Game (Godot 4, GDScript)

**Data-driven:** weapon stats, round scaling, prices, and perk effects are
loaded from the converter's JSON. Any value not found in the original data
lives in a single `approximations.json` so guesses stay visible.

| System | Responsibility |
|---|---|
| `MapLoader` | Builds Kino from converted glTF + placement JSON: rooms, spawn points, barricades, doors, buyables, navigation mesh. Uses the original lightmaps for lighting. |
| `RoundDirector` | Round number, zombies per round, spawn timing, health scaling, between-round pause. |
| `Zombie` | Go to a barricade, tear it down, then chase the player via the navigation mesh; attack, die, drop power-ups. |
| `Player` | Movement, health / downed state, points, 2 weapon slots (3 with Mule Kick if Kino has it), perks. |
| `WeaponSystem` | Fire, reload, aim down sights, Pack-a-Punch variants — all data-driven. |
| `Interactables` | Wall-buys, doors/debris, Mystery Box, perk machines, power switch, teleporter, Pack-a-Punch. |
| `PowerUps` | Max Ammo, Insta-Kill, Double Points, Nuke, Carpenter. |
| `HUD` / `Menus` | Points, round counter, ammo, perk icons; main menu, pause, game-over, settings. |
| `Settings` | Zombie cap, difficulty, aim assist, controls, graphics, audio. Defaults reproduce the original. |

**Co-op readiness:** game rules live in a central `GameState`, separate from
input. Players are identified by ID, never assumed to be "the" player.

**Performance target:** steady 60 fps on the Retroid Pocket 6 at native
1080p, with an internal-resolution option.

## 6. Controls

Standard Godot gamepad input, so the Retroid's built-in controls, Bluetooth
controllers, and PC pads all work.

| Input | Action |
|---|---|
| Left stick / L3 | Move / sprint |
| Right stick / R3 | Look / melee |
| R2 / L2 (analog) | Fire / aim down sights |
| R1 / L1 | Frag grenade / special grenade |
| South | Jump |
| East | Crouch |
| West | Reload; hold to use/buy |
| North | Switch weapon |
| Start / Select | Pause / scoreboard |

- Adjustable response curve, sensitivity, and dead zones.
- Aim assist (slowdown + light snap when aiming down sights), on by default
  and adjustable.
- Full remapping; Xbox-style or Nintendo-style button labels; vibration toggle.
- Menus are fully controller-navigable; touch also works in menus.

## 7. Error handling

- **Converter:** a failing resource is logged with its source offset and
  skipped; the run continues and the failure appears in the coverage report.
- **Game:** a missing asset shows a visible placeholder (e.g. a magenta box)
  and logs a warning; it never crashes the game.

## 8. Testing

- **Converter:** `node:test` unit tests for each decoder, run against real
  slices of `blackops_dxt.dz` read from the source folder at test time
  (never copied into the repo). Sanity checks on every run: entry counts
  match the manifest, texture dimensions are plausible, geometry and UVs
  are valid.
- **Game rules:** GUT (Godot Unit Test) tests for round scaling, points,
  prices, weapon damage, and perk effects; these run on the PC.
- **On device:** APK built and installed on the Retroid over adb; logs read
  via logcat. The owner playtests each milestone using a checklist in
  `docs/`, comparing against the original, which is still installed on the
  Retroid. Differences are checked against the data before changing them.

## 9. Background: why a remake

Found during investigation of the decompiled repo, using string evidence
from both `libs3e_android.so` builds:

- The game logic in `boz.s3e` is 32-bit ARM. The 64-bit Marmalade loader
  needs a separate `*_aarch64.s3e`, which was never built for this game.
- The loader's 64-bit flag check (`IW_S3E_64BIT_F`) and the 32-bit-only
  Thumb relocation code mean the two can't be mixed.
- The game imports 391 functions (144 `s3e*`, 224 `gl*`, 23 `egl*`).
  Static recompilation is the main alternative to a remake, and was set
  aside in favour of the remake.

## 10. Milestones

Each milestone is playable or testable on its own and gets its own
implementation plan.

1. **Converter basics** — unpack, parse Kino's groups, first coverage report.
2. **Walk around Kino** — geometry and textures in Godot, explored on the
   Retroid with the controller.
3. **Core combat** — player, one weapon, pathfinding zombies, round system.
4. **Economy** — points, barricades, doors/debris, wall-buys.
5. **Kino features** — Mystery Box, perks, power, teleporter, Pack-a-Punch,
   power-ups.
6. **Polish** — HUD, menus, settings, audio, game over, 60 fps.

**Main risk:** milestones 1–2 depend on decoding the model and sector
formats. Mitigation: decompile the matching deserialisers in `boz.s3e`.
