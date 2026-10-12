import type { DzEntry } from "./dz.ts";

/** Shared (non-level) files Kino der Toten needs. */
const KINO_SHARED = new Set([
  "weapons_kino.group.bin",
  "arms_kino.group.bin",
  "weapon_projectiles_kino.group.bin",
  "ai_weapons.group.bin",
  "ingame.group.bin",
  "shared.group.bin",
  "fixed.group.bin",
  "frontend.group.bin",
  "visualeffects.group.bin",
  "pickups.group.bin",
  "shaders.group.bin",
  "cameras.group.bin",
  "misc.group.bin",
  "console.bin",
]);

export function isKinoEntry(entry: DzEntry): boolean {
  const name = entry.name.toLowerCase();
  return entry.dir.toLowerCase().startsWith("levels/kino") || KINO_SHARED.has(name) || name.startsWith("snd_player_");
}
