/*
  Content model.

  Every collection item carries a `slug` that is STABLE across edits. That slug
  is what the chatbot names when it asks the UI to highlight something
  ("experience:ml-engineer-acme"), so renaming one silently breaks the link
  between an answer and the thing on screen. Admin treats slug as write-once.
*/

export type SectionId =
  | "hero"
  | "about"
  | "projects"
  | "experience"
  | "github"
  | "skills"
  | "education"
  | "testimonials"
  | "writing"
  | "contact";

/** Sections the chatbot is allowed to navigate to, in page order. */
export const NAVIGABLE_SECTIONS: SectionId[] = [
  "about",
  "projects",
  "experience",
  "github",
  "skills",
  "education",
  "testimonials",
  "writing",
  "contact",
];

export const SECTION_LABELS: Record<SectionId, string> = {
  hero: "Home",
  about: "About",
  projects: "Projects",
  experience: "Experience",
  github: "GitHub",
  skills: "Skills",
  education: "Education & Certifications",
  testimonials: "Testimonials",
  writing: "Writing",
  contact: "Contact",
};

export interface Socials {
  github?: string;
  linkedin?: string;
  twitter?: string;
  email?: string;
}

export interface Profile {
  name: string;
  headline: string;
  /** Short punchy line under the display headline. */
  tagline: string;
  bio: string;
  location?: string;
  email: string;
  /** Portrait. Shown in About and as the assistant's avatar in chat. */
  avatarUrl?: string;
  /** Google Drive share link, editable from admin. */
  resumeUrl?: string;
  openToWork: boolean;
  socials: Socials;
  githubUsername?: string;
}

export interface Experience {
  slug: string;
  role: string;
  company: string;
  companyUrl?: string;
  /** Company logo. Optional — falls back to a monogram plate. */
  logoUrl?: string;
  /** ISO date or "YYYY-MM". Rendered as a year range. */
  startDate: string;
  /** null means "present". */
  endDate: string | null;
  location?: string;
  summary: string;
  highlights: string[];
  tech: string[];
}

export interface Project {
  slug: string;
  name: string;
  summary: string;
  description: string;
  tech: string[];
  repoUrl?: string;
  liveUrl?: string;
  imageUrl?: string;
  featured: boolean;
}

export interface Skill {
  slug: string;
  name: string;
  category: string;
}

export interface Education {
  slug: string;
  institution: string;
  degree: string;
  field?: string;
  startYear?: string;
  endYear?: string;
  note?: string;
  /** Institution logo. Optional — falls back to a monogram plate. */
  logoUrl?: string;
}

export interface Certification {
  slug: string;
  name: string;
  issuer: string;
  issueDate?: string;
  credentialUrl?: string;
  /** Issuer logo. Optional — falls back to a monogram plate. */
  logoUrl?: string;
}

export interface Testimonial {
  slug: string;
  quote: string;
  authorName: string;
  authorTitle?: string;
  authorCompany?: string;
  authorUrl?: string;
}

export interface Writing {
  slug: string;
  title: string;
  summary: string;
  imageUrl?: string;
  externalUrl: string;
  publishedAt?: string;
  /** e.g. "Medium", "Substack" — shown as a small source label on the card. */
  source?: string;
}

export interface Portfolio {
  profile: Profile;
  experience: Experience[];
  projects: Project[];
  skills: Skill[];
  education: Education[];
  certifications: Certification[];
  testimonials: Testimonial[];
  writing: Writing[];
}

/* --- Addressing ------------------------------------------------------- */

/**
 * The chatbot addresses content as "<section>:<slug>". Building and parsing that
 * string lives here so the tool layer and the UI layer can never drift.
 */
export function itemId(section: SectionId, slug: string): string {
  return `${section}:${slug}`;
}

export function parseItemId(id: string): { section: SectionId; slug: string } | null {
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  const section = id.slice(0, idx) as SectionId;
  const slug = id.slice(idx + 1);
  if (!slug) return null;
  if (!(section in SECTION_LABELS)) return null;
  return { section, slug };
}

/**
 * Every addressable item on the page, flattened. The chat route uses this to
 * validate tool arguments against reality — a hallucinated id is rejected before
 * it can reach the UI and produce a dead highlight.
 */
export function addressableIds(portfolio: Portfolio): Map<string, { section: SectionId; label: string }> {
  const map = new Map<string, { section: SectionId; label: string }>();

  for (const e of portfolio.experience) {
    map.set(itemId("experience", e.slug), { section: "experience", label: `${e.role} at ${e.company}` });
  }
  for (const p of portfolio.projects) {
    map.set(itemId("projects", p.slug), { section: "projects", label: p.name });
  }
  for (const s of portfolio.skills) {
    map.set(itemId("skills", s.slug), { section: "skills", label: s.name });
  }
  for (const e of portfolio.education) {
    map.set(itemId("education", e.slug), { section: "education", label: `${e.degree}, ${e.institution}` });
  }
  for (const c of portfolio.certifications) {
    map.set(itemId("education", c.slug), { section: "education", label: `${c.name} (${c.issuer})` });
  }
  for (const t of portfolio.testimonials) {
    map.set(itemId("testimonials", t.slug), { section: "testimonials", label: `Quote from ${t.authorName}` });
  }
  for (const w of portfolio.writing) {
    map.set(itemId("writing", w.slug), { section: "writing", label: w.title });
  }

  return map;
}
