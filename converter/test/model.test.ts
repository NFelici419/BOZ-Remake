import { test } from "node:test";
import assert from "node:assert/strict";
import { FormatError } from "../src/bin-reader.ts";
import { classHash } from "../src/class-names.ts";
import { decodeModel } from "../src/model.ts";
import { listResources, resourceBytes } from "../src/resources.ts";
import { colsBlock, model, triList, uvs, verts } from "./fixtures.ts";
import { realKinoGroup, realKinoGroups } from "./helpers.ts";

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
  const cols = colsBlock(Buffer.from("\x00\x01\xff\xff\xff\xff\xff\xff\xff", "latin1"));
  const uv = [[0, 0], [4096, 0], [0, 4096]];
  const m = decodeModel(model([verts(QUAD, 0, []), uvs("CIwModelBlockGLUVs", uv), uvs("CIwModelBlockGLUVs2", uv), cols, triList(1, [2, 1, 0]), triList(0, [0, 1, 2])], [1, 2]));
  assert.deepEqual([...m.uv1!], [0, 0, 1, 0, 0, 1]);
  assert.deepEqual(m.meshes.map((x) => x.materialIndex), [1, 0]);
});

test("rejects triangle list whose index count is not a multiple of 3", () => {
  assert.throws(() => decodeModel(model([verts(QUAD, 0, []), triList(0, [0, 1, 2, 0])], [1])), (e) => e instanceof FormatError && /4 indices/.test(e.message));
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
