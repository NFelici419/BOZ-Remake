import { test } from "node:test";
import assert from "node:assert/strict";
import { FormatError } from "../src/bin-reader.ts";
import { classHash } from "../src/class-names.ts";
import { entityTransform, parseEntitySpec } from "../src/entity.ts";
import { listResources, resourceBytes } from "../src/resources.ts";
import { realKinoGroup, realKinoGroups } from "./helpers.ts";

const u32 = (...v: number[]) => Buffer.concat(v.map((x) => { const b = Buffer.alloc(4); b.writeUInt32LE(x >>> 0); return b; }));
const f32 = (...v: number[]) => Buffer.concat(v.map((x) => { const b = Buffer.alloc(4); b.writeFloatLE(x); return b; }));

function field(owner: string, type: string, name: string, data: Buffer): Buffer {
  return Buffer.concat([u32(classHash(owner), classHash(type), 1, classHash(name), 1, data.length), data]);
}
function component(cls: string, fields: Buffer[]): Buffer {
  const reflSize = 16 + fields.reduce((n, f) => n + f.length, 0);
  return Buffer.concat([u32(classHash("CIsComponentSpec"), 0, classHash(cls), reflSize), Buffer.from("LFER"), u32(classHash(cls), reflSize, fields.length), ...fields]);
}
function entity(nameHash: number, components: Buffer[], trailing = Buffer.alloc(0)): Buffer {
  const body = Buffer.concat([u32(nameHash, components.length), ...components, trailing]);
  return Buffer.concat([u32(body.length + 4), body]);
}
const transform = (pos: number[], rot: number[]) =>
  component("CIsTransform", [field("CIsTransform", "CIwFVec3", "m_localPosition", f32(...pos)), field("CIsTransform", "CIwFQuat", "m_localRotation", f32(...rot))]);

test("parses synthetic transform", () => {
  const res = entity(0x1234, [transform([1, 2, 3], [0, 0, 0, 1]), component("CIsRenderableModel", [field("CIsRenderableModel", "uint32", "m_x", Buffer.from([7]))])], Buffer.alloc(3));
  const e = parseEntitySpec(res);
  assert.equal(e.nameHash, 0x1234);
  assert.deepEqual(e.components.map((c) => c.classHash), [classHash("CIsTransform"), classHash("CIsRenderableModel")]);
  assert.deepEqual(e.components[1].fields[0].data, Buffer.from([7]));
  assert.deepEqual(entityTransform(e), { position: [1, 2, 3], rotation: [0, 0, 0, 1] });
});

test("rotation defaults to identity and no position means no transform", () => {
  const onlyPos = entity(1, [component("CIsTransform", [field("CIsTransform", "CIwFVec3", "m_localPosition", f32(4, 5, 6))])]);
  assert.deepEqual(entityTransform(parseEntitySpec(onlyPos)), { position: [4, 5, 6], rotation: [0, 0, 0, 1] });
  const none = entity(2, [component("CIsRenderableModel", [])]);
  assert.equal(entityTransform(parseEntitySpec(none)), null);
});

test("components with another spec class are kept opaque", () => {
  // kino_statics CIsEntitySpec#0: a CIsCollisionMeshSpec component whose block is not a field list
  const block = Buffer.from("not a field list");
  const opaque = Buffer.concat([u32(classHash("CIsCollisionMeshSpec"), 0xebf33ad1, classHash("CIsCollisionMesh"), block.length), block]);
  const e = parseEntitySpec(entity(1, [transform([0, 0, 0], [0, 0, 0, 1]), opaque], Buffer.from("BULLET blob")));
  assert.deepEqual(e.components.map((c) => [c.classHash, c.fields.length]), [
    [classHash("CIsTransform"), 2],
    [classHash("CIsCollisionMesh"), 0],
  ]);
});

test("rejects bad LFER tag", () => {
  const res = entity(1, [transform([1, 2, 3], [0, 0, 0, 1])]);
  res.write("XXXX", res.indexOf("LFER"), "latin1");
  assert.throws(() => parseEntitySpec(res), FormatError);
});

test("rejects fields that overrun reflSize", () => {
  const res = entity(1, [transform([1, 2, 3], [0, 0, 0, 1])]);
  const lfer = res.indexOf("LFER");
  res.writeUInt32LE(res.readUInt32LE(lfer - 4) - 4, lfer - 4); // component header reflSize
  assert.throws(() => parseEntitySpec(res), /reflSize|fields/);
});

test("real alley entity", (t) => {
  if (!realKinoGroups()) return t.skip("no local.json");
  const buf = realKinoGroup("levels/kino/alley_shared.group.bin");
  const refs = listResources(buf);
  const ref = refs.find((r) => r.classHash === classHash("CIsEntitySpec") && r.index === 0)!;
  const e = parseEntitySpec(resourceBytes(buf, ref));
  assert.equal(e.nameHash, refs.find((r) => r.classHash === classHash("CIwModel") && r.index === 0)!.nameHash);
  assert.deepEqual(e.components.map((c) => c.classHash), [classHash("CIsTransform"), classHash("CIsRenderableModel")]);
  const tr = entityTransform(e)!;
  [-3886.407, 717.298, -980.09].forEach((v, i) => assert.ok(Math.abs(tr.position[i] - v) < 1e-3, `position[${i}] ${tr.position[i]}`));
  assert.deepEqual(tr.rotation, [0, 0, 0, 1]);
  const rg = e.components[1].fields.find((f) => f.nameHash === classHash("m_renderGroupId"))!;
  assert.equal(rg.data.readUInt32LE(0), 20);
});

test("every Kino entity parses", (t) => {
  const groups = realKinoGroups();
  if (!groups) return t.skip("no local.json");
  let withTransform = 0;
  for (const g of groups.filter((x) => x.path.startsWith("levels/kino/"))) {
    for (const ref of listResources(g.data).filter((r) => r.classHash === classHash("CIsEntitySpec"))) {
      if (entityTransform(parseEntitySpec(resourceBytes(g.data, ref)))) withTransform++;
    }
  }
  assert.equal(withTransform, 728); // plan said 726: research counted unique names from a byte scan
});
