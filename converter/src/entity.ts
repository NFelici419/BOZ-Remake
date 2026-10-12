import { BinReader, FormatError } from "./bin-reader.ts";
import { classHash } from "./class-names.ts";

export type Field = { ownerHash: number; typeHash: number; nameHash: number; data: Buffer };
export type Component = { classHash: number; fields: Field[] };
export type EntitySpec = { nameHash: number; components: Component[] };
export type Transform = { position: [number, number, number]; rotation: [number, number, number, number] };

const LFER = 0x5245464c; // "LFER" read as u32
const COMPONENT_SPEC = classHash("CIsComponentSpec");
const TRANSFORM = classHash("CIsTransform");
const POSITION = classHash("m_localPosition");
const ROTATION = classHash("m_localRotation");

/**
 * Parses one CIsEntitySpec resource (including its size field): a component
 * count, then per component `u32 specClass, u32, u32 componentClass, u32 size`
 * and a size-byte block. Only CIsComponentSpec blocks are reflected "LFER"
 * field lists; other specs (e.g. CIsCollisionMeshSpec) are kept with no
 * fields. Bytes after the last component are ignored.
 */
export function parseEntitySpec(res: Buffer): EntitySpec {
  const r = new BinReader(res);
  r.u32(); // size
  const nameHash = r.u32();
  const count = r.u32();
  const components: Component[] = [];
  for (let c = 0; c < count; c++) {
    const spec = r.u32();
    r.u32();
    const cls = r.u32();
    const reflSize = r.u32();
    const start = r.pos;
    if (spec !== COMPONENT_SPEC) {
      r.bytes(reflSize);
      components.push({ classHash: cls, fields: [] });
      continue;
    }
    if (r.u32() !== LFER) throw new FormatError("missing LFER tag", start);
    r.u32(); // class hash again
    r.u32(); // reflSize again
    const fieldCount = r.u32();
    const fields: Field[] = [];
    for (let f = 0; f < fieldCount; f++) {
      const ownerHash = r.u32();
      const typeHash = r.u32();
      r.u32();
      const fieldName = r.u32();
      r.u32();
      const data = r.bytes(r.u32());
      fields.push({ ownerHash, typeHash, nameHash: fieldName, data });
    }
    if (r.pos !== start + reflSize) throw new FormatError(`component fields end at ${r.pos - start}, reflSize is ${reflSize}`, start);
    components.push({ classHash: cls, fields });
  }
  return { nameHash, components };
}

function floats(data: Buffer, n: number): number[] {
  if (data.length !== n * 4) throw new FormatError(`expected ${n} floats, got ${data.length} bytes`, 0);
  return Array.from({ length: n }, (_, i) => data.readFloatLE(i * 4));
}

/** Position and rotation (x, y, z, w) from the CIsTransform component, or null when it has no position. */
export function entityTransform(e: EntitySpec): Transform | null {
  const fields = e.components.find((c) => c.classHash === TRANSFORM)?.fields ?? [];
  const pos = fields.find((f) => f.nameHash === POSITION);
  if (!pos) return null;
  const rot = fields.find((f) => f.nameHash === ROTATION);
  return {
    position: floats(pos.data, 3) as Transform["position"],
    rotation: (rot ? floats(rot.data, 4) : [0, 0, 0, 1]) as Transform["rotation"],
  };
}
