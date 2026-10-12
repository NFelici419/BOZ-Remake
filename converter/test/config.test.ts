import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ConfigError, loadConfig } from "../src/config.ts";
import { tempDir } from "./helpers.ts";

function writeConfig(obj: object): string {
  const dir = tempDir();
  const file = path.join(dir, "local.json");
  fs.writeFileSync(file, JSON.stringify(obj));
  return file;
}

test("config reports missing key", () => {
  const existing = path.join(tempDir(), "x.dz");
  fs.writeFileSync(existing, "");
  const file = writeConfig({ dzPath: existing });
  assert.throws(() => loadConfig(file), (e: unknown) => e instanceof ConfigError && e.message.includes("gameBinaryPath"));
});

test("config reports missing file path", () => {
  const missing = path.join(tempDir(), "nope.dz");
  const file = writeConfig({ dzPath: missing, gameBinaryPath: missing });
  assert.throws(
    () => loadConfig(file),
    (e: unknown) => e instanceof ConfigError && e.message.includes("dzPath") && e.message.includes(missing),
  );
});

test("config reports missing config file", () => {
  const file = path.join(tempDir(), "local.json");
  assert.throws(() => loadConfig(file), (e: unknown) => e instanceof ConfigError && e.message.includes(file));
});

test("config rejects non-object JSON", () => {
  const file = writeConfig(null as unknown as object);
  assert.throws(() => loadConfig(file), ConfigError);
});

test("config rejects a directory where a file is expected", () => {
  const dir = tempDir();
  const file = writeConfig({ dzPath: dir, gameBinaryPath: dir });
  assert.throws(() => loadConfig(file), (e: unknown) => e instanceof ConfigError && e.message.includes("dzPath"));
});
