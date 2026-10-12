import { FormatError } from "./bin-reader.ts";

/** Texture references are texture name hashes; null when the slot is 0. texture1 is the lightmap. */
export type Material = { nameHash: number; texture0: number | null; texture1: number | null };

/** Offsets of texture0 / texture1 for each known CIwMaterial resource size. */
const LAYOUTS: Record<number, { texture0: number; texture1: number | null }> = {
  17: { texture0: 13, texture1: null },
  59: { texture0: 37, texture1: 41 },
  65: { texture0: 37, texture1: null },
};

/** Decodes one CIwMaterial resource (including its size field); the layout is selected by size. */
export function decodeMaterial(res: Buffer): Material {
  const layout = LAYOUTS[res.length];
  if (!layout) throw new FormatError(`unknown material size ${res.length}`, 0);
  const ref = (at: number | null) => (at === null ? null : res.readUInt32LE(at) || null);
  return { nameHash: res.readUInt32LE(4), texture0: ref(layout.texture0), texture1: ref(layout.texture1) };
}
