import { formatNumber } from "@/lib/format";
import { formatRetrieved, retrieve } from "./embeddings";
import { entityPath } from "@/lib/content/types";
import { addressableIds, itemId, type Portfolio } from "@/lib/content/types";
import type { GitHubStats } from "@/lib/github/service";
import type { LeetCodeStats } from "@/lib/leetcode/service";

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

/** Live data pulled from connected accounts, folded into the same context. */
export interface LiveStats {
  github?: GitHubStats | null;
  leetcode?: LeetCodeStats | null;
}

/*
  Connected-account stats, summarised.

  Deliberately aggregates only. The GitHub contribution calendar is 365 day
  entries and the language list can run long — dumping either would multiply the
  context size for data nobody asks a chatbot about at that granularity.
  "How many contributions last year?" needs one number, not the calendar.
*/
function serializeStats(stats: LiveStats): string {
  const parts: string[] = [];

  if (stats.github) {
    const g = stats.github;
    const languages = g.languages
      .slice(0, 6)
      .map((l) => `${l.name} ${l.percent.toFixed(0)}%`)
      .join(", ");
    const repos = g.recentRepos
      .slice(0, 5)
      .map((r) => `${r.name}${r.language ? ` (${r.language})` : ""}`)
      .join(", ");

    parts.push(
      `## GITHUB (@${g.username}, live — last 12 months unless stated)\n` +
        `Total contributions: ${g.totalContributions}` +
        (g.restrictedContributions > 0 ? ` (plus ${g.restrictedContributions} in private repos)` : "") +
        `\nCommits: ${g.commits} | Pull requests opened: ${g.pullRequests} | Code reviews: ${g.reviews} | Issues: ${g.issues}` +
        `\nPRs merged all-time: ${g.mergedPrs}. ${g.externalMergedPrs} of those were into team repositories he does not own (mostly his employer's private codebase — this is collaboration and shipping rate, NOT open-source contribution, and must never be described as open source). Genuinely open-source merged PRs into public repos owned by others: ${g.openSourceMergedPrs}.` +
        `\nRepositories contributed to: ${g.reposContributedTo} | Public repos: ${g.publicRepos} | Followers: ${g.followers}` +
        `\nYears on GitHub: ${g.yearsOnGitHub}` +
        (languages ? `\nLanguages by volume of code written: ${languages}` : "") +
        (repos ? `\nMost recently pushed: ${repos}` : ""),
    );
  }

  if (stats.leetcode) {
    const l = stats.leetcode;
    const breakdown = l.breakdown
      .map((d) => `${d.difficulty} ${d.solved}/${d.available}`)
      .join(", ");
    const languages = l.languages.slice(0, 4).map((x) => `${x.name} (${x.solved})`).join(", ");
    const tags = l.topTags.slice(0, 6).map((t) => `${t.name} (${t.solved})`).join(", ");

    parts.push(
      `## LEETCODE (@${l.username}, live)\n` +
        `Problems solved: ${l.totalSolved} out of ${l.totalAvailable} available\n` +
        `By difficulty: ${breakdown}` +
        (l.acceptanceRate !== null ? `\nAcceptance rate: ${l.acceptanceRate.toFixed(1)}% across ${l.totalSubmissions} submissions` : "") +
        (l.ranking ? `\nGlobal ranking: ${formatNumber(l.ranking)}` : "") +
        (languages ? `\nLanguages used: ${languages}` : "") +
        (tags ? `\nStrongest topics: ${tags}` : "") +
        (l.activeYears.length ? `\nActive years: ${l.activeYears.join(", ")}` : ""),
    );
  }

  return parts.join("\n\n");
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
export function serializePortfolio(p: Portfolio, stats: LiveStats = {}): string {
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
          .map((w) => {
            const where = w.externalUrl
              ? `published externally at ${w.externalUrl}`
              : w.body.length
                ? `on this site at ${entityPath("posts", w.slug)}`
                : "not written up yet";
            return `[${itemId("writing", w.slug)}] ${w.title} — ${w.summary} (${where})`;
          })
          .join("\n"),
    );
  }

  const live = serializeStats(stats);
  if (live) parts.push(live);

  /*
    Which entries have a full write-up behind them.

    Without this the model can't tell a one-line card from a 1,500-word page,
    so it either links to everything or nothing. Listing only what has a body
    means openPage gets used where there's actually something to read.
  */
  const withPages = [
    ...p.experience.filter((e) => e.body.length).map((e) => itemId("experience", e.slug)),
    ...p.projects.filter((x) => x.body.length).map((x) => itemId("projects", x.slug)),
    ...p.skills.filter((x) => x.body.length).map((x) => itemId("skills", x.slug)),
    ...p.certifications.filter((x) => x.body.length).map((x) => itemId("certifications", x.slug)),
    ...p.writing.filter((w) => w.body.length).map((w) => itemId("writing", w.slug)),
  ];
  if (withPages.length) {
    parts.push(
      `## HAS A FULL WRITE-UP (worth linking with openPage)\n${withPages.join("\n")}`,
    );
  }

  parts.push(
    `## CONTENT INDEX (the ONLY valid ids for highlightItems and openPage)\n` +
      [...addressableIds(p).keys()].join("\n"),
  );

  return parts.join("\n\n");
}

/*
  Summaries in the prompt, bodies retrieved.

  The base context — every title, role, skill and summary — is always present,
  which is what guarantees the bot never claims something doesn't exist merely
  because retrieval missed it. Only the long-form bodies are fetched on demand.

  Retrieval failure is not an error path: it returns the base context, so a
  missing pgvector extension or an embedding outage degrades the answer's depth
  rather than the reply itself.
*/
export class RetrievalContextProvider implements ContextProvider {
  constructor(
    private portfolio: Portfolio,
    private stats: LiveStats = {},
    private topK = 5,
  ) {}

  async getContext(question: string): Promise<string> {
    const base = serializePortfolio(this.portfolio, this.stats);
    const chunks = await retrieve(question, this.topK);
    const retrieved = formatRetrieved(chunks);
    return retrieved ? `${base}\n\n${retrieved}` : base;
  }
}

export class DirectContextProvider implements ContextProvider {
  constructor(
    private portfolio: Portfolio,
    private stats: LiveStats = {},
  ) {}

  async getContext(): Promise<string> {
    return serializePortfolio(this.portfolio, this.stats);
  }
}
