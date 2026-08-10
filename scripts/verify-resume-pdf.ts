/*
  Compiles a fixture resume and reads the text back out of the PDF.

  This is the test the whole ATS story rests on. Every failure mode here is
  silent: a missed escape produces a document that compiles to something subtly
  wrong, a table-based heading can extract in the wrong order, and a bullet can
  simply not appear. None of it throws, and none of it is obvious from looking
  at the rendered page.

  Needs pdflatex and pdftotext on PATH. Skips cleanly when they're absent so
  the suite still runs on a machine without a TeX installation.

  Run: npx tsx scripts/verify-resume-pdf.ts
*/

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileTex } from "../lib/resume/compile";
import { escapeLatex, renderResume, renderRich } from "../lib/resume/render";
import { resumeMetaSchema, resumeSchema } from "../lib/resume/schema";
import { z } from "zod";
import type { Resume } from "../lib/resume/schema";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function have(bin: string): boolean {
  try {
    execFileSync("command", ["-v", bin], { shell: "/bin/sh", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/*
  Deliberately hostile content. Every one of these characters is special to
  TeX, and all of them occur in the real data — C++, 75% F1-score,
  "Cloud & Infra", snake_case identifiers.
*/
const NASTY = "Cut cost by 50% on C++ & Python_v2 — see #3 {scoped} ~90 $/mo ^2";

const fixture: Resume = {
  header: {
    name: "Anhat Singh",
    location: "Jalandhar, India",
    phone: "+91 95010 30147",
    email: "anhatsingh2001@gmail.com",
    linkedin: "linkedin.com/in/anhatsingh",
    github: "github.com/anhatsingh",
  },
  summary: {
    text: "Backend engineer working on high-performance APIs and data-intensive systems.",
    emphasise: ["high-performance APIs"],
  },
  education: [
    { degree: "BS Data Science and Applications", institution: "IIT Madras", score: "9.26 CGPA", years: "2021 - 2025" },
    { degree: "B.Tech Computer Science", institution: "GNDU Amritsar", score: "9.41 CGPA", years: "2020 - 2024" },
  ],
  experience: [
    {
      company: "Mavenzeit",
      title: "Founding Engineer",
      dates: "Mar 2026 - Present",
      bullets: [
        { text: NASTY, emphasise: ["C++ & Python_v2"], sourceId: "experience:founding-engineer" },
        {
          text: "Built ELT pipelines with dbt over BigQuery and PostgreSQL.",
          emphasise: ["ELT pipelines"],
          sourceId: "experience:founding-engineer",
        },
      ],
    },
    {
      company: "Dom Ventas India",
      title: "Senior Full Stack Developer",
      dates: "Nov 2024 - Jan 2026",
      bullets: [
        {
          text: "Architected a multi-tenant FastAPI backend on Docker, PostgreSQL and Redis.",
          emphasise: ["multi-tenant FastAPI backend"],
          sourceId: "experience:senior-full-stack-developer",
        },
      ],
    },
  ],
  projects: [
    {
      name: "Course Compass",
      context: "Course Project | IIT Madras",
      dates: "Sep 2023 - Dec 2023",
      bullets: [
        {
          text: "Built a learning-path recommender with Flask, Vue and PostgreSQL.",
          emphasise: [],
          sourceId: "projects:course-compass",
        },
      ],
    },
  ],
  skills: [
    { label: "Languages", items: "Python, TypeScript, SQL, C++" },
    { label: "Cloud & Infra", items: "GCP, AWS, Docker, CI/CD" },
  ],
  achievements: [
    { text: "Gold Medalist at GNDU; Academic Distinction at IIT Madras.", emphasise: ["Gold Medalist"] },
  ],
};

console.log("\n── escaping ──");
check("backslash becomes a command, not a stray escape",
  escapeLatex("a\\b") === "a\\textbackslash{}b", escapeLatex("a\\b"));
check("braces escape", escapeLatex("{x}") === "\\{x\\}");
check("percent escapes", escapeLatex("50%") === "50\\%");
check("ampersand escapes", escapeLatex("Cloud & Infra") === "Cloud \\& Infra");
check("hash, underscore, dollar escape",
  escapeLatex("#a_b$") === "\\#a\\_b\\$", escapeLatex("#a_b$"));
check("caret and tilde become commands",
  escapeLatex("^~") === "\\textasciicircum{}\\textasciitilde{}");
// The classic bug: escape "\" to "\textbackslash{}", then a later pass escapes
// the braces that replacement just introduced.
check("escaping is single-pass, so replacements aren't re-escaped",
  !escapeLatex("\\").includes("\\{}"), escapeLatex("\\"));

console.log("\n── emphasis ──");
check("a phrase present verbatim is bolded",
  renderRich({ text: "fast APIs here", emphasise: ["fast APIs"] }) === "\\textbf{fast APIs} here");
check("a phrase that isn't present is dropped, not guessed",
  renderRich({ text: "fast APIs", emphasise: ["slow APIs"] }) === "fast APIs");
check("a phrase containing specials still matches after escaping",
  renderRich({ text: "we cut 50% today", emphasise: ["50%"] }) === "we cut \\textbf{50\\%} today",
  renderRich({ text: "we cut 50% today", emphasise: ["50%"] }));
check("overlapping phrases merge instead of nesting",
  renderRich({ text: "alpha beta gamma", emphasise: ["alpha beta", "beta gamma"] }) ===
    "\\textbf{alpha beta gamma}",
  renderRich({ text: "alpha beta gamma", emphasise: ["alpha beta", "beta gamma"] }));
check("no emphasis leaves text untouched",
  renderRich({ text: "plain", emphasise: [] }) === "plain");
// The model names phrases; it never emits markup. If it tried, escaping turns
// it into literal text rather than executing it.
check("markup in the text is neutralised, not executed",
  renderRich({ text: "\\input{/etc/passwd}", emphasise: [] }).startsWith("\\textbackslash{}input"),
  renderRich({ text: "\\input{/etc/passwd}", emphasise: [] }));

console.log("\n── the schema OpenAI will actually accept ──");
{
  /*
    Structured-output mode requires every property of every object to appear in
    that object's `required` array. An optional field is rejected outright:

      Invalid schema for response_format: 'required' is required to be supplied
      and to be an array including every key in properties. Missing 'location'.

    That failure only happens at call time, against the live API, so nothing in
    the build or the type checker catches a reintroduced .optional(). Hence
    this: walk the emitted JSON Schema and assert the shape the API demands.
    Use .nullable() instead — same meaning, accepted.
  */
  const walk = (node: unknown, path: string, report: string[]) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;

    if (n.type === "object" && n.properties) {
      const props = Object.keys(n.properties as object);
      const required = new Set((n.required as string[]) ?? []);
      for (const key of props) if (!required.has(key)) report.push(`${path}.${key}`);
      for (const key of props) walk((n.properties as Record<string, unknown>)[key], `${path}.${key}`, report);
    }
    if (n.items) walk(n.items, `${path}[]`, report);
    for (const key of ["anyOf", "allOf", "oneOf"]) {
      if (Array.isArray(n[key])) (n[key] as unknown[]).forEach((sub, i) => walk(sub, `${path}.${key}[${i}]`, report));
    }
  };

  for (const [name, schema] of [["resume", resumeSchema], ["resumeMeta", resumeMetaSchema]] as const) {
    const json = z.toJSONSchema(schema as z.ZodType, { io: "output" });
    const missing: string[] = [];
    walk(json, name, missing);
    check(`${name}: every property is required, as structured output demands`,
      missing.length === 0, missing.slice(0, 5).join(", "));
  }
}

console.log("\n── rendering ──");
const tex = renderResume(fixture);
check("preamble is present", tex.includes("\\documentclass"));
check("the ATS unicode lines survive",
  tex.includes("\\input{glyphtounicode}") && tex.includes("\\pdfgentounicode=1"));
check("document is closed", tex.trimEnd().endsWith("\\end{document}"));
check("headings are canonical",
  ["Summary", "Education", "Experience", "Projects", "Technical Skills", "Achievements"].every((h) =>
    tex.includes(`\\section{${h}}`)),
);
// Title first: several parsers assume that order, and the source template had
// company first.
check("title precedes company in the heading",
  tex.indexOf("{Founding Engineer}{Mavenzeit}") > -1);
check("no nested project headings inside experience",
  !tex.slice(tex.indexOf("\\section{Experience}"), tex.indexOf("\\section{Projects}"))
    .includes("\\resumeProjectHeading"));

/*
  Wrapped rather than top-level await: tsx transpiles these scripts to CJS,
  where top-level await is a syntax error.
*/
async function main() {
  console.log("\n── compile and extract ──");
  if (!have("pdflatex") || !have("pdftotext")) {
    console.log("  [SKIP] pdflatex/pdftotext not on PATH — install MacTeX or texlive to run these.");
  } else {
    const result = await compileTex(tex);

    if (!result.ok) {
      check("fixture compiles", false, result.error);
      if (result.log) console.log(result.log.split("\n").slice(-25).join("\n"));
    } else {
      check("fixture compiles", true, `${(result.pdf.length / 1024).toFixed(0)}KB`);
      check("output is a PDF", new TextDecoder().decode(result.pdf.slice(0, 5)) === "%PDF-");

      const dir = mkdtempSync(join(tmpdir(), "resume-verify-"));
      const pdfPath = join(dir, "out.pdf");
      writeFileSync(pdfPath, result.pdf);
      execFileSync("pdftotext", ["-layout", pdfPath, join(dir, "out.txt")]);
      const text = readFileSync(join(dir, "out.txt"), "utf8");
      rmSync(dir, { recursive: true, force: true });

      console.log("\n  ── what an ATS actually sees ──");
      check("name extracts", text.includes("Anhat Singh"));
      check("email extracts", text.includes("anhatsingh2001@gmail.com"));
      check("location extracts", text.includes("Jalandhar"));
      check("phone extracts with country code", text.includes("+91"));

      // The tabular* question from the audit, settled by measurement.
      for (const [role, company, dates] of [
        ["Founding Engineer", "Mavenzeit", "Mar 2026"],
        ["Senior Full Stack Developer", "Dom Ventas India", "Nov 2024"],
      ]) {
        const line = text.split("\n").find((l) => l.includes(company));
        check(`"${company}" extracts on one line with its title and dates`,
          Boolean(line && line.includes(role) && line.includes(dates)),
          line?.trim().slice(0, 90) ?? "not found");
      }

      check("exactly two positions are recoverable",
        text.split("\n").filter((l) => /\b(Founding Engineer|Senior Full Stack Developer)\b/.test(l)).length === 2);

      // The escaping test that matters: the nasty string must come back as the
      // characters a human typed, not as TeX commands.
      for (const fragment of ["50%", "C++", "Python_v2", "#3", "{scoped}", "~90", "$/mo"]) {
        check(`"${fragment}" survives extraction`, text.includes(fragment));
      }
      check("no escape sequences leaked into the text layer",
        !/\\textbf|\\textbackslash|\\%|\\&|\\_/.test(text));

      /*
        Headings must extract exactly. \scshape on a font without a real
        small-caps face fakes it by shrinking the letters after the first, and
        the size change makes extractors inject a space — "Summary" came out
        as "S UMMARY". Section headings are how an ATS segments a resume, so
        this is the most expensive thing on the page to get wrong.
      */
      const HEADINGS = ["Summary", "Education", "Experience", "Projects", "Technical Skills", "Achievements"];
      for (const heading of HEADINGS) {
        const line = text.split("\n").map((l) => l.trim()).find((l) => l.replace(/\s+/g, "") === heading.replace(/\s+/g, ""));
        check(`heading "${heading}" extracts exactly`, line === heading, line ?? "not found");
      }

      check("bullets appear in the order they were written",
        text.indexOf("Cut cost by 50%") < text.indexOf("Built ELT pipelines"),
      );
      check("projects section content extracts", text.includes("Course Compass"));
      check("skills extract with their labels", text.includes("Languages") && text.includes("Cloud & Infra"));

      /*
        pdftotext writes a form feed after every page including the last, so a
        bare split() reports one page too many — which read as a spurious blank
        page until it was checked against pdfinfo.
      */
      const pages = text.split("\f").filter((p) => p.trim()).length;
      check("fits on one or two pages", pages >= 1 && pages <= 2, `${pages} page(s)`);
    }
  }

  console.log(failures === 0 ? "\nAll resume checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
