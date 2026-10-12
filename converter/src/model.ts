import { FormatError } from "./bin-reader.ts";
import { classHash } from "./class-names.ts";

export type ModelMesh = { materialIndex: number; indices: Uint16Array };
export type Model = {
  nameHash: number;
  positions: Float32Array; // numVerts*3, raw game units
  uv0: Float32Array | null; // numVerts*2, /4096
  uv1: Float32Array | null; // lightmap, numVerts*2, /4096
  meshes: ModelMesh[];
  materialHashes: number[];
};

/** Every CIwModelBlock class named in the game binary; a block starts with its class hash written twice. */
const BLOCK_NAMES = [
  "CIwModelBlock", "CIwModelBlockBSP", "CIwModelBlockBiTangents", "CIwModelBlockChunk", "CIwModelBlockChunkTree",
  "CIwModelBlockChunkVerts", "CIwModelBlockCols", "CIwModelBlockFaceFlags", "CIwModelBlockGLPrimBase",
  "CIwModelBlockGLRenderEdges", "CIwModelBlockGLRenderVerts", "CIwModelBlockGLTriList", "CIwModelBlockGLTriStrip",
  "CIwModelBlockGLUVs", "CIwModelBlockGLUVs2", "CIwModelBlockIndGroups", "CIwModelBlockNorms", "CIwModelBlockPrimBase",
  "CIwModelBlockPrimF3", "CIwModelBlockPrimF4", "CIwModelBlockPrimFT3", "CIwModelBlockPrimFT4", "CIwModelBlockPrimG3",
  "CIwModelBlockPrimG4", "CIwModelBlockPrimGT3", "CIwModelBlockPrimGT4", "CIwModelBlockPrimGen3", "CIwModelBlockPrimGen4",
  "CIwModelBlockRenderEdges", "CIwModelBlockRenderVerts", "CIwModelBlockSWOptim1", "CIwModelBlockTangents",
  "CIwModelBlockVerts", "CIwModelBlockVerts2D", "CIwModelBlockVertsFP",
];
const BLOCKS = new Set(BLOCK_NAMES.map(classHash));
const VERTS = classHash("CIwModelBlockVerts");
const UVS = classHash("CIwModelBlockGLUVs");
const UVS2 = classHash("CIwModelBlockGLUVs2");
const TRILIST = classHash("CIwModelBlockGLTriList");
const UV_SCALE = 4096;

/**
 * Decodes one CIwModel resource (including its size field). Blocks are found
 * from byte 8 by their repeated class hash; Verts, GLUVs, GLUVs2 and
 * GLTriList are consumed and any other block is skipped by scanning to the
 * next block. The material list (`u32 0, u32 count, count × u32 hash`) follows
 * the last block and ends at the resource end.
 */
export function decodeModel(res: Buffer): Model {
  const isBlock = (p: number) => p + 8 <= res.length && BLOCKS.has(res.readUInt32LE(p)) && res.readUInt32LE(p + 4) === res.readUInt32LE(p);
  const nextBlock = (from: number) => {
    for (let p = from; p + 8 <= res.length; p++) if (isBlock(p)) return p;
    return -1;
  };
  const need = (p: number, end: number, what: string) => {
    if (end > res.length) throw new FormatError(`${what} block runs past the resource end`, p);
  };

  let positions: Float32Array | null = null;
  let uv0: Float32Array | null = null;
  let uv1: Float32Array | null = null;
  const meshes: ModelMesh[] = [];
  let numVerts = 0;

  let p = nextBlock(8);
  if (p < 0) throw new FormatError("no model blocks (no Verts block)", 8);
  while (isBlock(p)) {
    const h = res.readUInt32LE(p);
    let end: number;
    if (h === VERTS) {
      numVerts = res.readUInt16LE(p + 10);
      const packed = res.readUInt16LE(p + 14);
      const center = res.readInt16LE(p + 16);
      if (packed > numVerts) throw new FormatError(`packed count ${packed} > ${numVerts} verts`, p + 14);
      end = p + 18 + 6 * packed + 2 * (numVerts - packed);
      need(p, end, "Verts");
      if (!isBlock(end)) throw new FormatError("Verts block does not end at the next block", end);
      positions = new Float32Array(numVerts * 3);
      for (let axis = 0; axis < 3; axis++) {
        const plane = p + 18 + axis * 2 * packed;
        for (let i = 0; i < packed; i++) positions[i * 3 + axis] = res.readInt16LE(plane + 2 * i) + center;
      }
      for (let i = packed; i < numVerts; i++) {
        const src = res.readUInt16LE(p + 18 + 6 * packed + 2 * (i - packed));
        if (src >= i) throw new FormatError(`vertex ${i} remaps to ${src}`, p + 18 + 6 * packed + 2 * (i - packed));
        positions.copyWithin(i * 3, src * 3, src * 3 + 3);
      }
    } else if (h === UVS || h === UVS2 || h === TRILIST) {
      if (!positions) throw new FormatError("block before the Verts block", p);
      if (h === TRILIST) {
        const count = res.readUInt16LE(p + 10);
        end = p + 22 + 2 * count;
        need(p, end, "GLTriList");
        const indices = new Uint16Array(count);
        for (let i = 0; i < count; i++) {
          indices[i] = res.readUInt16LE(p + 18 + 2 * i);
          if (indices[i] >= numVerts) throw new FormatError(`index ${indices[i]} >= ${numVerts} verts`, p + 18 + 2 * i);
        }
        meshes.push({ materialIndex: res.readUInt16LE(p + 14), indices });
      } else {
        const count = res.readUInt16LE(p + 10);
        if (count !== numVerts) throw new FormatError(`uv count ${count} != ${numVerts} verts`, p + 10);
        end = p + 14 + 4 * count;
        need(p, end, "GLUVs");
        const uv = new Float32Array(count * 2);
        for (let i = 0; i < count * 2; i++) uv[i] = res.readInt16LE(p + 14 + 2 * i) / UV_SCALE;
        if (h === UVS) uv0 = uv;
        else uv1 = uv;
      }
    } else {
      end = nextBlock(p + 8);
      if (end < 0) throw new FormatError("no block after an unconsumed block", p);
    }
    p = end;
  }
  if (!positions) throw new FormatError("no Verts block", 8);

  if (p + 8 > res.length || res.readUInt32LE(p) !== 0) throw new FormatError("expected the material list after the last block", p);
  const materialCount = res.readUInt32LE(p + 4);
  if (p + 8 + 4 * materialCount !== res.length) throw new FormatError(`material list of ${materialCount} does not end at the resource end`, p);
  const materialHashes = Array.from({ length: materialCount }, (_, i) => res.readUInt32LE(p + 8 + 4 * i));
  for (const m of meshes) {
    if (m.materialIndex >= materialCount) throw new FormatError(`material index ${m.materialIndex} >= ${materialCount} materials`, p);
  }
  return { nameHash: res.readUInt32LE(4), positions, uv0, uv1, meshes, materialHashes };
}
