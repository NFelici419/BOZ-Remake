# BOZ Remake: Session Handoff

**Last updated:** 2026-10-15
**Repo:** https://github.com/NFelici419/BOZ-Remake (local: `D:\Documents\BOZ-Remake`, default branch `master`)

Read this first. The design spec and the milestone documents are linked below.

---

## 1. What this project is

A **personal-preservation remake** of *Call of Duty: Black Ops Zombies* (2012 mobile, Marmalade engine) in **Godot 4**, rebuilt from the original game's own data. It is not for distribution.

- **Why a remake:** the original game logic only exists as 32-bit ARM code inside `boz.s3e`, and a 64-bit port isn't possible (spec §9).
- **Agreed scope:** Kino der Toten only, "done properly" (full round loop, doors, box, perks, power, teleporter, Pack-a-Punch, HUD, menus); **Retroid Pocket 6** with native controller; **faithful to the mobile original by default**; solo only (co-op-ready structure); assets **converted by our own tool**, never hand-recreated.
- **The owner asked for the full game** ("make the full game now") and to **build directly without writing plans**. Work milestone by milestone, keep it playable on the Retroid after each step, and give progress updates.

**Documents:**
- Design spec: [`docs/superpowers/specs/2026-10-11-boz-remake-design.md`](superpowers/specs/2026-10-11-boz-remake-design.md) (milestones in §10)
- Milestone 1 and 2a plans (done): [`plans/`](superpowers/plans/)
- Milestone 2b design: [`specs/2026-10-12-m2b-godot-walkaround-design.md`](superpowers/specs/2026-10-12-m2b-godot-walkaround-design.md)
- Playtest checklist (2b): [`docs/playtest/2b-walkaround.md`](playtest/2b-walkaround.md)

---

## 2. Status

| Milestone | State |
|---|---|
| 1. Converter basics | **Done**, merged (PR #1). |
| 2a. Kino geometry → glTF | **Done**, pushed as `m2a-kino-geometry-export`. **PR not opened/merged yet** (owner does it from the compare URL). |
| 2b. Godot walk-around on the Retroid | **Done and verified on the device:** 60 fps in the lobby, original shader look, controls work. `MIRROR_X = false` confirmed (graffiti reads correctly). Owner hasn't run the side-by-side checklist yet. |
| 3. Core combat | **Done** (on the PC and the device): wave chains from the data, zombies (placeholder bodies), M1911 + knife, points, health/regen, HUD, pause, game over. |
| 4. Economy | **Done on the PC, not yet installed on the Retroid** (adb said "unauthorized"; owner must tick "Always allow"): doors, barricades, wall-buys, two weapon slots. |
| 5. Kino features | **Next:** power, perks, Mystery Box, Pack-a-Punch, teleporter, power-ups, hellhound rounds, traps. |
| 6. Polish / real assets | Not started: zombie and weapon models + animations, sound, menus, settings. |

### Git state (important)

- `origin/master` = `20699e6`. Local `master` has one unpushed commit (`fbddd5a`, the first handoff doc), which is also on the feature branches.
- `origin/m2a-kino-geometry-export` = `ea477cb` (pushed).
- **`m2b-godot-walkaround` is local only:** 8 commits on top of `ea477cb` (2b spec, converter extras, Godot project, combat, economy, docs). **It isn't backed up on GitHub. Ask the owner before pushing.**
- Repo-local identity `Nelson` / `197873008+NFelici419@users.noreply.github.com`. There's no `gh`; the owner opens PRs from compare URLs.

---

## 3. Where things live

| What | Path |
|---|---|
| Converter (TypeScript, Node 24, 107 tests) | `converter/` |
| Godot project (4.7.2, Mobile renderer) | `game/` |
| Converted assets (gitignored, regenerable) | `game/assets/converted/kino/`: `kino.gltf/.bin` (rooms), `dynamics.gltf/.bin` (174 prop models named by hash), `textures/`, `sky/` (6 faces + `sky.json`), `player.json`, `data/entities.json` (all 1,070 entities, decoded), `data/resources.json` (433 reflected resources: waves, zombies, level, areas, scores …), `navmesh.res` + `navsource.res` |
| APK + build logs (gitignored) | `build/` |
| Local config (gitignored) | `converter/local.json` |
| **Original data (read-only, never commit)** | `D:\Documents\COD-BOZ-Partially-Decompiled-master\retroid-backup\` (`blackops_dxt.dz` is the primary source) |
| Decompressed game binary | `D:\Documents\COD-BOZ-Partially-Decompiled-master\COD-BOZ-Partially-Decompiled-master\buildtools\boz\decompressed.s3e` |
| Ghidra project of the game code | `C:\Users\Nelson\Tools\ghidra-projects\boz` |
| Research scripts (gitignored) | `.scratch\` (`decomp.sh <out> <addr>…`, `callers.sh <out> <addr>` = decompile all callers; scripts in `.scratch\ghidra\scripts\`) |

### Game code map (`game/`)

| File | Role |
|---|---|
| `scenes/main.gd` | Builds everything: Kino scene, sky, navigation, player, weapon, HUD, round director, interactables; Start pause/restart; input actions. |
| `scripts/kino_data.gd` (autoload `KinoData`) | Loads `data/*.json`; `world()` unit conversion; lookups: `wave()`, `weapon()`, `score()`, `score_limit()`, `entities_with()`, templates. |
| `scripts/game_state.gd` (autoload `GameState`) | Points per player id, spending, capped awards, round number, open areas, game over. |
| `rounds/round_director.gd` | Wave chain by difficulty, spawning in open areas, window/ground/hole spawns. |
| `zombies/zombie.gd` | Placeholder body, hit zones, gaits, window states (outside → tear → climb → chase), attacks. |
| `weapons/weapon.gd` | Two gun slots + knife; fire modes from data; reload; falloff. |
| `interactables/` | `Interactable` base (hold-West use), `Door`, `Barricade`, `WallBuy`, `Props` (instances `dynamics.gltf` meshes by hash). |
| `world/nav_baker.gd`, `world/navmesh_settings.gd` | Navmesh with closed doors carved out; async re-bake when a door opens. |
| `player/player.gd`, `player/stick.gd` | Movement, health/regen, hold-West interaction, hold-Select rescue teleport. |
| `ui/hud.gd`, `debug/overlay.gd`, `debug/capture.gd` | HUD and prompts; FPS overlay; developer command-line options (below). |
| `addons/kino_import/` | Import add-on: original room shader + trimesh collision on `kino.gltf`. |
| `shaders/` | Room shader (vertex colour × texture × lightmap, unshaded), cut-out variant, sky. |
| `data/approximations.json` | **Every value not found in the data yet** (see §6). `data/settings.json`: dead zones, difficulty. |
| `tools/build-android.sh`, `tools/bake_navmesh.gd` | Full build and install; navmesh bake. |
| `tests/run.gd` | Headless checks (stick maths, imported scene). |

---

## 4. How to run

```bash
cd /d/Documents/BOZ-Remake/converter
npm test                         # 107 tests
npm run typecheck
npm run boz -- export-kino       # rooms, props, textures, sky, player.json -> game/assets/converted/kino/
npm run boz -- export-data       # entities.json + resources.json (run AFTER export-kino, which clears the folder)
npm run boz -- report            # coverage report in converter/out/
```

```bash
sh game/tools/build-android.sh               # both exports, Godot import, navmesh bake, tests, APK, install, launch, logcat
sh game/tools/build-android.sh --no-convert --no-install
```

PC: `C:\Users\Nelson\Tools\godot\Godot_v4.7.2-stable_win64.exe --path game` (add `-e` for the editor). Use `..._console.exe` for logs.

**Developer options** (after `--`): `--at=x,y,z[,yaw,pitch]` (metres/degrees), `--screenshot=file.png`, `--wait=seconds`, `--bot` (aims at the nearest visible zombie's head and fires), `--points=N`, `--open=DoorName` (e.g. `Lobby_To_Atrium`), `--give=weapon` (e.g. `mp40`). Example:
`Godot..._console.exe --path game -- --bot --points=2000 --open=Lobby_To_Atrium --screenshot=C:/tmp/x.png --wait=60`

**Controls:** left stick move, right stick look, L3 sprint, R3 knife, R2 fire, South jump, East crouch (hold), West tap = reload / hold = use (buy, open, repair), North switch weapon, Start pause (Select quits while paused), Select tap = FPS overlay, **hold Select 1.5 s = back to the start point** (rescue if stuck).

---

## 5. Key technical findings (all verified)

**Archive and resources.** `.dz` is a DTRZ archive of stored chunks. `.group.bin` records are `{u32 classHash, u32 size, payload}`. Class hash = djb2 of the lowercased name; names come from strings in the game binary, plus generated candidates (`wave1..300`, weapon names, `hole`). Resource lists: `classHash, count, u8, u8`, then resources starting `u32 size, u32 nameHash`.

**Geometry (2a, details in the 2a plan).** Textures are DXT1/DXT3 with a 12-slot mip table (data at +72) or raw RGBA4444; cubemap = outer header + 6 face records. Materials come in three sizes (17/59/65 bytes); texture1 is the lightmap. Models have compressed planar positions, UVs /4096, triangle lists and a material list; **vertex colours** (`Cols`, from game code at `0x24220c`) are a flag byte, then a grey byte per vertex (bit 0) or R, G, B, A byte planes. All 665 Kino models decode. Placement is `CIsTransform` of the entity with the model's name. Scale 0.01 (game unit = cm); +Y up; not mirrored.

**Look.** The original room shader (GLSL inside `ingame/shaders/shaders.group.bin`) is `vertexColour × texture(UV0) × lightmap(UV1)`, then fog; overbright is disabled. Reproduced unshaded in Godot. Vertex colours arrive as raw gamma bytes and are linearised in the shader.

**Reflection data ("LFER") — the key to gameplay.** `converter/src/reflect.ts` decodes it generically: block `"LFER", class, declaredSize, fieldCount`, then fields `owner, type, 1, name, 1, size, data`. **Read fields by count**: some blocks repeat a field while the declared size omits it. Values are decoded by type name: numbers, vectors, `std::string` (NUL-terminated), `std::list/vector<T>` (count + items), nested structs and enums. A resource's name is the u32 before the block's size word.

**Gameplay data found (all in `data/*.json`):**
- `CLevel`: `m_StartingArea`, `m_StartingWavesSP` (three chains = easy/normal/hard; normal starts 6 zombies/150 hp), `m_PerksAvailable [1,2,5,6]`, `MysteryBoxAvoid`, 8 zombie configurations.
- `CWave` chain (`m_NextWave`), then `CWaveRepeatable` (multipliers, health ×1.1 per round); `CWaveSpeciality` = hellhound rounds.
- `CArea` ×9, each listing its spawn points. `CSpawnPoint.spawnType`: `windows`, `ground`, `hole` (ceiling crawlers), plus an unrecovered type = hellhounds.
- `CScoreConfig`: hit 10, kill head 100 / torso 60 / limb 50 / knife 130, barricade 10 (capped 50/round), carpenter 200, nuke 400.
- Zombie template (`zombie_kino`): damage 115, attack radius 220, gait speed modifiers, hit zones (`CRigCollision`). Player template: health 230, regen delay 1 s / time 7 s, stand 150 / crouch 75.
- `CPlayerWeapon` ×65: clip/ammo, damage by zone, `behaviour` (1 semi, 2 auto, 3 burst + `semiBurst`, 4 shotgun, 9 projectile), RPM in field `0x47ee2045`, `m_falloff`, `m_ADSFoV`, `Upgrade` (Pack-a-Punch version), chalk UVs `m_uv0/m_uv1`. 28 names are still hashes (probably the upgraded weapons).
- Placed level entities: 12 doors (`CDoor` cost + `m_AreasUnlock`, collision box; two need power), 22 barricades (5 boards), 12 wall-buys (`CWeaponChalkOutline` cost; weapon from the `CIsNamed` prefix), 9 Mystery Box spots, 4 perks, power switch, Pack-a-Punch, teleporter + mainframe, traps, 66 spawns. Display names are in `CIsNamed` field `0x7c9b0c46`.

**Still undecoded:** skinned models (`CIwAnimSkin`/`CIwAnimSkel`/`CIwAnim`, 1,357 anims), `CIwSoundData` (578), `CIsNavMesh` (we bake our own from collision for now), the original collision (Bullet blob in kino_statics entity #0), UI (`CIwUIElement`, fonts), 5 `weapons_kino` models with a different tail, 26 textures in unsupported formats.

---

## 6. Approximations in use (`game/data/approximations.json`)

Walk speed 4 m/s, sprint ×1.5, jump 4 m/s, start position = player template position, start points 500, zombie base speeds per gait [1.0, 1.6, 3.0, 4.6] m/s, attack interval 1.2 s and half the data's attack radius, semi-auto fire interval 0.15 s, shotgun 0.6 s / 8 pellets, reload 1.7 s, knife cooldown 0.6 s, 1.5 s per board torn, 0.8 s per board repaired. Replace each with data when found (fire rates and speeds probably live in the animations).

---

## 7. Environment (owner's PC)

- Windows 11 IoT Enterprise LTSC (no winget). Node 24.21, Temurin JDK 21, Git 2.55, Ghidra 12.1.4 (`C:\Users\Nelson\Tools\ghidra_12.1.4_PUBLIC`), REA 6.4.0.
- **Godot 4.7.2:** `C:\Users\Nelson\Tools\godot\` (editor + `_console.exe`); Android export templates in `%APPDATA%\Godot\export_templates\4.7.2.stable\` (Android files only). Godot found the JDK/SDK itself and uses its own debug keystore.
- Android SDK `%LOCALAPPDATA%\Android\Sdk` (build-tools 35/36/37).
- Not installed: Python, `gh`, .NET.
- **Retroid Pocket 6:** adb serial `cc7436ad`; the original BOZ is installed beside ours (`org.nfelici.bozremake`). Its built-in pad shows up as an "Xbox Series X Controller".

---

## 8. Gotchas

- **adb "unauthorized"** after every adb daemon restart, until the owner ticks **"Always allow from this computer"** on the Retroid.
- **Bash tool + heredocs:** a heredoc whose body contains an apostrophe can fail with "unexpected EOF". Put edit scripts in the scratchpad with the Write tool and run them with node; edit `.gd` files with Write/Edit. In JS template literals inside such scripts, `"\n"` and `\\` get mangled, so check the result.
- **GDScript:** a type inferred from a Variant is an error (`var x: Type = …`); comparing a number with a String throws (use `str()`); the JSON stores unresolved hashes as numbers or `"0x…"` strings. Autoloads aren't loaded in `--script` mode.
- **Zombies outside windows** must follow the navmesh path kinematically: the outside routes have navmesh but no floor collision, so physics makes them fall through the world.
- **Godot headless import** applies `importer_defaults` (ETC2 + mipmaps) only to textures without an `.import` file; `export-kino` deletes the converted folder, so a fresh import picks them up.
- **Ghidra headless:** no `.`-folders in the project path; always `< /dev/null`. REA can't open the ARM image, so use Ghidra directly. Image = `decompressed.s3e` bytes `0x39483..0x456df3`, ARM mode, vtable base `0x4A000000`.
- **Node on Windows:** use the `package.json` test glob; `>>> 0` for u32 comparisons.
- Never commit original data, `local.json`, `converter/out/`, `game/assets/converted/`, `build/`.

---

## 9. Next steps

1. **Owner:** tick "Always allow" on the Retroid, then run `sh game/tools/build-android.sh --no-convert` (or ask Claude) to install the economy build and playtest. Open and merge the 2a PR; decide when to push `m2b-godot-walkaround`.
2. **Milestone 5 — Kino features** (all entities are placed in the data):
   - **Power switch** (`CPowerSwitch`): opens `PowerOn_Door1` and `TheatreCurtains` (no-cost `CDoor`s), turns on perks, Pack-a-Punch and traps.
   - **Perks** (`CPerk` ×4, `m_PerksAvailable [1,2,5,6]`, PerkType enum, perk-cola weapons `perkColaRed/Blue/Yellow/Green`): find costs and effects in the data; Juggernog changes health, Quick Revive matters in solo.
   - **Mystery Box** (`CMysteryBox` ×9 spots, `MysteryBoxAvoid`): weapon pool, cost, teddy-bear move rule.
   - **Pack-a-Punch** (`CPackAPunch`; weapon `Upgrade` → upgraded definitions; recover the 28 hashed names).
   - **Teleporter** (`CTeleporter`, `CTeleportMainframe`, `CTeleportSpawnConfig`, `CTeleporterCable`).
   - **Power-ups** (Max Ammo, Insta-Kill, Double Points, Nuke, Carpenter): drop rules not located yet.
   - **Hellhound rounds** (`CWaveSpeciality`, hellhound spawn points), **traps** (`CTrapSwitch`/`CTrap`), **grenades/claymores/Bowie** wall-buys.
3. **Milestone 6:** decode skinned models + animations (zombies, weapon viewmodels, doors/boards), sounds, HUD fonts/menus, settings; the original navmesh and collision; aim-down-sights (`m_ADSFoV`, L2).
4. **Known issues:** 1 of the 8 lobby zombie spawns is still unused; collision from visible geometry can snag (the owner got stuck once, location unknown; hold-Select rescue added); the 2b side-by-side checklist (scale, brightness) isn't done yet.

---

## 10. Working style the owner has shown

- Wants **progress updates** in plain language during long work, and **no plan documents**: build directly.
- Approves downloads explicitly (give file, source and size).
- Redirects mid-task when needed; check direction before very long or expensive steps.
- Tests on the Retroid; screenshots via `adb exec-out screencap -p` help diagnose what they see.
