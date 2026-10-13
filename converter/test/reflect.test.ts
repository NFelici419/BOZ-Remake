import { test } from "node:test";
import assert from "node:assert/strict";
import { classHash } from "../src/class-names.ts";
import { decodeReflectedResource, readLfer } from "../src/reflect.ts";
import { listResources, resourceBytes } from "../src/resources.ts";
import { f32, field, u16, u32 } from "./fixtures.ts";
import { realKinoGroup, realKinoGroups } from "./helpers.ts";

const NAMES = ["CThing", "m_count", "m_speed", "m_on", "m_pos", "m_label", "m_list", "m_names", "m_inner", "m_kids", "CInner", "m_x", "wave2", "m_next", "m_uv", "m_colour", "m_rot", "m_mystery"];
const TYPES = ["unsigned int", "float", "bool", "CIwFVec3", "std::string", "std::list<unsigned int>", "std::list<std::string>", "CInner", "std::list<CInner>", "int", "CIwSVec2", "CIwColour", "CIwFQuat", "CSomethingUnknown"];
const dict = new Map([...NAMES, ...TYPES].map((n) => [classHash(n), n]));
const names = (h: number) => dict.get(h);

function lfer(cls: string, fields: Buffer[], declaredSize?: number): Buffer {
  const body = Buffer.concat(fields);
  return Buffer.concat([Buffer.from("LFER"), u32(classHash(cls), declaredSize ?? 16 + body.length, fields.length), body]);
}
const cstrs = (...s: string[]) => Buffer.concat(s.map((x) => Buffer.from(x + "\0", "latin1")));

test("decodes every field kind by its type name", () => {
  const inner = lfer("CInner", [field("CInner", "float", "m_x", f32(2.5))]);
  const block = lfer("CThing", [
    field("CThing", "unsigned int", "m_count", u32(6)),
    field("CThing", "float", "m_speed", f32(1.5)),
    field("CThing", "bool", "m_on", Buffer.from([1])),
    field("CThing", "CIwFVec3", "m_pos", f32(1, 2, 3)),
    field("CThing", "std::string", "m_label", cstrs("hello")),
    field("CThing", "std::list<unsigned int>", "m_list", u32(2, 7, classHash("wave2"))),
    field("CThing", "std::list<std::string>", "m_names", Buffer.concat([u32(2), cstrs("a", "bc")])),
    field("CThing", "CInner", "m_inner", inner),
    field("CThing", "std::list<CInner>", "m_kids", Buffer.concat([u32(2), inner, inner])),
    field("CThing", "unsigned int", "m_next", u32(classHash("wave2"))),
    field("CThing", "CIwSVec2", "m_uv", u16(65535, 3)),
    field("CThing", "CIwColour", "m_colour", Buffer.from([1, 2, 3, 4])),
    field("CThing", "CIwFQuat", "m_rot", f32(0, 0, 0, 1)),
    field("CThing", "CSomethingUnknown", "m_mystery", Buffer.from([0xab, 0xcd])),
  ]);
  const { value, end } = readLfer(block, 0, names);
  assert.equal(end, block.length);
  assert.deepEqual(value, {
    _class: "CThing",
    m_count: 6,
    m_speed: 1.5,
    m_on: true,
    m_pos: [1, 2, 3],
    m_label: "hello",
    m_list: [7, "wave2"],
    m_names: ["a", "bc"],
    m_inner: { _class: "CInner", m_x: 2.5 },
    m_kids: [{ _class: "CInner", m_x: 2.5 }, { _class: "CInner", m_x: 2.5 }],
    m_next: "wave2",
    m_uv: [-1, 3],
    m_colour: [1, 2, 3, 4],
    m_rot: [0, 0, 0, 1],
    m_mystery: "hex:abcd",
  });
});

test("reads fields by count, ignoring a wrong declared size", () => {
  // ingame CBarricade blocks repeat a field but declare the size without it
  const block = lfer("CThing", [field("CThing", "unsigned int", "m_count", u32(5)), field("CThing", "unsigned int", "m_count", u32(5)), field("CThing", "bool", "m_on", Buffer.from([0]))], 45);
  const { value, end } = readLfer(block, 0, names);
  assert.equal(end, block.length);
  assert.deepEqual(value, { _class: "CThing", m_count: 5, m_on: false });
});

test("unknown field names fall back to hex hashes", () => {
  const block = lfer("CThing", [field("CThing", "int", "m_not_in_dict", u32(-2 >>> 0))]);
  assert.deepEqual(readLfer(block, 0, names).value, { _class: "CThing", [`0x${classHash("m_not_in_dict").toString(16).padStart(8, "0")}`]: -2 });
});

test("decodes a reflected resource and its name", () => {
  const block = lfer("CThing", [field("CThing", "unsigned int", "m_count", u32(1))]);
  // flag-(0,1) lists (e.g. CWave) carry the class hash before the name
  const res = Buffer.concat([u32(block.length + 16, classHash("CThing"), classHash("wave2"), block.length), block]);
  assert.deepEqual(decodeReflectedResource(res, names), { name: "wave2", value: { _class: "CThing", m_count: 1 } });
});

test("real wave 1 and level", (t) => {
  if (!realKinoGroups()) return t.skip("no local.json");
  const g = realKinoGroup("levels/kino/kino_statics.group.bin");
  const wave = listResources(g).find((r) => r.classHash === classHash("CWave") && r.index === 0)!;
  // Field and type names exist in the game binary; here only the ones the assertions need.
  const real = new Map([...dict, ...["CWave", "wave1", "m_ZombieCount", "m_ZombieHealth", "m_StartingZombies", "m_MaxActive", "m_TimeOut", "m_NextWave", "m_ZombieWalk"].map((n) => [classHash(n), n] as const)]);
  const w = decodeReflectedResource(resourceBytes(g, wave), (h) => real.get(h));
  assert.equal(w.name, "wave1");
  assert.equal(w.value._class, "CWave");
  assert.deepEqual([w.value.m_ZombieCount, w.value.m_ZombieHealth, w.value.m_StartingZombies, w.value.m_MaxActive, w.value.m_TimeOut, w.value.m_ZombieWalk], [6, 150, 2, 6, 4000, 1]);
});
