import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Resume, RichText } from "./schema";

/*
  Resume object -> LaTeX.

  This file owns every backslash in the output. The model produces data; the
  markup is written here, where it can be tested. That split is the safety
  model — see lib/resume/schema.ts.
*/

/*
  The ten characters TeX treats specially.

  Escaped in a single pass over the string, deliberately. The obvious
  implementation — a chain of .replace() calls — double-escapes: replace "\"
  with "\textbackslash{}" and the next rule escapes the braces you just
  inserted. A single pass emits each replacement directly and never revisits it.
*/
const ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  "^": "\\textasciicircum{}",
  _: "\\_",
  "~": "\\textasciitilde{}",
  "%": "\\%",
};

export function escapeLatex(value: string): string {
  let out = "";
  for (const char of value) out += ESCAPES[char] ?? char;
  return out;
}

/**
 * Escapes text, then bolds the named phrases within it.
 *
 * Order matters and is the whole point: escaping first means the phrases are
 * matched against escaped text, so a phrase containing `&` or `%` still lines
 * up. Emphasising first would mean escaping the `\textbf{}` we just inserted.
 *
 * A phrase that doesn't appear verbatim is dropped rather than approximated —
 * the model proposed it, and a near-miss is not worth guessing at.
 */
export function renderRich(rich: RichText): string {
  const text = escapeLatex(rich.text);

  // Collect match ranges up front rather than replacing as we go: replacing in
  // place would let a later phrase match inside markup an earlier one added.
  const ranges: Array<[number, number]> = [];
  for (const phrase of rich.emphasise ?? []) {
    const needle = escapeLatex(phrase);
    if (!needle) continue;
    const at = text.indexOf(needle);
    if (at === -1) continue;
    ranges.push([at, at + needle.length]);
  }

  ranges.sort((a, b) => a[0] - b[0]);

  // Overlapping phrases would produce nested \textbf, which is legal but means
  // one phrase silently swallows another. Merge instead.
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }

  let out = "";
  let cursor = 0;
  for (const [from, to] of merged) {
    out += text.slice(cursor, from) + `\\textbf{${text.slice(from, to)}}`;
    cursor = to;
  }
  return out + text.slice(cursor);
}

/** The static preamble, read from disk so the .tex stays editable as LaTeX. */
export function preamble(): string {
  return readFileSync(join(process.cwd(), "lib/resume/template.tex"), "utf8");
}

function section(title: string, body: string): string {
  if (!body.trim()) return "";
  return `\n\\section{${escapeLatex(title)}}\n${body}\n`;
}

function header(resume: Resume): string {
  const h = resume.header;

  /*
    Contact details as one centred line of plain text. Everything here is a
    real character in the text layer — no icons, no header/footer region, both
    of which ATS routinely drop or mangle.
  */
  const parts: string[] = [];
  if (h.location) parts.push(escapeLatex(h.location));
  if (h.phone) parts.push(escapeLatex(h.phone));
  parts.push(`\\href{mailto:${escapeLatex(h.email)}}{${escapeLatex(h.email)}}`);
  if (h.linkedin) parts.push(`\\href{https://${escapeLatex(h.linkedin)}}{${escapeLatex(h.linkedin)}}`);
  if (h.github) parts.push(`\\href{https://${escapeLatex(h.github)}}{${escapeLatex(h.github)}}`);

  return [
    "\\begin{center}",
    `    {\\Huge \\textbf{${escapeLatex(h.name)}}}\\\\[2pt]`,
    `    \\small ${parts.join(" \\quad | \\quad ")}`,
    "\\end{center}",
    "\\vspace{-6pt}",
  ].join("\n");
}

function bulletList(bullets: RichText[]): string {
  if (!bullets.length) return "";
  return [
    "      \\resumeItemListStart",
    ...bullets.map((b) => `        \\resumeItem{${renderRich(b)}}`),
    "      \\resumeItemListEnd",
  ].join("\n");
}

export function renderResume(resume: Resume): string {
  const education = resume.education.length
    ? [
        "  \\resumeSubHeadingListStart",
        ...resume.education.map(
          (e) =>
            `    \\resumeSubheadingSingleLineItalicStyle\n      {${escapeLatex(e.degree)}}{${escapeLatex(
              e.institution,
            )}}{${escapeLatex(e.score ?? "")}}{${escapeLatex(e.years)}}`,
        ),
        "  \\resumeSubHeadingListEnd",
      ].join("\n")
    : "";

  const experience = resume.experience.length
    ? [
        "  \\resumeSubHeadingListStart",
        ...resume.experience.map((role) =>
          [
            `    \\resumeSubheadingSingleLine\n      {${escapeLatex(role.title)}}{${escapeLatex(
              role.company,
            )}}{${escapeLatex(role.dates)}}`,
            bulletList(role.bullets),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
        "  \\resumeSubHeadingListEnd",
      ].join("\n")
    : "";

  const projects = resume.projects.length
    ? [
        "  \\resumeSubHeadingListStart",
        ...resume.projects.map((p) => {
          const name = `\\textbf{${escapeLatex(p.name)}}${p.context ? ` | ${escapeLatex(p.context)}` : ""}`;
          return [
            `    \\resumeProjectHeading\n      {${name}}{${escapeLatex(p.dates ?? "")}}`,
            bulletList(p.bullets),
          ]
            .filter(Boolean)
            .join("\n");
        }),
        "  \\resumeSubHeadingListEnd",
      ].join("\n")
    : "";

  const skills = resume.skills.length
    ? [
        "  \\begin{itemize}[leftmargin=0.15in, label={}]",
        "    \\small\\item{",
        resume.skills
          .map((g) => `      \\textbf{${escapeLatex(g.label)}}{: ${escapeLatex(g.items)}}`)
          .join(" \\\\\n"),
        "    }",
        "  \\end{itemize}",
      ].join("\n")
    : "";

  const achievements = resume.achievements.length
    ? [
        "\\begin{itemize}[leftmargin=0.18in, itemsep=2pt, topsep=2pt, parsep=0pt, partopsep=0pt]",
        ...resume.achievements.map((a) => `  \\item\\small{${renderRich(a)}}`),
        "\\end{itemize}",
      ].join("\n")
    : "";

  return [
    preamble(),
    header(resume),
    // Canonical headings. ATS look for these exact words; "Selected
    // Achievements" and the like reduce the odds of a section being recognised.
    section("Summary", `\\noindent\n${renderRich(resume.summary)}`),
    section("Education", education),
    section("Experience", experience),
    section("Projects", projects),
    section("Technical Skills", skills),
    section("Achievements", achievements),
    "\n\\end{document}\n",
  ].join("\n");
}
