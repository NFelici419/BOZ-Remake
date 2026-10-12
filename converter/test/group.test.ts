import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FormatError } from "../src/bin-reader.ts";
import { classHash } from "../src/class-names.ts";
import { parseDzIndex, readDzEntry, type DzEntry } from "../src/dz.ts";
import { parseGroup } from "../src/group.ts";
import { buildGroup, realSource } from "./helpers.ts";

test("parses synthetic group", () => {
  const g = parseGroup(
    buildGroup({
      name: "kino",
      flags: 0,
      children: ["levels/kino//kino_statics.group"],
      lists: [{ classHash: 0x3521f539, count: 2, body: Buffer.alloc(8) }],
    }),
  );
  assert.equal(g.name, "kino");
  assert.equal(g.flags, 0);
  assert.deepEqual(g.children.map((c) => c.path), ["levels/kino//kino_statics.group"]);
  assert.equal(g.listCount, 1);
  assert.equal(g.firstList?.classHash, 0x3521f539);
  assert.equal(g.firstList?.resourceCount, 2);
  assert.equal(g.records.length, 3);
});

test("empty resources container", () => {
  const base = buildGroup({ name: "e", flags: 0 });
  // insert a resources record whose 4-byte payload is all zeros before the terminator
  const rec = Buffer.alloc(12);
  rec.writeUInt32LE(0xdc3c2177, 0);
  rec.writeUInt32LE(8, 4);
  const buf = Buffer.concat([base.subarray(0, base.length - 4), rec, base.subarray(base.length - 4)]);
  const g = parseGroup(buf);
  assert.equal(g.listCount, 0);
  assert.equal(g.firstList, null);
});

test("rejects record running past end", () => {
  const buf = buildGroup({ name: "kino", flags: 0 });
  const sizeFieldAt = 6 + 4; // header (6) + members hash (4)
  buf.writeUInt32LE(0xffff, sizeFieldAt);
  assert.throws(() => parseGroup(buf), (e: unknown) => e instanceof FormatError && e.offset === sizeFieldAt);
});

test("rejects missing terminator", () => {
  const buf = buildGroup({ name: "kino", flags: 0 });
  assert.throws(() => parseGroup(buf.subarray(0, buf.length - 4)), FormatError);
});

function realGroups(): { fd: number; byPath: Map<string, DzEntry>; entries: DzEntry[] } | null {
  const src = realSource();
  if (!src) return null;
  const size = fs.statSync(src.dzPath).size;
  const fd = fs.openSync(src.dzPath, "r");
  const head = Buffer.alloc(Math.min(1 << 20, size));
  fs.readSync(fd, head, 0, head.length, 0);
  const { entries } = parseDzIndex(head, size);
  return { fd, entries, byPath: new Map(entries.map((e) => [e.path, e])) };
}

test("real kino groups", (t) => {
  const real = realGroups();
  if (!real) return t.skip("no local.json");
  const read = (p: string) => parseGroup(readDzEntry(real.fd, real.byPath.get(p)!));
  try {
    const kino = read("levels/kino/kino.group.bin");
    assert.equal(kino.name, "kino");
    assert.equal(kino.flags, 0);
    assert.deepEqual(kino.children.map((c) => c.path), ["levels/kino//kino_dynamics.group", "levels/kino//kino_statics.group"]);
    assert.equal(kino.terminatorOffset, 133);

    const sectors = read("levels/kino/kino_sectors.group.bin");
    assert.equal(sectors.flags, 1);
    assert.equal(sectors.children.length, 21);
    assert.equal(sectors.children[0].path, "levels/kino//alley_shared.group");

    const statics = read("levels/kino/kino_statics.group.bin");
    assert.equal(statics.listCount, 14);
    assert.equal(statics.firstList?.classHash, classHash("CZombieConfiguration"));
    assert.equal(statics.firstList?.resourceCount, 8);
  } finally {
    fs.closeSync(real.fd);
  }
});

test("every group in the real archive parses", (t) => {
  const real = realGroups();
  if (!real) return t.skip("no local.json");
  try {
    const groups = real.entries.filter((e) => e.name.endsWith(".group.bin"));
    assert.equal(groups.length, 180);
    for (const e of groups) assert.doesNotThrow(() => parseGroup(readDzEntry(real.fd, e)), e.path);
  } finally {
    fs.closeSync(real.fd);
  }
});
