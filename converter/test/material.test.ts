import { test } from "node:test";
import assert from "node:assert/strict";
import { FormatError } from "../src/bin-reader.ts";
import { classHash } from "../src/class-names.ts";
import { decodeMaterial } from "../src/material.ts";
import { listResources, resourceBytes } from "../src/resources.ts";
import { material } from "./fixtures.ts";
import { realKinoGroup, realKinoGroups } from "./helpers.ts";

test("size 17/59/65 layouts", () => {
  assert.deepEqual(decodeMaterial(material(17, { 13: 0xa17 })), { nameHash: 0x1111, texture0: 0xa17, texture1: null });
  assert.deepEqual(decodeMaterial(material(59, { 37: 0xa59, 41: 0xb59 })), { nameHash: 0x1111, texture0: 0xa59, texture1: 0xb59 });
  assert.deepEqual(decodeMaterial(material(59, { 37: 0xa59, 41: 0 })), { nameHash: 0x1111, texture0: 0xa59, texture1: null });
  assert.deepEqual(decodeMaterial(material(65, { 37: 0xa65 })), { nameHash: 0x1111, texture0: 0xa65, texture1: null });
  assert.equal(decodeMaterial(material(17, { 13: 0 })).texture0, null);
});

test("unknown size rejected", () => {
  assert.throws(() => decodeMaterial(material(20, {})), (e) => e instanceof FormatError && /20/.test(e.message));
});

test("real alley material", (t) => {
  if (!realKinoGroups()) return t.skip("no local.json");
  const buf = realKinoGroup("levels/kino/alley_shared.group.bin");
  const refs = listResources(buf);
  const tex = (i: number) => refs.find((r) => r.classHash === classHash("CIwTexture") && r.index === i)!.nameHash;
  const m = decodeMaterial(resourceBytes(buf, refs.find((r) => r.classHash === classHash("CIwMaterial") && r.index === 0)!));
  assert.equal(m.texture0, tex(44));
  assert.equal(m.texture1, tex(45));
});
