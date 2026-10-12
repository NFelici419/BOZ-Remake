import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseDzIndex } from "../src/dz.ts";
import { unpackEntries } from "../src/unpack.ts";
import { buildDz, tempDir, type DzFile } from "./helpers.ts";

function archive(files: DzFile[]): { dzPath: string; outDir: string; entries: ReturnType<typeof parseDzIndex>["entries"] } {
  const dir = tempDir();
  const dzPath = path.join(dir, "a.dz");
  const buf = buildDz(files);
  fs.writeFileSync(dzPath, buf);
  return { dzPath, outDir: path.join(dir, "out"), entries: parseDzIndex(buf, buf.length).entries };
}

test("unpack writes files and manifest", () => {
  const a = archive([
    { name: "a.bin", dir: "levels\\kino", data: Buffer.from("AAA") },
    { name: "b.bin", dir: "levels\\Kino", data: Buffer.from("BB") },
  ]);
  const res = unpackEntries(a.dzPath, a.entries, a.outDir);
  assert.equal(res.failed.length, 0);
  assert.equal(fs.readFileSync(path.join(a.outDir, "unpacked/levels/kino/a.bin"), "utf8"), "AAA");
  assert.equal(fs.readFileSync(path.join(a.outDir, "unpacked/levels/Kino/b.bin"), "utf8"), "BB");
  const manifest = JSON.parse(fs.readFileSync(path.join(a.outDir, "manifest.json"), "utf8"));
  assert.equal(manifest.source, a.dzPath);
  assert.deepEqual(manifest.entries.map((e: { path: string }) => e.path), ["levels/kino/a.bin", "levels/Kino/b.bin"]);
  assert.ok(manifest.entries.every((e: { offset: number }) => e.offset > 0));
});

test("unpack records bad entry and continues", () => {
  const a = archive([
    { name: "bad.bin", dir: "", data: Buffer.from("X"), flags: 0x200 },
    { name: "good.bin", dir: "", data: Buffer.from("Y") },
  ]);
  const res = unpackEntries(a.dzPath, a.entries, a.outDir);
  assert.equal(res.failed.length, 1);
  assert.match(res.failed[0].error, /0x200/);
  assert.equal(res.written.length, 1);
});

test("unpack refuses path traversal", () => {
  const a = archive([{ name: "..\\..\\evil.bin", dir: "", data: Buffer.from("E") }]);
  const res = unpackEntries(a.dzPath, a.entries, a.outDir);
  assert.equal(res.failed.length, 1);
  assert.equal(res.written.length, 0);
  assert.equal(fs.existsSync(path.resolve(a.outDir, "..", "evil.bin")), false);
  assert.equal(fs.existsSync(path.resolve(a.outDir, "..", "..", "evil.bin")), false);
});
