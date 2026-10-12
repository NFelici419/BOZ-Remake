# Milestone 2a: Kino Geometry Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the converter so `npm run boz -- export-kino` writes `out/kino/kino.gltf` (+ `.bin` + PNG textures). That file holds all 349 placed Kino room models with their surface textures and lightmaps, ready to open in Godot.

**Architecture:** New single-purpose decoders sit beside the milestone 1 parsers. `resources.ts` walks every resource in a group. `texture.ts`, `material.ts`, `model.ts` and `entity.ts` decode one class each. `png.ts` and `gltf.ts` are writers, and `kino-export.ts` assembles the scene. Every decoder takes a `Buffer` slice and returns plain data, so each one can be tested on synthetic bytes and on the real archive.

**Tech Stack:** Node 24 (type stripping, `node:test`, `node:zlib` for PNG deflate). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-boz-remake-design.md` (§4 decode stages 1–4, §7, §8, §10 milestone 2). Milestone 2 is split in two:
- **2a (this plan):** data to glTF.
- **2b (next plan):** Godot project, controller walk-around and Retroid build. 2b also confirms the two provisional constants in Global Constraints by eye.

## Format facts (verified 2026-10-12 against `blackops_dxt.dz` 1.0.8 and the game code)

Little-endian throughout. `hash(name)` = `classHash` from milestone 1 (djb2 of the lowercased name). Offsets below are from the start of the named structure. Real-data reference resources are identified as `<group path>#<index within its class>`.

**F1. Resource lists.** Inside the `ResGroupResources` record payload: `u32 listCount`, then per list `u32 classHash, u32 count, u8 flagA, u8 flagB`, then `count` resources. Each resource starts with `u32 size` (counting its own 4 bytes), followed by `u32 nameHash`. All 46 Kino groups walk to exactly the end of the container (verified). flagA/flagB are `1,1` except `CIwSoundData`, `CIwSoundSpec`, `CIwUIElement` and `CWave`, which are `0,1`.

**F2. CIwTexture.** Byte 13 = format: `0x2b` is compressed and `0x06` is raw 16-bit; `0x00` and `0x1b` occur 7 times in total, so treat them as unsupported. `u16 width` @21, `u16 height` @23, `u16 pitch` @25, `u32 recordSize` @27. The payload starts @31. The resource ends with 1 trailing byte.
- **Raw (`recordSize == 0`):** `pitch × height` bytes of 16-bit pixels. Byte 18 = `5` means RGBA4444 (R in the high nibble). Byte 18 values `0x0e` and `0x0a` are other raw formats, unsupported here.
- **Compressed:** a GL image record @31: `u32 tag, u32 recordSize (incl. tag), u32 glFormat, u32 mipCount, u32 width, u32 height, u32 mipSize[12]`. Pixel data starts @31+72, largest mip first. glFormat `0x83F1` = DXT1 (1-bit alpha), `0x83F2` = DXT3.
- **Cubemap:** the record's `recordSize` covers a 72-byte header followed by 6 face records with the same layout. Reference: `levels/kino/kino_skyboxes_shared.group.bin` CIwTexture#0, 6 faces of 128×128 DXT1, 8 mips.
- **Reference:** `levels/kino/alley_shared.group.bin` CIwTexture#45 = 256×256 DXT1, 9 mips, mip sizes `32768,8192,2048,512,128,32,8,8,8`. Its decoded first pixels are RGB `(0x3f,0x46,0x57)`-ish blue-grey; this is the lightmap atlas. CIwTexture#0 = 64×64 raw RGBA4444, pitch 128.

**F3. CIwMaterial.** Resource size selects the layout. Texture references are name hashes, and 0 or an unknown hash means none.
- Size 17: texture0 @13.
- Size 59: texture0 @37, texture1 (lightmap) @41.
- Size 65: texture0 @37.
- Reference: `alley_shared` CIwMaterial#0 → texture0 = name hash of `alley_shared` CIwTexture#44, texture1 = CIwTexture#45.

**F4. CIwModel.** Blocks begin where a `u32 h` is immediately repeated (`h, h`) and `h` is the hash of a `CIwModelBlock*` class. Find them by scanning from byte 8. Only the block types below are consumed; others are skipped by their known length or by scanning to the next block.
- **`CIwModelBlockVerts`** (exact, read from game code `0x242f48`/`0x258774`):
  - @10 `u16 numVerts`.
  - @14 `u16 packedCount`, `s16 center`, then 3 planes (X, then Y, then Z) of `packedCount` × s16. Each value gets `center` added.
  - Then `numVerts − packedCount` × `u16 remap`: vertex `packedCount + i` copies the position of vertex `remap[i]`.
  - The block ends exactly at the next block (665/665).
  - Reference: `alley_shared` CIwModel#0 → numVerts 835, packed 424, center 0, bbox x ±1131, y ±755, z ±4136.
- **`CIwModelBlockGLUVs` / `CIwModelBlockGLUVs2`:** @10 `u16 count`, data @14: `count` × (s16 u, s16 v). Block length = 14 + 4·count. UV = value / 4096. UVs2 are lightmap coordinates, in [0,1] for the alley.
- **`CIwModelBlockGLTriList`:** @10 `u16 indexCount`, @14 `u16 materialIndex`, indices @18 (`u16` each, all < numVerts). Block length = 22 + 2·indexCount.
- **Material list:** after the last TriList block: `u32 0`, `u32 materialCount`, then `materialCount` × `u32 materialNameHash`, ending exactly at the resource end (665/665). Reference: alley CIwModel#0 has 9 TriLists, material indices 0–8, and 9 materials.
- `CIwModelBlockCols` is **not** decoded in 2a (several variants; the lightmaps carry the lighting).

**F5. CIsEntitySpec** (self-describing reflection):
- Header: `u32 size, u32 nameHash, u32 componentCount`.
- Per component: `u32 hash("CIsComponentSpec"), u32 0, u32 classHash, u32 reflSize`, then a `reflSize`-byte block: `"LFER"`, `u32 classHash, u32 reflSize, u32 fieldCount`.
- Per field: `u32 ownerHash, u32 typeHash, u32 1, u32 fieldNameHash, u32 1, u32 dataSize, byte[dataSize]` (fields can be unaligned).
- `CIsTransform` fields: `m_localPosition` (CIwFVec3, 3 × f32) and `m_localRotation` (CIwFQuat, 4 × f32 in x,y,z,w order).
- An entity whose `nameHash` equals a CIwModel's `nameHash` places that model.
- Reference: `alley_shared` CIsEntitySpec#0 → name = alley CIwModel#0, position (−3886.407, 717.298, −980.090), rotation (0,0,0,1), components `[CIsTransform, CIsRenderableModel]`, `m_renderGroupId` = 20.
- Kino has 726 entities with a position. 349 of the 351 static room models (all Kino-dir models except `kino_dynamics`, `kino_skyboxes_shared` and `effects_shared`) match one.

**F6. Axes:** game +Y is up; the side view of the assembled map shows floors at the low-Y edge.

## Global Constraints

- Original files read-only; no game data committed (`converter/out/` stays gitignored). Every exported asset records its source group path and resource index in glTF `extras`.
- Unknown or unsupported data is reported, never guessed. A failing resource is logged in the coverage report and skipped (spec §7); export continues.
- Scope: Kino room geometry only. Models from `kino_dynamics.group.bin`, `kino_skyboxes_shared.group.bin` and `effects_shared.group.bin`, plus vertex colors and animations, are out of scope for 2a.
- Node 24 erasable TypeScript only; `.ts` extensions in imports; tests via `node:test`.
- **Provisional constants** (single definitions in `src/kino-export.ts`, confirmed in milestone 2b):
  - `POSITION_SCALE = 0.01` (game units → metres).
  - `MIRROR_X = false`.
  - Ruling recorded here: scale and handedness can't be verified without a renderer.

## Review Focus

1. **A model whose material hash matches no material, or a material whose texture hash matches no texture** (39 Kino materials have none). Export uses a flat grey material named `missing:<hash>`, and the coverage report counts these; never a crash. (Test in Task 6.)
2. **Unsupported texture formats** (format byte `0x00`/`0x1b`, raw byte-18 formats other than 5, glFormats other than 0x83F1/0x83F2). The decoder returns `{kind: "unsupported", reason}` and export substitutes the grey material. (Test in Task 3.)
3. **Non-power-of-two or tiny DXT mips** (2×2, 1×1 levels with 8-byte blocks). Only mip 0 is decoded to PNG, and widths/heights that aren't multiples of 4 are handled by clipping. (Test in Task 3.)
4. **glTF validity on large output** (≈225k triangle edges, > 65,535 vertices in total). Each primitive uses its own `UNSIGNED_SHORT` or `UNSIGNED_INT` indices as needed, buffer views stay 4-byte aligned, and accessor `min`/`max` are set for POSITION. (Test in Task 6.)
5. **Re-running `export-kino`** produces byte-identical `kino.gltf`/`.bin` and PNGs: no timestamps, deterministic ordering by group path, then resource index. (Test in Task 6.)

---

### Task 1: Resource walker and full coverage counts

**Files:**
- Create: `converter/src/resources.ts`
- Modify: `converter/src/report.ts`, `converter/test/helpers.ts` (`buildGroup` writes F1 resources)
- Test: `converter/test/resources.test.ts`, update `converter/test/report.test.ts`

**Interfaces:**
- Consumes: `parseGroup`, `GroupInfo`, `KNOWN_RECORDS`, `BinReader`, `FormatError`.
- Produces:
  ```ts
  type ResourceRef = { classHash: number; index: number; offset: number; size: number; nameHash: number };
  function listResources(buf: Buffer): ResourceRef[]; // every resource in every list, in file order; offset is absolute in buf
  function resourceBytes(buf: Buffer, ref: ResourceRef): Buffer; // buf.subarray(offset, offset + size)
  ```
  `listResources` throws `FormatError` when a resource size is < 8 or runs past the container, or when the walk doesn't end exactly at the container end. A group with no resources record, or an empty container, returns `[]`.
- Modify `GroupReport` to add `resourceCounts: Record<string, number>` (className → count). `totals.listsIdentified` becomes the count of all lists walked. `totals.resourcesDecoded` stays `0` until Task 6 replaces it.

- [ ] **Step 1: Write failing tests:**
  - `walks synthetic lists`: extend `buildGroup` so a list may give `resources: Buffer[]` instead of `body`, where each resource is written as `u32 size(=len+8), u32 nameHash(=i+1), body`, after `classHash, count, 1, 1`. Lists that still give `body` keep milestone 1's raw layout, so existing tests are untouched. Two lists of 2 and 1 resources → 3 refs, indices `0,1,0`, and offsets increasing.
  - `rejects resource past container`: a corrupted size → `FormatError`.
  - `real Kino groups walk exactly` (skip without source): every selected Kino `.group.bin` walks without throwing. `levels/kino/alley_shared.group.bin` yields a `CIwModel` count > 0, CIwTexture#45 has `size` > 43000, and the total `CIwModel` count across `levels/kino/` is 665.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `src/resources.ts`** (walk per F1). Update `report.ts` and its tests (the real report's `listsIdentified` now equals `listsTotal`).
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(converter): walk every resource in a group`.

### Task 2: Entity spec (reflection) parser

**Files:**
- Create: `converter/src/entity.ts`
- Test: `converter/test/entity.test.ts`

**Interfaces:**
- Consumes: `BinReader`, `FormatError`, `classHash`.
- Produces:
  ```ts
  type Field = { ownerHash: number; typeHash: number; nameHash: number; data: Buffer };
  type Component = { classHash: number; fields: Field[] };
  type EntitySpec = { nameHash: number; components: Component[] };
  type Transform = { position: [number, number, number]; rotation: [number, number, number, number] };
  function parseEntitySpec(res: Buffer): EntitySpec;           // res = one resource incl. its size field
  function entityTransform(e: EntitySpec): Transform | null;    // from CIsTransform; rotation defaults to [0,0,0,1]
  ```
  `parseEntitySpec` validates the `"LFER"` tag and that each component's fields end exactly at its `reflSize`; otherwise it throws `FormatError`. Trailing bytes after the last component are allowed.

- [ ] **Step 1: Write failing tests:**
  - `parses synthetic transform`: build bytes per F5 with one CIsTransform component holding position (1,2,3) and rotation (0,0,0,1) → `entityTransform` returns exactly those values.
  - `rejects bad LFER tag`: change the tag → `FormatError`.
  - `real alley entity` (skip without source): `alley_shared` CIsEntitySpec#0 matches F5's reference values (floats within 1e-3). Its component class names are `[CIsTransform, CIsRenderableModel]`, and the `m_renderGroupId` field data reads as u32 20.
  - `every Kino entity parses` (skip without source): all CIsEntitySpec resources in `levels/kino/` groups parse, and exactly 726 have a transform.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `src/entity.ts`.**
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(converter): parse reflected entity specs and transforms`.

### Task 3: Texture decoder and PNG writer

**Files:**
- Create: `converter/src/texture.ts`, `converter/src/png.ts`
- Test: `converter/test/texture.test.ts`, `converter/test/png.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Texture =
    | { kind: "image"; width: number; height: number; rgba: Buffer }               // mip 0 decoded to RGBA8
    | { kind: "cubemap"; width: number; height: number; faces: Buffer[] }          // 6 RGBA8 faces
    | { kind: "unsupported"; reason: string };
  function decodeTexture(res: Buffer): Texture;
  function decodeDxt(data: Buffer, width: number, height: number, format: 0x83f1 | 0x83f2): Buffer; // RGBA8
  function encodePng(width: number, height: number, rgba: Buffer): Buffer; // 8-bit RGBA, filter 0, zlib deflate
  ```
  DXT1 follows the standard block decode (c0 > c1 → 4-colour; else 3-colour + transparent black). DXT3 has an explicit 4-bit alpha block before each colour block. Edge blocks are clipped to the image bounds. RGBA4444 expands each nibble as `n × 17`.

- [ ] **Step 1: Write failing tests:**
  - `png round-trips`: `encodePng(2,1,rgba)`. The output starts with the PNG signature, its IHDR width/height read back as 2 and 1, and inflating the IDAT gives `[0, ...rgba]`.
  - `dxt1 solid block`: one block with c0 = 0xF800 (red), c1 = 0, all indices 0 → 16 pixels of (255,0,0,255).
  - `dxt1 3-colour transparent`: c0 = 0, c1 = 0xFFFF, indices all 3 → alpha 0.
  - `dxt clips non-multiple-of-4`: a 2×2 image from one block → 16 bytes out.
  - `unsupported format reported`: a texture with format byte 0x00 → `kind:"unsupported"` with a reason containing `0x0`.
  - `real alley textures` (skip without source): CIwTexture#45 → image 256×256. CIwTexture#0 → image 64×64. The skybox CIwTexture#0 → cubemap with 6 faces of 128×128.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement both modules** per F2.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Write `out/preview/alley_45.png` and `alley_0.png` with a one-off `node -e` using the new modules, and view them.** Expected: #45 shows the patchwork lightmap atlas and #0 a grey metal grate. Note the result in the ledger.
- [ ] **Step 6: Commit** `feat(converter): decode DXT and RGBA4444 textures to PNG`.

### Task 4: Material decoder

**Files:**
- Create: `converter/src/material.ts`
- Test: `converter/test/material.test.ts`

**Interfaces:**
- Produces: `type Material = { nameHash: number; texture0: number | null; texture1: number | null }` and `decodeMaterial(res: Buffer): Material`. It uses the size-selected offsets from F3; a hash value of 0 becomes `null`. Any other size throws `FormatError` naming the size.

- [ ] **Step 1: Write failing tests:**
  - `size 17/59/65 layouts`: synthetic buffers of each size with distinct hashes at the F3 offsets decode correctly, and size 59 with 0 @41 → `texture1: null`.
  - `unknown size rejected`: a 20-byte material → `FormatError` mentioning `20`.
  - `real alley material` (skip without source): CIwMaterial#0's texture0/texture1 equal the `nameHash` of `alley_shared` CIwTexture#44 and #45.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `src/material.ts`.**
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(converter): decode materials`.

### Task 5: Model decoder

**Files:**
- Create: `converter/src/model.ts`
- Test: `converter/test/model.test.ts`

**Interfaces:**
- Consumes: `classHash`, `FormatError`.
- Produces:
  ```ts
  type ModelMesh = { materialIndex: number; indices: Uint16Array };
  type Model = {
    nameHash: number;
    positions: Float32Array;          // numVerts*3, raw game units
    uv0: Float32Array | null;         // numVerts*2, /4096
    uv1: Float32Array | null;         // lightmap, numVerts*2, /4096
    meshes: ModelMesh[];
    materialHashes: number[];
  };
  function decodeModel(res: Buffer): Model;
  ```
  It throws `FormatError` when: there's no Verts block; the Verts block doesn't end exactly at the next block; a UV block's count ≠ numVerts; an index is ≥ numVerts; a `materialIndex` is ≥ `materialHashes.length`; or the material list doesn't end at the resource end.

- [ ] **Step 1: Write failing tests:**
  - `decodes synthetic model`: build a model with a Verts block (packedCount 3 of 4 verts, center 10, remap [0]), one UVs block and one TriList (indices 0,1,2, material 0), then `u32 0, u32 1, u32 hash`. Expect positions `[x0+10…]`, `positions[9..11]` equal to vertex 0's, uv/4096 values, one mesh, and one material hash.
  - `rejects out-of-range index`: index 4 with 4 verts → `FormatError`.
  - `real alley model` (skip without source): CIwModel#0 has 835 verts, 9 meshes, 9 material hashes, and a position bbox exactly x ±1131, y ±755, z ±4136. Every uv1 value is in [0,1].
  - `every Kino room model decodes` (skip without source): all 665 Kino-dir CIwModels decode without throwing.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `src/model.ts`** per F4.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(converter): decode Marmalade models`.

### Task 6: glTF writer, Kino scene export and CLI

**Files:**
- Create: `converter/src/gltf.ts`, `converter/src/kino-export.ts`
- Modify: `converter/src/cli.ts` (`export-kino` command), `converter/src/report.ts` (`resourcesDecoded`, missing-reference counts), `converter/README.md`
- Test: `converter/test/gltf.test.ts`, `converter/test/kino-export.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  ```ts
  // gltf.ts — minimal glTF 2.0 builder
  type GltfPrimitive = { positions: Float32Array; uv0?: Float32Array; uv1?: Float32Array; indices: Uint16Array | Uint32Array; material: number };
  type GltfNode = { name: string; mesh: number; translation: [number, number, number]; rotation: [number, number, number, number]; scale: [number, number, number]; extras: Record<string, unknown> };
  class GltfBuilder {
    addImage(uri: string): number;
    addMaterial(name: string, baseColorImage: number | null, lightmapImage: number | null): number; // lightmap → occlusionTexture with texCoord 1; null base → baseColorFactor [0.5,0.5,0.5,1]
    addMesh(name: string, primitives: GltfPrimitive[]): number;
    addNode(node: GltfNode): number;
    toFiles(baseName: string): { json: string; bin: Buffer }; // buffer views 4-byte aligned; POSITION min/max set
  }
  // kino-export.ts
  const POSITION_SCALE = 0.01; const MIRROR_X = false;
  type ExportStats = { models: number; placed: number; unplaced: string[]; textures: number; unsupportedTextures: number; missingMaterials: number; missingTextures: number };
  function exportKino(dzPath: string, outDir: string): ExportStats; // writes outDir/kino/kino.gltf, kino.bin, textures/*.png
  ```
  - One node per placed room model, named `<groupBase>#<index>` (e.g. `alley_shared#0`).
  - Node `translation` = entity position × `POSITION_SCALE`. Node `scale` = `[POSITION_SCALE, POSITION_SCALE, POSITION_SCALE]` applied to raw-unit mesh positions.
  - Textures are written once each as `textures/<groupBase>_<index>.png`. Cubemaps are skipped and counted as unsupported for 2a.
  - Nodes are sorted by group path, then model index.
  - CLI `boz export-kino` prints the `ExportStats` summary. `report` adds `resourcesDecoded` = models + textures + materials decoded.

- [ ] **Step 1: Write failing tests:**
  - `gltf structure`: one primitive with 3 verts → JSON parses. `asset.version == "2.0"`; the POSITION accessor has `min`/`max`; every bufferView `byteOffset % 4 == 0`; and `bin.length` equals `buffers[0].byteLength`.
  - `uint32 indices when needed`: a primitive with an index of 70000 → accessor `componentType == 5125`.
  - `missing material falls back to grey`: `addMaterial("missing:0x1", null, null)` → `baseColorFactor [0.5,0.5,0.5,1]`, no textures.
  - `real export` (skip without source): `exportKino` into a temp dir gives `placed == 349` and `unplaced.length == 2`. `kino.gltf` has 349 nodes. The `alley_shared#0` node translation ≈ `(-38.864, 7.173, -9.801)` (±1e-3). Every image file referenced exists.
  - `export is deterministic` (skip without source): two exports into different temp dirs give byte-identical `kino.gltf` and `kino.bin`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `gltf.ts`, `kino-export.ts`, the CLI command and the report change.**
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Run `npm run boz -- export-kino`.** Expected: a summary with 349 placed and 2 unplaced, and `out/kino/kino.gltf` written. Render a quick top-down PNG of the node positions (one-off script) to confirm the layout matches the milestone-research top view.
- [ ] **Step 6: Commit** `feat(converter): export Kino rooms to glTF`.
