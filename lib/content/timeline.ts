import type { Experience } from "./types";

/*
  Date maths for the experience timeline.

  Kept out of the component so it can be tested directly: the failure mode here
  is silent and ugly rather than loud — an off-by-one in the month arithmetic
  doesn't throw, it just draws a timeline that misrepresents how long someone
  worked somewhere.

  Dates arrive as "YYYY-MM" or "YYYY" because that is what LinkedIn exports and
  what the admin form asks for. A missing end date means "present".
*/

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Months since an arbitrary epoch, so two dates can be subtracted.
 *
 * Accepts more than one shape on purpose. "YYYY-MM" is what the admin form
 * asks for, but real rows also hold "2021" from LinkedIn's year-granular
 * education dates and "Nov 1, 2015" from certification issuers. Returning null
 * for those would not throw — it would quietly file a dated row as undated and
 * sink it to the bottom of the section, which is exactly the kind of wrong
 * nobody notices.
 */
export function monthIndex(value: string | null | undefined, fallbackNow = true): number | null {
  if (!value) return fallbackNow ? nowIndex() : null;
  const raw = value.trim();
  if (!raw) return fallbackNow ? nowIndex() : null;

  // "2024-03", "2024-3", "2024"
  const iso = raw.match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (iso) {
    const year = Number(iso[1]);
    // A bare year is treated as January, which is the only defensible guess
    // and matches how the year label renders.
    const month = iso[2] ? Number(iso[2]) : 1;
    if (month < 1 || month > 12) return year * 12;
    return year * 12 + (month - 1);
  }

  // "Nov 2015", "November 1, 2015", "Nov 1 2015"
  const named = raw.match(/^([A-Za-z]{3,})\.?\s+(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?(\d{4})$/);
  if (named) {
    const month = MONTH_NAMES[named[1].slice(0, 3).toLowerCase()];
    if (month) return Number(named[2]) * 12 + (month - 1);
  }

  return null;
}

/*
  `new Date()` is deliberately the only clock reference, and it is read at call
  time rather than module load so a long-lived server process doesn't freeze
  "present" at whenever it booted.
*/
function nowIndex(): number {
  const d = new Date();
  return d.getFullYear() * 12 + d.getMonth();
}

/** Whole months covered by a role, counting both endpoints. */
export function durationMonths(start: string, end: string | null): number {
  const a = monthIndex(start, false);
  const b = monthIndex(end);
  if (a === null || b === null) return 0;
  return Math.max(1, b - a + 1);
}

/** "1 yr 3 mos", "8 mos", "2 yrs". Empty when the dates don't parse. */
export function formatDuration(months: number): string {
  if (months <= 0) return "";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years) parts.push(`${years} yr${years === 1 ? "" : "s"}`);
  if (rest) parts.push(`${rest} mo${rest === 1 ? "" : "s"}`);
  return parts.join(" ");
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2024-03" → "Mar 2024"; "2024" → "2024"; null → "Present". */
export function formatMonth(value: string | null | undefined): string {
  if (!value) return "Present";
  const m = value.trim().match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (!m) return value;
  if (!m[2]) return m[1];
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${MONTH_LABELS[idx]} ${m[1]}` : m[1];
}

/** One role, with its own dates and duration. */
export interface TimelineRole {
  item: Experience;
  months: number;
  duration: string;
  range: string;
}

/**
 * Consecutive roles at one employer, presented as a single tenure.
 *
 * Two rows for the same company read as two unrelated jobs, which undersells a
 * promotion and makes the timeline look busier than the career was. Grouping is
 * limited to *consecutive* rows on purpose: returning to an employer years
 * later is a different thing, and collapsing that would hide the gap between.
 */
export interface TimelineGroup {
  company: string;
  companyUrl?: string;
  logoUrl?: string;
  location?: string;
  roles: TimelineRole[];
  /** Across every role in the group. */
  range: string;
  duration: string;
  /** True when the most recent role has no end date. */
  current: boolean;
}

function describeRole(item: Experience): TimelineRole {
  const months = durationMonths(item.startDate, item.endDate);
  return {
    item,
    months,
    duration: formatDuration(months),
    range: `${formatMonth(item.startDate)} — ${formatMonth(item.endDate)}`,
  };
}

/**
 * Groups the experience list into employers, preserving the given order.
 *
 * The order is not re-derived here: sort_order is set in the admin panel,
 * including by its "sort by date" control, and re-sorting would silently
 * override whichever direction was chosen there.
 */
export function buildTimeline(experience: Experience[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];

  for (const item of experience) {
    const last = groups[groups.length - 1];

    if (last && last.company === item.company) {
      last.roles.push(describeRole(item));
      continue;
    }

    groups.push({
      company: item.company,
      companyUrl: item.companyUrl,
      logoUrl: item.logoUrl,
      location: item.location,
      roles: [describeRole(item)],
      range: "",
      duration: "",
      current: false,
    });
  }

  for (const group of groups) {
    /*
      The tenure spans the whole group, which is not the sum of its roles —
      overlapping or back-to-back roles would double-count, and a promotion
      mid-month would add a month that never happened.
    */
    const starts = group.roles.map((r) => monthIndex(r.item.startDate, false)).filter((v): v is number => v !== null);
    const ongoing = group.roles.some((r) => !r.item.endDate);
    const ends = group.roles.map((r) => monthIndex(r.item.endDate)).filter((v): v is number => v !== null);

    const first = starts.length ? Math.min(...starts) : null;
    const lastEnd = ends.length ? Math.max(...ends) : null;

    group.current = ongoing;
    group.duration = first !== null && lastEnd !== null ? formatDuration(Math.max(1, lastEnd - first + 1)) : "";

    // Earliest start to latest end, whichever rows those came from.
    const earliest = group.roles.reduce((a, b) =>
      (monthIndex(a.item.startDate, false) ?? 0) <= (monthIndex(b.item.startDate, false) ?? 0) ? a : b,
    );
    const latest = group.roles.reduce((a, b) =>
      (monthIndex(a.item.endDate) ?? 0) >= (monthIndex(b.item.endDate) ?? 0) ? a : b,
    );
    group.range = `${formatMonth(earliest.item.startDate)} — ${formatMonth(latest.item.endDate)}`;
  }

  return groups;
}

/**
 * Row ids in date order, for renumbering sort_order.
 *
 * Shared by the admin action and scripts/reorder-by-date.ts so the two can't
 * drift — a script that ordered rows differently from the button would be a
 * genuinely confusing bug to chase.
 *
 * Undated rows sink to the bottom in both directions: they have no position on
 * a timeline, and floating them to the top in ascending order would lead with
 * the least-known entries.
 */
export function orderByDate(
  rows: Array<Record<string, unknown>>,
  dateField: string,
  direction: "asc" | "desc",
): string[] {
  return rows
    .map((r) => ({ id: String(r.id), at: monthIndex(r[dateField] as string, false) }))
    .sort((a, b) => {
      if (a.at === null && b.at === null) return 0;
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      return direction === "desc" ? b.at - a.at : a.at - b.at;
    })
    .map((r) => r.id);
}
