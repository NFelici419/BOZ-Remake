import fs from "node:fs";

export type Config = { dzPath: string; gameBinaryPath: string };

/** A user-fixable setup problem; the CLI prints only its message. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const KEYS = ["dzPath", "gameBinaryPath"] as const;

export function loadConfig(file: string): Config {
  if (!fs.existsSync(file)) {
    throw new ConfigError(`Config file not found: ${file}\nCopy local.example.json to local.json and set the paths.`);
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new ConfigError(`Config file ${file} is not valid JSON: ${(e as Error).message}`);
  }
  for (const key of KEYS) {
    const value = raw[key];
    if (typeof value !== "string" || value === "") throw new ConfigError(`Config ${file} is missing "${key}".`);
    if (!fs.existsSync(value)) throw new ConfigError(`Config "${key}" points to a file that does not exist: ${value}`);
  }
  return { dzPath: raw.dzPath as string, gameBinaryPath: raw.gameBinaryPath as string };
}
