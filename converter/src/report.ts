import { classHash, describeClass } from "./class-names.ts";
import { readDzEntry, type DzEntry } from "./dz.ts";
import { parseGroup } from "./group.ts";
import { decodeMaterial } from "./material.ts";
import { decodeModel } from "./model.ts";
import { listResources, resourceBytes } from "./resources.ts";
import { decodeTexture } from "./texture.ts";

export type GroupInput = { entry: DzEntry; data: Buffer | Error };

/** Reads each entry; a read failure is kept as an Error so the report can record it. */
export function readGroups(fd: number, entries: DzEntry[]): GroupInput[] {
  return entries.map((entry) => {
    try {
      return { entry, data: readDzEntry(fd, entry) };
    } catch (e) {
      return { entry, data: e as Error };
    }
  });
}

export type GroupReport = {
  path: string;
  offset: number;
  size: number;
  status: "parsed" | "failed";
  error?: string;
  name?: string;
  children?: string[];
  listCount?: number;
  firstList?: { className: string; resourceCount: number };
  resourceCounts?: Record<string, number>;
  resourcesDecoded?: number;
  decodeErrors?: string[]; // "<Class>#<index>: <error>"
};

export type CoverageReport = {
  generatedFrom: string;
  groups: GroupReport[];
  totals: {
    groups: number;
    parsed: number;
    failed: number;
    listsTotal: number;
    listsIdentified: number;
    resourcesDecoded: number; // textures, materials and models
    decodeFailed: number;
    unsupportedTextures: number;
    missingMaterialRefs: number; // model material hashes with no CIwMaterial in these groups
    missingTextureRefs: number; // material texture hashes with no CIwTexture in these groups
  };
  classesSeen: Record<string, number>; // className -> number of groups containing it
  resourcesByClass: Record<string, number>;
};

const sortedKeys = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

const TEXTURE = classHash("CIwTexture");
const MATERIAL = classHash("CIwMaterial");
const MODEL = classHash("CIwModel");

/**
 * Coverage: every resource list is walked and counted by class, and every
 * texture, material and model is decoded. A resource that fails is listed in
 * its group's decodeErrors; references are checked across all given groups.
 */
export function buildReport(dzPath: string, groups: GroupInput[], dict: Map<number, string>): CoverageReport {
  const names = { [TEXTURE]: new Set<number>(), [MATERIAL]: new Set<number>() };
  const materialRefs: number[] = [];
  const textureRefs: number[] = [];
  let unsupportedTextures = 0;
  const rows: GroupReport[] = groups.map(({ entry, data }) => {
    const base = { path: entry.path, offset: entry.offset, size: entry.size };
    try {
      if (data instanceof Error) throw data;
      const g = parseGroup(data);
      const counts: Record<string, number> = {};
      const decodeErrors: string[] = [];
      let decoded = 0;
      for (const ref of listResources(data)) {
        const c = describeClass(ref.classHash, dict);
        counts[c] = (counts[c] ?? 0) + 1;
        if (ref.classHash !== TEXTURE && ref.classHash !== MATERIAL && ref.classHash !== MODEL) continue;
        try {
          const res = resourceBytes(data, ref);
          if (ref.classHash === TEXTURE) {
            names[TEXTURE].add(ref.nameHash);
            if (decodeTexture(res).kind === "unsupported") {
              unsupportedTextures++;
              continue;
            }
          } else if (ref.classHash === MATERIAL) {
            names[MATERIAL].add(ref.nameHash);
            const m = decodeMaterial(res);
            for (const t of [m.texture0, m.texture1]) if (t !== null) textureRefs.push(t);
          } else {
            materialRefs.push(...decodeModel(res).materialHashes);
          }
          decoded++;
        } catch (e) {
          decodeErrors.push(`${c}#${ref.index}: ${(e as Error).message}`);
        }
      }
      return {
        ...base,
        status: "parsed",
        name: g.name ?? "",
        children: g.children.map((c) => c.path),
        listCount: g.listCount,
        ...(g.firstList && { firstList: { className: describeClass(g.firstList.classHash, dict), resourceCount: g.firstList.resourceCount } }),
        resourceCounts: sortedKeys(counts),
        resourcesDecoded: decoded,
        ...(decodeErrors.length && { decodeErrors }),
      };
    } catch (e) {
      return { ...base, status: "failed", error: (e as Error).message };
    }
  });
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const seen: Record<string, number> = {};
  const byClass: Record<string, number> = {};
  for (const r of rows) {
    for (const [c, n] of Object.entries(r.resourceCounts ?? {})) {
      seen[c] = (seen[c] ?? 0) + 1;
      byClass[c] = (byClass[c] ?? 0) + n;
    }
  }

  const parsed = rows.filter((r) => r.status === "parsed");
  return {
    generatedFrom: dzPath,
    groups: rows,
    totals: {
      groups: rows.length,
      parsed: parsed.length,
      failed: rows.length - parsed.length,
      listsTotal: parsed.reduce((n, r) => n + (r.listCount ?? 0), 0),
      listsIdentified: parsed.reduce((n, r) => n + (r.listCount ?? 0), 0),
      resourcesDecoded: parsed.reduce((n, r) => n + (r.resourcesDecoded ?? 0), 0),
      decodeFailed: parsed.reduce((n, r) => n + (r.decodeErrors?.length ?? 0), 0),
      unsupportedTextures,
      missingMaterialRefs: materialRefs.filter((h) => !names[MATERIAL].has(h)).length,
      missingTextureRefs: textureRefs.filter((h) => !names[TEXTURE].has(h)).length,
    },
    classesSeen: sortedKeys(seen),
    resourcesByClass: sortedKeys(byClass),
  };
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);

function kb(n: number): string {
  return n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;
}

export function renderReportHtml(report: CoverageReport): string {
  const t = report.totals;
  const stat = (label: string, value: number | string) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;
  const groupRows = report.groups
    .map((g) => {
      const counts = Object.entries(g.resourceCounts ?? {});
      const classes = counts.length ? counts.map(([c, n]) => `${esc(c)} &times; ${n}`).join(", ") : "&mdash;";
      const errors = (g.decodeErrors ?? []).map((e) => `<br><span class="err">${esc(e)}</span>`).join("");
      const detail = g.status === "failed" ? `<span class="err">${esc(g.error ?? "")}</span>` : classes + errors;
      const total = counts.reduce((n, [, k]) => n + k, 0);
      return `<tr class="${g.status}"><td>${esc(g.path)}</td><td>${esc(g.name ?? "")}</td><td class="n">${kb(g.size)}</td><td>${g.status}</td><td class="n">${g.listCount ?? ""}</td><td class="n">${g.status === "parsed" ? total : ""}</td><td>${detail}</td><td class="n">${g.children?.length ?? ""}</td></tr>`;
    })
    .join("\n");
  const classRows = Object.entries(report.classesSeen)
    .map(([c, n]) => `<tr><td>${esc(c)}</td><td class="n">${n}</td><td class="n">${report.resourcesByClass[c] ?? 0}</td></tr>`)
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kino Coverage Report</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--mute:#6b6a65;--line:#e4e1d9;--bad:#b3261e;--ok:#2e6b3a}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--mute:#9b9a93;--line:#2c2b28;--bad:#f2b8b5;--ok:#9fd3a8}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0;padding:32px 16px}
main{max-width:1100px;margin:auto}h1{font-size:1.6rem;margin:0 0 4px}p.src{color:var(--mute);margin:0 0 24px;word-break:break-all}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:28px}.stat{border:1px solid var(--line);border-radius:8px;padding:10px 16px;min-width:110px}
.stat b{display:block;font-size:1.4rem}.stat span{color:var(--mute);font-size:.85rem}
h2{font-size:1.1rem;margin:28px 0 8px}.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:600}
td.n{text-align:right;font-variant-numeric:tabular-nums}tr.failed td{color:var(--bad)}.err{font-family:ui-monospace,monospace;font-size:.85rem}
.note{color:var(--mute);font-size:.9rem}
</style></head><body><main>
<h1>Kino der Toten: asset coverage</h1>
<p class="src">Source: ${esc(report.generatedFrom)}</p>
<div class="stats">${stat("groups", t.groups)}${stat("parsed", t.parsed)}${stat("failed", t.failed)}${stat("resource lists", t.listsTotal)}${stat("lists identified", t.listsIdentified)}${stat("resources decoded", t.resourcesDecoded)}${stat("decode failures", t.decodeFailed)}${stat("unsupported textures", t.unsupportedTextures)}${stat("missing material refs", t.missingMaterialRefs)}${stat("missing texture refs", t.missingTextureRefs)}</div>
<p class="note">Every resource list is walked and counted by class. Textures, materials and models are decoded; other classes are counted only.</p>
<h2>Resource groups</h2>
<div class="wrap"><table><thead><tr><th>Path</th><th>Name</th><th>Size</th><th>Status</th><th>Lists</th><th>Resources</th><th>Classes</th><th>Children</th></tr></thead>
<tbody>
${groupRows}
</tbody></table></div>
<h2>Classes seen</h2>
<div class="wrap"><table><thead><tr><th>Class</th><th>Groups</th><th>Resources</th></tr></thead><tbody>
${classRows}
</tbody></table></div>
</main></body></html>
`;
}
