/*
  Checks the layout of the life graph in the About section.

  Everything here fails silently if it's wrong. A row that wraps a month early
  draws a graph that misdates someone's career; a reversed row whose columns
  aren't flipped draws a job running backwards through time. Neither throws,
  and neither is obvious from a glance at the finished picture — which is
  precisely why the geometry is a pure function with tests rather than inline
  arithmetic in a component.

  Run: npx tsx scripts/verify-graph.ts
*/

import { buildGraph, collectItems, itemRange, LANES } from "../lib/content/graph";
import type { Portfolio } from "../lib/content/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const M = (y: number, m = 1) => y * 12 + (m - 1);
const NOW = M(2026, 8);

const portfolio = {
  profile: {},
  education: [
    { slug: "btech", institution: "GNDU", degree: "B.Tech", startYear: "2017", endYear: "2021" },
    { slug: "school", institution: "School", degree: "Schooling", startYear: "2004", endYear: undefined },
  ],
  experience: [
    { slug: "now", role: "Founding Engineer", company: "X", startDate: "2026-04", endDate: null,
      summary: "", highlights: [], tech: [], body: [], showInBlogList: false },
    { slug: "past", role: "Dev", company: "Y", startDate: "2021-07", endDate: "2022-06",
      summary: "", highlights: [], tech: [], body: [], showInBlogList: false },
  ],
  projects: [
    { slug: "p1", name: "Thing", summary: "", description: "", tech: [], featured: false,
      started: "2020-11", ended: "2021-02", body: [], showInBlogList: false },
    { slug: "undated", name: "No date", summary: "", description: "", tech: [], featured: false,
      body: [], showInBlogList: false },
  ],
  certifications: [
    { slug: "gre", name: "GRE", issuer: "ETS", issueDate: "2024-11", body: [], showInBlogList: false },
  ],
  testimonials: [
    { slug: "jk", quote: "q", authorName: "JK", receivedAt: "2024-06" },
    { slug: "nodate", quote: "q", authorName: "No date" },
  ],
  skills: [],
  writing: [],
} as unknown as Portfolio;

console.log("\n── collecting ──");
{
  const items = collectItems(portfolio, NOW);
  const ids = items.map((i) => i.id);

  // 2 education + 2 experience + 1 dated project + 1 cert + 1 dated testimonial.
  check("everything dated is collected", items.length === 7, ids.join(", "));
  check("an undated project is left off rather than dated to zero",
    !ids.includes("projects:undated"));
  check("an undated testimonial is left off too", !ids.includes("testimonials:nodate"));
  check("sorted oldest first", ids[0] === "education:school", ids[0]);

  const current = items.find((i) => i.id === "experience:now")!;
  check("a current role runs to now", current.endMonth === NOW, String(current.endMonth));

  const school = items.find((i) => i.id === "education:school")!;
  // A school with a blank end year is a missing field far more often than a
  // course someone is still enrolled in; running it to today would draw a
  // 22-year bar across the whole graph.
  check("education with no end year does not run to today",
    school.endMonth === school.startMonth, `${school.startMonth}→${school.endMonth}`);

  const cert = items.find((i) => i.id === "certifications:gre")!;
  check("a certificate is a point, not a span", cert.isPoint && cert.startMonth === cert.endMonth);
  check("a testimonial is a point too",
    items.find((i) => i.id === "testimonials:jk")!.isPoint);
  check("points still carry a link where one exists", Boolean(cert.href), String(cert.href));
}

console.log("\n── snake layout ──");
{
  const g = buildGraph(portfolio, { monthsPerRow: 36, now: NOW });

  // 2004 is the earliest; origin snaps back to that January so year labels sit
  // on the grid instead of reading "Mar 2004" down the edge.
  check("origin snaps to a January", g.originMonth % 12 === 0, String(g.originMonth % 12));
  check("origin is the year of the earliest item", g.originMonth === M(2004), String(g.originMonth));
  check("covers up to now", g.originMonth + g.totalMonths - 1 >= NOW);
  check("row count covers the span",
    g.rows === Math.ceil(g.totalMonths / 36), `${g.rows} rows for ${g.totalMonths} months`);
  check("year labels are years", g.rowYears.every((r) => /^\d{4}$/.test(r.label)),
    g.rowYears.map((r) => r.label).join(","));
  check("consecutive rows are 3 years apart at 36/row",
    Number(g.rowYears[1].label) - Number(g.rowYears[0].label) === 3);

  // Every segment must land inside its row.
  check("no segment escapes its row",
    g.segments.every((s) => s.fromCol >= 0 && s.toCol < 36 && s.fromCol <= s.toCol),
    g.segments.filter((s) => s.fromCol > s.toCol || s.toCol >= 36).map((s) => s.itemId).join(","));

  check("odd rows are flagged reversed",
    g.segments.every((s) => s.reversed === (s.row % 2 === 1)));

  check("exactly one start node per item",
    g.items.every((i) => g.segments.filter((s) => s.itemId === i.id && s.isStart).length === 1));

  check("every lane in use is a declared lane",
    g.segments.every((s) => LANES.some((l) => l.key === s.lane)));
}

console.log("\n── wrapping across rows ──");
{
  // A 4-year degree at 36 months per row must split across two bands.
  const g = buildGraph(portfolio, { monthsPerRow: 36, now: NOW });
  const btech = g.segments.filter((s) => s.itemId === "education:btech");
  check("a span crossing a row boundary is split", btech.length === 2, `${btech.length} segments`);
  check("the split pieces are on consecutive rows",
    btech.length === 2 && Math.abs(btech[0].row - btech[1].row) === 1);
  check("only the first piece carries the start node",
    btech.filter((s) => s.isStart).length === 1);

  // The total months drawn must equal the item's real duration, or the graph
  // is lying about how long something took.
  const item = g.items.find((i) => i.id === "education:btech")!;
  const drawn = btech.reduce((n, s) => n + (s.toCol - s.fromCol + 1), 0);
  check("no month is lost or duplicated at the seam",
    drawn === item.endMonth - item.startMonth + 1,
    `drew ${drawn}, span is ${item.endMonth - item.startMonth + 1}`);
}

console.log("\n── reversed rows ──");
{
  /*
    The bug this guards: on a right-to-left row, an item starting early in the
    row must be drawn on the RIGHT. Getting this wrong doesn't throw — it draws
    a career running backwards, which reads as plausible until you check a date.
  */
  const single = {
    ...portfolio,
    education: [], projects: [], certifications: [], testimonials: [],
    experience: [
      { slug: "a", role: "A", company: "X", startDate: "2004-01", endDate: "2004-02",
        summary: "", highlights: [], tech: [], body: [], showInBlogList: false },
      // Row 1 (reversed) starts at month 12: this begins right at its start.
      { slug: "b", role: "B", company: "X", startDate: "2005-01", endDate: "2005-02",
        summary: "", highlights: [], tech: [], body: [], showInBlogList: false },
    ],
  } as unknown as Portfolio;

  const g = buildGraph(single, { monthsPerRow: 12, now: M(2005, 6) });
  const a = g.segments.find((s) => s.itemId === "experience:a")!;
  const b = g.segments.find((s) => s.itemId === "experience:b")!;

  check("row 0 runs left to right", a.row === 0 && !a.reversed && a.fromCol === 0, `${a.fromCol}`);
  check("row 1 is reversed", b.row === 1 && b.reversed);
  // Months 0-1 of a reversed 12-column row occupy columns 10-11.
  check("an item early in a reversed row is drawn at the right-hand end",
    b.fromCol === 10 && b.toCol === 11, `cols ${b.fromCol}-${b.toCol}`);
  check("columns are stored low-to-high even when reversed", b.fromCol <= b.toCol);
}

console.log("\n── ranges ──");
{
  const items = collectItems(portfolio, NOW);
  const current = items.find((i) => i.id === "experience:now")!;
  check("a current role reads as Present", itemRange(current, NOW).endsWith("Present"),
    itemRange(current, NOW));
  const cert = items.find((i) => i.id === "certifications:gre")!;
  check("a point is a single month, not a range", itemRange(cert, NOW) === "Nov 2024",
    itemRange(cert, NOW));
  const past = items.find((i) => i.id === "experience:past")!;
  check("a finished role shows both ends", itemRange(past, NOW) === "Jul 2021 — Jun 2022",
    itemRange(past, NOW));
}

console.log("\n── empty portfolio ──");
{
  const empty = { ...portfolio, education: [], experience: [], projects: [],
    certifications: [], testimonials: [] } as unknown as Portfolio;
  const g = buildGraph(empty, { monthsPerRow: 36, now: NOW });
  check("builds without throwing and reports nothing to draw",
    g.items.length === 0 && g.rows === 0 && g.segments.length === 0);
}

console.log(failures === 0 ? "\nAll graph checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
