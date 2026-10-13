# Milestone 2b — Walk Around Kino in Godot: Design

**Date:** 2026-10-12
**Status:** Approved in conversation; awaiting written-spec review
**Parent spec:** [`2026-10-11-boz-remake-design.md`](2026-10-11-boz-remake-design.md) (§3 layout, §5 game, §6 controls, §7 errors, §8 testing, §10 milestone 2)
**Builds on:** milestone 2a (`converter` → `kino.gltf`), branch `m2a-kino-geometry-export`

## 1. Outcome

Walk around Kino der Toten on the Retroid Pocket 6 with its built-in controls,
using geometry and textures converted from the original game.

**Success criteria**

1. A debug APK, installed over adb, opens straight into Kino at 1920×1080.
2. The whole map can be walked: left stick move, right stick look, South jump.
3. Rooms look like the original: vertex colour × texture × lightmap, no Godot
   lighting added.
4. `POSITION_SCALE` and `MIRROR_X` are confirmed by side-by-side comparison
   with the original game installed on the same Retroid.
5. Frame rate is measured on the device at the busiest spots. 60 fps is the
   project target (parent spec §5) but not a 2b pass/fail gate.

**Decided with the owner**

- Collision is generated from the visible room geometry. The original Bullet
  collision blob (kino_statics CIsEntitySpec#0) is decoded later, with the
  nav mesh (milestone 3).
- Approach A: Godot imports `kino.gltf`; a post-import script applies the
  original shader, alpha cut-out and collision.
- PC checks run in the Godot editor with a gamepad only (no keyboard/mouse).
- GUT is deferred to milestone 3; 2b uses a minimal headless test script.

**Out of scope for 2b:** menus, HUD, zombies, weapons, sound, fog, the
original collision, player spawn from data, input remapping, aim assist.

## 2. Evidence this design relies on

- The original room shader is stored in `ingame/shaders/shaders.group.bin` as
  GLSL text: `modulatedColour = outCol * terrainTex * lightmapTex`
  (`outCol` = vertex colour, `inSampler1` on `outUV1` = lightmap), then fog.
  Its 2× overbright step is disabled by the shipped console settings
  (`lightmapOverbrightBOShaderLightmapOverbrightMin "1.399999"`), so 2b uses
  a plain multiply.
- 625 of Kino's 665 models carry a `CIwModelBlockCols` block; 379 have no
  lightmap UVs, so vertex colours are their only lighting.
- Spawn points (`CSpawnPoint.spawnType`): "windows" ×26, "ground" ×4,
  "hole" ×12, one unrecovered type ×24. None is identified as the player
  start, so 2b starts at a fixed lobby point.
- Three `CPlayerController` entities exist; their reflected fields may give
  eye height and movement speed.

## 3. Converter changes

1. **Vertex colours.** Decode `CIwModelBlockCols` to RGBA and export them as
   glTF `COLOR_0`. Read its layout from the data (and from the game code if
   needed, as in 2a). A variant that cannot be decoded is reported in
   `ExportStats.failed`/the coverage report and that model gets no
   `COLOR_0` (the shader treats it as white). Variants are never guessed.
2. **Output location.** `export-kino` writes to `game/assets/converted/kino/`
   (gitignored, per parent spec §3) instead of `converter/out/kino/`.
3. **Transparency.** A material whose base texture has any texel with alpha
   below 128 is exported with glTF `alphaMode: "MASK"`, `alphaCutoff: 0.5`.
   Before relying on pixel alpha alone, the 59/65-byte material layouts are
   checked for a blend/alpha-test flag; if one is found and verified, it
   decides instead.
4. **Skybox.** The decoded skybox cubemap is written as six PNGs plus
   `sky.json` naming the faces in order.
5. **Lightmap mapping** is unchanged from 2a: lightmap = `occlusionTexture`
   on `TEXCOORD_1`. The import script reinterprets it.

## 4. Godot project (`game/`)

Godot **4.7.2-stable**, GDScript, **Mobile** renderer (Vulkan),
1920×1080 landscape.

| Unit | Responsibility |
|---|---|
| `project.godot` | Renderer, resolution, input map, texture import settings (ETC2/ASTC for Android). |
| `import/kino_post_import.gd` | `EditorScenePostImport` for `kino.gltf`: for every `MeshInstance3D`, replace each material with a `ShaderMaterial` using `kino_room.gdshader` (base = imported albedo texture, lightmap = imported AO texture, alpha cut-out when the imported material was MASK), and add a trimesh `StaticBody3D` collision. |
| `shaders/kino_room.gdshader` | `render_mode unshaded`; `ALBEDO = COLOR.rgb * base(UV).rgb * lightmap(UV2).rgb` (lightmap and colour default to white when absent); `ALPHA_SCISSOR_THRESHOLD` for MASK materials. |
| `scenes/main.tscn` + `main.gd` | Instances the imported Kino scene, the player at the fixed lobby start, the sky (cubemap built from the six faces), and the debug overlay. If the converted files are missing: magenta placeholder floor + logged warning, never a crash (parent spec §7). |
| `player/player.gd` | `CharacterBody3D` first-person controller: move, sprint (L3), look, jump (South), crouch (East). Eye height and speeds from `CPlayerController` fields where found; otherwise values in `game/data/approximations.json`. |
| `player/stick.gd` | Pure functions: radial dead zone and response curve for a stick vector. |
| `data/settings.json` | Dead zones, sensitivity, response-curve exponent. |
| `debug/overlay.gd` | FPS + world position label, toggled with Select. |

**Input map (gamepad only):** left stick move · L3 sprint · right stick look ·
South jump · East crouch · Select debug overlay · Start quit.

## 5. Build and device

- **Tools (owner approves each download with file, source and size):**
  `Godot_v4.7.2-stable_win64.exe.zip` (86,013,866 bytes) and
  `Godot_v4.7.2-stable_export_templates.tpz` (1,281,349,702 bytes) from the
  GitHub release `godotengine/godot` `4.7.2-stable`, installed under
  `C:\Users\Nelson\Tools\`.
- **Android export:** debug APK, `arm64-v8a` only, prebuilt template (no
  Gradle, no NDK), signed with the existing `~/.android/debug.keystore`,
  `apksigner` from build-tools 35.0.0, JDK 21. Package name
  `org.nfelici.bozremake` — never Activision's — so it installs beside the
  original.
- **One script** (`game/tools/build-android.sh`): converter `export-kino` →
  `godot --headless --import` → `godot --headless --export-debug` →
  `adb install -r` → launch → logcat filtered to the app.

## 6. Testing

- **Converter:** `node:test` as in 2a — vertex-colour decoding on synthetic
  and real blocks, MASK detection, sky export, output path.
- **Godot, headless (no GUT):** `game/tests/run.gd`, run with
  `godot --headless --script`, exits non-zero on failure.
  - Stick math: dead zone and response curve.
  - Scene check: the imported Kino scene has 349 mesh instances, each with
    collision and the room shader; MASK materials have alpha scissor set.
- **On device, by eye:** `docs/playtest/2b-walkaround.md`, comparing with the
  original at named spots:
  - text on signs/posters reads correctly (`MIRROR_X`);
  - door height vs player eye height (`POSITION_SCALE`);
  - lightmap and vertex-colour look;
  - grates and other cut-outs;
  - FPS at the busiest spots.

## 7. Risks

- **`CIwModelBlockCols` variants** may need game-code reading. Mitigation:
  unknown variants are reported and rendered white, so 2b still ships.
- **Godot's glTF importer** might not map the occlusion texture to
  `ao_texture` as expected. Mitigation: the scene check fails loudly; the
  import script can fall back to reading the glTF material `extras`.
- **Trimesh collision** of 75k triangles on mobile physics. Mitigation:
  measure on device; if heavy, collide only against floor/wall-facing
  triangles or merge per room.
