import { BinReader, FormatError } from "./bin-reader.ts";
import { KNOWN_RECORDS } from "./class-names.ts";

const GROUP_MAGIC = 0x0107033d;

export type GroupRecord = { classHash: number; offset: number; size: number };
export type ChildPath = { path: string; unknownA: number; unknownB: number; pathId: number };
export type FirstList = { classHash: number; resourceCount: number; dataOffset: number };
export type GroupInfo = {
  name: string | null;
  flags: number | null;
  children: ChildPath[];
  listCount: number;
  firstList: FirstList | null;
  records: GroupRecord[];
  terminatorOffset: number;
};

/**
 * Walks a Marmalade .group.bin: header, then {hash, size, payload} records
 * (size counts its own 4 bytes) ending in a u32 0 exactly at end of file.
 * Resources carry no size prefix, so only the first list's header is located.
 */
export function parseGroup(buf: Buffer): GroupInfo {
  const r = new BinReader(buf);
  if (r.u32() !== GROUP_MAGIC || r.u16() !== 0) throw new FormatError("not a resource group", 0);

  const info: GroupInfo = { name: null, flags: null, children: [], listCount: 0, firstList: null, records: [], terminatorOffset: -1 };

  for (;;) {
    const at = r.pos;
    const classHash = r.u32();
    if (classHash === 0) {
      if (r.pos !== buf.length) throw new FormatError(`terminator not at end of file (${buf.length - r.pos} bytes follow)`, at);
      info.terminatorOffset = at;
      return info;
    }
    const sizeAt = r.pos;
    const size = r.u32();
    if (size < 4 || sizeAt + size > buf.length) throw new FormatError(`record size ${size} out of range`, sizeAt);
    const payload = new BinReader(buf.subarray(sizeAt + 4, sizeAt + size));
    info.records.push({ classHash, offset: at, size });

    try {
      if (classHash === KNOWN_RECORDS.members) {
        info.name = payload.cstring();
        info.flags = payload.u32();
      } else if (classHash === KNOWN_RECORDS.childPaths) {
        const count = payload.u8();
        for (let i = 0; i < count; i++) {
          info.children.push({ path: payload.cstring(), unknownA: payload.u32(), unknownB: payload.u32(), pathId: payload.u32() });
        }
      } else if (classHash === KNOWN_RECORDS.resources) {
        info.listCount = payload.remaining() >= 4 ? payload.u32() : 0;
        if (info.listCount > 0) {
          const listHash = payload.u32();
          const resourceCount = payload.u32();
          info.firstList = { classHash: listHash, resourceCount, dataOffset: sizeAt + 4 + payload.pos };
        }
      }
    } catch (e) {
      // re-anchor payload-relative offsets to the whole buffer
      if (e instanceof FormatError) {
        const reason = e.message.replace(/ @0x[0-9a-f]+$/, "");
        throw new FormatError(`bad payload in record 0x${classHash.toString(16)}: ${reason}`, sizeAt + 4 + e.offset);
      }
      throw e;
    }
    r.pos = sizeAt + size;
  }
}
