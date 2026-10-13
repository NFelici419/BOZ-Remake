import { FormatError } from "./bin-reader.ts";

/**
 * Generic decoder for the game's reflection data ("LFER" blocks): named,
 * typed fields, used by entity components and by gameplay resources such as
 * CWave, CZombieConfiguration, CLevel and CScoreConfig.
 *
 * Block: "LFER", u32 classHash, u32 declaredSize, u32 fieldCount, then per
 * field u32 ownerHash, u32 typeHash, u32 1, u32 nameHash, u32 1, u32 size,
 * size bytes. Fields are read by count: some blocks (ingame CBarricade)
 * repeat a field while the declared size omits it, so the size is not used.
 */

export type ReflectedValue = number | boolean | string | ReflectedValue[] | ReflectedObject;
export type ReflectedObject = { _class: string; [field: string]: ReflectedValue };
/** Name for a hash (class, field, type or resource name), or undefined. */
export type Names = (hash: number) => string | undefined;

const LFER = "LFER";
const hex8 = (h: number) => `0x${h.toString(16).padStart(8, "0")}`;

function isLfer(buf: Buffer, at: number): boolean {
  return at + 16 <= buf.length && buf.toString("latin1", at, at + 4) === LFER;
}

/** A u32 that names something (a resource, an asset) reads as that name; plain numbers stay numbers. */
function u32Value(v: number, names: Names): ReflectedValue {
  const name = v > 0xffff ? names(v) : undefined;
  return name ?? v;
}

const FIXED: Record<string, { size: number; read: (d: Buffer, at: number, names: Names) => ReflectedValue }> = {
  bool: { size: 1, read: (d, at) => d[at] !== 0 },
  "unsigned char": { size: 1, read: (d, at) => d[at] },
  int: { size: 4, read: (d, at) => d.readInt32LE(at) },
  "unsigned int": { size: 4, read: (d, at, n) => u32Value(d.readUInt32LE(at), n) },
  float: { size: 4, read: (d, at) => d.readFloatLE(at) },
  CIwFVec3: { size: 12, read: (d, at) => [0, 4, 8].map((o) => d.readFloatLE(at + o)) },
  CIwFVec4: { size: 16, read: (d, at) => [0, 4, 8, 12].map((o) => d.readFloatLE(at + o)) },
  CIwFQuat: { size: 16, read: (d, at) => [0, 4, 8, 12].map((o) => d.readFloatLE(at + o)) },
  CIwFMat: { size: 48, read: (d, at) => Array.from({ length: 12 }, (_, i) => d.readFloatLE(at + 4 * i)) },
  CIwSVec2: { size: 4, read: (d, at) => [d.readInt16LE(at), d.readInt16LE(at + 2)] },
  CIwColour: { size: 4, read: (d, at) => [d[at], d[at + 1], d[at + 2], d[at + 3]] },
};

/** Enums and bitsets are stored as u32. */
function fixedType(type: string) {
  if (FIXED[type]) return FIXED[type];
  if (type.startsWith("CParsableEnumManager::") || type.startsWith("std::bitset<")) return { size: 4, read: (d: Buffer, at: number) => d.readUInt32LE(at) };
  return undefined;
}

/** Reads one element of `type` at `at`; returns the value and the next offset. */
function readElement(type: string, d: Buffer, at: number, names: Names): [ReflectedValue, number] {
  const fixed = fixedType(type);
  if (fixed) return [fixed.read(d, at, names), at + fixed.size];
  if (type === "std::string") {
    const end = d.indexOf(0, at);
    if (end < 0) throw new FormatError("unterminated string", at);
    return [d.toString("latin1", at, end), end + 1];
  }
  if (isLfer(d, at)) {
    const { value, end } = readLfer(d, at, names);
    return [value, end];
  }
  throw new FormatError(`cannot read element of type ${type}`, at);
}

function decodeField(type: string, data: Buffer, names: Names): ReflectedValue {
  try {
    const container = /^std::(?:list|vector)<(.+)>$/.exec(type);
    if (container) {
      const count = data.readUInt32LE(0);
      const items: ReflectedValue[] = [];
      let at = 4;
      for (let i = 0; i < count; i++) {
        const [value, next] = readElement(container[1].trim(), data, at, names);
        items.push(value);
        at = next;
      }
      return items;
    }
    const fixed = fixedType(type);
    if (fixed && data.length === fixed.size) return fixed.read(data, 0, names);
    if (type === "std::string" || isLfer(data, 0)) return readElement(type, data, 0, names)[0];
  } catch {
    // fall through to raw bytes: unknown layouts are kept, never guessed
  }
  return `hex:${data.toString("hex")}`;
}

/** Decodes the LFER block at `at`. Field names come from `names`; unknown ones are hex hashes. */
export function readLfer(buf: Buffer, at: number, names: Names): { value: ReflectedObject; end: number } {
  if (!isLfer(buf, at)) throw new FormatError("missing LFER tag", at);
  const classHash = buf.readUInt32LE(at + 4);
  const count = buf.readUInt32LE(at + 12);
  const value: ReflectedObject = { _class: names(classHash) ?? hex8(classHash) };
  let p = at + 16;
  for (let f = 0; f < count; f++) {
    if (p + 24 > buf.length) throw new FormatError(`field ${f} header runs past the data`, p);
    const typeHash = buf.readUInt32LE(p + 4);
    const nameHash = buf.readUInt32LE(p + 12);
    const size = buf.readUInt32LE(p + 20);
    if (p + 24 + size > buf.length) throw new FormatError(`field ${f} data runs past the data`, p);
    const type = names(typeHash) ?? hex8(typeHash);
    const fieldName = names(nameHash) ?? hex8(nameHash);
    value[fieldName] = decodeField(type, buf.subarray(p + 24, p + 24 + size), names);
    p += 24 + size;
  }
  return { value, end: p };
}

/**
 * Decodes a reflected resource (e.g. CWave): the first LFER block, with the
 * resource name being the u32 just before the block's size word.
 */
export function decodeReflectedResource(res: Buffer, names: Names): { name: string; value: ReflectedObject } {
  const at = res.indexOf(LFER, 8, "latin1");
  if (at < 12) throw new FormatError("no LFER block", 8);
  const nameHash = res.readUInt32LE(at - 8);
  return { name: names(nameHash) ?? hex8(nameHash), value: readLfer(res, at, names).value };
}
