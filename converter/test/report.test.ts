import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { classHash, buildClassNameDictionary } from "../src/class-names.ts";
import { parseDzIndex, readDzEntry, readGroups, type DzEntry } from "../src/dz.ts";
import { buildReport, renderReportHtml } from "../src/report.ts";
import { isKinoEntry } from "../src/selection.ts";
import { material, model, rgba4444Texture, texture, triList, verts } from "./fixtures.ts";
import { buildDz, buildGroup, realSource, tempDir } from "./helpers.ts";

const entry = (p: string, offset = 100): DzEntry => ({ index: 0, name: p.split("/").pop()!, dir: "levels/kino", path: p, offset, size: 1, flags: 0x100 });
const dict = new Map([
  [classHash("CIwTexture"), "CIwTexture"],
  [classHash("CIwMaterial"), "CIwMaterial"],
]);

function sample() {
  const good = buildGroup({ name: "ok", flags: 0, lists: [{ classHash: classHash("CIwTexture"), resources: [Buffer.alloc(1), Buffer.alloc(2), Buffer.alloc(3)] }] });
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
  assert.deepEqual(r.groups.find((g) => g.status === "parsed")!.resourceCounts, { CIwTexture: 3 });
});

test("report walks every list", () => {
  const data = buildGroup({
    name: "two",
    flags: 0,
    lists: [
      { classHash: classHash("CIwTexture"), resources: [Buffer.alloc(1)] },
      { classHash: classHash("CIwMaterial"), resources: [Buffer.alloc(1), Buffer.alloc(1)] },
    ],
  });
  const r = buildReport("x.dz", [{ entry: entry("levels/kino/two.group.bin"), data }], dict);
  assert.deepEqual(r.groups[0].resourceCounts, { CIwMaterial: 2, CIwTexture: 1 });
  assert.equal(r.totals.listsTotal, 2);
  assert.equal(r.totals.listsIdentified, 2);
});

test("group whose resources do not walk is a failed row", () => {
  const data = buildGroup({ name: "raw", flags: 0, lists: [{ classHash: classHash("CIwTexture"), count: 0, body: Buffer.alloc(6) }] });
  const r = buildReport("x.dz", [{ entry: entry("levels/kino/raw.group.bin"), data }], dict);
  assert.equal(r.groups[0].status, "failed");
  assert.match(r.groups[0].error!, /container end/);
});

test("report decodes textures, materials and models", () => {
  const body = (full: Buffer) => full.subarray(8); // buildGroup adds size and nameHash (= list index + 1)
  const data = buildGroup({
    name: "room",
    flags: 0,
    lists: [
      { classHash: classHash("CIwTexture"), resources: [rgba4444Texture(1, 1, [0xffff]), texture({ format: 0, b18: 0x0a, width: 1, height: 1, pitch: 2, recordSize: 0, payload: Buffer.alloc(2) })].map(body) },
      { classHash: classHash("CIwMaterial"), resources: [material(59, { 37: 1, 41: 77 }), material(20, {})].map(body) },
      { classHash: classHash("CIwModel"), resources: [body(model([verts([[0, 0, 0], [1, 0, 0], [0, 1, 0]], 0, []), triList(0, [0, 1, 2])], [1, 55]))] },
    ],
  });
  const r = buildReport("x.dz", [{ entry: entry("levels/kino/room.group.bin"), data }], dict);
  assert.equal(r.groups[0].status, "parsed");
  assert.equal(r.totals.resourcesDecoded, 3);
  assert.equal(r.totals.decodeFailed, 1);
  assert.equal(r.totals.unsupportedTextures, 1);
  assert.equal(r.totals.missingMaterialRefs, 1);
  assert.equal(r.totals.missingTextureRefs, 1);
  assert.equal(r.groups[0].resourcesDecoded, 3);
  assert.deepEqual(r.groups[0].decodeErrors?.length, 1);
  assert.match(r.groups[0].decodeErrors![0], /^CIwMaterial#1: .*20/);
  assert.ok(renderReportHtml(r).includes("CIwMaterial#1"));
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
    assert.equal(r.totals.listsIdentified, r.totals.listsTotal);
    assert.ok(r.groups.every((g) => g.resourceCounts));
    assert.equal(r.totals.missingMaterialRefs, 0);
    assert.equal(r.totals.missingTextureRefs, 0);
    assert.ok(r.totals.resourcesDecoded > 1500, `decoded ${r.totals.resourcesDecoded}`);
  } finally {
    fs.closeSync(fd);
  }
});

test("unreadable group becomes a failed row instead of aborting", () => {
  const dir = tempDir();
  const dzPath = path.join(dir, "a.dz");
  const buf = buildDz([
    { name: "bad.group.bin", dir: "levels\\kino", data: Buffer.from("X"), flags: 0x200 },
    { name: "ok.group.bin", dir: "levels\\kino", data: buildGroup({ name: "ok", flags: 0 }) },
  ]);
  fs.writeFileSync(dzPath, buf);
  const fd = fs.openSync(dzPath, "r");
  try {
    const r = buildReport(dzPath, readGroups(fd, parseDzIndex(buf, buf.length).entries), dict);
    assert.equal(r.totals.parsed, 1);
    assert.equal(r.totals.failed, 1);
    assert.match(r.groups.find((g) => g.status === "failed")!.error!, /0x200/);
  } finally {
    fs.closeSync(fd);
  }
});
