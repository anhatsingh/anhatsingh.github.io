import { addressableIds, itemId, type Portfolio } from "@/lib/content/types";

/*
  RETRIEVAL SEAM
  ==============
  A portfolio is a few kilobytes of text — small enough to fit whole in one
  prompt, which is cheaper and strictly more accurate than chunk-and-retrieve at
  this size. So the live implementation just serialises everything.

  But the seam is real: swap DirectContextProvider for a PgVectorContextProvider
  and nothing outside this file changes. That's the upgrade path if the content
  ever outgrows a single prompt.
*/

export interface ContextProvider {
  /** Returns the content block injected into the system prompt for this question. */
  getContext(question: string): Promise<string>;
}

function line(label: string, value?: string | null): string {
  return value ? `${label}: ${value}\n` : "";
}

/**
 * Compact, id-annotated serialisation of the whole portfolio.
 *
 * Every addressable item is prefixed with [id] because those ids are the
 * vocabulary the model uses in highlightItems calls. Without them inline the
 * model invents plausible-looking slugs.
 */
export function serializePortfolio(p: Portfolio): string {
  const parts: string[] = [];

  parts.push(
    `## PROFILE\n` +
      `Name: ${p.profile.name}\n` +
      `Role: ${p.profile.tagline}\n` +
      line("Location", p.profile.location) +
      `Open to work: ${p.profile.openToWork ? "yes, actively looking" : "no"}\n` +
      `Bio: ${p.profile.bio}\n` +
      `Resume available: ${p.profile.resumeUrl ? "yes" : "no"}`,
  );

  if (p.experience.length) {
    parts.push(
      `## EXPERIENCE\n` +
        p.experience
          .map((e) => {
            const end = e.endDate ?? "present";
            return (
              `[${itemId("experience", e.slug)}] ${e.role} at ${e.company} (${e.startDate}–${end})\n` +
              `  ${e.summary}\n` +
              e.highlights.map((h) => `  - ${h}`).join("\n") +
              (e.tech.length ? `\n  Tech: ${e.tech.join(", ")}` : "")
            );
          })
          .join("\n"),
    );
  }

  if (p.projects.length) {
    parts.push(
      `## PROJECTS\n` +
        p.projects
          .map(
            (pr) =>
              `[${itemId("projects", pr.slug)}] ${pr.name}${pr.featured ? " (featured)" : ""}\n` +
              `  ${pr.summary}\n  ${pr.description}` +
              (pr.tech.length ? `\n  Tech: ${pr.tech.join(", ")}` : "") +
              (pr.repoUrl ? `\n  Repo: ${pr.repoUrl}` : ""),
          )
          .join("\n"),
    );
  }

  if (p.skills.length) {
    const byCategory = new Map<string, string[]>();
    for (const s of p.skills) {
      const list = byCategory.get(s.category) ?? [];
      list.push(`[${itemId("skills", s.slug)}] ${s.name}`);
      byCategory.set(s.category, list);
    }
    parts.push(
      `## SKILLS\n` +
        [...byCategory.entries()].map(([cat, items]) => `${cat}: ${items.join(", ")}`).join("\n"),
    );
  }

  if (p.education.length || p.certifications.length) {
    parts.push(
      `## EDUCATION & CERTIFICATIONS\n` +
        p.education
          .map(
            (e) =>
              `[${itemId("education", e.slug)}] ${e.degree}${e.field ? ` in ${e.field}` : ""}, ` +
              `${e.institution}${e.endYear ? ` (${e.startYear ?? ""}–${e.endYear})` : ""}`,
          )
          .join("\n") +
        (p.certifications.length
          ? "\n" +
            p.certifications
              .map(
                (c) =>
                  `[${itemId("education", c.slug)}] ${c.name} — ${c.issuer}${c.issueDate ? ` (${c.issueDate})` : ""}`,
              )
              .join("\n")
          : ""),
    );
  }

  if (p.testimonials.length) {
    parts.push(
      `## TESTIMONIALS\n` +
        p.testimonials
          .map(
            (t) =>
              `[${itemId("testimonials", t.slug)}] "${t.quote}" — ${t.authorName}` +
              `${t.authorTitle ? `, ${t.authorTitle}` : ""}${t.authorCompany ? ` at ${t.authorCompany}` : ""}`,
          )
          .join("\n"),
    );
  }

  if (p.writing.length) {
    parts.push(
      `## WRITING\n` +
        p.writing
          .map((w) => `[${itemId("writing", w.slug)}] ${w.title} — ${w.summary}`)
          .join("\n"),
    );
  }

  parts.push(
    `## CONTENT INDEX (the ONLY valid ids for highlightItems)\n` +
      [...addressableIds(p).keys()].join("\n"),
  );

  return parts.join("\n\n");
}

export class DirectContextProvider implements ContextProvider {
  constructor(private portfolio: Portfolio) {}

  async getContext(): Promise<string> {
    return serializePortfolio(this.portfolio);
  }
}
