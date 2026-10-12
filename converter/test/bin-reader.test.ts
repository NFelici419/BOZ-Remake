import { test } from "node:test";
import assert from "node:assert/strict";
import { BinReader, FormatError } from "../src/bin-reader.ts";

test("reads little-endian integers", () => {
  const r = new BinReader(Buffer.from([1, 0x34, 0x12, 0x78, 0x56, 0x34, 0x12]));
  assert.equal(r.u8(), 1);
  assert.equal(r.u16(), 0x1234);
  assert.equal(r.u32(), 0x12345678);
  assert.equal(r.pos, 7);
});

test("reads cstring and advances past NUL", () => {
  const r = new BinReader(Buffer.from("kino\0x"));
  assert.equal(r.cstring(), "kino");
  assert.equal(r.pos, 5);
});

test("throws FormatError with offset past end", () => {
  assert.throws(
    () => new BinReader(Buffer.alloc(3), 2).u32(),
    (e: unknown) => e instanceof FormatError && e.offset === 2 && e.message.includes("@0x2"),
  );
});

test("cstring without NUL throws", () => {
  assert.throws(() => new BinReader(Buffer.from("abc")).cstring(), FormatError);
});
