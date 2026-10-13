import fs from "node:fs";
import path from "node:path";
import { classHash, describeClass } from "./class-names.ts";
import { readDzIndex, readGroups } from "./dz.ts";
import { MIRROR_X, POSITION_SCALE } from "./kino-export.ts";
import { decodeReflectedResource, readLfer, type Names, type ReflectedObject } from "./reflect.ts";
import { listResources, resourceBytes } from "./resources.ts";
import { isKinoEntry } from "./selection.ts";

const ENTITY = classHash("CIsEntitySpec");
const hex8 = (h: number) => `0x${h.toString(16).padStart(8, "0")}`;
const COMPONENT_SPEC = classHash("CIsComponentSpec");

export type DecodedEntity = {
  id: string; // "<group base>#<index>"
  group: string;
  name: string;
  position?: number[]; // game units
  rotation?: number[]; // x, y, z, w
  components: Record<string, ReflectedObject>;
};

export type DataStats = { entities: number; resources: number; failed: string[] };

/** Entity components decoded generically; non-reflected specs (collision blobs) are listed by class only. */
export function decodeEntity(res: Buffer, names: Names): Omit<DecodedEntity, "id" | "group"> {
  const nameHash = res.readUInt32LE(4);
  const count = res.readUInt32LE(8);
  const components: Record<string, ReflectedObject> = {};
  let p = 12;
  for (let c = 0; c < count; c++) {
    const spec = res.readUInt32LE(p);
    const cls = res.readUInt32LE(p + 8);
    const size = res.readUInt32LE(p + 12);
    let value: ReflectedObject;
    if (spec === COMPONENT_SPEC) {
      const read = readLfer(res, p + 16, names);
      value = read.value;
      p = read.end;
    } else {
      value = { _class: names(cls) ?? hex8(cls), _spec: names(spec) ?? hex8(spec) };
      p += 16 + size;
    }
    let key = value._class;
    for (let n = 2; key in components; n++) key = `${value._class}#${n}`;
    components[key] = value;
  }
  const transform = components.CIsTransform;
  return {
    name: names(nameHash) ?? hex8(nameHash),
    ...(Array.isArray(transform?.m_localPosition) && { position: transform.m_localPosition as number[] }),
    ...(Array.isArray(transform?.m_localRotation) && { rotation: transform.m_localRotation as number[] }),
    components,
  };
}

/**
 * Writes `outDir/kino/data/entities.json` (every Kino entity, decoded) and
 * `resources.json` (every other reflected resource by class and name, e.g.
 * CWave, CZombieConfiguration, CLevel, CScoreConfig).
 */
/** Generated names whose hashes the game uses but whose strings are not in the binary (e.g. "wave2"). */
const CANDIDATE_NAMES = Array.from({ length: 300 }, (_, i) => `wave${i + 1}`);

export function exportKinoData(dzPath: string, dict: Map<number, string>, outDir: string): DataStats {
  const known = new Map(dict);
  for (const n of CANDIDATE_NAMES) if (!known.has(classHash(n))) known.set(classHash(n), n);
  const stats: DataStats = { entities: 0, resources: 0, failed: [] };
  const entries = readDzIndex(dzPath).entries.filter((e) => isKinoEntry(e) && e.name.endsWith(".group.bin"));
  const fd = fs.openSync(dzPath, "r");
  const entities: DecodedEntity[] = [];
  const resources: Record<string, Record<string, ReflectedObject>> = {};
  try {
    const groups = readGroups(fd, entries).sort((a, b) => (a.entry.path < b.entry.path ? -1 : 1));
    // Every resource name hash, so references to unnamed resources come out
    // as the same hex key the resource is filed under.
    const resourceNames = new Set<number>();
    for (const { data } of groups) {
      if (data instanceof Error) continue;
      try {
        for (const ref of listResources(data)) {
          resourceNames.add(ref.nameHash);
          const res = resourceBytes(data, ref);
          const at = res.indexOf("LFER", 8, "latin1");
          if (at >= 12) resourceNames.add(res.readUInt32LE(at - 8));
        }
      } catch {
        // reported in the main pass
      }
    }
    const names: Names = (h) => known.get(h) ?? (resourceNames.has(h) ? hex8(h) : undefined);
    for (const { entry, data } of groups) {
      if (data instanceof Error) {
        stats.failed.push(`${entry.path}: ${data.message}`);
        continue;
      }
      const base = path.basename(entry.path, ".group.bin");
      let refs;
      try {
        refs = listResources(data);
      } catch (e) {
        stats.failed.push(`${entry.path}: ${(e as Error).message}`);
        continue;
      }
      for (const ref of refs) {
        const res = resourceBytes(data, ref);
        const label = `${base} ${describeClass(ref.classHash, known)}#${ref.index}`;
        try {
          if (ref.classHash === ENTITY) {
            entities.push({ id: `${base}#${ref.index}`, group: entry.path, ...decodeEntity(res, names) });
            stats.entities++;
          } else if (res.includes("LFER", 8, "latin1")) {
            const { name, value } = decodeReflectedResource(res, names);
            (resources[value._class] ??= {})[name] = value;
            stats.resources++;
          }
        } catch (e) {
          stats.failed.push(`${label}: ${(e as Error).message}`);
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  const dir = path.join(outDir, "kino", "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "entities.json"), JSON.stringify({ positionScale: POSITION_SCALE, mirrorX: MIRROR_X, entities }) + "\n");
  fs.writeFileSync(path.join(dir, "resources.json"), JSON.stringify(resources, null, 1) + "\n");
  return stats;
}
