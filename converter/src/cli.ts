import fs from "node:fs";
import path from "node:path";
import { FormatError } from "./bin-reader.ts";
import { ConfigError, loadConfig, type Config } from "./config.ts";
import { buildClassNameDictionary } from "./class-names.ts";
import { readDzIndex, readGroups } from "./dz.ts";
import { exportKino } from "./kino-export.ts";
import { buildReport, renderReportHtml } from "./report.ts";
import { isKinoEntry } from "./selection.ts";
import { unpackEntries } from "./unpack.ts";

const CONVERTER_DIR = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(CONVERTER_DIR, "out");
/** Converted game assets, imported by the Godot project (gitignored). */
const GAME_ASSETS_DIR = path.resolve(CONVERTER_DIR, "../game/assets/converted");

/** BOZ_CONFIG overrides the default converter/local.json (used by tests). */
function config(): Config {
  return loadConfig(process.env.BOZ_CONFIG || path.join(CONVERTER_DIR, "local.json"));
}

function unpack(args: string[]): void {
  const cfg = config();
  const { entries } = readDzIndex(cfg.dzPath);
  const selected = args.includes("--all") ? entries : entries.filter(isKinoEntry);
  const res = unpackEntries(cfg.dzPath, selected, OUT_DIR);
  console.log(`unpacked ${res.written.length} entries, ${res.failed.length} failed -> ${path.join(OUT_DIR, "unpacked")}`);
  for (const f of res.failed) console.log(`  FAILED ${f.path}: ${f.error}`);
}

function report(): void {
  const cfg = config();
  const dict = buildClassNameDictionary(fs.readFileSync(cfg.gameBinaryPath));
  const fd = fs.openSync(cfg.dzPath, "r");
  let rep;
  try {
    const selected = readDzIndex(cfg.dzPath).entries.filter((e) => isKinoEntry(e) && e.name.endsWith(".group.bin"));
    rep = buildReport(cfg.dzPath, readGroups(fd, selected), dict);
  } finally {
    fs.closeSync(fd);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(rep, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT_DIR, "report.html"), renderReportHtml(rep));
  const t = rep.totals;
  console.log(`groups ${t.groups}: ${t.parsed} parsed, ${t.failed} failed; lists ${t.listsIdentified}/${t.listsTotal} identified; classes ${Object.keys(rep.classesSeen).length}`);
  console.log(`decoded ${t.resourcesDecoded} textures/materials/models, ${t.decodeFailed} failed, ${t.unsupportedTextures} unsupported textures; missing refs: ${t.missingMaterialRefs} material, ${t.missingTextureRefs} texture`);
  console.log(`-> ${path.join(OUT_DIR, "report.html")}`);
}

function exportKinoScene(): void {
  const s = exportKino(config().dzPath, GAME_ASSETS_DIR);
  const unplaced = s.unplaced.length ? ` (${s.unplaced.join(", ")})` : "";
  console.log(`room models ${s.models}: ${s.placed} placed, ${s.unplaced.length} unplaced${unplaced}`);
  console.log(`textures ${s.textures} written, ${s.unsupportedTextures} unsupported; missing materials ${s.missingMaterials}; materials without a base texture ${s.missingTextures}`);
  console.log(`sky faces ${s.skyFaces}; failed ${s.failed.length}`);
  for (const f of s.failed) console.log(`  FAILED ${f}`);
  console.log(`-> ${path.join(GAME_ASSETS_DIR, "kino", "kino.gltf")}`);
}

const commands: Record<string, (args: string[]) => void> = { unpack, report, "export-kino": exportKinoScene };

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
    if (e instanceof FormatError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
}

process.exitCode = main(process.argv.slice(2));
