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

/** Months since an arbitrary epoch, so two dates can be subtracted. */
export function monthIndex(value: string | null | undefined, fallbackNow = true): number | null {
  if (!value) return fallbackNow ? nowIndex() : null;
  const m = value.trim().match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (!m) return null;
  const year = Number(m[1]);
  // A bare year is treated as January, which is the only defensible guess and
  // matches how the year label renders.
  const month = m[2] ? Number(m[2]) : 1;
  if (month < 1 || month > 12) return year * 12;
  return year * 12 + (month - 1);
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
 * Newest first, with the gap to the next-oldest role measured for each entry.
 * Input order is not trusted — the caller's sort is a database concern and this
 * has to be right regardless.
 */
export function buildTimeline(experience: Experience[]): TimelineEntry[] {
  const sorted = [...experience].sort((a, b) => {
    const ai = monthIndex(a.startDate, false) ?? 0;
    const bi = monthIndex(b.startDate, false) ?? 0;
    return bi - ai;
  });

  return sorted.map((item, i) => {
    const months = durationMonths(item.startDate, item.endDate);
    const next = sorted[i + 1];

    let gapQuarters = 0;
    let gapLabel: string | null = null;

    if (next) {
      const thisStart = monthIndex(item.startDate, false);
      const nextEnd = monthIndex(next.endDate);
      if (thisStart !== null && nextEnd !== null) {
        const gapMonths = thisStart - nextEnd - 1;
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
