import { test } from "node:test";
import assert from "node:assert/strict";
import type { DzEntry } from "../src/dz.ts";
import { isKinoEntry } from "../src/selection.ts";

const entry = (dir: string, name: string): DzEntry => ({ index: 0, name, dir, path: `${dir}/${name}`, offset: 0, size: 0, flags: 0x100 });

test("selection", () => {
  assert.equal(isKinoEntry(entry("levels/kino", "lobby_shared.group.bin")), true);
  assert.equal(isKinoEntry(entry("ingame/weapons", "weapons_kino.group.bin")), true);
  assert.equal(isKinoEntry(entry("x", "snd_player_takeo.group.bin")), true);
  assert.equal(isKinoEntry(entry("levels/ascension", "ascension.group.bin")), false);
});
