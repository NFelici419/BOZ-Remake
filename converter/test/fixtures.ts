/** Byte builders for synthetic resources, each laid out as the format facts in the 2a plan describe. */
import { classHash } from "../src/class-names.ts";

export const u16 = (...v: number[]) => Buffer.concat(v.map((x) => { const b = Buffer.alloc(2); b.writeUInt16LE(x & 0xffff); return b; }));
export const u32 = (...v: number[]) => Buffer.concat(v.map((x) => { const b = Buffer.alloc(4); b.writeUInt32LE(x >>> 0); return b; }));
export const f32 = (...v: number[]) => Buffer.concat(v.map((x) => { const b = Buffer.alloc(4); b.writeFloatLE(x); return b; }));

/** Prefixes `u32 size, u32 nameHash` to a resource body. */
export const resource = (nameHash: number, body: Buffer) => Buffer.concat([u32(body.length + 8, nameHash), body]);

// CIsEntitySpec (F5)
export function field(owner: string, type: string, name: string, data: Buffer): Buffer {
  return Buffer.concat([u32(classHash(owner), classHash(type), 1, classHash(name), 1, data.length), data]);
}
export function component(cls: string, fields: Buffer[]): Buffer {
  const reflSize = 16 + fields.reduce((n, f) => n + f.length, 0);
  return Buffer.concat([u32(classHash("CIsComponentSpec"), 0, classHash(cls), reflSize), Buffer.from("LFER"), u32(classHash(cls), reflSize, fields.length), ...fields]);
}
export function entity(nameHash: number, components: Buffer[], trailing = Buffer.alloc(0)): Buffer {
  return resource(nameHash, Buffer.concat([u32(components.length), ...components, trailing]));
}
export const transform = (pos: number[], rot: number[]) =>
  component("CIsTransform", [field("CIsTransform", "CIwFVec3", "m_localPosition", f32(...pos)), field("CIsTransform", "CIwFQuat", "m_localRotation", f32(...rot))]);

// CIwTexture (F2)
/** 31-byte header (format @13, byte18, w/h/pitch @21/23/25, recordSize @27), payload, 1 trailing byte. */
export function texture(opts: { format: number; b18: number; width: number; height: number; pitch?: number; recordSize: number; payload: Buffer; nameHash?: number }): Buffer {
  const head = Buffer.alloc(31);
  head.writeUInt32LE(31 + opts.payload.length + 1, 0);
  head.writeUInt32LE(opts.nameHash ?? 0xabcd, 4);
  head[13] = opts.format;
  head[18] = opts.b18;
  head.writeUInt16LE(opts.width, 21);
  head.writeUInt16LE(opts.height, 23);
  head.writeUInt16LE(opts.pitch ?? 0, 25);
  head.writeUInt32LE(opts.recordSize, 27);
  return Buffer.concat([head, opts.payload, Buffer.from([0])]);
}
/** GL image record: tag, recordSize, glFormat, mipCount, w, h, mipSize[12] (unused slots hold junk, as in the real data), data. */
export function glRecord(glFormat: number, w: number, h: number, mips: Buffer[], extra = Buffer.alloc(0)): Buffer {
  const sizes = mips.map((m) => m.length);
  const slots = [...sizes, ...Array(12 - sizes.length).fill(0xff574634)];
  const body = Buffer.concat([...mips, extra]);
  return Buffer.concat([u32(0x20034, 72 + body.length, glFormat, mips.length, w, h, ...slots), body]);
}
export const dxtBlock = (c0: number, c1: number, indices: number) => Buffer.concat([u16(c0, c1), u32(indices)]);
export const compressedTexture = (rec: Buffer, w: number, h: number) => texture({ format: 0x2b, b18: 0x23, width: w, height: h, pitch: w * 2, recordSize: rec.length, payload: rec });
/** Raw RGBA4444 texture with tight pitch. */
export const rgba4444Texture = (w: number, h: number, pixels: number[], nameHash?: number) =>
  texture({ format: 0x06, b18: 5, width: w, height: h, pitch: w * 2, recordSize: 0, payload: u16(...pixels), nameHash });

// CIwMaterial (F3)
export function material(size: number, at: Record<number, number>, nameHash = 0x1111): Buffer {
  const b = Buffer.alloc(size, 0xee);
  b.writeUInt32LE(size, 0);
  b.writeUInt32LE(nameHash, 4);
  for (const [off, v] of Object.entries(at)) b.writeUInt32LE(v, Number(off));
  return b;
}

// CIwModel (F4)
const blockHead = (cls: string) => u32(classHash(cls), classHash(cls));
/** Verts: @8 u16 ?, @10 numVerts, @12 u16 ?, @14 packedCount, @16 s16 center, X/Y/Z planes, then u16 remap. */
export function verts(xyz: number[][], center: number, remap: number[]): Buffer {
  const planes = [0, 1, 2].map((a) => u16(...xyz.map((v) => v[a])));
  return Buffer.concat([blockHead("CIwModelBlockVerts"), u16(0, xyz.length + remap.length, 0, xyz.length, center), ...planes, u16(...remap)]);
}
export function uvs(cls: "CIwModelBlockGLUVs" | "CIwModelBlockGLUVs2", uv: number[][]): Buffer {
  return Buffer.concat([blockHead(cls), u16(0, uv.length, 0), ...uv.map(([a, b]) => u16(a, b))]);
}
export function triList(materialIndex: number, indices: number[]): Buffer {
  return Buffer.concat([blockHead("CIwModelBlockGLTriList"), u16(0, indices.length, 0, materialIndex, 0), u16(...indices), u32(0)]);
}
export const colsBlock = (data: Buffer) => Buffer.concat([blockHead("CIwModelBlockCols"), data]);
export function model(blocks: Buffer[], materials: number[], nameHash = 0x5555): Buffer {
  return resource(nameHash, Buffer.concat([Buffer.alloc(8), ...blocks, u32(0, materials.length, ...materials)]));
}
