import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { classHash } from "../src/class-names.ts";
import { exportKino, nodePlacement } from "../src/kino-export.ts";
import { component, cubemapTexture, entity, material, model, rgba4444Texture, texture, transform, triList, uvs, verts } from "./fixtures.ts";
import { assertValidGltf } from "./gltf-check.ts";
import { buildDz, buildGroup, realSource, tempDir } from "./helpers.ts";

type V3 = [number, number, number];
type Q = [number, number, number, number];
function rotate([x, y, z]: V3, [qx, qy, qz, qw]: Q): V3 {
  // v + 2w(q×v) + 2 q×(q×v)
  const c1: V3 = [qy * z - qz * y, qz * x - qx * z, qx * y - qy * x];
  const c2: V3 = [qy * c1[2] - qz * c1[1], qz * c1[0] - qx * c1[2], qx * c1[1] - qy * c1[0]];
  return [x + 2 * (qw * c1[0] + c2[0]), y + 2 * (qw * c1[1] + c2[1]), z + 2 * (qw * c1[2] + c2[2])];
}
function world(p: { translation: V3; rotation: Q; scale: V3 }, v: V3): V3 {
  const r = rotate([v[0] * p.scale[0], v[1] * p.scale[1], v[2] * p.scale[2]], p.rotation);
  return [r[0] + p.translation[0], r[1] + p.translation[1], r[2] + p.translation[2]];
}
const close = (a: number[], b: number[], eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test("nodePlacement scales game units", () => {
  const p = nodePlacement({ position: [100, -200, 300], rotation: [0, 0, 0, 1] }, 0.01, false);
  assert.deepEqual(p, { translation: [1, -2, 3], rotation: [0, 0, 0, 1], scale: [0.01, 0.01, 0.01] });
});

test("nodePlacement mirror reflects the placed geometry across X", () => {
  const t = { position: [100, -200, 300] as V3, rotation: [0.1, 0.5, -0.3, 0.8] as Q };
  const n = Math.hypot(...t.rotation);
  t.rotation = t.rotation.map((c) => c / n) as Q;
  const plain = nodePlacement(t, 0.01, false);
  const mirrored = nodePlacement(t, 0.01, true);
  for (const v of [[1, 2, 3], [-40, 7, 0.5]] as V3[]) {
    const a = world(plain, v);
    assert.ok(close(world(mirrored, v), [-a[0], a[1], a[2]]), `vertex ${v}`);
  }
});

const body = (full: Buffer) => full.subarray(8); // buildGroup adds size and nameHash (= list index + 1)
const QUAD = [[100, 0, 0], [0, 100, 0], [0, 0, 100]];
const UV = [[0, 0], [4096, 0], [0, 4096]];

/** levels/kino/room_shared: 4 models (placed, unplaced, broken, lightmapped) + an excluded kino_dynamics group. */
function syntheticArchive(): string {
  const room = buildGroup({
    name: "room_shared",
    flags: 0,
    lists: [
      { classHash: classHash("CIwTexture"), resources: [rgba4444Texture(2, 2, [0xf000, 0x0f0f, 0x00ff, 0xffff]), texture({ format: 0, b18: 0x0a, width: 2, height: 2, pitch: 4, recordSize: 0, payload: Buffer.alloc(8) })].map(body) },
      { classHash: classHash("CIwMaterial"), resources: [material(59, { 37: 1, 41: 1 }), material(17, { 13: 2 })].map(body) },
      {
        classHash: classHash("CIwModel"),
        resources: [
          model([verts(QUAD, 0, []), uvs("CIwModelBlockGLUVs", UV), triList(0, [0, 1, 2]), triList(1, [0, 1, 2]), triList(2, [2, 1, 0])], [1, 2, 999]),
          model([verts(QUAD, 0, []), triList(0, [0, 1, 2])], [1]),
          Buffer.concat([Buffer.alloc(8), Buffer.alloc(12)]),
          model([verts(QUAD, 0, []), uvs("CIwModelBlockGLUVs", UV), uvs("CIwModelBlockGLUVs2", UV), triList(0, [0, 1, 2])], [1]),
        ].map(body),
      },
      {
        classHash: classHash("CIsEntitySpec"),
        resources: [
          entity(0, [transform([100, 200, 300], [0, 0, 0, 1])]),
          entity(0, [component("CIsRenderableModel", [])]),
          entity(0, [transform([0, 0, 0], [0, 0, 0, 1])]),
          entity(0, [transform([-50, 0, 10], [0, Math.SQRT1_2, 0, Math.SQRT1_2])]),
        ].map(body),
      },
    ],
  });
  const dynamics = buildGroup({ name: "kino_dynamics", flags: 0, lists: [{ classHash: classHash("CIwModel"), resources: [body(model([verts(QUAD, 0, []), triList(0, [0, 1, 2])], [1]))] }] });
  const sky = buildGroup({ name: "kino_skyboxes_shared", flags: 0, lists: [{ classHash: classHash("CIwTexture"), resources: [body(cubemapTexture([0xf800, 0x07e0, 0x001f, 0xffff, 0xf81f, 0x0000]))], nameHashes: [0x5c1] }] });
  const dir = tempDir();
  const dzPath = path.join(dir, "kino.dz");
  fs.writeFileSync(dzPath, buildDz([
    { name: "kino_skyboxes_shared.group.bin", dir: "levels\\kino", data: sky },
    { name: "kino_dynamics.group.bin", dir: "levels\\kino", data: dynamics },
    { name: "room_shared.group.bin", dir: "levels\\kino", data: room },
  ]));
  return dzPath;
}

function readExport(outDir: string) {
  const json = fs.readFileSync(path.join(outDir, "kino/kino.gltf"), "utf8");
  const bin = fs.readFileSync(path.join(outDir, "kino/kino.bin"));
  return { json, bin, doc: JSON.parse(json) };
}

test("synthetic export", () => {
  const outDir = tempDir();
  const stats = exportKino(syntheticArchive(), outDir);
  assert.equal(stats.failed.length, 1);
  assert.match(stats.failed[0], /room_shared#2/);
  assert.deepEqual({ ...stats, failed: [] }, { models: 4, placed: 2, unplaced: ["room_shared#1"], textures: 1, unsupportedTextures: 1, missingMaterials: 1, missingTextures: 1, skyFaces: 6, failed: [] });

  const { doc, bin } = readExport(outDir);
  assertValidGltf(doc, bin);
  assert.deepEqual(doc.nodes.map((n: { name: string }) => n.name), ["room_shared#0", "room_shared#3"]);
  const [n0, n3] = doc.nodes;
  assert.deepEqual([n0.translation, n0.scale], [[1, 2, 3], [0.01, 0.01, 0.01]]);
  assert.deepEqual(n0.extras, { source: "levels/kino/room_shared.group.bin", resource: "CIwModel#0", entitySource: "levels/kino/room_shared.group.bin", entityResource: "CIsEntitySpec#0" });
  assert.ok(close(n3.translation, [-0.5, 0, 0.1]) && close(n3.rotation, [0, Math.SQRT1_2, 0, Math.SQRT1_2]));

  const materialOf = (node: { mesh: number }, i: number) => doc.materials[doc.meshes[node.mesh].primitives[i].material];
  const plain = materialOf(n0, 0);
  assert.equal(plain.occlusionTexture, undefined, "no lightmap without TEXCOORD_1");
  assert.equal(plain.alphaMode, "MASK", "base texture has a transparent texel");
  assert.equal(doc.images[plain.pbrMetallicRoughness.baseColorTexture.index].uri, "textures/room_shared_0.png");
  assert.deepEqual(materialOf(n0, 1).pbrMetallicRoughness.baseColorFactor, [0.5, 0.5, 0.5, 1]);
  assert.equal(materialOf(n0, 2).name, "missing:0x3e7");
  assert.deepEqual(materialOf(n0, 2).pbrMetallicRoughness.baseColorFactor, [0.5, 0.5, 0.5, 1]);
  assert.deepEqual(materialOf(n3, 0).occlusionTexture, { index: plain.pbrMetallicRoughness.baseColorTexture.index, texCoord: 1 });
  assert.deepEqual(doc.images[0].extras, { source: "levels/kino/room_shared.group.bin", resource: "CIwTexture#0" });

  const sky = JSON.parse(fs.readFileSync(path.join(outDir, "kino/sky/sky.json"), "utf8"));
  assert.deepEqual(sky.faces, ["px.png", "nx.png", "py.png", "ny.png", "pz.png", "nz.png"]);
  assert.equal(sky.source, "levels/kino/kino_skyboxes_shared.group.bin CIwTexture#0");
  for (const f of sky.faces) assert.ok(fs.existsSync(path.join(outDir, "kino/sky", f)), f);
  const png = fs.readFileSync(path.join(outDir, "kino/textures/room_shared_0.png"));
  assert.equal(png.toString("latin1", 1, 4), "PNG");
  assert.deepEqual(fs.readdirSync(path.join(outDir, "kino/textures")), ["room_shared_0.png"]);
});

test("synthetic export is deterministic", () => {
  const dz = syntheticArchive();
  const a = tempDir();
  const b = tempDir();
  exportKino(dz, a);
  exportKino(dz, b);
  assert.deepEqual(readExport(a).bin, readExport(b).bin);
  assert.equal(readExport(a).json, readExport(b).json);
});

let realOut: { dir: string; stats: ReturnType<typeof exportKino> } | undefined;
function realExport() {
  const src = realSource();
  if (!src) return null;
  if (!realOut) {
    const dir = tempDir();
    realOut = { dir, stats: exportKino(src.dzPath, dir) };
  }
  return realOut;
}

test("real export", (t) => {
  const real = realExport();
  if (!real) return t.skip("no local.json");
  assert.equal(real.stats.placed, 349);
  assert.deepEqual(real.stats.unplaced, ["atriumupstairs_shared#3", "atriumupstairs_shared#4"]);
  assert.deepEqual(real.stats.failed, []);
  const { doc, bin } = readExport(real.dir);
  assert.equal(doc.nodes.length, 349);
  const alley = doc.nodes.find((n: { name: string }) => n.name === "alley_shared#0");
  assert.ok(close(alley.translation, [-38.864, 7.173, -9.801], 1e-3), `${alley.translation}`);
  for (const img of doc.images) assert.ok(fs.existsSync(path.join(real.dir, "kino", img.uri)), img.uri);
  assertValidGltf(doc, bin);
});

test("export is deterministic", (t) => {
  const real = realExport();
  if (!real) return t.skip("no local.json");
  const again = tempDir();
  exportKino(realSource()!.dzPath, again);
  const a = readExport(real.dir);
  const b = readExport(again);
  assert.equal(a.json, b.json);
  assert.ok(a.bin.equals(b.bin));
  const files = fs.readdirSync(path.join(real.dir, "kino/textures")).sort();
  assert.deepEqual(fs.readdirSync(path.join(again, "kino/textures")).sort(), files);
  for (const f of files) assert.ok(fs.readFileSync(path.join(real.dir, "kino/textures", f)).equals(fs.readFileSync(path.join(again, "kino/textures", f))), f);
});
