import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { encodePng } from "../src/png.ts";

function chunks(png: Buffer): { type: string; data: Buffer; crcOk: boolean }[] {
  const out = [];
  for (let p = 8; p < png.length; ) {
    const len = png.readUInt32BE(p);
    const typeAndData = png.subarray(p + 4, p + 8 + len);
    out.push({ type: typeAndData.toString("latin1", 0, 4), data: typeAndData.subarray(4), crcOk: zlib.crc32(typeAndData) === png.readUInt32BE(p + 8 + len) });
    p += 12 + len;
  }
  return out;
}

test("png round-trips", () => {
  const rgba = Buffer.from([1, 2, 3, 4, 250, 251, 252, 253]);
  const png = encodePng(2, 1, rgba);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const cs = chunks(png);
  assert.deepEqual(cs.map((c) => c.type), ["IHDR", "IDAT", "IEND"]);
  assert.ok(cs.every((c) => c.crcOk));
  const ihdr = cs[0].data;
  assert.deepEqual([ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ihdr[8], ihdr[9]], [2, 1, 8, 6]);
  assert.deepEqual(zlib.inflateSync(cs[1].data), Buffer.concat([Buffer.from([0]), rgba]));
});

test("png rejects wrong pixel buffer length", () => {
  assert.throws(() => encodePng(2, 2, Buffer.alloc(8)), /16/);
});
