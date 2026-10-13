# BOZ asset converter

Reads the original *Call of Duty: Black Ops Zombies* data packs (read-only) and
writes inspectable output to `out/`.

## Setup

1. Node.js 24 or newer.
2. `npm install`
3. Copy `local.example.json` to `local.json` and point it at your copies of
   `blackops_dxt.dz` and the decompressed game binary. `local.json` and `out/`
   are gitignored; no game data is committed.

## Commands

- `npm test`: unit tests (real-data tests are skipped without `local.json`)
- `npm run typecheck`
- `npm run boz -- unpack [--all]`: extract Kino's files (or all) to `out/unpacked/`
- `npm run boz -- report`: write `out/report.json` and `out/report.html` (resource counts,
  decoded textures/materials/models, decode failures and missing references)
- `npm run boz -- export-kino`: write `../game/assets/converted/kino/`: `kino.gltf`,
  `kino.bin`, `textures/*.png` and `sky/` (six cubemap faces + `sky.json`).
  Every static Kino room model placed by its entity, with surface textures,
  lightmaps (occlusion texture on UV set 1) and vertex colours (`COLOR_0`).
  Textures with transparent texels give alpha-masked materials. Unknown
  materials and unusable textures become flat grey. Scale (`POSITION_SCALE`, game units to
  metres) and handedness (`MIRROR_X`) are provisional constants in
  `src/kino-export.ts`, to be confirmed in Godot.
