/*
  Checks the arithmetic behind the experience timeline and the project ordering.

  Worth automating because every failure here is silent. A wrong month count
  doesn't throw — it just prints "2 yrs 11 mos" for a three-year job, or draws
  a gap where two roles actually ran back to back. Nobody notices that from a
  screenshot, and it's on the page a recruiter reads most carefully.

  Run: npx tsx scripts/verify-timeline.ts
*/

import {
  buildTimeline,
  durationMonths,
  formatDuration,
  formatMonth,
  monthIndex,
  sortProjectsByDate,
} from "../lib/content/timeline";
import type { Experience } from "../lib/content/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function role(over: Partial<Experience> & { slug: string; startDate: string }): Experience {
  return {
    role: "Engineer",
    company: "Acme",
    endDate: null,
    summary: "",
    highlights: [],
    tech: [],
    body: [],
    showInBlogList: false,
    ...over,
  } as Experience;
}

console.log("\n── monthIndex ──");
check("a bare year is January", monthIndex("2021", false) === 2021 * 12);
check("YYYY-MM is zero-based inside the year", monthIndex("2021-03", false) === 2021 * 12 + 2);
check("single-digit month parses", monthIndex("2021-3", false) === 2021 * 12 + 2);
check("garbage returns null rather than NaN", monthIndex("not a date", false) === null);
check("blank returns null when no fallback", monthIndex("", false) === null);
check("blank means now when a fallback is wanted", typeof monthIndex("") === "number");
// A month of 13 would otherwise index into the following year and silently
// reorder the timeline.
check("out-of-range month is clamped, not wrapped", monthIndex("2021-13", false) === 2021 * 12);

console.log("\n── durationMonths ──");
check("same month is 1 month, not 0", durationMonths("2024-03", "2024-03") === 1);
check("Jan to Dec is 12", durationMonths("2024-01", "2024-12") === 12);
check("crossing a year boundary", durationMonths("2023-11", "2024-02") === 4);
check("an open-ended role runs to today", durationMonths("2020-01", null) > 60);

console.log("\n── formatDuration ──");
check("exact years drop the months", formatDuration(24) === "2 yrs", formatDuration(24));
check("singular year", formatDuration(12) === "1 yr", formatDuration(12));
check("years and months", formatDuration(15) === "1 yr 3 mos", formatDuration(15));
check("months only", formatDuration(8) === "8 mos", formatDuration(8));
check("singular month", formatDuration(1) === "1 mo", formatDuration(1));
check("zero is empty, not '0 mos'", formatDuration(0) === "");

console.log("\n── formatMonth ──");
check("YYYY-MM becomes a short month", formatMonth("2024-03") === "Mar 2024", formatMonth("2024-03"));
check("a bare year stays a year", formatMonth("2021") === "2021");
check("null is Present", formatMonth(null) === "Present");

console.log("\n── buildTimeline ──");
{
  // Deliberately supplied oldest-first, to prove the component doesn't depend
  // on the database having ordered them.
  const entries = buildTimeline([
    role({ slug: "old", startDate: "2019-01", endDate: "2019-12" }),
    role({ slug: "mid", startDate: "2022-01", endDate: "2023-06" }),
    role({ slug: "now", startDate: "2024-03", endDate: null }),
  ]);

  check("newest first regardless of input order",
    entries.map((e) => e.item.slug).join(",") === "now,mid,old",
    entries.map((e) => e.item.slug).join(","));

  check("range reads start to end", entries[1].range === "Jan 2022 — Jun 2023", entries[1].range);
  check("a current role ranges to Present", entries[0].range.endsWith("Present"), entries[0].range);
  check("duration computed", entries[1].duration === "1 yr 6 mos", entries[1].duration);

  // now starts 2024-03, mid ended 2023-06 → 8 clear months → 3 quarters.
  check("a real gap is measured", entries[0].gapQuarters === 3, String(entries[0].gapQuarters));
  check("the gap is labelled in months", entries[0].gapLabel === "8 mos", String(entries[0].gapLabel));
  check("the last entry has no gap below it", entries[2].gapQuarters === 0);
}
{
  const back2back = buildTimeline([
    role({ slug: "a", startDate: "2023-01", endDate: "2023-06" }),
    role({ slug: "b", startDate: "2023-07", endDate: "2023-12" }),
  ]);
  check("consecutive roles draw no gap", back2back[0].gapQuarters === 0,
    String(back2back[0].gapQuarters));
}
{
  const overlap = buildTimeline([
    role({ slug: "a", startDate: "2023-01", endDate: "2023-12" }),
    role({ slug: "b", startDate: "2023-06", endDate: "2024-06" }),
  ]);
  check("overlapping roles never produce a negative gap",
    overlap.every((e) => e.gapQuarters >= 0));
}
{
  const huge = buildTimeline([
    role({ slug: "a", startDate: "2005-01", endDate: "2005-06" }),
    role({ slug: "b", startDate: "2024-01", endDate: "2024-06" }),
  ]);
  // Without the cap, a 19-year gap would push the older role off the screen.
  check("an enormous gap is capped", huge[0].gapQuarters <= 6, String(huge[0].gapQuarters));
}

console.log("\n── sortProjectsByDate ──");
{
  const sorted = sortProjectsByDate([
    { slug: "undated" },
    { slug: "old", started: "2019-05" },
    { slug: "new", started: "2024-01" },
    { slug: "mid", started: "2021-11" },
  ] as Array<{ slug: string; started?: string }>);

  check("newest first", sorted.slice(0, 3).map((p) => p.slug).join(",") === "new,mid,old",
    sorted.map((p) => p.slug).join(","));
  // Undated projects at the top would put the least-known work first.
  check("undated sinks to the bottom", sorted[3].slug === "undated", sorted[3].slug);
  check("a bare year sorts against a YYYY-MM",
    sortProjectsByDate([{ started: "2020-06" }, { started: "2021" }])[0].started === "2021");
}

console.log(failures === 0 ? "\nAll timeline checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
