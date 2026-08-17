import { monthIndex } from "./timeline";
import { entityPath, type Portfolio } from "./types";

/*
  Layout for the life graph in the About section.

  A git network diagram: one continuous track along time, with every entry
  drawn as its own branch. One dot is one month, fixed — so distance on screen
  is distance in time, a four-year degree is visibly four times a one-year job,
  and two things that ran at once are visibly concurrent.

  Two rules drive the shape:

  1. Bars never overlap. Entries are packed into rows so that no row ever
     holds two bars running at the same time — the standard greedy interval
     packing. Where life ran in parallel, the track forks, which is what a
     network graph is for.

     Only the bars count. Two spans that merely touch — one ending the month
     another begins — share a row, and so do the end nodes and the text
     labels, which are allowed to sit close or overlap. Forking for those
     spent a whole row on a near-miss and made the graph far taller than the
     data warranted.

     Packing runs per section rather than across everything, so a section's
     entries stay together vertically the way a Gantt chart groups its rows.
     A section is therefore as tall as its own busiest moment, and the reader
     can find all the jobs without hunting between certificates.

  2. Every entry has its own colour. Colouring by category would put four
     concurrent jobs in one indistinguishable colour, which defeats the point
     of forking them apart in the first place.

  All geometry is computed here rather than in the component, because it is the
  part that can be wrong without anything throwing — packing that lets two bars
  share a row draws them on top of each other, and nothing errors.
*/

export type ItemKind = "education" | "experience" | "projects" | "certifications" | "testimonials";

/*
  Line style per kind, so the category is readable without spending colour on
  it — colour now identifies the individual entry. Points (certificates,
  recommendations) draw no line at all, so they take no pattern.

  Values are SVG stroke-dasharray strings; empty means solid. With a round
  linecap, "1 7" renders as a row of dots rather than short dashes.
*/
export const KIND_DASH: Record<ItemKind, string> = {
  experience: "",
  education: "11 5",
  projects: "1 7",
  certifications: "",
  testimonials: "",
};

/** Top-to-bottom order of the bands. Longest-running kinds first. */
export const KIND_ORDER: ItemKind[] = [
  "education",
  "experience",
  "projects",
  "certifications",
  "testimonials",
];

/*
  Two label sets on purpose. The caption names one entry — "Project · Nov 2024"
  — while a band heads a whole group of them, so it reads plural.
*/
export const KIND_GROUP_LABELS: Record<ItemKind, string> = {
  education: "Education",
  experience: "Experience",
  projects: "Projects",
  certifications: "Certificates",
  testimonials: "Recommendations",
};

export const KIND_LABELS: Record<ItemKind, string> = {
  education: "Education",
  experience: "Experience",
  projects: "Project",
  certifications: "Certificate",
  testimonials: "Recommendation",
};

export interface GraphItem {
  id: string;
  kind: ItemKind;
  label: string;
  detail?: string;
  href?: string;
  /** Absolute month indices, inclusive. */
  startMonth: number;
  endMonth: number;
  /** True when this is a moment rather than a span — a certificate, a review. */
  isPoint: boolean;
  /**
   * Whether the source actually recorded an end. An ongoing role's endMonth is
   * today's month, which is derived rather than known — drawing a terminating
   * node there would claim the job has finished.
   */
  hasEnd: boolean;
  /** Column offsets from the track's origin. */
  startCol: number;
  endCol: number;
  /** Packed row. 0 is the top branch. */
  lane: number;
  /** Degrees on the colour wheel; the component turns this into a colour. */
  hue: number;
}

/** A section's band: which rows it occupies, in display order. */
export interface Group {
  kind: ItemKind;
  label: string;
  /** First global row of this band. */
  firstLane: number;
  /** Rows this band needs — its own busiest concurrency. */
  lanes: number;
}

export interface Graph {
  items: GraphItem[];
  /** Bands, top to bottom. Only sections with entries appear. */
  groups: Group[];
  /** Total rows across every band. */
  lanes: number;
  /** Absolute month index of column 0. */
  originMonth: number;
  totalMonths: number;
  /** Every January in range, for gridlines and the axis. */
  yearTicks: Array<{ col: number; label: string }>;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthLabel(index: number): string {
  return `${MONTHS[index % 12]} ${Math.floor(index / 12)}`;
}

/*
  The golden angle. Stepping hues by 137.5 degrees spreads any number of
  colours about as evenly as possible around the wheel, and — unlike dividing
  360 by the count — consecutive entries land far apart, so two branches that
  begin near each other never come out near-identical.
*/
const GOLDEN_ANGLE = 137.508;

type Collected = Omit<GraphItem, "startCol" | "endCol" | "lane" | "hue">;

/** Everything with a date, in one shape, oldest first. */
export function collectItems(portfolio: Portfolio, now: number): Collected[] {
  const items: Collected[] = [];

  for (const e of portfolio.education) {
    const start = monthIndex(e.startYear, false);
    if (start === null) continue;
    // A blank end year is a missing field far more often than a course someone
    // is still attending, so it does not run to today.
    const end = monthIndex(e.endYear, false) ?? start;
    items.push({
      id: `education:${e.slug}`, kind: "education",
      label: e.degree || e.institution, detail: e.institution,
      startMonth: start, endMonth: Math.max(start, end), isPoint: false,
      hasEnd: Boolean(e.endYear),
      // Clickable now that a degree can have a page, the way a certification
      // already was. Only where one exists.
      ...(e.body?.length ? { href: entityPath("education", e.slug) } : {}),
    });
  }

  for (const e of portfolio.experience) {
    const start = monthIndex(e.startDate, false);
    if (start === null) continue;
    // A blank end date here really does mean "present".
    const end = e.endDate ? (monthIndex(e.endDate, false) ?? now) : now;
    items.push({
      id: `experience:${e.slug}`, kind: "experience",
      label: e.role, detail: e.company,
      startMonth: start, endMonth: Math.max(start, end), isPoint: false,
      hasEnd: Boolean(e.endDate),
      href: entityPath("experience", e.slug),
    });
  }

  for (const p of portfolio.projects) {
    const start = monthIndex(p.started, false);
    if (start === null) continue;
    const end = monthIndex(p.ended, false) ?? start;
    items.push({
      id: `projects:${p.slug}`, kind: "projects",
      label: p.name,
      startMonth: start, endMonth: Math.max(start, end), isPoint: false,
      hasEnd: Boolean(p.ended),
      href: entityPath("projects", p.slug),
    });
  }

  for (const c of portfolio.certifications) {
    const at = monthIndex(c.issueDate, false);
    if (at === null) continue;
    items.push({
      id: `certifications:${c.slug}`, kind: "certifications",
      label: c.name, detail: c.issuer,
      startMonth: at, endMonth: at, isPoint: true, hasEnd: false,
      href: entityPath("certifications", c.slug),
    });
  }

  for (const t of portfolio.testimonials) {
    const at = monthIndex(t.receivedAt, false);
    if (at === null) continue;
    items.push({
      id: `testimonials:${t.slug}`, kind: "testimonials",
      label: t.authorName, detail: t.authorCompany ?? t.authorTitle,
      startMonth: at, endMonth: at, isPoint: true, hasEnd: false,
    });
  }

  return items.sort((a, b) =>
    a.startMonth - b.startMonth || b.endMonth - a.endMonth || a.id.localeCompare(b.id),
  );
}

export interface BuildOptions {
  now: number;
}

/**
 * Packs every dated entry onto a non-overlapping track.
 *
 * `now` is supplied rather than read from the clock so the layout is
 * deterministic and testable.
 */
export function buildGraph(portfolio: Portfolio, { now }: BuildOptions): Graph {
  const collected = collectItems(portfolio, now);

  if (!collected.length) {
    return { items: [], groups: [], lanes: 0, originMonth: now, totalMonths: 0, yearTicks: [] };
  }

  const first = Math.min(...collected.map((i) => i.startMonth));
  const last = Math.max(...collected.map((i) => i.endMonth), now);

  // Start on a January so the year gridlines land on column boundaries.
  const originMonth = Math.floor(first / 12) * 12;
  const totalMonths = last - originMonth + 1;

  /*
    Hues are assigned over the whole set, in date order, before the split into
    sections — so neighbouring entries differ sharply wherever they end up,
    rather than each band restarting from the same corner of the wheel.
  */
  const hues = new Map(collected.map((item, index) => [item.id, (index * GOLDEN_ANGLE) % 360]));

  /*
    Greedy first-fit packing, run once per section. Entries are already sorted
    by start, so walking them in order and dropping each into the first row
    that has come free is optimal in the number of rows used.

    `laneNextFree[i]` is the first column in row i that nothing occupies.
  */
  const items: GraphItem[] = [];
  const groups: Group[] = [];
  let firstLane = 0;

  for (const kind of KIND_ORDER) {
    const inKind = collected.filter((i) => i.kind === kind);
    if (!inKind.length) continue;

    /*
      `laneEnd[i]` is the last column row i's occupant covers.

      A new entry joins that row when it starts at or after that column AND
      finishes strictly later. The first half lets a span begin the month the
      previous one ended — a touch, not an overlap, and not worth a row. The
      second half is what stops two entries occupying exactly the same columns:
      a certificate and a test score issued in the same month have no length to
      overlap, but drawing them on one row puts both nodes and both labels at
      the same pixel and one of them simply disappears.
    */
    const laneEnd: number[] = [];

    for (const item of inKind) {
      const startCol = item.startMonth - originMonth;
      const endCol = item.endMonth - originMonth;

      let lane = laneEnd.findIndex((end) => end <= startCol && endCol > end);
      if (lane === -1) {
        lane = laneEnd.length;
        laneEnd.push(0);
      }
      laneEnd[lane] = endCol;

      items.push({
        ...item,
        startCol,
        endCol,
        lane: firstLane + lane,
        hue: hues.get(item.id) ?? 0,
      });
    }

    groups.push({ kind, label: KIND_GROUP_LABELS[kind], firstLane, lanes: laneEnd.length });
    firstLane += laneEnd.length;
  }

  const yearTicks: Array<{ col: number; label: string }> = [];
  for (let m = 0; m < totalMonths; m++) {
    if ((originMonth + m) % 12 === 0) {
      yearTicks.push({ col: m, label: String(Math.floor((originMonth + m) / 12)) });
    }
  }

  return { items, groups, lanes: firstLane, originMonth, totalMonths, yearTicks };
}

/** "Mar 2021 — Present" for the caption. */
export function itemRange(
  item: { startMonth: number; endMonth: number; isPoint: boolean },
  now: number,
): string {
  const start = monthLabel(item.startMonth);
  if (item.isPoint) return start;
  if (item.endMonth >= now) return `${start} — Present`;
  return `${start} — ${monthLabel(item.endMonth)}`;
}
