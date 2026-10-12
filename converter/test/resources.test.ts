import { test } from "node:test";
import assert from "node:assert/strict";
import { FormatError } from "../src/bin-reader.ts";
import { classHash } from "../src/class-names.ts";
import { listResources, resourceBytes } from "../src/resources.ts";
import { buildGroup, realKinoGroup, realKinoGroups } from "./helpers.ts";

const TEX = classHash("CIwTexture");
const MAT = classHash("CIwMaterial");

test("walks synthetic lists", () => {
  const buf = buildGroup({
    name: "g",
    flags: 0,
    lists: [
      { classHash: TEX, resources: [Buffer.from("abc"), Buffer.alloc(5)] },
      { classHash: MAT, resources: [Buffer.from("x")] },
    ],
  });
  const refs = listResources(buf);
  assert.deepEqual(
    refs.map((r) => [r.classHash, r.index, r.size, r.nameHash]),
    [
      [TEX, 0, 11, 1],
      [TEX, 1, 13, 2],
      [MAT, 0, 9, 1],
    ],
  );
  assert.ok(refs[0].offset < refs[1].offset && refs[1].offset < refs[2].offset);
  assert.equal(resourceBytes(buf, refs[0]).toString("latin1", 8), "abc");
  assert.equal(resourceBytes(buf, refs[2]).readUInt32LE(0), 9);
});

test("group without resources is empty", () => {
  assert.deepEqual(listResources(buildGroup({ name: "g", flags: 0 })), []);
  assert.deepEqual(listResources(buildGroup({ name: "g", flags: 0, lists: [] })), []);
});

test("rejects resource past container", () => {
  const buf = buildGroup({ name: "g", flags: 0, lists: [{ classHash: TEX, resources: [Buffer.from("abc")] }] });
  const at = buf.indexOf(Buffer.from("abc")) - 8;
  buf.writeUInt32LE(200, at);
  assert.throws(() => listResources(buf), FormatError);
});

test("rejects resource smaller than its header", () => {
  const buf = buildGroup({ name: "g", flags: 0, lists: [{ classHash: TEX, resources: [Buffer.from("abc")] }] });
  buf.writeUInt32LE(4, buf.indexOf(Buffer.from("abc")) - 8);
  assert.throws(() => listResources(buf), /size 4/);
});

test("rejects walk that stops short of the container end", () => {
  // milestone 1 raw layout: count 1 with a body that is not a sized resource list
  const buf = buildGroup({ name: "g", flags: 0, lists: [{ classHash: TEX, count: 0, body: Buffer.alloc(6) }] });
  assert.throws(() => listResources(buf), FormatError);
});

test("real Kino groups walk exactly", (t) => {
  const groups = realKinoGroups();
  if (!groups) return t.skip("no local.json");
  let kinoModels = 0;
  for (const g of groups) {
    const refs = listResources(g.data);
    if (g.path.startsWith("levels/kino/")) kinoModels += refs.filter((r) => r.classHash === classHash("CIwModel")).length;
  }
  const alley = listResources(realKinoGroup("levels/kino/alley_shared.group.bin"));
  assert.ok(alley.filter((r) => r.classHash === classHash("CIwModel")).length > 0);
  const tex45 = alley.find((r) => r.classHash === TEX && r.index === 45);
  assert.ok(tex45 && tex45.size > 43000, `CIwTexture#45 size ${tex45?.size}`);
  assert.equal(kinoModels, 665);
});
