/*
  Verifies the LinkedIn export parser against a synthetic archive shaped like a
  real "Get a copy of your data" download — including the quirks that actually
  break naive parsers: nested folders, "Mar 2024" dates, blank end dates for
  current roles, quoted commas in descriptions, and duplicate skills.

  Run: npx tsx scripts/verify-linkedin.ts
*/

import JSZip from "jszip";
import { normalizeDate, parseLinkedInExport, slugify } from "../lib/linkedin/import";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(`  [${condition ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function buildFakeExport(): Promise<Buffer> {
  const zip = new JSZip();
  // Real exports nest under a folder; the parser must find files by basename.
  const dir = zip.folder("Basic_LinkedInDataExport_08-10-2026")!;

  dir.file(
    "Profile.csv",
    `First Name,Last Name,Headline,Summary,Industry\nAnhat,Singh,"AI/ML Engineer, ex-Placeholder","I build LLM systems, mostly.",Software`,
  );

  dir.file(
    "Positions.csv",
    `Company Name,Title,Description,Location,Started On,Finished On\n` +
      `Placeholder Co,Machine Learning Engineer,"Owned retrieval, evals, and inference.",Remote,Mar 2024,\n` +
      `Placeholder Labs,Data Engineer,"Built pipelines at 200GB/day.","Bengaluru, India",Jun 2022,Feb 2024`,
  );

  dir.file(
    "Education.csv",
    `School Name,Start Date,End Date,Notes,Degree Name,Activities\n` +
      `Guru Nanak Dev University,2017,2021,,B.Tech Computer Science,`,
  );

  // Duplicate entry on purpose — LinkedIn exports contain them.
  dir.file("Skills.csv", `Name\nPython\nPyTorch\nPython\nRAG`);

  dir.file(
    "Projects.csv",
    `Title,Description,Url,Started On,Finished On\n` +
      `Web-Differential Engine,"Watches a page and reports what changed.",https://github.com/anhatsingh/Web-Differential-Engine,Nov 2020,\n` +
      `Course Compass,"Recommends electives, no repo.",,Sep 2023,`,
  );

  // One VISIBLE and one PENDING — the pending one must not be imported.
  dir.file(
    "Recommendations_Received.csv",
    `First Name,Last Name,Company,Job Title,Text,Creation Date,Status\n` +
      `Jasleen,Kaur,Valtech,Software Engineer,"Ships carefully, explains clearly.",Jan 2024,VISIBLE\n` +
      `Aashish,Trikha,Busineswise,Co-Founder,"Not yet accepted.",Feb 2024,PENDING`,
  );

  dir.file("Honors.csv", `Title,Description,Issued On\nAcademic Distinction,"CGPA above 9.5.",Dec 2023`);
  dir.file(
    "TestScores.csv",
    `Tested On,Name,Description,Score\nJan 2015,National Cyber Olympiad,"Conducted by SOF.",97 Percentile`,
  );
  dir.file(
    "Volunteering.csv",
    `Company Name,Role,Cause,Started On,Finished On,Description\nGDSC - GNDU,Team Lead - Web Development,Education,Aug 2020,Jul 2021,"Ran the web track."`,
  );

  dir.file(
    "Certifications.csv",
    `Name,Url,Authority,Started On,Finished On,License Number\n` +
      `Deep Learning Specialization,https://coursera.org/verify/abc,Coursera,Jan 2023,,ABC123`,
  );

  return zip.generateAsync({ type: "nodebuffer" });
}

async function main() {
  console.log("\n── normalizeDate ──");
  check("'Mar 2024' → 2024-03", normalizeDate("Mar 2024") === "2024-03");
  check("'2021' → 2021", normalizeDate("2021") === "2021");
  check("empty → null", normalizeDate("") === null);
  check("undefined → null", normalizeDate(undefined) === null);
  check("'December 2020' → 2020-12", normalizeDate("December 2020") === "2020-12");

  console.log("\n── slugify ──");
  check(
    "role + company → kebab",
    slugify("Machine Learning Engineer", "Placeholder Co") ===
      "machine-learning-engineer-placeholder-co",
    slugify("Machine Learning Engineer", "Placeholder Co"),
  );
  check("punctuation stripped", !slugify("C++ / Rust!", "Acme").includes("+"));

  console.log("\n── full archive parse ──");
  const buf = await buildFakeExport();
  // JSZip accepts a Buffer; the browser signature is File|Blob.
  const result = await parseLinkedInExport(buf as unknown as Blob);

  check("headline extracted", result.headline === "AI/ML Engineer, ex-Placeholder", result.headline);
  check("2 positions parsed", result.experience.length === 2, `got ${result.experience.length}`);

  const current = result.experience[0];
  check("current role has null end date", current.end_date === null);
  check("start date normalised", current.start_date === "2024-03", current.start_date);
  check(
    "quoted comma in description survives",
    current.summary === "Owned retrieval, evals, and inference.",
    current.summary,
  );
  check(
    "location with comma survives",
    result.experience[1].location === "Bengaluru, India",
    String(result.experience[1].location),
  );

  check("1 education parsed", result.education.length === 1);
  check(
    "education years are year-only",
    result.education[0].start_year === "2017" && result.education[0].end_year === "2021",
  );

  check("duplicate skills deduped (4 rows → 3)", result.skills.length === 3, `got ${result.skills.length}`);
  // Honours and test scores share this table, so assert the mix, not a count —
  // a bare number would have to be edited every time a new source is added.
  check(
    "certifications hold the real cert plus the honour and the test score",
    result.certifications.length === 3,
    result.certifications.map((c) => c.issuer).join(", "),
  );
  const realCert = result.certifications.find((c) => c.issuer === "Coursera");
  check(
    "certification issuer + url",
    realCert?.credential_url === "https://coursera.org/verify/abc",
  );

  check("nothing reported missing for a full archive", result.missing.length === 0, result.missing.join(", "));

  console.log("\n── projects ──");
  check("2 projects parsed", result.projects.length === 2, `got ${result.projects.length}`);
  const repoProject = result.projects.find((p) => p.name.startsWith("Web-Differential"));
  check("a GitHub url lands in repo_url, not live_url",
    repoProject?.repo_url?.includes("github.com") === true && repoProject?.live_url === null);
  const noRepo = result.projects.find((p) => p.name === "Course Compass");
  check("a project with no url keeps both null", noRepo?.repo_url === null && noRepo?.live_url === null);
  check("summary is the first sentence, not the whole description",
    repoProject?.summary.endsWith("changed.") === true, repoProject?.summary);

  console.log("\n── recommendations ──");
  check("only VISIBLE recommendations import", result.testimonials.length === 1,
    result.testimonials.map((t) => t.author_name).join(", "));
  check("the imported one is the visible one", result.testimonials[0]?.author_name === "Jasleen Kaur");
  check("PENDING is reported as skipped, not silently dropped",
    result.skipped.some((s) => s.file === "Recommendations_Received.csv" && s.rows === 1));
  check("author title and company carried",
    result.testimonials[0]?.author_title === "Software Engineer" &&
      result.testimonials[0]?.author_company === "Valtech");

  console.log("\n── honours and test scores ──");
  const honour = result.certifications.find((c) => c.name === "Academic Distinction");
  check("honour imported", Boolean(honour));
  check("issuer stays a short label, not the description",
    honour?.issuer === "Honour", honour?.issuer);
  check("the long text is carried separately for the page body",
    honour?.description?.includes("CGPA") === true);
  const score = result.certifications.find((c) => c.name.includes("National Cyber Olympiad"));
  check("test score name includes the score", score?.name.includes("97 Percentile") === true, score?.name);

  console.log("\n── volunteering ──");
  check("1 volunteering role parsed", result.volunteering.length === 1);
  check("role and organisation both captured",
    result.volunteering[0]?.role === "Team Lead - Web Development" &&
      result.volunteering[0]?.company === "GDSC - GNDU");

  console.log("\n── partial archive (Skills only) ──");
  const partial = new JSZip();
  partial.file("Skills.csv", `Name\nPython`);
  const partialResult = await parseLinkedInExport(
    (await partial.generateAsync({ type: "nodebuffer" })) as unknown as Blob,
  );
  check("parses without throwing", partialResult.skills.length === 1);
  check(
    "missing files reported so a partial export is obvious",
    partialResult.missing.includes("Positions.csv"),
    partialResult.missing.join(", "),
  );

  console.log("\n── slug stability (re-import safety) ──");
  const second = await parseLinkedInExport((await buildFakeExport()) as unknown as Blob);
  check(
    "same input produces identical slugs, so upsert updates rather than duplicates",
    JSON.stringify(second.experience.map((e) => e.slug)) ===
      JSON.stringify(result.experience.map((e) => e.slug)),
  );

  console.log(failures === 0 ? "\nAll LinkedIn parser checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
