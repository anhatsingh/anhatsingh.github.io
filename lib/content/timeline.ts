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

export interface TimelineEntry {
  item: Experience;
  months: number;
  duration: string;
  range: string;
  /**
   * Quarters of empty time between this role's end and the *next* role down
   * (the previous one chronologically). Drives the spacing, so the gap between
   * two cards reflects the gap between two jobs.
   */
  gapQuarters: number;
  /** Whether that gap is worth drawing a marker for. */
  gapLabel: string | null;
}

/*
  Spacing is quantised to three-month steps rather than being purely linear.
  Linear spacing makes a four-year gap push the next role off the screen, and
  makes two roles a month apart collide; quarters keep the proportion legible
  while bounding both ends.
*/
export const QUARTER_GAP_PX = 26;
export const MAX_GAP_QUARTERS = 6;

/**
 * Decorates roles with duration and the gap to the one below them.
 *
 * The incoming order is preserved rather than re-sorted. sort_order is set in
 * the admin panel — including by its "sort by date" control — and re-sorting
 * here would silently override whichever direction was chosen there.
 *
 * Gaps are measured symmetrically between the two adjacent roles' date ranges,
 * so they come out the same whether the list runs newest-first or oldest-first,
 * and a hand-ordered list that isn't chronological simply shows no gaps rather
 * than nonsense ones.
 */
export function buildTimeline(experience: Experience[]): TimelineEntry[] {
  const list = [...experience];

  return list.map((item, i) => {
    const months = durationMonths(item.startDate, item.endDate);
    const next = list[i + 1];

    let gapQuarters = 0;
    let gapLabel: string | null = null;

    if (next) {
      const aStart = monthIndex(item.startDate, false);
      const aEnd = monthIndex(item.endDate);
      const bStart = monthIndex(next.startDate, false);
      const bEnd = monthIndex(next.endDate);

      if (aStart !== null && aEnd !== null && bStart !== null && bEnd !== null) {
        // Clear months between two intervals; negative when they overlap.
        const gapMonths = Math.max(aStart, bStart) - Math.min(aEnd, bEnd) - 1;
        if (gapMonths >= 3) {
          gapQuarters = Math.min(MAX_GAP_QUARTERS, Math.round(gapMonths / 3));
          gapLabel = formatDuration(gapMonths);
        }
      }
    }

    return {
      item,
      months,
      duration: formatDuration(months),
      range: `${formatMonth(item.startDate)} — ${formatMonth(item.endDate)}`,
      gapQuarters,
      gapLabel,
    };
  });
}

/**
 * Newest first, with a hand-set `sort_order` still winning.
 *
 * Applied in the component rather than the query for the same reason the
 * timeline sorts there: it keeps rendering correct regardless of whether the
 * date columns have been migrated in yet, and a few dozen rows cost nothing.
 * Undated projects sink to the bottom rather than jumping to the top.
 */
export function sortProjectsByDate<T extends { started?: string; ended?: string }>(
  projects: T[],
): T[] {
  return [...projects].sort((a, b) => {
    const ai = monthIndex(a.started, false);
    const bi = monthIndex(b.started, false);
    if (ai === null && bi === null) return 0;
    if (ai === null) return 1;
    if (bi === null) return -1;
    return bi - ai;
  });
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
