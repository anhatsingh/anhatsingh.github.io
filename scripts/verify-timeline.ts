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
} from "../lib/content/timeline";
import type { Experience } from "../lib/content/types";
import { serializeTenure, summariseTenure } from "../lib/content/tenure";
import { seedPortfolio } from "../lib/content/seed";
import type { Portfolio } from "../lib/content/types";

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
// Certification issuers write dates as prose. Failing to parse these doesn't
// throw — it files a dated row as undated and sinks it, silently.
check("'Nov 2015' parses", monthIndex("Nov 2015", false) === 2015 * 12 + 10, String(monthIndex("Nov 2015", false)));
check("'Nov 1, 2015' parses", monthIndex("Nov 1, 2015", false) === 2015 * 12 + 10, String(monthIndex("Nov 1, 2015", false)));
check("'January 1, 2016' parses", monthIndex("January 1, 2016", false) === 2016 * 12, String(monthIndex("January 1, 2016", false)));
check("'Nov 1 2015' without a comma parses", monthIndex("Nov 1 2015", false) === 2015 * 12 + 10);
check("'1st March 2020' is not mistaken for a month", monthIndex("1st March 2020", false) === null);
check("a bogus month name is null, not month 0", monthIndex("Xyz 2015", false) === null);
check("prose dates order correctly against each other",
  (monthIndex("Nov 1, 2015", false) ?? 0) < (monthIndex("Jan 1, 2016", false) ?? 0));

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

console.log("\n── grouping by employer ──");
{
  /*
    Two consecutive roles at one company are one tenure. Rendering them as two
    separate blocks reads as two unrelated jobs, which undersells a promotion.
  */
  const groups = buildTimeline([
    role({ slug: "now", startDate: "2026-04", endDate: null, company: "Mavenzeit", role: "Founding Engineer" }),
    role({ slug: "senior", startDate: "2025-04", endDate: "2026-03", company: "Dom Ventas", role: "Senior Dev" }),
    role({ slug: "mid", startDate: "2024-11", endDate: "2025-04", company: "Dom Ventas", role: "Dev" }),
    role({ slug: "ds", startDate: "2024-01", endDate: "2024-07", company: "Axtria", role: "Data Scientist" }),
  ]);

  check("one block per employer", groups.length === 3, groups.map((g) => g.company).join(", "));
  check("the repeated employer holds both roles",
    groups[1].company === "Dom Ventas" && groups[1].roles.length === 2,
    `${groups[1].company}: ${groups[1].roles.length}`);
  check("roles keep the order they were given",
    groups[1].roles.map((r) => r.item.slug).join(",") === "senior,mid");
  check("a single-role employer is still a group of one", groups[0].roles.length === 1);
  check("input order is preserved across groups",
    groups.map((g) => g.company).join(",") === "Mavenzeit,Dom Ventas,Axtria");

  // The tenure spans the whole group, not the sum of its parts: adding the
  // roles would double-count an overlap and invent a month at every handover.
  check("tenure runs from the earliest start to the latest end",
    groups[1].range === "Nov 2024 — Mar 2026", groups[1].range);
  check("tenure duration covers the whole span, not the sum of roles",
    groups[1].duration === "1 yr 5 mos", groups[1].duration);

  check("each role keeps its own range", groups[1].roles[1].range === "Nov 2024 — Apr 2025",
    groups[1].roles[1].range);
  check("a current role marks its group current", groups[0].current === true);
  check("a finished group is not current", groups[1].current === false);
  check("an ongoing group reads as Present", groups[0].range.endsWith("Present"), groups[0].range);
}
{
  // Returning to an employer years later is a different thing from a
  // promotion, so only *consecutive* rows collapse.
  const groups = buildTimeline([
    role({ slug: "a", startDate: "2024-01", endDate: "2025-01", company: "Acme", role: "Senior" }),
    role({ slug: "b", startDate: "2022-01", endDate: "2023-01", company: "Other", role: "Dev" }),
    role({ slug: "c", startDate: "2020-01", endDate: "2021-01", company: "Acme", role: "Junior" }),
  ]);
  check("a non-adjacent return to an employer stays separate", groups.length === 3,
    groups.map((g) => g.company).join(","));
}
{
  const groups = buildTimeline([
    role({ slug: "a", startDate: "2022-09", endDate: "2022-12", company: "Busineswise", role: "Dev" }),
    role({ slug: "b", startDate: "2022-09", endDate: "2022-12", company: "IIT Madras", role: "Mentor" }),
  ]);
  check("concurrent roles at different employers stay separate", groups.length === 2);
}
{
  const groups = buildTimeline([]);
  check("an empty list produces no groups", groups.length === 0);
}

/*
  How long he has been at this.

  "How many years of experience" is the first thing a recruiter asks, and a
  model adding up dated entries unaided gets it wrong three ways: two roles
  that ran at once become double the time, a degree becomes either work
  experience or a gap, and either error is checkable against the dates rendered
  beside the answer. So the arithmetic happens in code and the model is handed
  the result.
*/
console.log("\n── tenure ──");
{
  const p = (experience: unknown[], education: unknown[]) =>
    ({ ...seedPortfolio, experience, education }) as unknown as Portfolio;

  const role = (startDate: string, endDate: string | null) =>
    ({ slug: `r${startDate}`, role: "Engineer", company: "C", startDate, endDate, summary: "" });
  const course = (startYear: string, endYear: string) =>
    ({ slug: `e${startYear}`, institution: "U", degree: "B.Tech", startYear, endYear });

  /*
    The double-count. Two roles held at the same time are one stretch of
    working life, not two — this is the error that turns three years into six.
  */
  const overlapping = summariseTenure(p([role("2023-01", "2024-12"), role("2023-06", "2024-06")], []));
  check(
    "concurrent roles count once",
    overlapping.professionalMonths === 24,
    `${overlapping.professionalMonths} months`,
  );

  // A job ending in March and the next starting in April is continuous.
  const backToBack = summariseTenure(p([role("2023-01", "2023-03"), role("2023-04", "2023-06")], []));
  check("consecutive roles leave no gap", backToBack.gaps.length === 0);
  check("and their months add up", backToBack.professionalMonths === 6, `${backToBack.professionalMonths}`);

  /*
    The point of the whole file: a degree is not a gap, and it is not work
    experience either. Both numbers have to be available separately.
  */
  const withStudy = summariseTenure(p([role("2024-01", "2024-12")], [course("2020", "2023")]));
  check("study does not inflate the professional figure", withStudy.professionalMonths === 12);
  check(
    "but it does fill the timeline",
    withStudy.accountedMonths > withStudy.professionalMonths,
    `${withStudy.accountedMonths} accounted vs ${withStudy.professionalMonths} employed`,
  );
  check("so the years before the first role are not a gap", withStudy.gaps.length === 0);

  // A real gap must still be reported. Papering over one is how an assistant
  // starts making excuses for its subject.
  const realGap = summariseTenure(p([role("2019-01", "2019-06"), role("2024-01", "2024-06")], []));
  check("a genuine gap is still reported", realGap.gaps.length === 1, JSON.stringify(realGap.gaps));

  // Two months between jobs is between things, not a gap anyone asks about.
  const short = summariseTenure(p([role("2023-01", "2023-06"), role("2023-09", "2023-12")], []));
  check("a couple of months between roles is not a gap", short.gaps.length === 0);

  const text = serializeTenure(withStudy);
  check("the block tells the model not to conflate the two", /Never present study as work experience/.test(text));
  check("and names both figures", /Professional experience:/.test(text) && /Continuously accounted for:/.test(text));
}

console.log(failures === 0 ? "\nAll timeline checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
