import { socialLinks, type Portfolio } from "@/lib/content/types";

/*
  SEO helpers.

  The single highest-leverage thing for a NAME query is the Person JSON-LD
  below — specifically `sameAs`. That's how a search engine connects this domain
  to the GitHub and LinkedIn profiles it already knows about, and treats them as
  one entity rather than three unrelated pages. Without it the site is just
  another document that happens to contain the words "Anhat Singh".

  Everything else here (titles, descriptions, sitemap) is table stakes that only
  matters once that association exists.
*/

export const SITE_URL = "https://anhatsingh.com";

/** Absolute URL for a path — schema.org and OG tags both reject relative ones. */
export function absoluteUrl(path = "/"): string {
  return new URL(path, SITE_URL).toString();
}

/**
 * "a" or "an" for a role that's admin-authored and could start with anything.
 * Vowel-letter matching alone gets "an AI/ML Engineer" wrong the other way for
 * consonant-sounding vowels, so initialisms are checked explicitly: A, E, F, H,
 * I, L, M, N, O, R, S and X all begin with a vowel *sound* when spelled out.
 */
function article(word: string): "a" | "an" {
  const first = word.trim().charAt(0);
  if (!first) return "a";

  const isInitialism = /^[A-Z]{2,}/.test(word.trim());
  if (isInitialism) return /^[AEFHILMNORSX]/.test(first) ? "an" : "a";

  return /^[aeiou]/i.test(first) ? "an" : "a";
}

/**
 * Builds a description that reads like a sentence rather than a keyword list.
 * Stuffed descriptions get rewritten by Google anyway, and they read badly in
 * the result — which costs clicks, the thing ranking is supposed to win.
 */
export function buildDescription(portfolio: Portfolio): string {
  const { profile } = portfolio;
  const topSkills = portfolio.skills.slice(0, 4).map((s) => s.name).join(", ");
  const status = profile.openToWork ? " Currently open to new roles." : "";

  const base = `${profile.name} is ${article(profile.tagline)} ${profile.tagline}${
    profile.location ? ` based in ${profile.location}` : ""
  }.${status}`;

  const detail = topSkills ? ` Works with ${topSkills}.` : "";
  const hook = " Ask the site's assistant anything about his work.";

  // Search results truncate around 160 characters; keep the meaningful part first.
  return `${base}${detail}${hook}`.slice(0, 300);
}

/**
 * Person + ProfilePage structured data.
 *
 * ProfilePage wrapping Person is the schema Google documents for "this page is
 * about one person", which is exactly the shape of a portfolio homepage.
 */
export function buildPersonJsonLd(portfolio: Portfolio, avatarUrl: string) {
  const { profile } = portfolio;

  // sameAs is the entity-resolution signal. Only include profiles that are
  // genuinely the same person — a wrong link here actively confuses the graph.
  //
  // Read through socialLinks() rather than profile.socials: the stored jsonb is
  // empty for rows created through the admin form, and reading it directly
  // silently emitted sameAs: [] — dropping the one field that connects this
  // domain to the GitHub and LinkedIn profiles.
  const links = socialLinks(profile);
  const sameAs = [links.github, links.linkedin, links.leetcode, links.twitter].filter(
    (url): url is string => Boolean(url),
  );

  const currentRole = portfolio.experience.find((e) => e.endDate === null);

  const person: Record<string, unknown> = {
    "@type": "Person",
    "@id": `${SITE_URL}/#person`,
    name: profile.name,
    // Helps match searches that use the handle rather than the full name.
    alternateName: profile.githubUsername,
    url: SITE_URL,
    image: avatarUrl,
    jobTitle: profile.tagline,
    description: profile.bio,
    email: `mailto:${profile.email}`,
    sameAs,
  };

  if (profile.location) {
    person.address = { "@type": "PostalAddress", addressLocality: profile.location };
  }

  if (currentRole) {
    person.worksFor = {
      "@type": "Organization",
      name: currentRole.company,
      ...(currentRole.companyUrl ? { url: currentRole.companyUrl } : {}),
    };
  }

  if (portfolio.education.length) {
    person.alumniOf = portfolio.education.map((e) => ({
      "@type": "EducationalOrganization",
      name: e.institution,
    }));
  }

  if (portfolio.skills.length) {
    // knowsAbout is how you state topical expertise without stuffing prose.
    person.knowsAbout = portfolio.skills.map((s) => s.name);
  }

  if (portfolio.certifications.length) {
    person.hasCredential = portfolio.certifications.map((c) => ({
      "@type": "EducationalOccupationalCredential",
      name: c.name,
      credentialCategory: "certification",
      recognizedBy: { "@type": "Organization", name: c.issuer },
    }));
  }

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        "@id": `${SITE_URL}/#page`,
        url: SITE_URL,
        name: `${profile.name} — ${profile.tagline}`,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#person` },
        primaryImageOfPage: avatarUrl,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: profile.name,
        publisher: { "@id": `${SITE_URL}/#person` },
        inLanguage: "en",
      },
      person,
    ],
  };
}

/**
 * Projects as CreativeWork. Gives the portfolio entries a chance at their own
 * result rather than only ever surfacing as part of the homepage.
 */
export function buildProjectsJsonLd(portfolio: Portfolio) {
  if (!portfolio.projects.length) return null;

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Projects by ${portfolio.profile.name}`,
    itemListElement: portfolio.projects.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "SoftwareSourceCode",
        name: p.name,
        description: p.summary || p.description,
        url: p.liveUrl ?? p.repoUrl ?? absoluteUrl("/#projects"),
        ...(p.repoUrl ? { codeRepository: p.repoUrl } : {}),
        ...(p.tech.length ? { programmingLanguage: p.tech } : {}),
        author: { "@id": `${SITE_URL}/#person` },
      },
    })),
  };
}
