import { describeClass } from "./class-names.ts";
import type { DzEntry } from "./dz.ts";
import { parseGroup } from "./group.ts";

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
};

export type CoverageReport = {
  generatedFrom: string;
  groups: GroupReport[];
  totals: { groups: number; parsed: number; failed: number; listsTotal: number; listsIdentified: number; resourcesDecoded: 0 };
  classesSeen: Record<string, number>;
};

/**
 * Structure-level coverage. Only each group's first resource list can be
 * identified until per-class decoders exist, so resourcesDecoded is 0.
 */
export function buildReport(dzPath: string, groups: { entry: DzEntry; data: Buffer }[], dict: Map<number, string>): CoverageReport {
  const rows: GroupReport[] = groups.map(({ entry, data }) => {
    const base = { path: entry.path, offset: entry.offset, size: entry.size };
    try {
      const g = parseGroup(data);
      return {
        ...base,
        status: "parsed",
        name: g.name ?? "",
        children: g.children.map((c) => c.path),
        listCount: g.listCount,
        ...(g.firstList && { firstList: { className: describeClass(g.firstList.classHash, dict), resourceCount: g.firstList.resourceCount } }),
      };
    } catch (e) {
      return { ...base, status: "failed", error: (e as Error).message };
    }
  });
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const seen: Record<string, number> = {};
  for (const r of rows) if (r.firstList) seen[r.firstList.className] = (seen[r.firstList.className] ?? 0) + 1;
  const classesSeen = Object.fromEntries(Object.entries(seen).sort(([a], [b]) => (a < b ? -1 : 1)));

  const parsed = rows.filter((r) => r.status === "parsed");
  return {
    generatedFrom: dzPath,
    groups: rows,
    totals: {
      groups: rows.length,
      parsed: parsed.length,
      failed: rows.length - parsed.length,
      listsTotal: parsed.reduce((n, r) => n + (r.listCount ?? 0), 0),
      listsIdentified: parsed.filter((r) => r.firstList).length,
      resourcesDecoded: 0,
    },
    classesSeen,
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
      const first = g.firstList ? `${esc(g.firstList.className)} &times; ${g.firstList.resourceCount}` : "&mdash;";
      const detail = g.status === "failed" ? `<span class="err">${esc(g.error ?? "")}</span>` : first;
      return `<tr class="${g.status}"><td>${esc(g.path)}</td><td>${esc(g.name ?? "")}</td><td class="n">${kb(g.size)}</td><td>${g.status}</td><td class="n">${g.listCount ?? ""}</td><td>${detail}</td><td class="n">${g.children?.length ?? ""}</td></tr>`;
    })
    .join("\n");
  const classRows = Object.entries(report.classesSeen)
    .map(([c, n]) => `<tr><td>${esc(c)}</td><td class="n">${n}</td></tr>`)
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
<div class="stats">${stat("groups", t.groups)}${stat("parsed", t.parsed)}${stat("failed", t.failed)}${stat("resource lists", t.listsTotal)}${stat("lists identified", t.listsIdentified)}${stat("resources decoded", t.resourcesDecoded)}</div>
<p class="note">Milestone 1 reads group structure only. Each group's first resource list is identified; the rest need per-class decoders (next milestone).</p>
<h2>Resource groups</h2>
<div class="wrap"><table><thead><tr><th>Path</th><th>Name</th><th>Size</th><th>Status</th><th>Lists</th><th>First list</th><th>Children</th></tr></thead>
<tbody>
${groupRows}
</tbody></table></div>
<h2>Classes seen (first lists)</h2>
<div class="wrap"><table><thead><tr><th>Class</th><th>Groups</th></tr></thead><tbody>
${classRows}
</tbody></table></div>
</main></body></html>
`;
}
