/*
  Checks the layout of the life graph in the About section.

  Everything here fails silently if it's wrong. Packing that lets two entries
  share a row draws them on top of each other; an off-by-one in the column
  arithmetic misdates a career by a month. Neither throws, and neither is
  obvious from a glance at the finished picture — which is why the geometry is
  a pure function with tests rather than arithmetic inline in a component.

  Run: npx tsx scripts/verify-graph.ts
*/

import {
  buildGraph,
  collectItems,
  itemRange,
  KIND_DASH,
  KIND_LABELS,
  KIND_GROUP_LABELS,
  KIND_ORDER,
} from "../lib/content/graph";
import type { Portfolio } from "../lib/content/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const M = (y: number, m = 1) => y * 12 + (m - 1);
const NOW = M(2026, 8);

function job(slug: string, start: string, end: string | null) {
  return {
    slug, role: slug, company: "X", startDate: start, endDate: end,
    summary: "", highlights: [], tech: [], body: [], showInBlogList: false,
  };
}

const portfolio = {
  profile: {},
  education: [
    { slug: "btech", institution: "GNDU", degree: "B.Tech", startYear: "2017", endYear: "2021" },
    { slug: "school", institution: "School", degree: "Schooling", startYear: "2004", endYear: undefined },
  ],
  experience: [job("now", "2026-04", null), job("past", "2021-07", "2022-06")],
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
  // Running a blank end year to today would draw a 22-year bar across the
  // whole graph; a missing field is the far likelier explanation.
  check("education with no end year does not run to today",
    school.endMonth === school.startMonth, `${school.startMonth}→${school.endMonth}`);

  const cert = items.find((i) => i.id === "certifications:gre")!;
  check("a certificate is a point, not a span", cert.isPoint && cert.startMonth === cert.endMonth);
  check("a testimonial is a point too", items.find((i) => i.id === "testimonials:jk")!.isPoint);
  check("points still carry a link where one exists", Boolean(cert.href), String(cert.href));
  check("every kind has a caption label", items.every((i) => Boolean(KIND_LABELS[i.kind])));
  check("every kind has a line style defined",
    items.every((i) => KIND_DASH[i.kind] !== undefined));
  // Category is carried by line style now that colour identifies the entry, so
  // the three span kinds must be distinguishable from each other.
  check("the three span kinds have distinct line styles",
    new Set([KIND_DASH.experience, KIND_DASH.education, KIND_DASH.projects]).size === 3,
    `${KIND_DASH.experience}|${KIND_DASH.education}|${KIND_DASH.projects}`);
}

console.log("\n── known vs derived ends ──");
{
  /*
    A closing node is drawn only where the end is a recorded fact. An ongoing
    role's endMonth is today's date, so capping it would assert on the page
    that the job has finished.
  */
  const items = collectItems(portfolio, NOW);
  check("an ongoing role has no recorded end",
    items.find((i) => i.id === "experience:now")!.hasEnd === false);
  check("a finished role does", items.find((i) => i.id === "experience:past")!.hasEnd === true);
  check("a dated project does", items.find((i) => i.id === "projects:p1")!.hasEnd === true);
  check("a degree with an end year does",
    items.find((i) => i.id === "education:btech")!.hasEnd === true);
  check("education with a blank end year does not",
    items.find((i) => i.id === "education:school")!.hasEnd === false);
  check("points never claim an end",
    items.filter((i) => i.isPoint).every((i) => !i.hasEnd));
}

console.log("\n── the track ──");
{
  const g = buildGraph(portfolio, { now: NOW });

  check("origin snaps to a January", g.originMonth % 12 === 0, String(g.originMonth % 12));
  check("origin is the year of the earliest entry", g.originMonth === M(2004));
  check("the track reaches now", g.originMonth + g.totalMonths - 1 >= NOW);
  check("columns are real month offsets",
    g.items.every((i) => i.startCol === i.startMonth - g.originMonth &&
      i.endCol === i.endMonth - g.originMonth));
  check("no entry escapes the track",
    g.items.every((i) => i.startCol >= 0 && i.startCol <= i.endCol && i.endCol < g.totalMonths));
}

console.log("\n── nothing overlaps ──");
{
  /*
    The rule this whole layout exists to enforce. Two entries sharing a row and
    a moment would be drawn one on top of the other, silently hiding one — so
    it's asserted exhaustively rather than spot-checked.
  */
  const g = buildGraph(portfolio, { now: NOW });
  let clashes = 0;
  for (let a = 0; a < g.items.length; a++) {
    for (let b = a + 1; b < g.items.length; b++) {
      const x = g.items[a];
      const z = g.items[b];
      if (x.lane !== z.lane) continue;
      // Strict: sharing only a boundary month is a permitted touch.
      if (x.startCol < z.endCol && z.startCol < x.endCol) clashes++;
    }
  }
  check("no two bars on a row genuinely overlap", clashes === 0, `${clashes} clashes`);

  check("lane count equals the rows actually used",
    g.lanes === new Set(g.items.map((i) => i.lane)).size, `${g.lanes} reported`);
  check("lanes are numbered from zero with no gaps",
    [...new Set(g.items.map((i) => i.lane))].sort((p, q) => p - q).every((l, i) => l === i));
}
{
  // Four roles genuinely running at once must produce four branches — the
  // "if anything shares a timeline, show it as a branch" case.
  const concurrent = {
    ...portfolio, education: [], projects: [], certifications: [], testimonials: [],
    experience: [
      job("a", "2022-09", "2023-09"), job("b", "2022-09", "2023-09"),
      job("c", "2022-09", "2023-09"), job("d", "2022-09", "2023-09"),
    ],
  } as unknown as Portfolio;

  const g = buildGraph(concurrent, { now: M(2024, 1) });
  check("four concurrent roles fork onto four branches", g.lanes === 4, `${g.lanes}`);
  check("each is on its own row", new Set(g.items.map((i) => i.lane)).size === 4);
}
{
  // Sequential entries should reuse one row rather than stacking forever.
  const sequential = {
    ...portfolio, education: [], projects: [], certifications: [], testimonials: [],
    experience: [
      job("a", "2020-01", "2020-06"), job("b", "2021-01", "2021-06"),
      job("c", "2022-01", "2022-06"),
    ],
  } as unknown as Portfolio;

  const g = buildGraph(sequential, { now: M(2023, 1) });
  check("entries that never overlap share one branch", g.lanes === 1, `${g.lanes} lanes`);
}

console.log("\n── sections are stacked bands ──");
{
  /*
    Gantt-style grouping: a section's rows must be contiguous and in the
    declared order. If bands interleaved, "all the jobs" would be scattered
    among certificates and the grouping would buy nothing.
  */
  const g = buildGraph(portfolio, { now: NOW });

  check("only sections with entries get a band",
    g.groups.length === new Set(g.items.map((i) => i.kind)).size,
    g.groups.map((x) => x.kind).join(", "));

  check("bands follow the declared order",
    g.groups.map((x) => x.kind).join(",") ===
      KIND_ORDER.filter((k) => g.items.some((i) => i.kind === k)).join(","),
    g.groups.map((x) => x.kind).join(","));

  check("bands are contiguous and start at row 0",
    g.groups.every((x, i) =>
      x.firstLane === (i === 0 ? 0 : g.groups[i - 1].firstLane + g.groups[i - 1].lanes)));

  check("total rows is the sum of the bands",
    g.lanes === g.groups.reduce((n, x) => n + x.lanes, 0), `${g.lanes}`);

  // The actual grouping guarantee.
  for (const group of g.groups) {
    const rows = g.items.filter((i) => i.kind === group.kind).map((i) => i.lane);
    const ok = rows.every((r) => r >= group.firstLane && r < group.firstLane + group.lanes);
    check(`${group.kind} sits entirely inside its own band`, ok,
      `rows ${Math.min(...rows)}-${Math.max(...rows)} vs band ${group.firstLane}-${group.firstLane + group.lanes - 1}`);
  }

  check("no row holds two different sections",
    g.items.every((a) => g.items.every((b) => a.lane !== b.lane || a.kind === b.kind)));

  check("every band is at least one row tall", g.groups.every((x) => x.lanes >= 1));
  // A band heads a group, so it reads plural; the caption names one entry.
  check("bands are labelled in the plural",
    g.groups.every((x) => x.label === KIND_GROUP_LABELS[x.kind]),
    g.groups.map((x) => x.label).join(", "));
}
{
  // Packing is per section, so a busy section must not make a quiet one taller.
  const mixed = {
    ...portfolio, education: [], certifications: [], testimonials: [],
    projects: [{ slug: "solo", name: "Solo", summary: "", description: "", tech: [],
      featured: false, started: "2020-01", ended: "2020-06", body: [], showInBlogList: false }],
    experience: [
      job("a", "2022-01", "2023-01"), job("b", "2022-01", "2023-01"), job("c", "2022-01", "2023-01"),
    ],
  } as unknown as Portfolio;

  const g = buildGraph(mixed, { now: M(2024, 1) });
  const exp = g.groups.find((x) => x.kind === "experience")!;
  const proj = g.groups.find((x) => x.kind === "projects")!;
  check("a busy section is as tall as its own concurrency", exp.lanes === 3, `${exp.lanes}`);
  check("a quiet section stays one row", proj.lanes === 1, `${proj.lanes}`);
  check("total is the sum, not the global maximum", g.lanes === 4, `${g.lanes}`);
}

console.log("\n── only bars force a fork ──");
{
  /*
    Two short entries a couple of months apart, whose text labels would
    certainly overlap. They must still share a row: a label collision is not a
    reason to spend a whole extra branch, and forking on it made the graph far
    taller than the data warranted.
  */
  const nearby = {
    ...portfolio, education: [], projects: [], certifications: [], testimonials: [],
    experience: [job("a", "2020-01", "2020-02"), job("b", "2020-04", "2020-05")],
  } as unknown as Portfolio;
  check("labels that would collide do not fork",
    buildGraph(nearby, { now: M(2021, 1) }).lanes === 1);
}
{
  // One ends exactly as the next begins. Sharing that single boundary month is
  // a touch, not an overlap.
  const touching = {
    ...portfolio, education: [], projects: [], certifications: [], testimonials: [],
    experience: [job("a", "2020-01", "2020-06"), job("b", "2020-06", "2021-01")],
  } as unknown as Portfolio;
  check("ends meeting starts do not fork",
    buildGraph(touching, { now: M(2021, 6) }).lanes === 1, "");
}
{
  // A single month of genuine overlap must still fork.
  const overlapping = {
    ...portfolio, education: [], projects: [], certifications: [], testimonials: [],
    experience: [job("a", "2020-01", "2020-07"), job("b", "2020-06", "2021-01")],
  } as unknown as Portfolio;
  check("one month of real overlap does fork",
    buildGraph(overlapping, { now: M(2021, 6) }).lanes === 2);
}
{
  /*
    Points have no length, so they can never *overlap*. But two in the same
    month occupy exactly the same column, and drawing them on one row puts both
    nodes and both labels at the same pixel — one entry vanishes. Coincidence
    forks; mere adjacency does not.
  */
  const points = {
    ...portfolio, education: [], projects: [], experience: [], testimonials: [],
    certifications: [
      { slug: "a", name: "A", issuer: "X", issueDate: "2024-06", body: [], showInBlogList: false },
      { slug: "b", name: "B", issuer: "X", issueDate: "2024-06", body: [], showInBlogList: false },
      { slug: "c", name: "C", issuer: "X", issueDate: "2024-11", body: [], showInBlogList: false },
    ],
  } as unknown as Portfolio;
  const g = buildGraph(points, { now: M(2025, 1) });
  check("all three appear", g.items.length === 3);
  // A and B are both June: identical columns, so one would be drawn exactly on
  // top of the other. C is November and reuses A's row.
  check("two entries in the same month fork so neither is hidden", g.lanes === 2, `${g.lanes}`);
  const june = g.items.filter((i) => i.startCol === g.items[0].startCol);
  check("the coincident pair are on different rows",
    new Set(june.map((i) => i.lane)).size === june.length);
  check("a later point reuses an earlier row rather than adding one",
    g.items.find((i) => i.id === "certifications:c")!.lane === 0);
}

console.log("\n── colours ──");
{
  const g = buildGraph(portfolio, { now: NOW });
  check("every entry gets a hue", g.items.every((i) => Number.isFinite(i.hue)));
  check("hues stay on the wheel", g.items.every((i) => i.hue >= 0 && i.hue < 360));
  check("no two entries share a hue",
    new Set(g.items.map((i) => i.hue.toFixed(2))).size === g.items.length);

  // Colouring by category is precisely what this replaced: entries of the same
  // kind must not come out the same colour.
  const sameKind = g.items.filter((i) => i.kind === "experience");
  check("two entries of the same kind differ in colour",
    sameKind.length < 2 || sameKind[0].hue !== sameKind[1].hue);

  /*
    Hues are assigned in date order, before entries are split into bands — so
    the property to check is that entries adjacent *in time* differ sharply.
    Adjacency in g.items is now band order, which is a different thing.
  */
  const byDate = [...g.items].sort((a, b) => a.startMonth - b.startMonth);
  const gaps = byDate.slice(1).map((i, n) => {
    const d = Math.abs(i.hue - byDate[n].hue);
    return Math.min(d, 360 - d);
  });
  check("entries adjacent in time are far apart on the wheel",
    gaps.every((d) => d > 60), `min gap ${Math.min(...gaps).toFixed(0)}°`);
}

console.log("\n── year ticks ──");
{
  const g = buildGraph(portfolio, { now: NOW });
  check("one tick per year", g.yearTicks.length === Math.ceil(g.totalMonths / 12),
    `${g.yearTicks.length} over ${g.totalMonths} months`);
  check("the first tick is the origin year at column 0",
    g.yearTicks[0].label === "2004" && g.yearTicks[0].col === 0);
  check("ticks are 12 columns apart",
    g.yearTicks.every((t, i) => i === 0 || t.col - g.yearTicks[i - 1].col === 12));
  check("labels ascend by one year",
    g.yearTicks.every((t, i) => i === 0 || Number(t.label) - Number(g.yearTicks[i - 1].label) === 1));
}

console.log("\n── ranges ──");
{
  const items = collectItems(portfolio, NOW);
  const current = items.find((i) => i.id === "experience:now")!;
  check("a current role reads as Present", itemRange(current, NOW).endsWith("Present"),
    itemRange(current, NOW));
  check("a point is a single month, not a range",
    itemRange(items.find((i) => i.id === "certifications:gre")!, NOW) === "Nov 2024");
  check("a finished role shows both ends",
    itemRange(items.find((i) => i.id === "experience:past")!, NOW) === "Jul 2021 — Jun 2022");
}

console.log("\n── empty portfolio ──");
{
  const empty = { ...portfolio, education: [], experience: [], projects: [],
    certifications: [], testimonials: [] } as unknown as Portfolio;
  const g = buildGraph(empty, { now: NOW });
  check("builds without throwing and reports nothing to draw",
    g.items.length === 0 && g.lanes === 0 && g.yearTicks.length === 0);
}

console.log(failures === 0 ? "\nAll graph checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
