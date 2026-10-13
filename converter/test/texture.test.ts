import { test } from "node:test";
import assert from "node:assert/strict";
import { FormatError } from "../src/bin-reader.ts";
import { classHash } from "../src/class-names.ts";
import { decodeDxt, decodeTexture } from "../src/texture.ts";
import { listResources, resourceBytes } from "../src/resources.ts";
import { compressedTexture as compressed, cubemapTexture, dxtBlock as block, glRecord, texture, u16 } from "./fixtures.ts";
import { realKinoGroup, realKinoGroups } from "./helpers.ts";

const DXT1 = 0x83f1;
const DXT3 = 0x83f2;
const px = (out: Buffer, i: number) => [...out.subarray(i * 4, i * 4 + 4)];

test("dxt1 solid block", () => {
  const out = decodeDxt(block(0xf800, 0, 0), 4, 4, DXT1);
  assert.equal(out.length, 64);
  for (let i = 0; i < 16; i++) assert.deepEqual(px(out, i), [255, 0, 0, 255]);
});

test("dxt1 4-colour interpolation", () => {
  const out = decodeDxt(block(0xffff, 0, 0b10), 4, 4, DXT1); // pixel 0 uses index 2, the rest index 0
  assert.deepEqual(px(out, 0), [170, 170, 170, 255]);
  assert.deepEqual(px(out, 1), [255, 255, 255, 255]);
});

test("dxt1 3-colour transparent", () => {
  const out = decodeDxt(block(0, 0xffff, 0xffffffff), 4, 4, DXT1);
  for (let i = 0; i < 16; i++) assert.deepEqual(px(out, i), [0, 0, 0, 0]);
  const half = decodeDxt(block(0, 0xffff, 0b10), 4, 4, DXT1);
  assert.deepEqual(px(half, 0), [127, 127, 127, 255]);
});

test("dxt3 explicit alpha, colour always 4-colour", () => {
  const alpha = Buffer.from([0x8f, 0, 0, 0, 0, 0, 0, 0]); // pixel 0 alpha 0xf, pixel 1 alpha 0x8
  const out = decodeDxt(Buffer.concat([alpha, block(0, 0xffff, 0b1111)]), 4, 4, DXT3); // pixels 0,1 use index 3
  assert.deepEqual(px(out, 0), [170, 170, 170, 255]);
  assert.deepEqual(px(out, 1), [170, 170, 170, 136]);
  assert.deepEqual(px(out, 2), [0, 0, 0, 0]);
});

test("dxt clips non-multiple-of-4", () => {
  const out = decodeDxt(block(0xf800, 0, 0b0100), 2, 2, DXT1); // pixel 1 of the block = index 1 (black)
  assert.equal(out.length, 16);
  assert.deepEqual(px(out, 1), [0, 0, 0, 255]);
  assert.deepEqual(px(decodeDxt(Buffer.alloc(16), 5, 1, DXT1), 4), [0, 0, 0, 255]); // 2 blocks wide
});

test("dxt rejects short data", () => {
  assert.throws(() => decodeDxt(Buffer.alloc(8), 8, 4, DXT1), /16/);
});

test("decodes compressed image from mip 0", () => {
  const t = decodeTexture(compressed(glRecord(DXT1, 4, 4, [block(0xf800, 0, 0)]), 4, 4));
  assert.equal(t.kind, "image");
  if (t.kind !== "image") return;
  assert.deepEqual([t.width, t.height, t.rgba.length], [4, 4, 64]);
  assert.deepEqual(px(t.rgba, 15), [255, 0, 0, 255]);
});

test("tiny mips are ignored after mip 0", () => {
  const rec = glRecord(DXT1, 8, 8, [Buffer.alloc(32), block(0xf800, 0, 0), block(0xf800, 0, 0), block(0x1f, 0, 0)]);
  const t = decodeTexture(compressed(rec, 8, 8));
  assert.equal(t.kind === "image" && t.rgba.length, 256);
});

test("decodes raw RGBA4444", () => {
  const payload = u16(0xf00f, 0x0f80, 0, 0, 0x1234, 0, 0, 0); // pitch 8 bytes: 2 pixels + 4 padding per row
  const t = decodeTexture(texture({ format: 0x06, b18: 5, width: 2, height: 2, pitch: 8, recordSize: 0, payload }));
  assert.equal(t.kind, "image");
  if (t.kind !== "image") return;
  assert.deepEqual(px(t.rgba, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(t.rgba, 1), [0, 255, 136, 0]);
  assert.deepEqual(px(t.rgba, 2), [17, 34, 51, 68]);
});

test("decodes cubemap faces", () => {
  const t = decodeTexture(cubemapTexture([0xf800, 0x07e0, 0x001f, 0xffff, 0xf81f, 0x0000]));
  assert.equal(t.kind, "cubemap");
  if (t.kind !== "cubemap") return;
  assert.deepEqual([t.width, t.height, t.faces.length], [4, 4, 6]);
  assert.deepEqual(px(t.faces[1], 0), [0, 255, 0, 255]);
});

test("unsupported format reported", () => {
  const t = decodeTexture(texture({ format: 0x00, b18: 0x0a, width: 2, height: 2, pitch: 4, recordSize: 0, payload: Buffer.alloc(8) }));
  assert.equal(t.kind, "unsupported");
  assert.match(t.kind === "unsupported" ? t.reason : "", /0x0\b/);
});

test("unsupported raw and gl formats reported", () => {
  const raw = decodeTexture(texture({ format: 0x06, b18: 0x0e, width: 2, height: 2, pitch: 4, recordSize: 0, payload: Buffer.alloc(8) }));
  assert.match(raw.kind === "unsupported" ? raw.reason : "", /0xe\b/);
  const gl = decodeTexture(compressed(glRecord(0x8c00, 4, 4, [Buffer.alloc(8)]), 4, 4));
  assert.match(gl.kind === "unsupported" ? gl.reason : "", /0x8c00/);
});

test("rejects raw pitch narrower than a row", () => {
  const t = texture({ format: 0x06, b18: 5, width: 4, height: 2, pitch: 4, recordSize: 0, payload: Buffer.alloc(8) });
  assert.throws(() => decodeTexture(t), (e) => e instanceof FormatError && /pitch 4/.test(e.message));
});

test("rejects truncated texture", () => {
  assert.throws(() => decodeTexture(Buffer.alloc(12)), (e) => e instanceof FormatError && /12 bytes/.test(e.message));
});

test("rejects record size that matches neither image nor cubemap", () => {
  const rec = glRecord(DXT1, 4, 4, [block(0, 0, 0)], Buffer.alloc(8));
  assert.throws(() => decodeTexture(compressed(rec, 4, 4)), /record/);
});

function realTexture(p: string, index: number) {
  const buf = realKinoGroup(p);
  const ref = listResources(buf).find((r) => r.classHash === classHash("CIwTexture") && r.index === index)!;
  return decodeTexture(resourceBytes(buf, ref));
}

test("real alley textures", (t) => {
  if (!realKinoGroups()) return t.skip("no local.json");
  const lightmap = realTexture("levels/kino/alley_shared.group.bin", 45);
  assert.deepEqual(lightmap.kind === "image" && [lightmap.width, lightmap.height], [256, 256]);
  const grate = realTexture("levels/kino/alley_shared.group.bin", 0);
  assert.deepEqual(grate.kind === "image" && [grate.width, grate.height], [64, 64]);
  const sky = realTexture("levels/kino/kino_skyboxes_shared.group.bin", 0);
  assert.deepEqual(sky.kind === "cubemap" && [sky.width, sky.height, sky.faces.length], [128, 128, 6]);
});

test("every Kino texture decodes or is reported unsupported", (t) => {
  const groups = realKinoGroups();
  if (!groups) return t.skip("no local.json");
  const kinds: Record<string, number> = {};
  for (const g of groups) {
    for (const ref of listResources(g.data).filter((r) => r.classHash === classHash("CIwTexture"))) {
      const k = decodeTexture(resourceBytes(g.data, ref)).kind;
      kinds[k] = (kinds[k] ?? 0) + 1;
    }
  }
  assert.deepEqual(kinds, { image: 859, cubemap: 1, unsupported: 26 });
});
