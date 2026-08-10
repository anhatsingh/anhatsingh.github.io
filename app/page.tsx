import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { JsonLd } from "@/components/seo/json-ld";
import { About } from "@/components/sections/about";
import { Contact } from "@/components/sections/contact";
import { Education } from "@/components/sections/education";
import { Experience } from "@/components/sections/experience";
import { GitHub } from "@/components/sections/github";
import { Hero } from "@/components/sections/hero";
import { LeetCode } from "@/components/sections/leetcode";
import { Projects } from "@/components/sections/projects";
import { Skills } from "@/components/sections/skills";
import { Testimonials } from "@/components/sections/testimonials";
import { Writing } from "@/components/sections/writing";
import { defaultAvatar } from "@/components/ui/default-avatar";
import { getPortfolio } from "@/lib/content";
import { getGitHubStats } from "@/lib/github/service";
import { getLeetCodeStats } from "@/lib/leetcode/service";
import {
  SITE_URL,
  absoluteUrl,
  buildDescription,
  buildPersonJsonLd,
  buildProjectsJsonLd,
} from "@/lib/seo";
import { listPublishedResumes } from "@/lib/resume/store";

/*
  Regenerate at most once a minute.

  Without this the page inherited a 1-hour revalidate from the GitHub fetch's
  own TTL, so a change made straight to the database took up to an hour to
  appear. Edits through /admin were fine — those call revalidatePath and update
  instantly — but anything out-of-band (a SQL editor, a maintenance script)
  looked like it simply hadn't worked.

  This costs at most one Supabase read per minute, and only when someone is
  actually visiting. The GitHub and LeetCode fetches keep their own longer TTLs
  regardless, so a faster page doesn't mean hammering third-party APIs.
*/
export const revalidate = 60;

/*
  Server component. Content and GitHub stats are both fetched here so the page
  arrives complete — no client-side waterfall, the chatbot is guaranteed to be
  reasoning over the same snapshot the visitor sees, and every word is in the
  initial HTML where a crawler can read it.
*/

/**
 * Metadata is derived from the live profile rather than hardcoded, so editing
 * the headline in /admin updates the search result and the share card too.
 */
export async function generateMetadata(): Promise<Metadata> {
  const portfolio = await getPortfolio();
  const { profile } = portfolio;
  const description = buildDescription(portfolio);

  const title = `${profile.name} — ${profile.tagline}`;

  return {
    title: { absolute: title },
    description,
    // Canonical stops the apex/www/vercel.app variants competing with each
    // other for the same query.
    alternates: { canonical: SITE_URL },
    keywords: [
      profile.name,
      profile.githubUsername,
      profile.tagline,
      ...portfolio.skills.slice(0, 10).map((s) => s.name),
    ].filter((k): k is string => Boolean(k)),
    authors: [{ name: profile.name, url: SITE_URL }],
    creator: profile.name,
    publisher: profile.name,
    openGraph: {
      type: "profile",
      url: SITE_URL,
      siteName: profile.name,
      title,
      description,
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        // Lets Google show a full-length snippet and a large image rather than
        // truncating to its conservative defaults.
        "max-snippet": -1,
        "max-image-preview": "large",
        "max-video-preview": -1,
      },
    },
    verification: process.env.GOOGLE_SITE_VERIFICATION
      ? { google: process.env.GOOGLE_SITE_VERIFICATION }
      : undefined,
  };
}

export default async function HomePage() {
  const portfolio = await getPortfolio();

  /*
    The current month, resolved here and passed down so the life graph's
    "present" spans are identical on the server and in the browser. Computing
    it inside the client component would disagree across a timezone or a month
    boundary and hydrate with a mismatch. It refreshes with the page's own
    60-second revalidation, which is far finer than monthly.
  */
  const nowDate = new Date();
  const nowMonth = nowDate.getFullYear() * 12 + nowDate.getMonth();

  /*
    Variant names for the chat's role suggestions, resolved here rather than
    handed to the model. The assistant asks an open question and emits a
    marker; these render as controls beside its answer, so it still cannot list
    them in prose or be talked into naming them.
  */
  const resumeOptions = (await listPublishedResumes().catch(() => [])).map((r) => r.label);

  // Neither third party can take the page down with it — both resolve to null
  // on any failure and their sections simply don't render.
  const [githubStats, leetcodeStats] = await Promise.all([
    portfolio.profile.githubUsername
      ? getGitHubStats(portfolio.profile.githubUsername, portfolio.profile.selectedRepos).catch(() => null)
      : null,
    portfolio.profile.leetcodeUsername
      ? getLeetCodeStats(portfolio.profile.leetcodeUsername).catch(() => null)
      : null,
  ]);

  const avatarUrl = portfolio.profile.avatarUrl?.trim()
    ? absoluteUrl(portfolio.profile.avatarUrl)
    : absoluteUrl(defaultAvatar.src);

  const projectsJsonLd = buildProjectsJsonLd(portfolio);

  return (
    <>
      <JsonLd data={buildPersonJsonLd(portfolio, avatarUrl)} />
      {projectsJsonLd && <JsonLd data={projectsJsonLd} />}

      <SiteShell
        name={portfolio.profile.name}
        avatarUrl={portfolio.profile.avatarUrl}
        resumeUrl={portfolio.profile.resumeUrl}
        resumeOptions={resumeOptions}
      >
        <Hero profile={portfolio.profile} />
        <About profile={portfolio.profile} portfolio={portfolio} nowMonth={nowMonth} />
        <Projects projects={portfolio.projects} />
        <Experience experience={portfolio.experience} />
        <GitHub stats={githubStats} />
        <LeetCode stats={leetcodeStats} />
        <Skills skills={portfolio.skills} />
        <Education education={portfolio.education} certifications={portfolio.certifications} />
        <Testimonials testimonials={portfolio.testimonials} />
        <Writing writing={portfolio.writing} />
        <Contact profile={portfolio.profile} />

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline py-10">
          <p className="font-mono text-xs text-muted">
            Built with Next.js. The chatbot drives the page — that part was the fun bit.
          </p>
          <a
            href="/how-it-works"
            className="font-mono text-xs uppercase tracking-widest text-accent hover:underline"
          >
            how it works →
          </a>
        </footer>
      </SiteShell>
    </>
  );
}
