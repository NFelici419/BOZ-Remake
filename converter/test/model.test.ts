import { test } from "node:test";
import assert from "node:assert/strict";
import { FormatError } from "../src/bin-reader.ts";
import { classHash } from "../src/class-names.ts";
import { decodeModel } from "../src/model.ts";
import { listResources, resourceBytes } from "../src/resources.ts";
import { realKinoGroup, realKinoGroups } from "./helpers.ts";

const u16 = (...v: number[]) => Buffer.concat(v.map((x) => { const b = Buffer.alloc(2); b.writeUInt16LE(x & 0xffff); return b; }));
const u32 = (...v: number[]) => Buffer.concat(v.map((x) => { const b = Buffer.alloc(4); b.writeUInt32LE(x >>> 0); return b; }));
const head = (cls: string) => u32(classHash(cls), classHash(cls));

/** Verts: @8 u16 ?, @10 numVerts, @12 u16 ?, @14 packedCount, @16 s16 center, X/Y/Z planes, then u16 remap. */
function verts(xyz: number[][], center: number, remap: number[]): Buffer {
  const planes = [0, 1, 2].map((a) => u16(...xyz.map((v) => v[a])));
  return Buffer.concat([head("CIwModelBlockVerts"), u16(0, xyz.length + remap.length, 0, xyz.length, center), ...planes, u16(...remap)]);
}
function uvs(cls: "CIwModelBlockGLUVs" | "CIwModelBlockGLUVs2", uv: number[][]): Buffer {
  return Buffer.concat([head(cls), u16(0, uv.length, 0), ...uv.map(([a, b]) => u16(a, b))]);
}
function triList(material: number, indices: number[]): Buffer {
  return Buffer.concat([head("CIwModelBlockGLTriList"), u16(0, indices.length, 0, material, 0), u16(...indices), u32(0)]);
}
function model(blocks: Buffer[], materials: number[], nameHash = 0x5555): Buffer {
  const body = Buffer.concat([u32(nameHash), Buffer.alloc(8), ...blocks, u32(0, materials.length, ...materials)]);
  return Buffer.concat([u32(body.length + 4), body]);
}
const QUAD = [[1, 2, 3], [-4, 5, -6], [7, -8, 9]];

test("decodes synthetic model", () => {
  const m = decodeModel(model([verts(QUAD, 10, [0]), uvs("CIwModelBlockGLUVs", [[4096, 0], [2048, 1024], [0, 4096], [-4096, 8192]]), triList(0, [0, 1, 2])], [0xabc]));
  assert.equal(m.nameHash, 0x5555);
  assert.deepEqual([...m.positions], [11, 12, 13, 6, 15, 4, 17, 2, 19, 11, 12, 13]);
  assert.deepEqual([...m.uv0!], [1, 0, 0.5, 0.25, 0, 1, -1, 2]);
  assert.equal(m.uv1, null);
  assert.equal(m.meshes.length, 1);
  assert.deepEqual([m.meshes[0].materialIndex, [...m.meshes[0].indices]], [0, [0, 1, 2]]);
  assert.ok(m.meshes[0].indices instanceof Uint16Array);
  assert.deepEqual(m.materialHashes, [0xabc]);
});

test("decodes lightmap uvs and skips unconsumed blocks", () => {
  const cols = Buffer.concat([head("CIwModelBlockCols"), Buffer.from("\x00\x01\xff\xff\xff\xff\xff\xff\xff", "latin1")]);
  const uv = [[0, 0], [4096, 0], [0, 4096]];
  const m = decodeModel(model([verts(QUAD, 0, []), uvs("CIwModelBlockGLUVs", uv), uvs("CIwModelBlockGLUVs2", uv), cols, triList(1, [2, 1, 0]), triList(0, [0, 1, 2])], [1, 2]));
  assert.deepEqual([...m.uv1!], [0, 0, 1, 0, 0, 1]);
  assert.deepEqual(m.meshes.map((x) => x.materialIndex), [1, 0]);
});

test("rejects out-of-range index", () => {
  assert.throws(() => decodeModel(model([verts(QUAD, 0, [0]), triList(0, [0, 1, 4])], [1])), (e) => e instanceof FormatError && /index 4/.test(e.message));
});

test("rejects missing verts block", () => {
  assert.throws(() => decodeModel(model([triList(0, [0, 1, 2])], [1])), /Verts/);
});

test("rejects verts block that does not end at the next block", () => {
  const v = verts(QUAD, 0, []);
  v.writeUInt16LE(2, 14); // packedCount 2 of 3 verts: length no longer matches
  assert.throws(() => decodeModel(model([v, triList(0, [0, 1, 2])], [1])), FormatError);
});

test("rejects uv count different from vertex count", () => {
  assert.throws(() => decodeModel(model([verts(QUAD, 0, []), uvs("CIwModelBlockGLUVs", [[0, 0]]), triList(0, [0, 1, 2])], [1])), /uv/i);
});

test("rejects material index past the material list", () => {
  assert.throws(() => decodeModel(model([verts(QUAD, 0, []), triList(1, [0, 1, 2])], [1])), /material index 1/);
});

test("rejects material list that does not end at the resource end", () => {
  const m = model([verts(QUAD, 0, []), triList(0, [0, 1, 2])], [1]);
  const grown = Buffer.concat([m, Buffer.alloc(4)]);
  grown.writeUInt32LE(grown.length, 0);
  assert.throws(() => decodeModel(grown), /material list/);
});

test("real alley model", (t) => {
  if (!realKinoGroups()) return t.skip("no local.json");
  const buf = realKinoGroup("levels/kino/alley_shared.group.bin");
  const m = decodeModel(resourceBytes(buf, listResources(buf).find((r) => r.classHash === classHash("CIwModel") && r.index === 0)!));
  assert.equal(m.positions.length / 3, 835);
  assert.equal(m.meshes.length, 9);
  assert.equal(m.materialHashes.length, 9);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  m.positions.forEach((v, i) => {
    min[i % 3] = Math.min(min[i % 3], v);
    max[i % 3] = Math.max(max[i % 3], v);
  });
  assert.deepEqual([min, max], [[-1131, -755, -4136], [1131, 755, 4136]]);
  assert.ok(m.uv1 && m.uv1.every((v) => v >= 0 && v <= 1));
});

test("every Kino room model decodes", (t) => {
  const groups = realKinoGroups();
  if (!groups) return t.skip("no local.json");
  let n = 0;
  for (const g of groups.filter((x) => x.path.startsWith("levels/kino/"))) {
    for (const ref of listResources(g.data).filter((r) => r.classHash === classHash("CIwModel"))) {
      assert.doesNotThrow(() => decodeModel(resourceBytes(g.data, ref)), `${g.path} CIwModel#${ref.index}`);
      n++;
    }
  }
  assert.equal(n, 665);
});
