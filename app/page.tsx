import { SiteShell } from "@/components/site-shell";
import { About } from "@/components/sections/about";
import { Contact } from "@/components/sections/contact";
import { Education } from "@/components/sections/education";
import { Experience } from "@/components/sections/experience";
import { GitHub } from "@/components/sections/github";
import { Hero } from "@/components/sections/hero";
import { Projects } from "@/components/sections/projects";
import { Skills } from "@/components/sections/skills";
import { Testimonials } from "@/components/sections/testimonials";
import { Writing } from "@/components/sections/writing";
import { getPortfolio } from "@/lib/content";
import { getGitHubStats } from "@/lib/github/service";

/*
  Server component. Content and GitHub stats are both fetched here so the page
  arrives complete — no client-side waterfall, and the chatbot is guaranteed to
  be reasoning over the same snapshot the visitor is looking at.
*/
export default async function HomePage() {
  const portfolio = await getPortfolio();

  // Never let a GitHub outage take the page down with it.
  const githubStats = portfolio.profile.githubUsername
    ? await getGitHubStats(portfolio.profile.githubUsername).catch(() => null)
    : null;

  return (
    <SiteShell name={portfolio.profile.name} avatarUrl={portfolio.profile.avatarUrl}>
      <Hero profile={portfolio.profile} />
      <About profile={portfolio.profile} />
      <Projects projects={portfolio.projects} />
      <Experience experience={portfolio.experience} />
      <GitHub stats={githubStats} />
      <Skills skills={portfolio.skills} />
      <Education education={portfolio.education} certifications={portfolio.certifications} />
      <Testimonials testimonials={portfolio.testimonials} />
      <Writing writing={portfolio.writing} />
      <Contact profile={portfolio.profile} />

      <footer className="border-t border-hairline py-10">
        <p className="font-mono text-xs text-muted">
          Built with Next.js. The chatbot drives the page — that part was the fun bit.
        </p>
      </footer>
    </SiteShell>
  );
}
