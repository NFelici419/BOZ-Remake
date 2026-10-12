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
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new ConfigError(`Config file ${file} is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`Config file ${file} must be a JSON object with ${KEYS.map((k) => `"${k}"`).join(" and ")}.`);
  }
  const obj = raw as Record<string, unknown>;
  for (const key of KEYS) {
    const value = obj[key];
    if (typeof value !== "string" || value === "") throw new ConfigError(`Config ${file} is missing "${key}".`);
    if (!fs.existsSync(value)) throw new ConfigError(`Config "${key}" points to a file that does not exist: ${value}`);
    if (!fs.statSync(value).isFile()) throw new ConfigError(`Config "${key}" must point to a file, not a folder: ${value}`);
  }
  return { dzPath: obj.dzPath as string, gameBinaryPath: obj.gameBinaryPath as string };
}
