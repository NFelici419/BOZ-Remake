import fs from "node:fs";
import path from "node:path";
import { readDzEntry, type DzEntry } from "./dz.ts";

export type UnpackResult = {
  written: { path: string; offset: number; size: number }[];
  failed: { path: string; error: string }[];
};

/**
 * Copies each entry to outDir/unpacked/<entry.path> and writes outDir/manifest.json.
 * A failing entry is recorded and skipped; the run continues.
 */
export function unpackEntries(dzPath: string, entries: DzEntry[], outDir: string): UnpackResult {
  const root = path.resolve(outDir, "unpacked");
  const result: UnpackResult = { written: [], failed: [] };
  const fd = fs.openSync(dzPath, "r");
  try {
    for (const entry of entries) {
      try {
        const target = path.resolve(root, entry.path.replaceAll("\\", "/"));
        if (!target.startsWith(root + path.sep)) throw new Error(`path escapes output folder: ${entry.path}`);
        const data = readDzEntry(fd, entry);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
        result.written.push({ path: entry.path, offset: entry.offset, size: entry.size });
      } catch (e) {
        result.failed.push({ path: entry.path, error: (e as Error).message });
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = { source: dzPath, entries: result.written, failed: result.failed };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return result;
}
