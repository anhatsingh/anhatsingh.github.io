import { monthIndex } from "./timeline";
import { entityPath, type Portfolio } from "./types";

/*
  Layout for the life graph in the About section.

  The shape is a git network diagram: a trunk running along time, with each
  kind of thing on its own coloured branch. One dot is one month, fixed — so
  distance on screen is distance in time, and a four-year degree is visibly
  four times a one-year job. That's the whole point of it, and it's also why
  the layout can't simply space things evenly.

  Twenty-two years of history at one dot per month is 260-odd dots, far past
  any screen. So the track snakes: it runs left to right, drops a band, then
  runs right to left, like a train switching back on itself. Reversing every
  other row rather than always restarting on the left keeps the line
  continuous, so time never appears to jump backwards.

  All geometry is computed here rather than in the component, because it is the
  part that can be wrong without anything throwing — a row that wraps a month
  early draws a graph that simply misdates someone's life.
*/

export type LaneKey = "education" | "experience" | "projects" | "certifications" | "testimonials";

export interface Lane {
  key: LaneKey;
  label: string;
  /** CSS custom property holding this branch's colour. */
  varName: string;
}

/*
  Ordered from the longest-running to the most occasional, so the branches that
  span years sit nearest the trunk and the single-point ones sit outermost.
  Colours are defined as CSS variables so both themes can tune them; see
  app/globals.css.
*/
export const LANES: Lane[] = [
  { key: "education", label: "Education", varName: "--graph-education" },
  { key: "experience", label: "Experience", varName: "--graph-experience" },
  { key: "projects", label: "Projects", varName: "--graph-projects" },
  { key: "certifications", label: "Certificates", varName: "--graph-certifications" },
  { key: "testimonials", label: "Recommendations", varName: "--graph-testimonials" },
];

export interface GraphItem {
  id: string;
  lane: LaneKey;
  label: string;
  /** Absolute month index of the start, and of the end (inclusive). */
  startMonth: number;
  endMonth: number;
  /** True when this is a moment rather than a span — a certificate, a review. */
  isPoint: boolean;
  href?: string;
  detail?: string;
}

/** A run of one item within a single row of the snake. */
export interface Segment {
  itemId: string;
  lane: LaneKey;
  row: number;
  /** Column indices within the row, inclusive, already in draw order. */
  fromCol: number;
  toCol: number;
  /** Whether this row runs right-to-left. */
  reversed: boolean;
  /** True when the item begins in this row, so only one label is drawn. */
  isStart: boolean;
}

export interface Graph {
  items: GraphItem[];
  segments: Segment[];
  rows: number;
  monthsPerRow: number;
  /** Absolute month index that column 0 of row 0 represents. */
  originMonth: number;
  totalMonths: number;
  /** Year label for each row's first column, for the axis. */
  rowYears: Array<{ row: number; label: string }>;
  lanes: Lane[];
}

function monthLabel(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][month]} ${year}`;
}

/** Pulls everything with a date out of the portfolio, in one shape. */
export function collectItems(portfolio: Portfolio, now: number): GraphItem[] {
  const items: GraphItem[] = [];

  for (const e of portfolio.education) {
    const start = monthIndex(e.startYear, false);
    if (start === null) continue;
    // An education row with no end year is treated as finished at its start
    // rather than as ongoing — a school with a blank end is far more often a
    // missing field than a course someone is still attending.
    const end = monthIndex(e.endYear, false) ?? start;
    items.push({
      id: `education:${e.slug}`,
      lane: "education",
      label: e.degree || e.institution,
      detail: e.institution,
      startMonth: start,
      endMonth: Math.max(start, end),
      isPoint: false,
    });
  }

  for (const e of portfolio.experience) {
    const start = monthIndex(e.startDate, false);
    if (start === null) continue;
    // A blank end date here really does mean "present" — that's what the
    // section renders it as.
    const end = e.endDate ? (monthIndex(e.endDate, false) ?? now) : now;
    items.push({
      id: `experience:${e.slug}`,
      lane: "experience",
      label: e.role,
      detail: e.company,
      startMonth: start,
      endMonth: Math.max(start, end),
      isPoint: false,
      href: entityPath("experience", e.slug),
    });
  }

  for (const p of portfolio.projects) {
    const start = monthIndex(p.started, false);
    if (start === null) continue;
    const end = monthIndex(p.ended, false) ?? start;
    items.push({
      id: `projects:${p.slug}`,
      lane: "projects",
      label: p.name,
      startMonth: start,
      endMonth: Math.max(start, end),
      isPoint: false,
      href: entityPath("projects", p.slug),
    });
  }

  for (const c of portfolio.certifications) {
    const at = monthIndex(c.issueDate, false);
    if (at === null) continue;
    items.push({
      id: `certifications:${c.slug}`,
      lane: "certifications",
      label: c.name,
      detail: c.issuer,
      startMonth: at,
      endMonth: at,
      isPoint: true,
      href: entityPath("certifications", c.slug),
    });
  }

  for (const t of portfolio.testimonials) {
    const at = monthIndex(t.receivedAt, false);
    if (at === null) continue;
    items.push({
      id: `testimonials:${t.slug}`,
      lane: "testimonials",
      label: t.authorName,
      detail: t.authorCompany ?? t.authorTitle,
      startMonth: at,
      endMonth: at,
      isPoint: true,
    });
  }

  return items.sort((a, b) => a.startMonth - b.startMonth);
}

/**
 * Wraps every item onto the snake and returns the full drawing plan.
 *
 * `now` is passed in rather than read from the clock so the layout is
 * deterministic and testable; the caller supplies the real current month.
 */
export function buildGraph(
  portfolio: Portfolio,
  { monthsPerRow, now }: { monthsPerRow: number; now: number },
): Graph {
  const items = collectItems(portfolio, now);

  if (!items.length) {
    return {
      items: [], segments: [], rows: 0, monthsPerRow,
      originMonth: now, totalMonths: 0, rowYears: [], lanes: LANES,
    };
  }

  const first = Math.min(...items.map((i) => i.startMonth));
  const last = Math.max(...items.map((i) => i.endMonth), now);

  // Start each row on a January so the year labels line up with the grid
  // instead of reading "Mar 2004" down the left edge.
  const originMonth = Math.floor(first / 12) * 12;
  const totalMonths = last - originMonth + 1;
  const rows = Math.ceil(totalMonths / monthsPerRow);

  const segments: Segment[] = [];

  for (const item of items) {
    const from = item.startMonth - originMonth;
    const to = item.endMonth - originMonth;

    const firstRow = Math.floor(from / monthsPerRow);
    const lastRow = Math.floor(to / monthsPerRow);

    for (let row = firstRow; row <= lastRow; row++) {
      const rowStart = row * monthsPerRow;
      const a = Math.max(from, rowStart) - rowStart;
      const b = Math.min(to, rowStart + monthsPerRow - 1) - rowStart;
      const reversed = row % 2 === 1;

      segments.push({
        itemId: item.id,
        lane: item.lane,
        row,
        // Columns are stored in visual order, so a consumer never has to know
        // which rows are reversed to draw a left-to-right rectangle.
        fromCol: reversed ? monthsPerRow - 1 - b : a,
        toCol: reversed ? monthsPerRow - 1 - a : b,
        reversed,
        isStart: row === firstRow,
      });
    }
  }

  const rowYears = Array.from({ length: rows }, (_, row) => ({
    row,
    label: monthLabel(originMonth + row * monthsPerRow).split(" ")[1],
  }));

  return { items, segments, rows, monthsPerRow, originMonth, totalMonths, rowYears, lanes: LANES };
}

/** "Mar 2021 — Present" for a tooltip. */
export function itemRange(item: GraphItem, now: number): string {
  const start = monthLabel(item.startMonth);
  if (item.isPoint) return start;
  if (item.endMonth >= now) return `${start} — Present`;
  return `${start} — ${monthLabel(item.endMonth)}`;
}
