import { formatDuration, monthIndex } from "@/lib/content/timeline";
import type { Portfolio } from "@/lib/content/types";

/*
  "How many years of experience does he have?"

  A model asked this from a list of dated entries does arithmetic, and does it
  badly: it double-counts two roles that ran at the same time, it treats a
  degree as a job or ignores it entirely, and it reads a stretch with no
  employment as a gap it then has to explain or hide. All three answers are
  wrong in ways a recruiter checks.

  So the arithmetic happens here and the model is handed the results. Three
  numbers, and the distinction between them is the whole point:

    professional  — months actually employed, overlaps merged
    accounted     — months either employed OR studying
    unexplained   — months that are neither

  What this must NOT do is inflate the first by folding study into it. A degree
  is not work experience, a recruiter will find out in the interview, and the
  assistant's honesty is the only reason anyone trusts what it says about him.
  Education is here to explain the shape of the timeline, not to pad it.
*/

export interface Tenure {
  /** Months employed, with concurrent roles counted once. */
  professionalMonths: number;
  /** "2 yrs 7 mos" — same phrasing the timeline cards use. */
  professional: string;
  /** Months either employed or studying. */
  accountedMonths: number;
  accounted: string;
  /** Stretches with neither, if any. Empty is the normal case. */
  gaps: Array<{ from: string; to: string; months: number }>;
  /** When the record starts — the earliest of any dated thing. */
  since: string | null;
}

interface Span {
  start: number;
  end: number;
}

/*
  A bare year means different things at each end of a span.

  "2023" as a start is January 2023, which monthIndex already gives. As an END
  it means the year finished — a degree recorded as ending "2023" did not stop
  on the 1st of January. Reading it as January invents an eleven-month hole
  immediately before the first job, which is the exact gap this file exists to
  avoid claiming.

  Education is the common case since it is stored as bare years, but an
  experience row typed as a year has the same problem.
*/
function endIndex(value: string | null | undefined): number | null {
  const index = monthIndex(value ?? null);
  if (index === null) return null;
  return /^\d{4}$/.test((value ?? "").trim()) ? index + 11 : index;
}

/** Merges overlapping spans so concurrent things count once. */
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];

  for (const span of sorted) {
    const last = out[out.length - 1];
    // Adjacent months are continuous, not two spans with a hole between them:
    // a job ending in March and the next starting in April is not a gap.
    if (last && span.start <= last.end + 1) last.end = Math.max(last.end, span.end);
    else out.push({ ...span });
  }
  return out;
}

const total = (spans: Span[]) => spans.reduce((n, s) => n + (s.end - s.start + 1), 0);

/** Month index back to "Mar 2024", for naming a gap in prose. */
function label(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month]} ${year}`;
}

export function summariseTenure(portfolio: Portfolio): Tenure {
  const work: Span[] = [];
  for (const role of portfolio.experience) {
    const start = monthIndex(role.startDate);
    // A null endDate means "present", which monthIndex resolves to now.
    const end = endIndex(role.endDate ?? null);
    if (start !== null && end !== null && end >= start) work.push({ start, end });
  }

  const study: Span[] = [];
  for (const course of portfolio.education) {
    const start = monthIndex(course.startYear);
    const end = endIndex(course.endYear);
    if (start !== null && end !== null && end >= start) study.push({ start, end });
  }

  const employed = merge(work);
  const covered = merge([...work, ...study]);

  /*
    Gaps are found in the combined timeline, not the working one. A year spent
    on a degree is not a gap, and reporting it as one is what makes an
    assistant sound like it is making excuses for its subject.
  */
  const gaps: Tenure["gaps"] = [];
  for (let i = 1; i < covered.length; i++) {
    const from = covered[i - 1].end + 1;
    const to = covered[i].start - 1;
    const months = to - from + 1;
    // Under three months is between things, not a gap anybody asks about.
    if (months >= 3) gaps.push({ from: label(from), to: label(to), months });
  }

  const earliest = covered[0]?.start;

  return {
    professionalMonths: total(employed),
    professional: formatDuration(total(employed)),
    accountedMonths: total(covered),
    accounted: formatDuration(total(covered)),
    gaps,
    since: earliest === undefined ? null : label(earliest),
  };
}

/** The block that goes into the model's context. */
export function serializeTenure(tenure: Tenure): string {
  const lines = [
    `Professional experience: ${tenure.professional} (${tenure.professionalMonths} months employed, concurrent roles counted once).`,
    `Continuously accounted for: ${tenure.accounted} since ${tenure.since ?? "the first dated entry"} — every month of that is either a role or full-time study.`,
  ];

  if (tenure.gaps.length) {
    lines.push(
      `Unaccounted stretches: ${tenure.gaps
        .map((g) => `${g.from} to ${g.to} (${g.months} months)`)
        .join("; ")}. Don't invent a reason for these.`,
    );
  } else {
    lines.push(`There are no unexplained gaps in the timeline.`);
  }

  lines.push(
    `Answer "how many years of experience" with the professional figure. Then account for the rest of the timeline with the education that fills it, so nothing reads as an unexplained gap. Never present study as work experience — that is checked in interviews and getting it wrong costs more than the extra year gains.`,
  );

  return `## TIMELINE\n${lines.join("\n")}`;
}
