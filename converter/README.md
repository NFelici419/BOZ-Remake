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
- `npm run boz -- report`: write `out/report.json` and `out/report.html`
