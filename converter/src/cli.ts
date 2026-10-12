import fs from "node:fs";
import path from "node:path";
import { ConfigError, loadConfig } from "./config.ts";
import { parseDzIndex, type DzIndex } from "./dz.ts";
import { isKinoEntry } from "./selection.ts";
import { unpackEntries } from "./unpack.ts";

const CONVERTER_DIR = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(CONVERTER_DIR, "out");

function readIndex(dzPath: string): DzIndex {
  const size = fs.statSync(dzPath).size;
  const head = Buffer.alloc(Math.min(1 << 20, size));
  const fd = fs.openSync(dzPath, "r");
  try {
    fs.readSync(fd, head, 0, head.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  return parseDzIndex(head, size);
}

function unpack(args: string[]): void {
  const cfg = loadConfig(path.join(CONVERTER_DIR, "local.json"));
  const { entries } = readIndex(cfg.dzPath);
  const selected = args.includes("--all") ? entries : entries.filter(isKinoEntry);
  const res = unpackEntries(cfg.dzPath, selected, OUT_DIR);
  console.log(`unpacked ${res.written.length} entries, ${res.failed.length} failed -> ${path.join(OUT_DIR, "unpacked")}`);
  for (const f of res.failed) console.log(`  FAILED ${f.path}: ${f.error}`);
}

const commands: Record<string, (args: string[]) => void> = { unpack };

function main(argv: string[]): number {
  const [cmd, ...args] = argv;
  const run = commands[cmd ?? ""];
  if (!run) {
    console.error(`usage: boz <${Object.keys(commands).join("|")}> [--all]`);
    return 1;
  }
  try {
    run(args);
    return 0;
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
}

process.exitCode = main(process.argv.slice(2));
