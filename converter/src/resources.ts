import { BinReader, FormatError } from "./bin-reader.ts";
import { KNOWN_RECORDS } from "./class-names.ts";
import { parseGroup } from "./group.ts";

/** One resource inside a group; `offset` is absolute in the group buffer and `size` counts the size field itself. */
export type ResourceRef = { classHash: number; index: number; offset: number; size: number; nameHash: number };

/**
 * Walks every list in the ResGroupResources record: `u32 listCount`, then per
 * list `u32 classHash, u32 count, u8, u8` and `count` resources, each starting
 * with `u32 size, u32 nameHash`. The walk must end exactly at the record end.
 */
export function listResources(buf: Buffer): ResourceRef[] {
  const rec = parseGroup(buf).records.find((r) => r.classHash === KNOWN_RECORDS.resources);
  if (!rec) return [];
  const start = rec.offset + 8;
  const end = rec.offset + 4 + rec.size;
  if (end === start) return [];

  const r = new BinReader(buf.subarray(0, end), start);
  const refs: ResourceRef[] = [];
  const listCount = r.u32();
  for (let l = 0; l < listCount; l++) {
    const classHash = r.u32();
    const count = r.u32();
    r.u8();
    r.u8();
    for (let index = 0; index < count; index++) {
      const offset = r.pos;
      const size = r.u32();
      if (size < 8 || offset + size > end) throw new FormatError(`resource size ${size} out of range`, offset);
      refs.push({ classHash, index, offset, size, nameHash: r.u32() });
      r.pos = offset + size;
    }
  }
  if (r.pos !== end) throw new FormatError(`resource walk ended ${end - r.pos} bytes before the container end`, r.pos);
  return refs;
}

export function resourceBytes(buf: Buffer, ref: ResourceRef): Buffer {
  return buf.subarray(ref.offset, ref.offset + ref.size);
}
