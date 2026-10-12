# Milestone 1: Converter Basics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Node.js CLI that unpacks Kino der Toten's files from `blackops_dxt.dz`, parses each resource group's structure, names every class it finds, and writes a coverage report.

**Architecture:** Small single-purpose TypeScript modules (binary reader, hash, archive index, group parser, report), run directly by Node 24's built-in type stripping, so there's no build step. The CLI reads archive entries by offset (never loading the 342 MB file at once) and writes to `converter/out/`. Tests use `node:test`. Synthetic buffers make them self-contained; real-data tests run only when the local source files are configured.

**Tech Stack:** Node.js 24.21 (type stripping, `node:test`, `node:fs`), TypeScript 5.x only as a devDependency for `tsc --noEmit` type-checking. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-boz-remake-design.md` (§2, §4, §7, §8, §10 milestone 1)

## Format facts (verified 2026-10-11 against the real files)

These come from read-only probes of `blackops_dxt.dz` (1.0.8) and are the ground truth for the tests below. All integers are little-endian.

**DTRZ archive (`.dz`)**
1. `char[4] magic = "DTRZ"`, `u16 fileCount`, `u16 dirCount`, `u8 version (0)`.
2. `fileCount` NUL-terminated file names, then `dirCount - 1` NUL-terminated directory names (directory 0 is the root, `""`). Directory names use `\` separators.
3. For each file: `u16 dirIndex`, then `u16` chunk indices terminated by `0xFFFF`.
4. `u16 archiveFileCount`, `u16 chunkCount`; then per chunk `u32 offset, u32 compressedSize, u32 size, u16 flags, u16 archiveFile`; then `archiveFileCount - 1` NUL-terminated extra archive names.
5. In `blackops_dxt.dz`: 189 files, 175 dirs, 1 archive file, 189 chunks, one chunk per file, every chunk `flags = 0x100` (stored, uncompressed, `compressedSize == size`), table ends at 12443, the first chunk starts at 12443, and the last chunk ends exactly at the file size of 341,884,481.

**Resource group (`.group.bin`)**
1. `u32 0x0107033D`, `u16 0`, then records `{u32 classHash, u32 size, byte[size - 4] payload}`. Note: `size` counts its own 4 bytes. The records end with `u32 0`, which must land exactly at end of file. All 180 groups in the archive satisfy this.
2. Class hashes are **djb2 over the lowercased class name**: `h = 5381; h = h*33 + c` (uint32). Example: `"CIwTexture"` → `0x3521F539`.
3. Record `0x8081E087` = `ResGroupMembers`: `cstring groupName, u32 flags`.
4. Record `0x3B495DC0` = `ResGroupChildPaths`: `u8 count`, then per child `cstring path, u32 unknownA, u32 unknownB, u32 pathId`. `pathId` is **not** djb2 of the path; keep it raw.
5. Record `0xDC3C2177` = `ResGroupResources`: `u32 listCount`, then per list `u32 classHash, u32 resourceCount, resources...`. Resources have **no size prefix**, so only the first list's header can be located without class decoders. 7 groups have an empty container (`size < 16`, treat as `listCount = 0`).
6. Class names come from scanning printable strings (length ≥ 3) in the decompressed game binary and hashing each one. 63,767 strings resolve every class seen so far (e.g. `CIwMaterial`, `CIwSoundData`, `CZombieConfiguration`).

Real-data reference values used by tests:

| Entry | Dir | Offset | Size |
|---|---|---|---|
| `kino.group.bin` | `levels\kino` | 285657439 | 137 |
| `kino_sectors.group.bin` | `levels\kino` | 290569494 | 1077 |
| `kino_statics.group.bin` | `levels\kino` | 290656141 | 7771833 |

`kino.group.bin` → name `kino`, flags 0, children `levels/kino//kino_dynamics.group` and `levels/kino//kino_statics.group`, terminator at 133. `kino_sectors.group.bin` → name `kino_sectors`, flags 1, 21 children, first child `levels/kino//alley_shared.group`. `kino_statics.group.bin` → 14 lists, first list `CZombieConfiguration` × 8.

## Global Constraints

- Original files are opened **read-only**. Nothing is ever written next to them.
- No Activision data is committed: `converter/out/`, `converter/local.json`, `*.dz`, `*.group.bin`, `*.s3e` stay gitignored (already in `.gitignore`).
- Every output records provenance: source file and byte offset.
- An unknown or unparseable structure is **reported, never guessed**. One bad entry is logged and skipped; the run continues (spec §7).
- Scope: Kino plus the shared groups Kino needs (Task 5 lists them exactly).
- Runtime: Node 24 built-in TypeScript type stripping. Use only erasable syntax (no `enum`, no `namespace`, no parameter properties) and `.ts` extensions in relative imports.

## Review Focus

1. **Missing or wrong source paths in `local.json`.** The user gets one clear error naming the config key and the path, not a stack trace. (Test in Task 5.)
2. **A corrupt or truncated archive or group** (a size running past the buffer, or a missing terminator). It throws a `FormatError` with the byte offset. The CLI records it as a failed entry and continues. (Tests in Tasks 3 and 4.)
3. **Chunks that aren't stored uncompressed** (`flags != 0x100`), e.g. from other texture packs. They're rejected per entry with the flag value named, never silently written as garbage. (Test in Task 3.)
4. **Windows `\` directory separators and mixed-case names** (e.g. `atriumUpstairs` in a child path vs. `atriumupstairs_shared.group.bin` on disk). Output paths use `/`, preserve the archive's case, and never escape `out/`. (Test in Task 5.)
5. **Re-running `unpack`/`report` into an existing `out/`** overwrites deterministically and produces identical files. (Test in Task 6.)

---

### Task 1: Project scaffold and binary reader

**Files:**
- Create: `converter/package.json`, `converter/tsconfig.json`, `converter/local.example.json`, `converter/README.md`
- Create: `converter/src/bin-reader.ts`
- Test: `converter/test/bin-reader.test.ts`

**Interfaces:**
- Produces: `class FormatError extends Error { readonly offset: number }`, constructed as `new FormatError(message: string, offset: number)`. Its message must include the offset as hex (`@0x…`).
- Produces: `class BinReader { constructor(buf: Buffer, offset?: number); pos: number; readonly buf: Buffer; u8(): number; u16(): number; u32(): number; cstring(): string /* latin1, consumes NUL */; bytes(n: number): Buffer; remaining(): number }`. Every read past the end throws `FormatError` at the current `pos`.

- [ ] **Step 1: Create `package.json`**: `"type": "module"`, `"private": true`, `"engines": {"node": ">=24"}`, scripts `"test": "node --test test/"`, `"typecheck": "tsc --noEmit"`, `"boz": "node src/cli.ts"`; devDependency `typescript@^5`. `tsconfig.json`: `"module": "nodenext"`, `"target": "es2023"`, `"strict": true`, `"noEmit": true`, `"allowImportingTsExtensions": true`, `"verbatimModuleSyntax": true`, `"erasableSyntaxOnly": true`, `"types": ["node"]`; also add devDependency `@types/node@^24`. `local.example.json`: `{ "dzPath": "D:/Documents/COD-BOZ-Partially-Decompiled-master/retroid-backup/blackops_dxt.dz", "gameBinaryPath": "D:/Documents/COD-BOZ-Partially-Decompiled-master/COD-BOZ-Partially-Decompiled-master/buildtools/boz/decompressed.s3e" }`. The README says to copy it to `local.json`, which is gitignored.
- [ ] **Step 2: Run `npm install` in `converter/`.** Expected: installs typescript and @types/node only.
- [ ] **Step 3: Write failing tests** in `test/bin-reader.test.ts`:
  - `reads little-endian integers`: `Buffer.from([1, 0x34,0x12, 0x78,0x56,0x34,0x12])` → `u8()==1`, `u16()==0x1234`, `u32()==0x12345678`, `pos==7`.
  - `reads cstring and advances past NUL`: `Buffer.from("kino\0x")` → `cstring()=="kino"`, `pos==5`.
  - `throws FormatError with offset past end`: `new BinReader(Buffer.alloc(3), 2).u32()` throws `FormatError` with `.offset==2` and a message containing `@0x2`.
  - `cstring without NUL throws`: `new BinReader(Buffer.from("abc")).cstring()` throws `FormatError`.
- [ ] **Step 4: Run `npm test`.** Expected: FAIL, module not found.
- [ ] **Step 5: Implement `src/bin-reader.ts`** per the interface.
- [ ] **Step 6: Run `npm test && npm run typecheck`.** Expected: all pass, no type errors.
- [ ] **Step 7: Commit** `feat(converter): scaffold project and binary reader`.

### Task 2: Class hash and name dictionary

**Files:**
- Create: `converter/src/class-names.ts`
- Test: `converter/test/class-names.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `classHash(name: string): number` (djb2 over the lowercased name, uint32).
- Produces: `buildClassNameDictionary(binary: Buffer): Map<number, string>`. Scans runs of printable ASCII (0x20–0x7E) of length ≥ 3 and maps `classHash(run)` → run. On collision, the first string seen wins.
- Produces: `KNOWN_RECORDS = { members: 0x8081E087, childPaths: 0x3B495DC0, resources: 0xDC3C2177 } as const`.
- Produces: `describeClass(hash: number, dict: Map<number, string>): string`. Returns the name, or `0x` + 8 lowercase hex digits when unknown.

- [ ] **Step 1: Write failing tests:**
  - `classHash matches known Marmalade IDs`: `classHash("CIwTexture")==0x3521F539`, `classHash("ResGroupMembers")==0x8081E087`, `classHash("ResGroupChildPaths")==0x3B495DC0`, `classHash("ResGroupResources")==0xDC3C2177`, and `classHash("cIWtEXTURE")==classHash("CIwTexture")`.
  - `dictionary finds names in binary noise`: `Buffer.concat([Buffer.from([0,1,2]), Buffer.from("CIwMaterial"), Buffer.from([0xff]), Buffer.from("ab"), Buffer.from([0])])` → dictionary has `classHash("CIwMaterial")` → `"CIwMaterial"`, and no entry for `"ab"`.
  - `describeClass falls back to hex`: `describeClass(0xdeadbeef, new Map())=="0xdeadbeef"`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `src/class-names.ts`.**
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(converter): djb2 class hashing and name dictionary`.

### Task 3: DTRZ archive index

**Files:**
- Create: `converter/src/dz.ts`
- Create: `converter/test/helpers.ts` (shared test utilities)
- Test: `converter/test/dz.test.ts`

**Interfaces:**
- Consumes: `BinReader`, `FormatError` (Task 1).
- Produces:
  ```ts
  type DzEntry = { index: number; name: string; dir: string /* "/"-separated, "" for root */; path: string /* dir ? dir + "/" + name : name */; offset: number; size: number; flags: number };
  type DzIndex = { version: number; entries: DzEntry[]; tableEnd: number };
  function parseDzIndex(header: Buffer, fileSize: number): DzIndex;
  function readDzEntry(fd: number, entry: DzEntry): Buffer; // fs.readSync at entry.offset
  const DZ_STORED = 0x100;
  ```
  `parseDzIndex` takes a buffer that holds at least the whole table. Callers pass the first 1 MiB, or the whole file if smaller. It throws `FormatError` when: the magic isn't `DTRZ`; a file has ≠ 1 chunk ("multi-chunk entries unsupported"); `archiveFileCount != 1`; or a chunk runs past `fileSize`. Entries are returned in file-name order.
  `readDzEntry` throws `FormatError` naming the flag in hex when `entry.flags != DZ_STORED`.
- Produces in `test/helpers.ts`: `buildDz(files: {name: string; dir: string; data: Buffer; flags?: number}[]): Buffer`, which builds a valid DTRZ archive with one chunk per file and directories deduplicated in first-seen order. Also `realSource(): {dzPath: string; gameBinaryPath: string} | null`, which reads `converter/local.json` and returns null if it's missing or either file doesn't exist.

- [ ] **Step 1: Write failing tests:**
  - `round-trips a synthetic archive`: `buildDz([{name:"a.group.bin",dir:"levels\\kino",data:Buffer.from("AAAA")},{name:"b.bin",dir:"",data:Buffer.from("BB")}])`. Parsing gives 2 entries; entry 0 has `path=="levels/kino/a.group.bin"` and `size==4`; entry 1 has `path=="b.bin"`. Writing the archive to a temp file and calling `readDzEntry` returns the original bytes.
  - `rejects bad magic`: replacing the first byte with `X` throws `FormatError` with `.offset==0`.
  - `rejects chunk past end of file`: `parseDzIndex(buf, buf.length - 1)` throws `FormatError`.
  - `refuses to read non-stored chunks`: an entry built with `flags: 0x200` throws `FormatError` whose message contains `0x200` from `readDzEntry`.
  - `real archive index` (skip via `t.skip("no local.json")` when `realSource()` is null): 189 entries, `tableEnd==12443`; every `flags==0x100`; the last entry ends at the file size; `levels/kino/kino.group.bin` has offset 285657439 and size 137; `levels/kino/kino_statics.group.bin` has offset 290656141 and size 7771833.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `src/dz.ts` and `test/helpers.ts`.** Convert `\` to `/` in `dir` while parsing.
- [ ] **Step 4: Create `converter/local.json`** from the example (paths as given in Task 1). Run `npm test && npm run typecheck`. Expected: PASS, including the real-archive test, which is **not** skipped.
- [ ] **Step 5: Commit** `feat(converter): DTRZ archive index reader`. Check `git status` first: `local.json` must not be staged.

### Task 4: Resource group parser

**Files:**
- Create: `converter/src/group.ts`
- Test: `converter/test/group.test.ts`
- Modify: `converter/test/helpers.ts` (add `buildGroup`)

**Interfaces:**
- Consumes: `BinReader`, `FormatError` (Task 1), `KNOWN_RECORDS` (Task 2).
- Produces:
  ```ts
  type GroupRecord = { classHash: number; offset: number /* of the hash */; size: number };
  type ChildPath = { path: string; unknownA: number; unknownB: number; pathId: number };
  type FirstList = { classHash: number; resourceCount: number; dataOffset: number };
  type GroupInfo = {
    name: string | null; flags: number | null;
    children: ChildPath[];
    listCount: number;                 // 0 when no/empty resources record
    firstList: FirstList | null;       // null when listCount == 0
    records: GroupRecord[];            // every top-level record, in order
    terminatorOffset: number;
  };
  function parseGroup(buf: Buffer): GroupInfo;
  ```
  `parseGroup` throws `FormatError` when: the header isn't `u32 0x0107033D, u16 0`; a record's `size < 4` or it runs past the end; or there's no `u32 0` terminator exactly 4 bytes before the end of the buffer. Unknown record hashes are kept in `records` without error.
- Produces in helpers: `buildGroup(opts: {name: string; flags: number; children?: string[]; lists?: {classHash: number; count: number; body: Buffer}[]}): Buffer`. It writes children with `unknownA=0`, `unknownB=0x1000`, `pathId=0`, and omits the resources record when `lists` is undefined.

- [ ] **Step 1: Write failing tests:**
  - `parses synthetic group`: `buildGroup({name:"kino",flags:0,children:["levels/kino//kino_statics.group"],lists:[{classHash:0x3521F539,count:2,body:Buffer.alloc(8)}]})` → `name=="kino"`, `flags==0`, 1 child with that path, `listCount==1`, `firstList.classHash==0x3521F539`, `firstList.resourceCount==2`, `records.length==3`.
  - `empty resources container`: a resources record with a 4-byte payload of zeros → `listCount==0`, `firstList==null`.
  - `rejects record running past end`: corrupting the members record's size to `0xFFFF` throws `FormatError` with `.offset` equal to that record's size field.
  - `rejects missing terminator`: dropping the last 4 bytes throws `FormatError`.
  - `real kino groups` (skip when no source): read via `parseDzIndex` + `readDzEntry`. `kino.group.bin` → name `kino`, flags 0, children paths exactly `["levels/kino//kino_dynamics.group","levels/kino//kino_statics.group"]`, `terminatorOffset==133`. `kino_sectors.group.bin` → flags 1, 21 children, first `levels/kino//alley_shared.group`. `kino_statics.group.bin` → `listCount==14`, `firstList.classHash==classHash("CZombieConfiguration")`, `resourceCount==8`.
  - `every group in the real archive parses` (skip when no source): all 180 `.group.bin` entries parse without throwing.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `src/group.ts`.**
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS, with real-data tests not skipped.
- [ ] **Step 5: Commit** `feat(converter): resource group structure parser`.

### Task 5: Config, Kino selection and `unpack` command

**Files:**
- Create: `converter/src/config.ts`, `converter/src/selection.ts`, `converter/src/unpack.ts`, `converter/src/cli.ts`
- Test: `converter/test/config.test.ts`, `converter/test/selection.test.ts`, `converter/test/unpack.test.ts`

**Interfaces:**
- Consumes: Task 3 (`parseDzIndex`, `readDzEntry`, `DzEntry`), `FormatError`.
- Produces: `type Config = { dzPath: string; gameBinaryPath: string }`, `loadConfig(file: string): Config`. Throws `ConfigError` (an `Error` subclass) whose message names the key and path when the file is missing, a key is missing, or a path doesn't exist.
- Produces: `isKinoEntry(entry: DzEntry): boolean`. True when `entry.dir` starts with `levels/kino` (case-insensitive), or when `entry.name` (case-insensitive) is in: `weapons_kino.group.bin`, `arms_kino.group.bin`, `weapon_projectiles_kino.group.bin`, `ai_weapons.group.bin`, `ingame.group.bin`, `shared.group.bin`, `fixed.group.bin`, `frontend.group.bin`, `visualeffects.group.bin`, `pickups.group.bin`, `shaders.group.bin`, `cameras.group.bin`, `misc.group.bin`, `console.bin`, or starts with `snd_player_`.
- Produces: `type UnpackResult = { written: {path: string; offset: number; size: number}[]; failed: {path: string; error: string}[] }`; `unpackEntries(dzPath: string, entries: DzEntry[], outDir: string): UnpackResult`. Writes each entry to `outDir/unpacked/<entry.path>` and writes `outDir/manifest.json` = `{source: dzPath, entries: written, failed}`. Refuses (as a failure) any entry whose resolved path escapes `outDir`.
- Produces: CLI `node src/cli.ts unpack [--all]` (Kino selection by default; `--all` for every entry) and `node src/cli.ts report` (Task 6). Both read `local.json` from the `converter/` folder and write to `converter/out/`. On `ConfigError` the CLI prints the message only and exits with code 2.

- [ ] **Step 1: Write failing tests:**
  - `config reports missing key`: a temp `local.json` containing `{"dzPath": "<existing temp file>"}` makes `loadConfig` throw `ConfigError` with a message containing `gameBinaryPath`.
  - `config reports missing file path`: `dzPath` pointing at a nonexistent file → message contains `dzPath` and that path.
  - `selection`: `isKinoEntry` is true for `{dir:"levels/kino",name:"lobby_shared.group.bin"}`, `{dir:"ingame/weapons",name:"weapons_kino.group.bin"}` and `{dir:"x",name:"snd_player_takeo.group.bin"}`, and false for `{dir:"levels/ascension",name:"ascension.group.bin"}`.
  - `unpack writes files and manifest`: a synthetic archive from `buildDz` with `a.bin` in `levels\kino` and `b.bin` in `levels\Kino` (mixed case) → reading `out/unpacked/levels/kino/a.bin` and `out/unpacked/levels/Kino/b.bin` returns the original bytes. Windows' case-insensitive filesystem may merge the folders, which is fine. The manifest lists both paths with the archive's original case and their offsets.
  - `unpack records bad entry and continues`: an archive with one entry at `flags:0x200` and one good entry → `failed.length==1` (error mentions `0x200`), `written.length==1`.
  - `unpack refuses path traversal`: an entry named `..\\..\\evil.bin` in the root dir ends up in `failed`, and nothing is written outside `outDir`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement the four modules.** Open the archive with `fs.openSync(path, "r")`; read the first `min(1 MiB, size)` bytes for the index.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Run `npm run boz -- unpack`.** Expected: prints a count of written entries (≥ 40) and 0 failures; `out/unpacked/levels/kino/kino_statics.group.bin` is 7,771,833 bytes.
- [ ] **Step 6: Commit** `feat(converter): config, Kino selection and unpack command`.

### Task 6: Coverage report

**Files:**
- Create: `converter/src/report.ts`
- Modify: `converter/src/cli.ts` (wire up `report`)
- Test: `converter/test/report.test.ts`

**Interfaces:**
- Consumes: `parseGroup`/`GroupInfo` (Task 4), `buildClassNameDictionary`/`describeClass` (Task 2), `UnpackResult` and selection (Task 5).
- Produces:
  ```ts
  type GroupReport = { path: string; offset: number; size: number; status: "parsed" | "failed"; error?: string;
    name?: string; children?: string[]; listCount?: number; firstList?: { className: string; resourceCount: number } };
  type CoverageReport = { generatedFrom: string; groups: GroupReport[];
    totals: { groups: number; parsed: number; failed: number; listsTotal: number; listsIdentified: number; resourcesDecoded: 0 };
    classesSeen: Record<string, number> /* className -> groups whose first list is that class */ };
  function buildReport(dzPath: string, groups: {entry: DzEntry; data: Buffer}[], dict: Map<number, string>): CoverageReport;
  function renderReportHtml(report: CoverageReport): string;
  ```
  `listsIdentified` counts first lists only, since later lists need class decoders (format fact 5). `resourcesDecoded` is the literal `0` in this milestone. The HTML is a single self-contained file: a totals summary, a table of groups (path, size, status, first list, child count), and the `classesSeen` table. Any group name or error text is HTML-escaped.
- CLI `report`: builds the dictionary from `gameBinaryPath`, parses every selected `.group.bin` from the archive, and writes `out/report.json` and `out/report.html`. JSON keys are emitted in a stable order, groups are sorted by path, and neither file contains timestamps.

- [ ] **Step 1: Write failing tests:**
  - `report counts parsed and failed groups`: two synthetic groups (one valid from `buildGroup` with a first list of class `classHash("CIwTexture")`, one truncated) → `totals.parsed==1`, `totals.failed==1`, the failed one has an `error` containing `@0x`, and `classesSeen` equals `{"CIwTexture":1}`.
  - `html escapes names`: a group named `<b>x</b>` renders `&lt;b&gt;x&lt;/b&gt;` and never the raw tag.
  - `report is deterministic`: calling `buildReport` twice on the same input produces identical `JSON.stringify` output.
  - `real Kino report` (skip when no source): `totals.failed==0`; `classesSeen` includes `CIwTexture`, `CIwMaterial` and `CZombieConfiguration`; the `levels/kino/kino_statics.group.bin` row has `listCount==14`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `src/report.ts` and the CLI wiring.**
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Run `npm run boz -- report` twice.** Expected: both runs print totals with 0 failed. `out/report.json` is byte-identical between runs (compare with `git diff --no-index` or a hash). Open `out/report.html` to confirm it renders.
- [ ] **Step 6: Commit** `feat(converter): Kino coverage report`.
