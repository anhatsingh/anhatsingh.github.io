import { cache } from "react";
import { getPublicClient, isSupabaseConfigured } from "@/lib/supabase/server";
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
    highlights: (r.highlights as string[]) ?? [],
    tech: (r.tech as string[]) ?? [],
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
  };
}

function mapWriting(r: Record<string, unknown>): Writing {
  return {
    slug: r.slug as string,
    title: r.title as string,
    summary: (r.summary as string) ?? "",
    imageUrl: (r.image_url as string) ?? undefined,
    externalUrl: r.external_url as string,
    publishedAt: (r.published_at as string) ?? undefined,
    source: (r.source as string) ?? undefined,
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
    twitterUrl: (r.twitter_url as string) ?? undefined,
    socials: (r.socials as Profile["socials"]) ?? {},
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
    })) as Certification[],
    testimonials: (testimonials.data ?? []).map((r) => ({
      slug: r.slug,
      quote: r.quote,
      authorName: r.author_name,
      authorTitle: r.author_title ?? undefined,
      authorCompany: r.author_company ?? undefined,
      authorUrl: r.author_url ?? undefined,
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
