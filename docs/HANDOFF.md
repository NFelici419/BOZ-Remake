# BOZ Remake: Session Handoff

**Last updated:** 2026-10-12
**Repo:** https://github.com/NFelici419/BOZ-Remake (local: `D:\Documents\BOZ-Remake`, default branch `master`)

Read this first, then the spec and the current plan linked below.

---

## 1. What this project is

A **personal-preservation remake** of *Call of Duty: Black Ops Zombies* (2012 mobile, Marmalade engine) in **Godot 4**, rebuilt from the original game's own data. It is not for distribution.

- **Why a remake:** the original game logic only exists as 32-bit ARM code inside `boz.s3e`. Marmalade's 64-bit loader needs a separate `*_aarch64.s3e` that was never built, so a 64-bit port isn't possible. (Investigated with REA/string evidence; details in spec §9.)
- **Agreed scope** (from the owner):
  - **Kino der Toten only** to start, "done properly": full round loop, doors, box, perks, power, teleporter, Pack-a-Punch, HUD and menus.
  - **Target device: Retroid Pocket 6** (Android, Snapdragon 8 Gen 2), with **native controller support**.
  - **Faithful to the mobile original by default**, with options.
  - **Solo only** for now; code structured so co-op can be added later.
  - Assets are **converted from the original files by our own tool**, never hand-recreated.

**Authoritative documents:**
- Design spec: [`docs/superpowers/specs/2026-10-11-boz-remake-design.md`](superpowers/specs/2026-10-11-boz-remake-design.md)
- Milestone 1 plan (done): [`docs/superpowers/plans/2026-10-11-m1-converter-basics.md`](superpowers/plans/2026-10-11-m1-converter-basics.md)
- **Milestone 2a plan (next to execute):** [`docs/superpowers/plans/2026-10-12-m2a-kino-geometry-export.md`](superpowers/plans/2026-10-12-m2a-kino-geometry-export.md)

---

## 2. Status

| Milestone | State |
|---|---|
| 1. Converter basics (unpack `.dz`, parse groups, coverage report) | **Done.** Merged to `master` as PR #1. 34 tests passing. |
| 2a. Kino geometry export → glTF | **Planned, not started.** Plan written, committed and pushed (`20699e6`). All format facts verified against real data. |
| 2b. Godot project + controller walk-around + Retroid build | Not planned yet. Godot isn't installed. |
| 3–6. Core combat, economy, Kino features, polish | Not started (see spec §10). |

**Pending decision from the owner:** the execution method for the 2a plan. Native (inline, one final review) was recommended and was used for milestone 1. Ask before starting.

---

## 3. Where things live

| What | Path |
|---|---|
| Project repo | `D:\Documents\BOZ-Remake` |
| Converter (TypeScript, Node 24) | `D:\Documents\BOZ-Remake\converter` |
| Converter output (gitignored) | `converter/out/`: `unpacked/`, `manifest.json`, `report.json`, `report.html` |
| Local config (gitignored) | `converter/local.json` (copy of `local.example.json`) |
| **Original game data (read-only, never commit)** | `D:\Documents\COD-BOZ-Partially-Decompiled-master\retroid-backup\` |
| → primary data pack (PC-ready DXT textures) | `blackops_dxt.dz` (341,884,481 bytes) |
| → same pack as on the Retroid | `blackops_atitc.dz` (342,388,603 bytes) |
| → original APK pulled from the Retroid | `com.activision.boz-1.0.8.apk` |
| Decompressed game binary (class names, code) | `D:\Documents\COD-BOZ-Partially-Decompiled-master\COD-BOZ-Partially-Decompiled-master\buildtools\boz\decompressed.s3e` |
| Fan decompilation repo (reference only) | `D:\Documents\COD-BOZ-Partially-Decompiled-master\COD-BOZ-Partially-Decompiled-master` |
| Ghidra project of the game code | `C:\Users\Nelson\Tools\ghidra-projects\boz` |
| Research probe scripts (gitignored) | `D:\Documents\BOZ-Remake\.scratch\` (`probe.mjs`, `decodemodel.mjs`, `assemble.mjs`, `decomp.sh`, …) |

The data packs were downloaded from Activision's still-live CDN: `http://cdn-boz-android.callofduty.com/PROD/CODBOZ/1_0_8/` (also `blackops_etc.dz`, `blackops_gles1.dz`). The Retroid's own copy can't be read: it's app-private, and the device isn't rooted.

---

## 4. How to run

```bash
cd /d/Documents/BOZ-Remake/converter
npm install
npm test               # 34 tests; real-data tests run when local.json exists
npm run typecheck
npm run boz -- unpack  # Kino files -> out/unpacked (47 entries)
npm run boz -- report  # out/report.json + out/report.html (46 groups, 0 failed)
```

Milestone 2a adds `npm run boz -- export-kino` → `out/kino/kino.gltf`.

---

## 5. Key technical findings (all verified)

Full detail with byte offsets is in the 2a plan's **"Format facts"** section. In brief:

- **`.dz` (DTRZ):** a single archive file; all 189 chunks are stored uncompressed (flag `0x100`) and packed contiguously.
- **`.group.bin`:**
  - Records are `{u32 classHash, u32 size (incl. itself), payload}`, ending in `u32 0`.
  - Class hash = **djb2 over the lowercased class name**. Names are recovered by hashing every string in `decompressed.s3e`.
- **Resource lists:** `classHash, count, u8, u8`, then resources that each start with `u32 size` and `u32 nameHash`.
- **Textures:** DXT1/DXT3 GL records with a fixed 12-slot mip table (data at record + 72), or raw RGBA4444. The skybox is a cubemap.
- **Materials:** layout depends on size (17/59/65 bytes). Texture references are name hashes; texture1 is the room **lightmap**.
- **Models:**
  - Blocks are found by a repeated class-hash pair.
  - **Vertex positions are compressed** (read from game code: loader `0x242f48`, decompressor `0x258774`): a packed count, a shared center, X/Y/Z planes of s16, then u16 remap indices for duplicated vertices.
  - UVs are s16 / 4096. Triangle lists carry a material index.
  - All 665 Kino models decode byte-exactly.
- **Placement:** `CIsEntitySpec` is self-describing reflection data (`"LFER"` blocks with typed, named fields). `CIsTransform.m_localPosition` / `m_localRotation` place each room; entity name hash == model name hash. 349/351 room models are placed, and the assembled map forms a coherent floor plan.
- **Axes:** +Y is up. **Provisional** (confirm by eye in 2b): `POSITION_SCALE = 0.01`, `MIRROR_X = false`.
- **Useful classes for later milestones** (all present in Kino's data): `CZombieConfiguration`, `CWave`, `CScoreConfig`, `CLevel`, `CArea`, `CIsNavMesh`, `CTeleportSpawnConfig`, `CIsPortal`/`CIsOccluder`, `CIwAnim`/`CIwAnimSkel`/`CIwAnimSkin`, `CIwSoundData`.

---

## 6. Environment (owner's PC)

- **OS:** Windows 11 IoT Enterprise LTSC. **No winget.**
- **Installed this session:**
  - Node.js 24.21 (`C:\Program Files\nodejs`)
  - Temurin JDK 21 (`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`)
  - Ghidra 12.1.4 (`C:\Users\Nelson\Tools\ghidra_12.1.4_PUBLIC`)
  - REA 6.4.0 (global npm install, registered for Claude Code and Claude Desktop)
- **Already present:** Android SDK at `%LOCALAPPDATA%\Android\Sdk` (adb, emulator, build-tools 35/36/37, platform 36/37), Git 2.55.
- **Not installed:** Python, `gh` CLI, .NET SDK, **Godot**.
- **Retroid Pocket 6:** reachable over USB via `adb` (serial `cc7436ad`). The original BOZ 1.0.8 is installed on it and supports armeabi-v7a.

---

## 7. Gotchas learned the hard way

- **REA on Windows:** its Ghidra provider only accepts PE (Windows) files, so it can't open Android ARM ELF libraries or the game image. Run Ghidra directly instead (next point).
- **Ghidra headless:**
  - The project path must not contain a folder starting with `.` (e.g. `.scratch`), or it aborts.
  - It then waits on "Press any key" forever. Always redirect stdin: `< /dev/null`.
  - Use `.scratch/decomp.sh <out.txt> <addr>...` to decompile functions from the saved project.
- **The game image:**
  - It is `decompressed.s3e` bytes `0x39483 .. 0x456df3`, loaded at 0. The code is **ARM mode** (32-bit instructions).
  - String addresses are computed as literal + PC.
  - Vtable entries are absolute addresses with runtime base **`0x4A000000`**.
  - A class's constructor sits **before** its size function in the registry at `FUN_0023d188`.
- **Node on Windows:** `node --test test/` doesn't accept a bare directory, so use the glob in `package.json`. Bitwise ops are signed, so use `>>> 0` when comparing u32 values.
- **Git:**
  - Repo-local identity is `Nelson` / `197873008+NFelici419@users.noreply.github.com`. Keep the owner's personal email out of history.
  - Pushes use Git Credential Manager (browser sign-in).
  - There's no `gh`, so the owner opens and merges PRs from the compare URL themselves.
- **Never write next to the original data files.** Never commit `.dz`, `.group.bin`, `.s3e`, `.apk`, `local.json` or `converter/out/`; `.gitignore` already covers these.

---

## 8. Next steps

1. **Ask the owner for the 2a execution method** (Native recommended). Then create branch `m2a-kino-geometry-export` from `master` and execute the 2a plan task by task with TDD, ledger and final review, as in milestone 1.
2. After 2a: push the branch and give the owner the PR compare URL.
3. **Plan 2b:**
   - Install Godot 4 (needs download permission; the owner approves downloads individually, with file, source and size).
   - Import `kino.gltf` and confirm `POSITION_SCALE` / `MIRROR_X` by eye.
   - Add a first-person controller with gamepad input.
   - Export to Android and install on the Retroid over adb.

---

## 9. Working style the owner has shown

- Wants **progress updates** during long work, and plain-language explanations.
- Approves big downloads and installs explicitly, and has been happy to say yes when given the exact file, source and size.
- Chose **Native** execution for milestone 1.
- Interrupted once to redirect (cancelled the Android 11 emulator download and asked for a 64-bit port investigation instead). Check direction before long or expensive steps.
