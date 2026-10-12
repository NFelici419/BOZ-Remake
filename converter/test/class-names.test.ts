import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClassNameDictionary, classHash, describeClass } from "../src/class-names.ts";

test("classHash matches known Marmalade IDs", () => {
  assert.equal(classHash("CIwTexture"), 0x3521f539);
  assert.equal(classHash("ResGroupMembers"), 0x8081e087);
  assert.equal(classHash("ResGroupChildPaths"), 0x3b495dc0);
  assert.equal(classHash("ResGroupResources"), 0xdc3c2177);
  assert.equal(classHash("cIWtEXTURE"), classHash("CIwTexture"));
});

test("dictionary finds names in binary noise", () => {
  const bin = Buffer.concat([
    Buffer.from([0, 1, 2]),
    Buffer.from("CIwMaterial"),
    Buffer.from([0xff]),
    Buffer.from("ab"),
    Buffer.from([0]),
  ]);
  const dict = buildClassNameDictionary(bin);
  assert.equal(dict.get(classHash("CIwMaterial")), "CIwMaterial");
  assert.equal(dict.has(classHash("ab")), false);
});

test("describeClass falls back to hex", () => {
  assert.equal(describeClass(0xdeadbeef, new Map()), "0xdeadbeef");
});
