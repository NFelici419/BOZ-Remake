import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readDzIndex, readGroups } from "../src/dz.ts";
import { isKinoEntry } from "../src/selection.ts";

const CONVERTER_DIR = path.resolve(import.meta.dirname, "..");

function cstr(s: string): Buffer {
  return Buffer.from(s + "\0", "latin1");
}
function u16(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
}
function u32(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
}

export type DzFile = { name: string; dir: string; data: Buffer; flags?: number };

/** A valid DTRZ archive: one stored chunk per file, dirs deduplicated in first-seen order. */
export function buildDz(files: DzFile[]): Buffer {
  const dirs = [""];
  for (const f of files) if (!dirs.includes(f.dir)) dirs.push(f.dir);
  const head: Buffer[] = [Buffer.from("DTRZ"), u16(files.length), u16(dirs.length), Buffer.from([0])];
  for (const f of files) head.push(cstr(f.name));
  for (const d of dirs.slice(1)) head.push(cstr(d));
  files.forEach((f, i) => head.push(u16(dirs.indexOf(f.dir)), u16(i), u16(0xffff)));
  head.push(u16(1), u16(files.length));
  const chunkTableLen = files.length * 16;
  let offset = Buffer.concat(head).length + chunkTableLen;
  for (const f of files) {
    head.push(u32(offset), u32(f.data.length), u32(f.data.length), u16(f.flags ?? 0x100), u16(0));
    offset += f.data.length;
  }
  return Buffer.concat([...head, ...files.map((f) => f.data)]);
}

/** `body` keeps milestone 1's raw layout; `resources` writes F1 lists (flags 1,1; each resource sized, nameHash = nameHashes[i] ?? i+1). */
export type GroupList = { classHash: number; count: number; body: Buffer } | { classHash: number; resources: Buffer[]; nameHashes?: number[] };

function listBytes(l: GroupList): Buffer {
  if ("body" in l) return Buffer.concat([u32(l.classHash), u32(l.count), l.body]);
  const res = l.resources.map((r, i) => Buffer.concat([u32(r.length + 8), u32(l.nameHashes?.[i] ?? i + 1), r]));
  return Buffer.concat([u32(l.classHash), u32(l.resources.length), Buffer.from([1, 1]), ...res]);
}

function record(hash: number, payload: Buffer): Buffer {
  return Buffer.concat([u32(hash), u32(payload.length + 4), payload]);
}

/** A valid .group.bin; omits the resources record when `lists` is undefined. */
export function buildGroup(opts: { name: string; flags: number; children?: string[]; lists?: GroupList[] }): Buffer {
  const parts = [u32(0x0107033d), u16(0), record(0x8081e087, Buffer.concat([cstr(opts.name), u32(opts.flags)]))];
  if (opts.children) {
    const kids = opts.children.map((p) => Buffer.concat([cstr(p), u32(0), u32(0x1000), u32(0)]));
    parts.push(record(0x3b495dc0, Buffer.concat([Buffer.from([opts.children.length]), ...kids])));
  }
  if (opts.lists) {
    const lists = opts.lists.map(listBytes);
    parts.push(record(0xdc3c2177, Buffer.concat([u32(opts.lists.length), ...lists])));
  }
  parts.push(u32(0));
  return Buffer.concat(parts);
}

/** The configured real source files, or null when not available on this machine. */
export function realSource(): { dzPath: string; gameBinaryPath: string } | null {
  const file = path.join(CONVERTER_DIR, "local.json");
  if (!fs.existsSync(file)) return null;
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!fs.existsSync(cfg.dzPath ?? "") || !fs.existsSync(cfg.gameBinaryPath ?? "")) return null;
  return { dzPath: cfg.dzPath, gameBinaryPath: cfg.gameBinaryPath };
}

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "boz-"));
}

export type RealGroup = { path: string; data: Buffer };
let kinoCache: RealGroup[] | null | undefined;

/** Every Kino .group.bin from the real archive (sorted by path, read once), or null without a source. */
export function realKinoGroups(): RealGroup[] | null {
  if (kinoCache !== undefined) return kinoCache;
  const src = realSource();
  if (!src) return (kinoCache = null);
  const entries = readDzIndex(src.dzPath).entries.filter((e) => isKinoEntry(e) && e.name.endsWith(".group.bin"));
  const fd = fs.openSync(src.dzPath, "r");
  try {
    kinoCache = readGroups(fd, entries)
      .map(({ entry, data }) => {
        if (data instanceof Error) throw data;
        return { path: entry.path, data };
      })
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  } finally {
    fs.closeSync(fd);
  }
  return kinoCache;
}

export function realKinoGroup(p: string): Buffer {
  const g = realKinoGroups()?.find((x) => x.path === p);
  if (!g) throw new Error(`no real group ${p}`);
  return g.data;
}
