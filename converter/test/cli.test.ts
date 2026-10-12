import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tempDir } from "./helpers.ts";

const CLI = path.resolve(import.meta.dirname, "../src/cli.ts");

test("corrupt archive gives one clear error, not a stack trace", () => {
  const dir = tempDir();
  const notDz = path.join(dir, "x.dz");
  fs.writeFileSync(notDz, "this is not an archive");
  const cfg = path.join(dir, "local.json");
  fs.writeFileSync(cfg, JSON.stringify({ dzPath: notDz, gameBinaryPath: notDz }));
  const r = spawnSync(process.execPath, [CLI, "unpack"], { env: { ...process.env, BOZ_CONFIG: cfg }, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a DTRZ archive/);
  assert.match(r.stderr, new RegExp(notDz.replaceAll("\\", "\\\\")));
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});
