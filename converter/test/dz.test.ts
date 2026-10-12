import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FormatError } from "../src/bin-reader.ts";
import { parseDzIndex, readDzEntry } from "../src/dz.ts";
import { buildDz, realSource, tempDir } from "./helpers.ts";

function withFile<T>(buf: Buffer, fn: (fd: number) => T): T {
  const file = path.join(tempDir(), "a.dz");
  fs.writeFileSync(file, buf);
  const fd = fs.openSync(file, "r");
  try {
    return fn(fd);
  } finally {
    fs.closeSync(fd);
  }
}

test("round-trips a synthetic archive", () => {
  const buf = buildDz([
    { name: "a.group.bin", dir: "levels\\kino", data: Buffer.from("AAAA") },
    { name: "b.bin", dir: "", data: Buffer.from("BB") },
  ]);
  const idx = parseDzIndex(buf, buf.length);
  assert.equal(idx.entries.length, 2);
  assert.equal(idx.entries[0].path, "levels/kino/a.group.bin");
  assert.equal(idx.entries[0].size, 4);
  assert.equal(idx.entries[1].path, "b.bin");
  withFile(buf, (fd) => {
    assert.equal(readDzEntry(fd, idx.entries[0]).toString(), "AAAA");
    assert.equal(readDzEntry(fd, idx.entries[1]).toString(), "BB");
  });
});

test("rejects bad magic", () => {
  const buf = buildDz([{ name: "a", dir: "", data: Buffer.from("A") }]);
  buf[0] = "X".charCodeAt(0);
  assert.throws(() => parseDzIndex(buf, buf.length), (e: unknown) => e instanceof FormatError && e.offset === 0);
});

test("rejects chunk past end of file", () => {
  const buf = buildDz([{ name: "a", dir: "", data: Buffer.from("AAAA") }]);
  assert.throws(() => parseDzIndex(buf, buf.length - 1), FormatError);
});

test("refuses to read non-stored chunks", () => {
  const buf = buildDz([{ name: "a", dir: "", data: Buffer.from("A"), flags: 0x200 }]);
  const idx = parseDzIndex(buf, buf.length);
  withFile(buf, (fd) => {
    assert.throws(
      () => readDzEntry(fd, idx.entries[0]),
      (e: unknown) => e instanceof FormatError && e.message.includes("0x200"),
    );
  });
});

test("real archive index", (t) => {
  const src = realSource();
  if (!src) return t.skip("no local.json");
  const size = fs.statSync(src.dzPath).size;
  const fd = fs.openSync(src.dzPath, "r");
  const head = Buffer.alloc(Math.min(1 << 20, size));
  fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  const idx = parseDzIndex(head, size);
  assert.equal(idx.entries.length, 189);
  assert.equal(idx.tableEnd, 12443);
  assert.ok(idx.entries.every((e) => e.flags === 0x100));
  assert.equal(Math.max(...idx.entries.map((e) => e.offset + e.size)), size);
  const byPath = new Map(idx.entries.map((e) => [e.path, e]));
  assert.deepEqual(
    [byPath.get("levels/kino/kino.group.bin")?.offset, byPath.get("levels/kino/kino.group.bin")?.size],
    [285657439, 137],
  );
  assert.deepEqual(
    [byPath.get("levels/kino/kino_statics.group.bin")?.offset, byPath.get("levels/kino/kino_statics.group.bin")?.size],
    [290656141, 7771833],
  );
});
