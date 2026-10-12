import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { classHash, buildClassNameDictionary } from "../src/class-names.ts";
import { parseDzIndex, readDzEntry, type DzEntry } from "../src/dz.ts";
import { buildReport, renderReportHtml } from "../src/report.ts";
import { isKinoEntry } from "../src/selection.ts";
import { buildGroup, realSource } from "./helpers.ts";

const entry = (p: string, offset = 100): DzEntry => ({ index: 0, name: p.split("/").pop()!, dir: "levels/kino", path: p, offset, size: 1, flags: 0x100 });
const dict = new Map([[classHash("CIwTexture"), "CIwTexture"]]);

function sample() {
  const good = buildGroup({ name: "ok", flags: 0, lists: [{ classHash: classHash("CIwTexture"), count: 3, body: Buffer.alloc(0) }] });
  const bad = buildGroup({ name: "bad", flags: 0 }).subarray(0, 10);
  return [
    { entry: entry("levels/kino/z_bad.group.bin", 200), data: bad },
    { entry: entry("levels/kino/a_ok.group.bin"), data: good },
  ];
}

test("report counts parsed and failed groups", () => {
  const r = buildReport("x.dz", sample(), dict);
  assert.equal(r.totals.parsed, 1);
  assert.equal(r.totals.failed, 1);
  const failed = r.groups.find((g) => g.status === "failed")!;
  assert.match(failed.error!, /@0x/);
  assert.deepEqual(r.classesSeen, { CIwTexture: 1 });
  assert.deepEqual(r.groups.map((g) => g.path), ["levels/kino/a_ok.group.bin", "levels/kino/z_bad.group.bin"]);
  assert.equal(r.totals.resourcesDecoded, 0);
});

test("html escapes names", () => {
  const data = buildGroup({ name: "<b>x</b>", flags: 0 });
  const html = renderReportHtml(buildReport("x.dz", [{ entry: entry("levels/kino/e.group.bin"), data }], dict));
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(!html.includes("<b>x</b>"));
});

test("report is deterministic", () => {
  assert.equal(JSON.stringify(buildReport("x.dz", sample(), dict)), JSON.stringify(buildReport("x.dz", sample(), dict)));
});

test("real Kino report", (t) => {
  const src = realSource();
  if (!src) return t.skip("no local.json");
  const size = fs.statSync(src.dzPath).size;
  const fd = fs.openSync(src.dzPath, "r");
  try {
    const head = Buffer.alloc(Math.min(1 << 20, size));
    fs.readSync(fd, head, 0, head.length, 0);
    const groups = parseDzIndex(head, size)
      .entries.filter((e) => isKinoEntry(e) && e.name.endsWith(".group.bin"))
      .map((e) => ({ entry: e, data: readDzEntry(fd, e) }));
    const r = buildReport(src.dzPath, groups, buildClassNameDictionary(fs.readFileSync(src.gameBinaryPath)));
    assert.equal(r.totals.failed, 0);
    for (const c of ["CIwTexture", "CIwMaterial", "CZombieConfiguration"]) assert.ok(c in r.classesSeen, c);
    assert.equal(r.groups.find((g) => g.path === "levels/kino/kino_statics.group.bin")?.listCount, 14);
  } finally {
    fs.closeSync(fd);
  }
});
