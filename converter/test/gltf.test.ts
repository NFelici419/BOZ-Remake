import { test } from "node:test";
import assert from "node:assert/strict";
import { GltfBuilder, type GltfNode } from "../src/gltf.ts";
import { assertValidGltf } from "./gltf-check.ts";

const tri = () => ({
  positions: new Float32Array([0, 0, 0, 2, -1, 0, 0, 5, 3]),
  uv0: new Float32Array([0, 0, 1, 0, 0, 1]),
  indices: new Uint16Array([0, 1, 2]),
});
const node = (mesh: number): GltfNode => ({ name: "n", mesh, translation: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [0.01, 0.01, 0.01], extras: { source: "g#0" } });

function build(b: GltfBuilder) {
  const { json, bin } = b.toFiles("t");
  return { doc: JSON.parse(json), bin };
}

test("gltf structure", () => {
  const b = new GltfBuilder();
  const mat = b.addMaterial("m", null, null);
  b.addNode(node(b.addMesh("mesh", [{ ...tri(), material: mat }, { ...tri(), material: mat }])));
  const { doc, bin } = build(b);
  assert.equal(doc.asset.version, "2.0");
  const pos = doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION];
  assert.deepEqual([pos.min, pos.max], [[0, -1, 0], [2, 5, 3]]);
  assert.ok(doc.bufferViews.every((v: { byteOffset: number }) => v.byteOffset % 4 === 0));
  assert.equal(bin.length, doc.buffers[0].byteLength);
  assert.equal(doc.buffers[0].uri, "t.bin");
  assertValidGltf(doc, bin);
});

test("uint32 indices when needed", () => {
  const b = new GltfBuilder();
  const mat = b.addMaterial("m", null, null);
  const big = new Float32Array(70001 * 3);
  const small = b.addMesh("small", [{ ...tri(), material: mat }]);
  const large = b.addMesh("large", [{ positions: big, indices: new Uint32Array([0, 1, 70000]), material: mat }]);
  const { doc, bin } = build(b);
  const indexType = (mesh: number) => doc.accessors[doc.meshes[mesh].primitives[0].indices].componentType;
  assert.equal(indexType(small), 5123);
  assert.equal(indexType(large), 5125);
  assertValidGltf(doc, bin);
});

test("missing material falls back to grey", () => {
  const b = new GltfBuilder();
  const m = b.addMaterial("missing:0x1", null, null);
  const { doc } = build(b);
  assert.equal(doc.materials[m].name, "missing:0x1");
  assert.deepEqual(doc.materials[m].pbrMetallicRoughness.baseColorFactor, [0.5, 0.5, 0.5, 1]);
  assert.equal(doc.materials[m].pbrMetallicRoughness.baseColorTexture, undefined);
  assert.equal(doc.materials[m].occlusionTexture, undefined);
});

test("lightmap becomes an occlusion texture on texCoord 1", () => {
  const b = new GltfBuilder();
  const base = b.addImage("textures/a.png", { source: "g#1" });
  const lightmap = b.addImage("textures/b.png");
  assert.equal(b.addImage("textures/a.png"), base);
  const m = b.addMaterial("m", base, lightmap, { source: "g#2" });
  b.addNode(node(b.addMesh("mesh", [{ ...tri(), uv1: new Float32Array(6), material: m }])));
  const { doc, bin } = build(b);
  assert.deepEqual(doc.images, [{ uri: "textures/a.png", extras: { source: "g#1" } }, { uri: "textures/b.png" }]);
  assert.deepEqual(doc.textures, [{ sampler: 0, source: 0 }, { sampler: 0, source: 1 }]);
  assert.equal(doc.materials[m].pbrMetallicRoughness.baseColorTexture.index, base);
  assert.deepEqual(doc.materials[m].occlusionTexture, { index: lightmap, texCoord: 1 });
  assert.deepEqual(doc.materials[m].extras, { source: "g#2" });
  assertValidGltf(doc, bin);
});

test("shared attribute arrays reuse accessors", () => {
  const b = new GltfBuilder();
  const mat = b.addMaterial("m", null, null);
  const t = tri();
  b.addMesh("mesh", [{ ...t, material: mat }, { ...t, indices: new Uint16Array([2, 1, 0]), material: mat }]);
  const { doc } = build(b);
  const [p0, p1] = doc.meshes[0].primitives;
  assert.equal(p0.attributes.POSITION, p1.attributes.POSITION);
  assert.equal(p0.attributes.TEXCOORD_0, p1.attributes.TEXCOORD_0);
  assert.notEqual(p0.indices, p1.indices);
});

test("nodes and scene", () => {
  const b = new GltfBuilder();
  const mesh = b.addMesh("mesh", [{ ...tri(), material: b.addMaterial("m", null, null) }]);
  assert.equal(b.addNode(node(mesh)), 0);
  assert.equal(b.addNode({ ...node(mesh), name: "second" }), 1);
  const { doc } = build(b);
  assert.deepEqual(doc.nodes[0], { name: "n", mesh: 0, translation: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [0.01, 0.01, 0.01], extras: { source: "g#0" } });
  assert.deepEqual(doc.scenes, [{ nodes: [0, 1] }]);
  assert.equal(doc.scene, 0);
});
