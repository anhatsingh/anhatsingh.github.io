import { formatDuration, monthIndex, nowIndex } from "@/lib/content/timeline";
import { endIndex, label, merge, total, type Span } from "@/lib/content/tenure";
import { termKey } from "@/lib/content/vocabulary";
import type { Portfolio } from "@/lib/content/types";

/*
  "How much experience does he have with Python?"

  Asked that, the assistant said there was no exact, defensible number and
  listed the places Python appears. It was obeying its instructions: the prompt
  forbids adding up dates unaided, because that is how two roles held at once
  become double the experience. It had no figure to lean on and correctly
  declined to invent one.

  There is a figure. Eight dated entries name Python and their merged spans come
  to two years four months. This computes it — the same argument tenure.ts makes
  for the career total, one level down, sharing that file's span merge rather
  than growing a second one. Two implementations of "count overlapping months
  once" disagree eventually, and the disagreement is a number on a page.

  What it returns is the working, not just the total. A recruiter checks a
  claim like this against the dates rendered in the Experience section, so the
  spans that produced the number travel with it.
*/

export interface SkillSpan {
  /** "experience:slug" — the same id vocabulary highlightItems uses. */
  id: string;
  label: string;
  /** "Jan 2024", or "Present" for something still running. */
  from: string;
  to: string;
  months: number;
}

export interface SkillTenure {
  /** The spelling to display — an existing skill's, where there is one. */
  skill: string;
  /** Whether anything on the site names it at all. */
  found: boolean;
  months: number;
  /** "2 yrs 4 mos". Empty when months is 0, so never render it bare. */
  formatted: string;
  /** Newest first, which is the order a reader expects. */
  spans: SkillSpan[];
  /** Entries that name it but carry no dates. Reported, never guessed at. */
  undated: string[];
  ongoing: boolean;
  /** One honest sentence, for the model to build its answer on. */
  summary: string;
}

/**
 * How long a skill has actually been in use, from the dated record.
 *
 * Matching folds case and whitespace through `termKey`, the same normalisation
 * the skills taxonomy uses. `getSkillEvidence` compares raw lowercase instead,
 * so a trailing space in a tech list silently fails to match there — worth
 * knowing, and worth not repeating.
 */
export function skillTenure(portfolio: Portfolio, skill: string): SkillTenure {
  const needle = termKey(skill);
  if (!needle) {
    return { skill, found: false, months: 0, formatted: "", spans: [], undated: [], ongoing: false, summary: "" };
  }

  // An existing skill's own spelling beats however the visitor typed it.
  const known = portfolio.skills.find((s) => termKey(s.name) === needle);
  const display = known?.name ?? skill.trim();

  const spans: SkillSpan[] = [];
  const undated: string[] = [];
  const raw: Span[] = [];
  let ongoing = false;

  const names = (tech: string[]) => tech.some((t) => termKey(t) === needle);

  for (const role of portfolio.experience) {
    if (!names(role.tech ?? [])) continue;

    const start = monthIndex(role.startDate, false);
    if (start === null) {
      undated.push(`${role.role} at ${role.company}`);
      continue;
    }

    /*
      A null endDate means "still there", and monthIndex resolves that to now —
      which is what we want here, unlike a missing START date below.
    */
    const running = !role.endDate;
    const end = running ? nowIndex() : endIndex(role.endDate);
    if (end === null || end < start) {
      undated.push(`${role.role} at ${role.company}`);
      continue;
    }

    if (running) ongoing = true;
    raw.push({ start, end });
    spans.push({
      id: `experience:${role.slug}`,
      label: `${role.role} at ${role.company}`,
      from: label(start),
      to: running ? "Present" : label(end),
      months: end - start + 1,
    });
  }

  for (const project of portfolio.projects) {
    if (!names(project.tech ?? [])) continue;

    /*
      fallbackNow off, deliberately. monthIndex(null) returns TODAY, so a
      project with no start date would become a span from now to now — a
      zero-length row that quietly drags the earliest date forward. Project
      dates are both optional, so this is the common case, not the exotic one.
    */
    const start = monthIndex(project.started ?? null, false);
    if (start === null) {
      undated.push(project.name);
      continue;
    }

    const end = project.ended ? endIndex(project.ended) : nowIndex();
    if (end === null || end < start) {
      undated.push(project.name);
      continue;
    }

    if (!project.ended) ongoing = true;
    raw.push({ start, end });
    spans.push({
      id: `projects:${project.slug}`,
      label: project.name,
      from: label(start),
      to: project.ended ? label(end) : "Present",
      months: end - start + 1,
    });
  }

  /*
    Whether the site knows the term at all, which is a different answer from
    knowing it and having no dates. "Machine Learning" is a listed skill no
    entry is tagged with; "Fortran" is nothing. Telling a visitor the second is
    the first would be a small lie about the shape of the record.
  */
  const listed = Boolean(known);
  const months = total(merge(raw));
  spans.sort((a, b) => b.months - a.months);

  return {
    skill: display,
    found: spans.length > 0 || undated.length > 0,
    months,
    formatted: formatDuration(months),
    spans,
    undated,
    ongoing,
    summary: summarise(display, months, spans.length, undated.length, ongoing, listed),
  };
}

/*
  The sentence the model answers from.

  Every branch says something true and usable. The empty case matters most:
  formatDuration(0) returns an empty string, so a skill nothing dated uses would
  otherwise produce a blank where a number should be — and several will, since
  "Machine Learning" is listed and appears on no dated entry at all.
*/
function summarise(
  skill: string,
  months: number,
  spanCount: number,
  undatedCount: number,
  ongoing: boolean,
  listed: boolean,
): string {
  const extra =
    undatedCount > 0
      ? ` ${undatedCount} further ${undatedCount === 1 ? "entry uses it but carries" : "entries use it but carry"} no dates, so ${undatedCount === 1 ? "it is" : "they are"} not counted.`
      : "";

  if (spanCount === 0) {
    if (undatedCount > 0) {
      return `${skill} is used on the site, but nothing that names it carries dates, so there is no figure to give.`;
    }
    return listed
      ? `${skill} is listed as a skill, but no job or project on the site is tagged with it, so there is no duration to report. Say that plainly rather than estimating.`
      : `Nothing on the site mentions ${skill} at all. Say so rather than reaching for something adjacent.`;
  }

  return (
    `${skill}: ${formatDuration(months)} across ${spanCount} dated ${spanCount === 1 ? "entry" : "entries"}, ` +
    `overlapping months counted once${ongoing ? ", and still in use" : ""}.` +
    extra
  );
}
