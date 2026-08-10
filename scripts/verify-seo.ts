/*
  Checks the structured data and metadata that a name search depends on.

  Worth automating because these fail silently: a malformed sameAs or a missing
  @id doesn't break the page, it just quietly stops the search engine connecting
  this domain to the GitHub and LinkedIn profiles — which is the entire point.

  Run: npx tsx scripts/verify-seo.ts
*/

import { seedPortfolio } from "../lib/content/seed";
import { buildDescription, buildPersonJsonLd, buildProjectsJsonLd, SITE_URL } from "../lib/seo";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const AVATAR = "https://anhatsingh.com/portrait.jpg";

console.log("\n── description ──");
const desc = buildDescription(seedPortfolio);
console.log(`  "${desc}"`);
check("mentions the full name", desc.includes(seedPortfolio.profile.name));
check("mentions the role", desc.includes(seedPortfolio.profile.tagline));
check("uses the correct article", !/\bis a [AEIOU]/.test(desc), desc.match(/is an? \S+/)?.[0] ?? "");
check("no double spaces", !desc.includes("  "));
check("stays under 300 chars", desc.length <= 300, `${desc.length} chars`);

console.log("\n── Person / ProfilePage graph ──");
const graph = buildPersonJsonLd(seedPortfolio, AVATAR) as {
  "@context": string;
  "@graph": Array<Record<string, unknown>>;
};

check("has @context", graph["@context"] === "https://schema.org");
check("serialises to valid JSON", (() => {
  try { JSON.parse(JSON.stringify(graph)); return true; } catch { return false; }
})());

const byType = (t: string) => graph["@graph"].find((n) => n["@type"] === t);
const person = byType("Person");
const page = byType("ProfilePage");
const site = byType("WebSite");

check("contains Person", Boolean(person));
check("contains ProfilePage", Boolean(page));
check("contains WebSite", Boolean(site));

check("Person has a stable @id", person?.["@id"] === `${SITE_URL}/#person`);
check("ProfilePage points at the Person", (page?.about as { "@id": string })?.["@id"] === `${SITE_URL}/#person`);
check("WebSite publisher points at the Person", (site?.publisher as { "@id": string })?.["@id"] === `${SITE_URL}/#person`);

const sameAs = (person?.sameAs ?? []) as string[];
check("sameAs is populated", sameAs.length > 0, `${sameAs.length} profiles`);
check("every sameAs is an absolute https URL", sameAs.every((u) => /^https:\/\//.test(u)), sameAs.join(", "));
check("sameAs has no empty entries", sameAs.every(Boolean));

check("image is absolute", typeof person?.image === "string" && /^https:\/\//.test(person.image as string));
check("url is the canonical site", person?.url === SITE_URL);
check("email is a mailto URI", String(person?.email).startsWith("mailto:"));
check("jobTitle present", Boolean(person?.jobTitle));
check("knowsAbout populated from skills", ((person?.knowsAbout ?? []) as string[]).length === seedPortfolio.skills.length);
check("alumniOf populated from education", ((person?.alumniOf ?? []) as unknown[]).length === seedPortfolio.education.length);

console.log("\n── projects ItemList ──");
const projects = buildProjectsJsonLd(seedPortfolio) as {
  itemListElement: Array<{ position: number; item: Record<string, unknown> }>;
} | null;

check("built when projects exist", Boolean(projects));
if (projects) {
  check("one entry per project", projects.itemListElement.length === seedPortfolio.projects.length);
  check("positions are 1-indexed and sequential",
    projects.itemListElement.every((e, i) => e.position === i + 1));
  check("every item has an absolute url",
    projects.itemListElement.every((e) => /^https:\/\//.test(String(e.item.url))),
  );
  check("every item credits the Person node",
    projects.itemListElement.every((e) => (e.item.author as { "@id": string })["@id"] === `${SITE_URL}/#person`),
  );
}

console.log("\n── empty-portfolio safety ──");
const bare = {
  ...seedPortfolio,
  projects: [],
  skills: [],
  education: [],
  certifications: [],
  experience: [],
};
check("projects list omitted when there are none", buildProjectsJsonLd(bare) === null);
check("person graph still builds with nothing optional", (() => {
  try { JSON.parse(JSON.stringify(buildPersonJsonLd(bare, AVATAR))); return true; } catch { return false; }
})());

console.log(failures === 0 ? "\nAll SEO checks passed.\n" : `\n${failures} SEO check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
