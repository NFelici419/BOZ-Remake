import fs from "node:fs";
import { BinReader, FormatError } from "./bin-reader.ts";

/** Chunk flag for data stored uncompressed — the only kind this reader extracts. */
export const DZ_STORED = 0x100;

export type DzEntry = {
  index: number;
  name: string;
  dir: string; // "/"-separated, "" for root
  path: string;
  offset: number;
  size: number;
  flags: number;
};

export type DzIndex = { version: number; entries: DzEntry[]; tableEnd: number };

/**
 * Parses a Marmalade DTRZ archive table. `header` must contain the whole
 * table (the first 1 MiB is plenty); `fileSize` bounds chunk extents.
 */
export function parseDzIndex(header: Buffer, fileSize: number): DzIndex {
  const r = new BinReader(header);
  if (header.toString("latin1", 0, 4) !== "DTRZ") throw new FormatError("not a DTRZ archive", 0);
  r.pos = 4;
  const fileCount = r.u16();
  const dirCount = r.u16();
  const version = r.u8();

  const names: string[] = [];
  for (let i = 0; i < fileCount; i++) names.push(r.cstring());
  const dirs = [""];
  for (let i = 1; i < dirCount; i++) dirs.push(r.cstring().replaceAll("\\", "/"));

  const fileMap: { dir: number; chunk: number }[] = [];
  for (let i = 0; i < fileCount; i++) {
    const at = r.pos;
    const dir = r.u16();
    const chunks: number[] = [];
    for (let c = r.u16(); c !== 0xffff; c = r.u16()) chunks.push(c);
    if (chunks.length !== 1) throw new FormatError(`file ${names[i]} has ${chunks.length} chunks; multi-chunk entries unsupported`, at);
    if (dir >= dirs.length) throw new FormatError(`file ${names[i]} has bad dir index ${dir}`, at);
    fileMap.push({ dir, chunk: chunks[0] });
  }

  const archAt = r.pos;
  const archiveFileCount = r.u16();
  const chunkCount = r.u16();
  if (archiveFileCount !== 1) throw new FormatError(`${archiveFileCount} archive files; only single-file archives supported`, archAt);

  const chunks: { offset: number; size: number; flags: number }[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const at = r.pos;
    const offset = r.u32();
    r.u32(); // compressed size (== size for stored chunks)
    const size = r.u32();
    const flags = r.u16();
    r.u16(); // archive file index
    if (offset + size > fileSize) throw new FormatError(`chunk ${i} ends at ${offset + size}, past file size ${fileSize}`, at);
    chunks.push({ offset, size, flags });
  }

  const entries = fileMap.map(({ dir, chunk }, index) => {
    const c = chunks[chunk];
    if (!c) throw new FormatError(`file ${names[index]} references missing chunk ${chunk}`, archAt);
    const d = dirs[dir];
    return { index, name: names[index], dir: d, path: d ? `${d}/${names[index]}` : names[index], ...c };
  });
  return { version, entries, tableEnd: r.pos };
}

export function readDzEntry(fd: number, entry: DzEntry): Buffer {
  if (entry.flags !== DZ_STORED) {
    throw new FormatError(`${entry.path}: chunk flags 0x${entry.flags.toString(16)} not supported (only stored 0x100)`, entry.offset);
  }
  const buf = Buffer.alloc(entry.size);
  const n = fs.readSync(fd, buf, 0, entry.size, entry.offset);
  if (n !== entry.size) throw new FormatError(`${entry.path}: short read ${n}/${entry.size}`, entry.offset);
  return buf;
}
