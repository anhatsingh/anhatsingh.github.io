import { cache } from "react";
import { getPortfolio } from "./index";
import { blocksToPlainText, readingMinutes, type Block } from "./blocks";
import { getPublicClient } from "@/lib/supabase/server";
import {
  entityPath,
  type Certification,
  type EntityType,
  type Experience,
  type Portfolio,
  type Project,
  type Skill,
  type Writing,
} from "./types";

/*
  Everything the detail pages and /blog read.

  All of it goes through the existing `getPortfolio()` rather than issuing new
  per-slug queries. That's deliberate:

   - getPortfolio is React-`cache`d, so a page rendering a detail view and the
     chatbot answering about it share one snapshot.
   - RLS already filters unpublished rows, so an unpublished slug is simply
     absent — a detail route gets a 404 for free, with no `is_published` check
     to forget.

  The whole portfolio is a few hundred rows. Fetching it to render one page is
  cheaper than the round trips a per-slug query would add, and it stays that way
  until this is a very different site.
*/

export interface ContentLink {
  postSlug: string;
  targetType: string;
  targetSlug: string;
}

/** The join table is small and read on nearly every page, so fetch it whole. */
export const getContentLinks = cache(async (): Promise<ContentLink[]> => {
  const db = getPublicClient();
  if (!db) return [];

  try {
    const { data, error } = await db.from("content_links").select("post_slug, target_type, target_slug");
    if (error) {
      // The table may not exist yet if schema.sql hasn't been re-run. Relations
      // are an enhancement — a missing table shouldn't take detail pages down.
      console.error("[entities] content_links unavailable:", error.message);
      return [];
    }
    return (data ?? []).map((r) => ({
      postSlug: r.post_slug as string,
      targetType: r.target_type as string,
      targetSlug: r.target_slug as string,
    }));
  } catch {
    return [];
  }
});

/** The fields every detail page needs, whatever the underlying entity is. */
export interface DetailView {
  type: EntityType;
  slug: string;
  title: string;
  /** Small line under the title — company, category, issuer. */
  subtitle?: string;
  /** One-paragraph lead. */
  summary: string;
  body: Block[];
  heroImageUrl?: string;
  logoUrl?: string;
  showInBlogList: boolean;
  /** Right-hand facts list: dates, links, tech. */
  meta: Array<{ label: string; value: string; href?: string }>;
  tech: string[];
  readingMinutes: number;
  path: string;
}

function experienceView(e: Experience): DetailView {
  const end = e.endDate ?? "Present";
  return {
    type: "experience",
    slug: e.slug,
    title: e.role,
    subtitle: e.company,
    summary: e.summary,
    body: e.body,
    heroImageUrl: e.heroImageUrl,
    logoUrl: e.logoUrl,
    showInBlogList: e.showInBlogList,
    meta: [
      { label: "dates", value: `${e.startDate} — ${end}` },
      ...(e.location ? [{ label: "location", value: e.location }] : []),
      ...(e.companyUrl ? [{ label: "company", value: e.company, href: e.companyUrl }] : []),
    ],
    tech: e.tech,
    readingMinutes: readingMinutes(e.body),
    path: entityPath("experience", e.slug),
  };
}

function projectView(p: Project): DetailView {
  return {
    type: "projects",
    slug: p.slug,
    title: p.name,
    subtitle: p.featured ? "Featured project" : "Project",
    summary: p.summary || p.description,
    body: p.body,
    heroImageUrl: p.heroImageUrl ?? p.imageUrl,
    showInBlogList: p.showInBlogList,
    meta: [
      ...(p.repoUrl ? [{ label: "code", value: "GitHub", href: p.repoUrl }] : []),
      ...(p.liveUrl ? [{ label: "live", value: "Open", href: p.liveUrl }] : []),
    ],
    tech: p.tech,
    readingMinutes: readingMinutes(p.body),
    path: entityPath("projects", p.slug),
  };
}

function skillView(s: Skill): DetailView {
  return {
    type: "skills",
    slug: s.slug,
    title: s.name,
    subtitle: s.category,
    summary: "",
    body: s.body,
    heroImageUrl: s.heroImageUrl,
    showInBlogList: s.showInBlogList,
    meta: [{ label: "category", value: s.category }],
    tech: [],
    readingMinutes: readingMinutes(s.body),
    path: entityPath("skills", s.slug),
  };
}

function certificationView(c: Certification): DetailView {
  return {
    type: "certifications",
    slug: c.slug,
    title: c.name,
    subtitle: c.issuer,
    summary: "",
    body: c.body,
    heroImageUrl: c.heroImageUrl,
    logoUrl: c.logoUrl,
    showInBlogList: c.showInBlogList,
    meta: [
      { label: "issuer", value: c.issuer },
      ...(c.issueDate ? [{ label: "issued", value: c.issueDate }] : []),
      ...(c.credentialUrl ? [{ label: "credential", value: "Verify", href: c.credentialUrl }] : []),
    ],
    tech: [],
    readingMinutes: readingMinutes(c.body),
    path: entityPath("certifications", c.slug),
  };
}

function postView(w: Writing): DetailView {
  return {
    type: "posts",
    slug: w.slug,
    title: w.title,
    subtitle: w.source,
    summary: w.summary,
    body: w.body,
    heroImageUrl: w.heroImageUrl ?? w.imageUrl,
    showInBlogList: w.showInBlogList,
    meta: [
      ...(w.publishedAt ? [{ label: "published", value: w.publishedAt }] : []),
      ...(w.externalUrl ? [{ label: "original", value: w.source ?? "Read there", href: w.externalUrl }] : []),
    ],
    tech: [],
    readingMinutes: readingMinutes(w.body),
    path: entityPath("posts", w.slug),
  };
}

/** Returns null for an unknown or unpublished slug — the route turns that into a 404. */
export async function getDetail(type: EntityType, slug: string): Promise<DetailView | null> {
  const p = await getPortfolio();

  switch (type) {
    case "experience": {
      const row = p.experience.find((e) => e.slug === slug);
      return row ? experienceView(row) : null;
    }
    case "projects": {
      const row = p.projects.find((x) => x.slug === slug);
      return row ? projectView(row) : null;
    }
    case "skills": {
      const row = p.skills.find((x) => x.slug === slug);
      return row ? skillView(row) : null;
    }
    case "certifications": {
      const row = p.certifications.find((x) => x.slug === slug);
      return row ? certificationView(row) : null;
    }
    case "posts": {
      const row = p.writing.find((x) => x.slug === slug);
      return row ? postView(row) : null;
    }
  }
}

/** Slugs for generateStaticParams. Unpublished rows never reach here (RLS). */
export async function getSlugs(type: EntityType): Promise<string[]> {
  const p = await getPortfolio();
  const source =
    type === "experience" ? p.experience
    : type === "projects" ? p.projects
    : type === "skills" ? p.skills
    : type === "certifications" ? p.certifications
    : p.writing;
  return source.map((row) => row.slug);
}

/** Posts explicitly linked to this entity via content_links. */
export async function getRelatedPosts(type: EntityType, slug: string): Promise<Writing[]> {
  const [p, links] = await Promise.all([getPortfolio(), getContentLinks()]);
  const wanted = new Set(
    links.filter((l) => l.targetType === type && l.targetSlug === slug).map((l) => l.postSlug),
  );
  return p.writing.filter((w) => wanted.has(w.slug));
}

export interface SkillEvidence {
  experience: Experience[];
  projects: Project[];
  posts: Writing[];
}

/*
  A skill page assembles itself.

  Matching is on the `tech[]` arrays that already exist on experience and
  projects, compared case-insensitively — "PyTorch" in a tech list should match
  the skill whose name is "PyTorch" without anyone maintaining a third list.
*/
export async function getSkillEvidence(skill: Skill): Promise<SkillEvidence> {
  const [p, posts] = await Promise.all([getPortfolio(), getRelatedPosts("skills", skill.slug)]);
  const needle = skill.name.toLowerCase();
  const matches = (tech: string[]) => tech.some((t) => t.toLowerCase() === needle);

  return {
    experience: p.experience.filter((e) => matches(e.tech)),
    projects: p.projects.filter((x) => matches(x.tech)),
    posts,
  };
}

export interface BlogEntry {
  type: EntityType;
  slug: string;
  title: string;
  summary: string;
  imageUrl?: string;
  /** Set when the canonical version lives elsewhere. */
  externalUrl?: string;
  source?: string;
  publishedAt?: string;
  readingMinutes: number;
  path: string;
}

/*
  Everything that belongs in /blog, from two sources:

   1. Posts (the `writing` table), internal or external.
   2. Entity pages whose author flipped show_in_blog_list on — an experience
      write-up that reads as an article rather than a CV entry.

  An entity page with an empty body is excluded even when the flag is on: a
  blog index entry that opens onto a bare heading is worse than no entry.
*/
export async function getBlogEntries(): Promise<BlogEntry[]> {
  const p = await getPortfolio();
  const entries: BlogEntry[] = [];

  for (const w of p.writing) {
    // An external post needs no body; an internal one is only real once written.
    if (!w.externalUrl && w.body.length === 0) continue;
    if (!w.showInBlogList) continue;

    entries.push({
      type: "posts",
      slug: w.slug,
      title: w.title,
      summary: w.summary,
      imageUrl: w.heroImageUrl ?? w.imageUrl,
      externalUrl: w.externalUrl,
      source: w.source,
      publishedAt: w.publishedAt,
      readingMinutes: readingMinutes(w.body),
      path: entityPath("posts", w.slug),
    });
  }

  const flagged: Array<[EntityType, Array<Experience | Project | Skill | Certification>]> = [
    ["experience", p.experience],
    ["projects", p.projects],
    ["skills", p.skills],
    ["certifications", p.certifications],
  ];

  for (const [type, rows] of flagged) {
    for (const row of rows) {
      if (!row.showInBlogList || row.body.length === 0) continue;
      const view =
        type === "experience" ? experienceView(row as Experience)
        : type === "projects" ? projectView(row as Project)
        : type === "skills" ? skillView(row as Skill)
        : certificationView(row as Certification);

      entries.push({
        type,
        slug: view.slug,
        title: view.title,
        summary: view.summary || blocksToPlainText(view.body).slice(0, 160),
        imageUrl: view.heroImageUrl,
        readingMinutes: view.readingMinutes,
        path: view.path,
      });
    }
  }

  // Newest first where a date exists; undated entries sort after, by title.
  return entries.sort((a, b) => {
    if (a.publishedAt && b.publishedAt) return b.publishedAt.localeCompare(a.publishedAt);
    if (a.publishedAt) return -1;
    if (b.publishedAt) return 1;
    return a.title.localeCompare(b.title);
  });
}

/** Every detail page that exists, for the sitemap. */
export async function getAllDetailPaths(): Promise<string[]> {
  const p: Portfolio = await getPortfolio();
  return [
    ...p.experience.map((e) => entityPath("experience", e.slug)),
    ...p.projects.map((x) => entityPath("projects", x.slug)),
    ...p.skills.map((x) => entityPath("skills", x.slug)),
    ...p.certifications.map((x) => entityPath("certifications", x.slug)),
    // External-only posts have no page here, so they don't belong in the sitemap.
    ...p.writing.filter((w) => w.body.length > 0).map((w) => entityPath("posts", w.slug)),
  ];
}
