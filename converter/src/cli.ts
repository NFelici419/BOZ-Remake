import fs from "node:fs";
import path from "node:path";
import { ConfigError, loadConfig } from "./config.ts";
import { buildClassNameDictionary } from "./class-names.ts";
import { parseDzIndex, readDzEntry, type DzIndex } from "./dz.ts";
import { buildReport, renderReportHtml } from "./report.ts";
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

function report(): void {
  const cfg = loadConfig(path.join(CONVERTER_DIR, "local.json"));
  const dict = buildClassNameDictionary(fs.readFileSync(cfg.gameBinaryPath));
  const fd = fs.openSync(cfg.dzPath, "r");
  let rep;
  try {
    const groups = readIndex(cfg.dzPath)
      .entries.filter((e) => isKinoEntry(e) && e.name.endsWith(".group.bin"))
      .map((e) => ({ entry: e, data: readDzEntry(fd, e) }));
    rep = buildReport(cfg.dzPath, groups, dict);
  } finally {
    fs.closeSync(fd);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(rep, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT_DIR, "report.html"), renderReportHtml(rep));
  const t = rep.totals;
  console.log(`groups ${t.groups}: ${t.parsed} parsed, ${t.failed} failed; lists ${t.listsIdentified}/${t.listsTotal} identified; classes ${Object.keys(rep.classesSeen).length}`);
  console.log(`-> ${path.join(OUT_DIR, "report.html")}`);
}

const commands: Record<string, (args: string[]) => void> = { unpack, report };

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
