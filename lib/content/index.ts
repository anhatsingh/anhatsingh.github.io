import { cache } from "react";
import { getPublicClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { parseBlocks } from "./blocks";
import { seedPortfolio } from "./seed";
import type {
  Certification,
  Education,
  Experience,
  Portfolio,
  Profile,
  Project,
  Skill,
  Testimonial,
  Writing,
} from "./types";

/*
  Single read path for all page content.

  Wrapped in React's `cache` so one render pass hits Supabase once, no matter how
  many sections ask for data. The chat route calls the same function, so the
  chatbot can never be answering from a different snapshot than the page shows.
*/

/** The three detail-page columns every entity now carries. */
function detailFields(r: Record<string, unknown>) {
  return {
    // parseBlocks drops malformed entries rather than throwing, so a body
    // written by an older schema can't take the page down.
    body: parseBlocks(r.body),
    showInBlogList: Boolean(r.show_in_blog_list),
    heroImageUrl: (r.hero_image_url as string) ?? undefined,
  };
}

/** Rows come back snake_case from Postgres; the app speaks camelCase. */
function mapExperience(r: Record<string, unknown>): Experience {
  return {
    slug: r.slug as string,
    role: r.role as string,
    company: r.company as string,
    companyUrl: (r.company_url as string) ?? undefined,
    logoUrl: (r.logo_url as string) ?? undefined,
    startDate: r.start_date as string,
    endDate: (r.end_date as string) ?? null,
    location: (r.location as string) ?? undefined,
    summary: (r.summary as string) ?? "",
    shortSummary: (r.short_summary as string) ?? "",
    highlights: (r.highlights as string[]) ?? [],
    tech: (r.tech as string[]) ?? [],
    ...detailFields(r),
  };
}

function mapProject(r: Record<string, unknown>): Project {
  return {
    slug: r.slug as string,
    name: r.name as string,
    summary: (r.summary as string) ?? "",
    description: (r.description as string) ?? "",
    tech: (r.tech as string[]) ?? [],
    repoUrl: (r.repo_url as string) ?? undefined,
    liveUrl: (r.live_url as string) ?? undefined,
    imageUrl: (r.image_url as string) ?? undefined,
    featured: Boolean(r.featured),
    started: (r.started as string) ?? undefined,
    ended: (r.ended as string) ?? undefined,
    ...detailFields(r),
  };
}

function mapWriting(r: Record<string, unknown>): Writing {
  return {
    slug: r.slug as string,
    title: r.title as string,
    summary: (r.summary as string) ?? "",
    imageUrl: (r.image_url as string) ?? undefined,
    externalUrl: (r.external_url as string) || undefined,
    publishedAt: (r.published_at as string) ?? undefined,
    source: (r.source as string) ?? undefined,
    ...detailFields(r),
  };
}

function mapProfile(r: Record<string, unknown>): Profile {
  return {
    name: r.name as string,
    headline: r.headline as string,
    tagline: (r.tagline as string) ?? "",
    bio: (r.bio as string) ?? "",
    location: (r.location as string) ?? undefined,
    email: r.email as string,
    avatarUrl: (r.avatar_url as string) ?? undefined,
    resumeUrl: (r.resume_url as string) ?? undefined,
    openToWork: Boolean(r.open_to_work),
    githubUsername: (r.github_username as string) ?? undefined,
    leetcodeUsername: (r.leetcode_username as string) ?? undefined,
    linkedinUrl: (r.linkedin_url as string) ?? undefined,
    xUrl: (r.x_url as string) ?? undefined,
    kaggleUrl: (r.kaggle_url as string) ?? undefined,
    huggingfaceUrl: (r.huggingface_url as string) ?? undefined,
    hashnodeUrl: (r.hashnode_url as string) ?? undefined,
    peerlistUrl: (r.peerlist_url as string) ?? undefined,
    mediumUrl: (r.medium_url as string) ?? undefined,
    stackoverflowUrl: (r.stackoverflow_url as string) ?? undefined,
    devtoUrl: (r.devto_url as string) ?? undefined,
    hiddenSocials: (r.hidden_socials as string[]) ?? [],
    selectedRepos: (r.selected_repos as string[]) ?? [],
  };
}

async function fetchFromSupabase(): Promise<Portfolio | null> {
  const db = getPublicClient();
  if (!db) return null;

  // One round trip per table, issued together. RLS restricts these to published
  // rows, so no is_published filter is needed here — but we order explicitly
  // because Postgres makes no ordering guarantee without it.
  const [profile, experience, projects, skills, education, certifications, testimonials, writing] =
    await Promise.all([
      db.from("profile").select("*").limit(1).maybeSingle(),
      // Only sort_order here. Chronological ordering is applied in the section
      // components instead, so the query never names a column that a database
      // running one migration behind doesn't have yet — ordering on a missing
      // column is a hard error that would take the whole page down.
      db.from("experience").select("*").order("sort_order", { ascending: true }),
      db.from("projects").select("*").order("sort_order", { ascending: true }),
      db.from("skills").select("*").order("sort_order", { ascending: true }),
      db.from("education").select("*").order("sort_order", { ascending: true }),
      db.from("certifications").select("*").order("sort_order", { ascending: true }),
      db.from("testimonials").select("*").order("sort_order", { ascending: true }),
      db.from("writing").select("*").order("sort_order", { ascending: true }),
    ]);

  // If the profile singleton is missing the project isn't seeded yet — fall back
  // wholesale rather than rendering a half-empty page.
  if (profile.error || !profile.data) return null;

  return {
    profile: mapProfile(profile.data),
    experience: (experience.data ?? []).map(mapExperience),
    projects: (projects.data ?? []).map(mapProject),
    skills: (skills.data ?? []).map((r) => ({
      slug: r.slug,
      name: r.name,
      category: r.category ?? "Other",
      ...detailFields(r),
    })) as Skill[],
    education: (education.data ?? []).map((r) => ({
      slug: r.slug,
      institution: r.institution,
      degree: r.degree,
      field: r.field ?? undefined,
      startYear: r.start_year ?? undefined,
      endYear: r.end_year ?? undefined,
      note: r.note ?? undefined,
      logoUrl: r.logo_url ?? undefined,
    })) as Education[],
    certifications: (certifications.data ?? []).map((r) => ({
      slug: r.slug,
      name: r.name,
      issuer: r.issuer,
      issueDate: r.issue_date ?? undefined,
      credentialUrl: r.credential_url ?? undefined,
      logoUrl: r.logo_url ?? undefined,
      ...detailFields(r),
    })) as Certification[],
    testimonials: (testimonials.data ?? []).map((r) => ({
      slug: r.slug,
      quote: r.quote,
      authorName: r.author_name,
      authorTitle: r.author_title ?? undefined,
      authorCompany: r.author_company ?? undefined,
      authorUrl: r.author_url ?? undefined,
      authorImageUrl: r.author_image_url ?? undefined,
      authorEmail: r.author_email ?? undefined,
      receivedAt: r.received_at ?? undefined,
    })) as Testimonial[],
    writing: (writing.data ?? []).map(mapWriting),
  };
}

export const getPortfolio = cache(async (): Promise<Portfolio> => {
  if (!isSupabaseConfigured) return seedPortfolio;

  try {
    const fromDb = await fetchFromSupabase();
    return fromDb ?? seedPortfolio;
  } catch (err) {
    // A database blip should degrade to seed content, not a 500. The site
    // staying up matters more than it being current.
    console.error("[content] Supabase read failed, serving seed content:", err);
    return seedPortfolio;
  }
});

export * from "./types";
