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
- Milestone 2a plan (done, PR open): [`docs/superpowers/plans/2026-10-12-m2a-kino-geometry-export.md`](superpowers/plans/2026-10-12-m2a-kino-geometry-export.md)
- **Milestone 2b plan:** not written yet (next step, see §8).

---

## 2. Status

| Milestone | State |
|---|---|
| 1. Converter basics (unpack `.dz`, parse groups, coverage report) | **Done.** Merged to `master` as PR #1. 34 tests passing. |
| 2a. Kino geometry export → glTF | **Done** on branch `m2a-kino-geometry-export`, PR open against `master` (merge pending). 93 tests passing. `export-kino` writes 349/351 placed room models, 75,249 triangles, 169 textures, 0 failures. |
| 2b. Godot project + controller walk-around + Retroid build | Not planned yet. Godot isn't installed. |
| 3–6. Core combat, economy, Kino features, polish | Not started (see spec §10). |

**Pending from the owner:** merge the 2a PR. Its final review was a self-review (no fresh reviewer agent was dispatched); the owner can ask for an independent review before merging.

---

## 3. Where things live

| What | Path |
|---|---|
| Project repo | `D:\Documents\BOZ-Remake` |
| Converter (TypeScript, Node 24) | `D:\Documents\BOZ-Remake\converter` |
| Converter output (gitignored) | `converter/out/`: `unpacked/`, `manifest.json`, `report.json`, `report.html`, `kino/` (`kino.gltf`, `kino.bin`, `textures/*.png`), `preview/` (one-off check renders) |
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
npm test               # 93 tests; real-data tests run when local.json exists
npm run typecheck
npm run boz -- unpack  # Kino files -> out/unpacked (47 entries)
npm run boz -- report  # out/report.json + out/report.html (46 groups, 0 failed; 4102 decoded, 5 weapon models fail)
npm run boz -- export-kino  # out/kino/kino.gltf + kino.bin + textures/*.png
```

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
- **Axes:** +Y is up (confirmed by a side render of the export). **Provisional** (confirm by eye in 2b): `POSITION_SCALE = 0.01` (map ≈ 135 × 156 m, 37 m tall), `MIRROR_X = false`. Both are single constants in `converter/src/kino-export.ts`.
- **Learned while building 2a** (corrections to the plan's format facts):
  - **Entity components** all share a 16-byte header `specClass, ?, componentClass, size`. Only `CIsComponentSpec` blocks are LFER field lists; `kino_statics` CIsEntitySpec#0 has a `CIsCollisionMeshSpec` followed by a ~6 MB Bullet physics blob (future collision source). 728 entities have a transform (725 unique names).
  - **Cubemaps:** the outer GL header's mip table describes one face; `recordSize = 72 + 6 × (72 + Σmips)`, each face its own 72-byte GL record. Unused mip-table slots hold junk that looks like pixels.
  - **Textures:** 859 decode, 1 cubemap, 26 unsupported (format byte 0x00 ×6, 0x1b ×1, raw byte18 0x0e ×19).
  - **Weapon models:** 5 `weapons_kino` CIwModels (#3, #5, #6, #239, #242) have a different tail after the last block. Investigate in the weapons milestone.
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

1. Owner merges the 2a PR (`m2a-kino-geometry-export` → `master`).
2. **Plan 2b:**
   - Install Godot 4 (needs download permission; the owner approves downloads individually, with file, source and size).
   - Import `kino.gltf` and confirm `POSITION_SCALE` / `MIRROR_X` by eye.
   - Add a first-person controller with gamepad input.
   - Export to Android and install on the Retroid over adb.
   - Decide, once viewed in Godot (deferred from 2a):
     - **Lightmaps** are exported as glTF `occlusionTexture` on UV1; Godot treats that as ambient-only AO, so rooms won't look lit yet. Pick the real lightmap path (e.g. a custom shader multiplying UV1).
     - **Alpha:** all materials are OPAQUE; grates and other cut-out textures need alphaMode MASK/BLEND.
     - Vertex colours (`CIwModelBlockCols`) and normals aren't exported; 379 of the 665 Kino models have no lightmap UVs and may look flat.
   - Small cleanups left from the 2a review: `decodeRgba4444` should check pitch ≥ 2×width; `decodeModel` could require triangle index counts divisible by 3; `readGroups` could move from `report.ts` to `dz.ts`.

---

## 9. Working style the owner has shown

- Wants **progress updates** during long work, and plain-language explanations.
- Approves big downloads and installs explicitly, and has been happy to say yes when given the exact file, source and size.
- Chose **Native** execution for milestones 1 and 2a.
- Interrupted once to redirect (cancelled the Android 11 emulator download and asked for a 64-bit port investigation instead). Check direction before long or expensive steps.
