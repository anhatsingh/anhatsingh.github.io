import { unsupportedCharacters } from "./render";
import type { Resume } from "./schema";

/*
  What an ATS actually gets, checked against what was written.

  A resume can compile perfectly and still be broken for its only real reader:
  a parser that reads the PDF's text layer. Every failure in that gap is
  silent — a bullet that didn't make it, a heading a parser can't match, an
  escape sequence printed literally. The page looks right and the application
  is worse for it.

  So the generated PDF is read back and compared to the object it came from.
  These checks are deterministic and run before any model is asked anything:
  they are cheap, they never disagree with themselves, and they catch the
  mechanical failures precisely. The model's judgement is reserved for what
  cannot be checked this way — see confirmFidelity in lib/ai/resume.ts.
*/

export interface AuditFinding {
  /** error blocks a save unless overridden; warning is worth reading. */
  severity: "error" | "warning";
  check: string;
  detail: string;
}

/*
  A check that ran, whether or not it found anything.

  Findings alone only ever describe failure, so a clean audit produced silence
  — indistinguishable from an audit that never ran. That is the wrong shape for
  something whose whole job is assurance: "12 checks, nothing wrong" is worth
  saying out loud, and "0 checks" is worth being able to notice.

  Recorded as the audit runs rather than derived afterwards, so a check added
  later cannot quietly go unreported.
*/
export interface AuditStep {
  check: string;
  /** What was examined, in words a human reads once and understands. */
  label: string;
  /** How many things this check looked at. */
  examined: number;
  problems: number;
}

/*
  The one date form the generator is asked for. An en dash, a slash, a bare
  year or a spelled-out month all parse worse, and mixing them across entries
  parses worst of all.
*/
const DATE_RANGE = /^[A-Z][a-z]{2} \d{4} - ([A-Z][a-z]{2} \d{4}|Present)$/;

/** Canonical section names an ATS looks for when segmenting a resume. */
const HEADINGS = ["Summary", "Education", "Experience", "Projects", "Technical Skills", "Achievements"];

/*
  Markdown a model reaches for out of habit.

  LaTeX has no idea what ** means, so "**FastAPI**" is typeset as four literal
  asterisks around the word. Emphasis is carried by the `emphasise` field
  instead — see lib/resume/schema.ts.
*/
const MARKDOWN_PATTERNS: Array<{ pattern: RegExp; what: string }> = [
  { pattern: /\*\*[^*]+\*\*/, what: "**bold**" },
  { pattern: /(^|\s)\*[^*\s][^*]*\*(\s|$)/, what: "*italic*" },
  { pattern: /(^|\s)__[^_]+__/, what: "__bold__" },
  { pattern: /`[^`]+`/, what: "`code`" },
  { pattern: /^\s*[-•*]\s+/, what: "a leading bullet character" },
  { pattern: /^\s*#{1,6}\s+/, what: "a # heading" },
  { pattern: /\[[^\]]+\]\([^)]+\)/, what: "a [markdown](link)" },
];

/** Every piece of prose in the resume, with a label for reporting. */
function proseFields(resume: Resume): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = [
    { where: "summary", text: resume.summary.text },
  ];
  for (const e of resume.experience) {
    e.bullets.forEach((b, i) => out.push({ where: `${e.company} bullet ${i + 1}`, text: b.text }));
  }
  for (const p of resume.projects) {
    p.bullets.forEach((b, i) => out.push({ where: `${p.name} bullet ${i + 1}`, text: b.text }));
  }
  resume.achievements.forEach((a, i) => out.push({ where: `achievement ${i + 1}`, text: a.text }));
  for (const s of resume.skills) out.push({ where: `skills: ${s.label}`, text: s.items });
  return out;
}

/*
  Characters the renderer has to remove to compile at all.

  Reported rather than left silent: a stray CJK syllable or emoji in a draft
  would otherwise vanish from the PDF with no trace of why, and if it landed
  inside a real word it would leave that word misspelt.
*/
export function findUnsupportedCharacters(resume: Resume): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const { where, text } of proseFields(resume)) {
    const bad = unsupportedCharacters(text);
    if (bad.length) {
      findings.push({
        severity: "error",
        check: "characters",
        detail: `${where} contains ${bad.map((c) => `"${c}"`).join(", ")}, which pdflatex cannot typeset — they were dropped.`,
      });
    }
  }
  return findings;
}

/** Markdown syntax that LaTeX would print as literal characters. */
export function findMarkdownArtifacts(resume: Resume): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const { where, text } of proseFields(resume)) {
    for (const { pattern, what } of MARKDOWN_PATTERNS) {
      if (pattern.test(text)) {
        findings.push({
          severity: "error",
          check: "markdown in the text",
          detail: `${where} contains ${what} — LaTeX prints those characters literally.`,
        });
        break;
      }
    }
  }
  return findings;
}

/*
  Extraction inserts line breaks and collapses runs of spaces wherever the
  layout put them, so a bullet rarely survives as one contiguous string.
  Comparing on normalised, punctuation-stripped words is what makes "did this
  sentence make it" answerable at all.
*/
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when most of `needle`'s words appear in order within `haystack`. */
function containsMostOf(haystack: string, needle: string): boolean {
  const words = normalise(needle).split(" ").filter((w) => w.length > 2);
  if (!words.length) return true;

  // A run of the first eight significant words is enough to identify a bullet
  // without demanding an exact match that hyphenation would break.
  const probe = words.slice(0, 8).join(" ");
  if (haystack.includes(probe)) return true;

  const hit = words.filter((w) => haystack.includes(w)).length;
  return hit / words.length >= 0.85;
}

/**
 * Compares the PDF's text layer against the resume it was built from.
 *
 * `text` empty means no extractor was available; that is reported once rather
 * than as a flood of false failures.
 */
export function auditExtraction(resume: Resume, text: string, pages: number): AuditFinding[] {
  return auditExtractionDetailed(resume, text, pages).findings;
}

/**
 * The same audit, reporting every check it ran.
 *
 * `auditExtraction` above is the thin wrapper for callers that only care
 * whether anything is wrong. This one is for the admin panel, where seeing
 * that the contact fields and the headings and the bullets were all checked is
 * the difference between trusting the result and assuming it did nothing.
 */
export function auditExtractionDetailed(
  resume: Resume,
  text: string,
  pages: number,
): { findings: AuditFinding[]; steps: AuditStep[] } {
  const findings: AuditFinding[] = [];
  const steps: AuditStep[] = [];

  /*
    Every check goes through here, so a step exists for anything that ran. The
    count of problems is taken from what the check actually produced rather
    than passed in separately, which is what stops the two disagreeing.
  */
  const record = (check: string, label: string, examined: number, produced: AuditFinding[]) => {
    findings.push(...produced);
    steps.push({ check, label, examined, problems: produced.length });
  };

  const prose = proseFields(resume);

  record("markdown", "Markdown that LaTeX would print literally", prose.length, findMarkdownArtifacts(resume));
  record("characters", "Characters pdflatex cannot typeset", prose.length, findUnsupportedCharacters(resume));

  if (!text.trim()) {
    record("extraction", "Reading the text back out of the PDF", 1, [
      {
        severity: "warning",
        check: "extraction",
        detail: "Couldn't read the text back out of the PDF, so nothing below was verified.",
      },
    ]);
    return { findings, steps };
  }

  record("extraction", "Reading the text back out of the PDF", 1, []);

  const flat = normalise(text);
  const lines = text.split("\n").map((l) => l.trim());

  // Contact details are the fields an ATS populates first.
  const contact: AuditFinding[] = [];
  let contactFields = 1; // the name, which is always present
  if (resume.header.email && !flat.includes(normalise(resume.header.email))) {
    contact.push({ severity: "error", check: "contact", detail: "The email didn't extract." });
  }
  if (resume.header.phone && !flat.includes(normalise(resume.header.phone))) {
    contact.push({ severity: "warning", check: "contact", detail: "The phone number didn't extract cleanly." });
  }
  if (resume.header.location && !flat.includes(normalise(resume.header.location))) {
    contact.push({ severity: "warning", check: "contact", detail: "The location didn't extract." });
  }
  if (!flat.includes(normalise(resume.header.name))) {
    contact.push({ severity: "error", check: "contact", detail: "The name didn't extract." });
  }
  for (const f of [resume.header.email, resume.header.phone, resume.header.location]) if (f) contactFields++;
  record("contact", "Contact details an ATS populates first", contactFields, contact);

  /*
    Headings must extract exactly. A faked small-caps face, or anything that
    changes size mid-word, makes extractors insert a space — "Summary" comes
    out as "S ummary" and a parser looking for the section misses it.
  */
  const headings: AuditFinding[] = [];
  for (const heading of HEADINGS) {
    const present = lines.some((l) => l === heading);
    const mangled = lines.some((l) => l.replace(/\s+/g, "") === heading.replace(/\s+/g, ""));
    if (!present && mangled) {
      headings.push({
        severity: "error",
        check: "headings",
        detail: `"${heading}" extracts with broken spacing, so a parser won't match the section.`,
      });
    }
  }
  record("headings", "Section headings a parser segments on", HEADINGS.length, headings);

  // Employment history is what an ATS reads hardest.
  const roles: AuditFinding[] = [];
  for (const role of resume.experience) {
    if (!flat.includes(normalise(role.company))) {
      roles.push({ severity: "error", check: "experience", detail: `"${role.company}" didn't extract.` });
    }
    if (!flat.includes(normalise(role.title))) {
      roles.push({ severity: "error", check: "experience", detail: `The title "${role.title}" didn't extract.` });
    }
  }
  record("experience", "Company and title on every role", resume.experience.length * 2, roles);

  // Content that silently failed to make it onto the page.
  const missing: AuditFinding[] = [];
  for (const { where, text: line } of prose) {
    if (!containsMostOf(flat, line)) {
      missing.push({
        severity: "error",
        check: "content",
        detail: `${where} didn't survive into the PDF: "${line.slice(0, 60)}…"`,
      });
    }
  }
  record("content", "Every bullet surviving into the PDF", prose.length, missing);

  // An escaping bug shows up here rather than as a compile failure.
  const leaked = /\\(textbf|textbackslash|textasciitilde|textasciicircum|%|&|_|#|\$)/.exec(text);
  record("escaping", "LaTeX escapes leaking into the text layer", 1, leaked
    ? [{
        severity: "error",
        check: "escaping",
        detail: `A LaTeX escape reached the text layer: "${leaked[0]}".`,
      }]
    : []);

  record("length", "Page count", 1, pages > 2
    ? [{
        severity: "error",
        check: "length",
        detail: `${pages} pages. Cut bullets until it fits two.`,
      }]
    : []);

  /*
    Dates are checked against the one form the prompt asks for rather than
    against each other. Comparing entries to each other cannot tell a genuine
    inconsistency from a current role — "Present" is a legitimate end, not a
    different format — and it reports "2 formats" without saying which entry is
    the odd one out.
  */
  const dates: AuditFinding[] = [];
  for (const role of resume.experience) {
    if (!DATE_RANGE.test(role.dates.trim())) {
      dates.push({
        severity: "warning",
        check: "dates",
        detail: `"${role.dates}" at ${role.company} isn't "Mon YYYY - Mon YYYY" or "Mon YYYY - Present". Inconsistent dates lower a parser's confidence on the field it reads hardest.`,
      });
    }
  }
  record("dates", "Date format on every role", resume.experience.length, dates);

  return { findings, steps };
}

export function hasErrors(findings: AuditFinding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
