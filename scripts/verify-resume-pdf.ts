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
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileTex } from "../lib/resume/compile";
import { escapeLatex, renderResume, renderRich, unsupportedCharacters } from "../lib/resume/render";
import { auditExtraction, findMarkdownArtifacts, findUnsupportedCharacters, hasErrors } from "../lib/resume/audit";
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

console.log("\n── characters pdflatex can't typeset ──");
{
  /*
    A draft came back with a stray Korean syllable in it and the compile died
    outright — "Unicode character not set up for use with LaTeX" takes the
    whole document, not just the word. Dropping beats failing, and the audit
    says what went so it is never silent.
  */
  check("a CJK character is reported", unsupportedCharacters("Built 리 the thing").length === 1);
  check("an emoji is reported", unsupportedCharacters("Shipped it 🚀").length === 1);
  check("plain ASCII is untouched", unsupportedCharacters("Built the thing").length === 0);
  check("accented Latin is kept — names depend on it",
    unsupportedCharacters("Café Möller Ångström").length === 0);
  check("smart punctuation is mapped, not reported",
    unsupportedCharacters("it\u2019s \u201cquoted\u201d \u2014 really\u2026").length === 0);

  check("an em dash becomes a LaTeX em dash", escapeLatex("a \u2014 b") === "a --- b");
  check("curly quotes become TeX quotes", escapeLatex("\u201chi\u201d") === "``hi''");
  check("an apostrophe survives", escapeLatex("it\u2019s") === "it's");
  check("an unsupported character is removed rather than breaking the build",
    escapeLatex("a리b") === "ab", escapeLatex("a리b"));
  check("a non-breaking space becomes a space", escapeLatex("a\u00a0b") === "a b");
}

console.log("\n── markdown the model shouldn't emit ──");
{
  const withMarkdown = {
    ...fixture,
    experience: [
      {
        ...fixture.experience[0],
        bullets: [{ text: "Built **FastAPI** services", emphasise: [], sourceId: "experience:x" }],
      },
    ],
  };
  const found = findMarkdownArtifacts(withMarkdown as typeof fixture);
  check("**bold** is caught", found.length === 1, found[0]?.detail ?? "");
  check("it is an error, not a warning", found[0]?.severity === "error");
  check("clean prose produces nothing", findMarkdownArtifacts(fixture).length === 0);

  for (const [label, text] of [
    ["backtick code", "Use `pip install`"],
    ["a markdown link", "See [the repo](https://x.com)"],
    ["a leading dash", "- Built the thing"],
    ["a # heading", "# Experience"],
  ] as Array<[string, string]>) {
    const r = { ...fixture, achievements: [{ text, emphasise: [] }] };
    check(`${label} is caught`, findMarkdownArtifacts(r as typeof fixture).length === 1, text);
  }

  // An asterisk that isn't markup shouldn't trip it.
  const legit = { ...fixture, achievements: [{ text: "Scored 4.5 * 10^3 ops/sec", emphasise: [] }] };
  check("a lone asterisk in prose is not flagged",
    findMarkdownArtifacts(legit as typeof fixture).length === 0);
}

console.log("\n── the audit reads the PDF, not the draft ──");
{
  const nasty = {
    ...fixture,
    achievements: [{ text: "Shipped 리 with **bold**", emphasise: [] }],
  } as typeof fixture;
  check("unsupported characters surface", findUnsupportedCharacters(nasty).length === 1);
  check("both defect kinds are errors", hasErrors(auditExtraction(nasty, "", 1)));

  // Nothing extracted means nothing was verified — reported once, not as a
  // flood of failures against an empty string.
  const blind = auditExtraction(fixture, "", 1);
  check("an unreadable PDF reports once and stops",
    blind.filter((f) => f.check === "extraction").length === 1 && blind.length === 1,
    `${blind.length} findings`);

  // Content that never made it onto the page is the failure this exists for.
  const partial = auditExtraction(
    fixture,
    "Anhat Singh\nJalandhar, India\nanhatsingh2001@gmail.com\n+91 95010 30147\nFounding Engineer | Mavenzeit\nSenior Full Stack Developer | Dom Ventas India\n",
    1,
  );
  check("missing bullets are caught",
    partial.some((f) => f.check === "content"),
    `${partial.filter((f) => f.check === "content").length} missing`);
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
      if (result.trace.texLog) console.log(result.trace.texLog.split("\n").slice(-25).join("\n"));
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

  await remoteContract();

  console.log(failures === 0 ? "\nAll resume checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

/*
  The remote backend, against a stub.

  This is the branch that runs in production — Vercel cannot host a TeX
  installation, so every real resume is compiled over HTTP — and until now it
  had no test at all. The local path above is the one that was covered, and it
  is the one that never runs for a user.

  A stub rather than the real container, because what is being checked here is
  the contract: that a JSON body is parsed, that an older PDF-only deployment
  still works, that a 422 keeps its log, and that the trace survives every one
  of those paths. None of that needs pdflatex, so unlike the tests above these
  run everywhere.
*/
async function remoteContract() {
  console.log("\n── the remote compiler contract ──");

  const PDF = Buffer.from("%PDF-1.4 stub");

  const serve = (handler: (req: IncomingMessage, res: ServerResponse) => void) =>
    new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
      const server = createServer(handler);
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as AddressInfo).port;
        resolve({
          url: `http://127.0.0.1:${port}`,
          close: () => new Promise<void>((done) => server.close(() => done())),
        });
      });
    });

  /** Runs one compile against a stub, with LATEX_SERVICE_URL pointed at it. */
  async function against(handler: (req: IncomingMessage, res: ServerResponse) => void) {
    const stub = await serve(handler);
    const previous = process.env.LATEX_SERVICE_URL;
    process.env.LATEX_SERVICE_URL = stub.url;
    try {
      return await compileTex("\\documentclass{article}\\begin{document}hi\\end{document}");
    } finally {
      if (previous === undefined) delete process.env.LATEX_SERVICE_URL;
      else process.env.LATEX_SERVICE_URL = previous;
      await stub.close();
    }
  }

  // The modern service: JSON carrying the PDF, the text and the trail.
  let seenRequestId: string | undefined;
  let seenAccept: string | undefined;
  const json = await against((req, res) => {
    seenRequestId = req.headers["x-request-id"] as string;
    seenAccept = req.headers.accept as string;
    const body = JSON.stringify({
      pdfBase64: PDF.toString("base64"),
      text: "Anhat Singh\fpage two",
      pages: 2,
      texLog: "Overfull \\hbox badness 10000",
      stdout: "── pass 1 ──\nThis is pdfTeX",
      timings: { pass1Ms: 900, pass2Ms: 850, extractMs: 40 },
      revision: "latex-compiler-00007-abc",
      instance: "00bf4bf02d",
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
  });

  check("a JSON response compiles", json.ok);
  check("it asks for JSON", (seenAccept ?? "").includes("application/json"));
  check("a request id is sent for correlation", Boolean(seenRequestId));
  check("the trace reports the remote backend", json.trace.backend === "remote");
  check("the request id sent is the one traced", json.trace.requestId === seenRequestId);
  check("the status is recorded", json.trace.status === 200);
  check("the TeX log survives", json.trace.texLog.includes("Overfull"));
  check("pdflatex output survives", json.trace.stdout.includes("pdfTeX"));
  check("timings survive", json.trace.timings?.pass1Ms === 900);
  check("the revision survives", json.trace.revision === "latex-compiler-00007-abc");
  check("the instance survives", json.trace.instance === "00bf4bf02d");
  check("the window is ordered", json.trace.startedAt <= json.trace.finishedAt);
  if (json.ok) {
    check("the PDF is decoded from base64", Buffer.from(json.pdf).equals(PDF));
    check("the extracted text comes back", json.text.includes("Anhat Singh"));
    check("the page count is taken from the service", json.pages === 2);
  }

  /*
    The back-compat branch. A deployment predating the JSON response returns
    raw bytes, and it has to keep working — that is the whole reason the
    branch exists in compile.ts.
  */
  const raw = await against((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/pdf" });
    res.end(PDF);
  });
  check("a PDF-only deployment still compiles", raw.ok);
  if (raw.ok) {
    check("its bytes arrive intact", Buffer.from(raw.pdf).equals(PDF));
    check("it reports no extracted text rather than failing", raw.text === "");
  }
  check("it is still traced", raw.trace.status === 200 && raw.trace.backend === "remote");

  // Identity from headers, for a response that carries no JSON to put it in.
  const headers = await against((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "X-Cloud-Run-Revision": "latex-compiler-00009-zzz",
      "X-Cloud-Run-Instance": "aa11bb22",
    });
    res.end(PDF);
  });
  check("the revision is read off the headers", headers.trace.revision === "latex-compiler-00009-zzz");
  check("the instance is read off the headers", headers.trace.instance === "aa11bb22");

  // A compile failure: 422 with the log as the body.
  const failed = await against((_req, res) => {
    res.writeHead(422, { "Content-Type": "text/plain" });
    res.end("! Undefined control sequence.\n\nl.42 \\badmacro");
  });
  check("a 422 is a failure, not a PDF", !failed.ok);
  check("the 422 status is traced", failed.trace.status === 422);
  check("the log survives a 422", failed.trace.texLog.includes("Undefined control sequence"));
  /*
    Both backends must name the same failure the same way. Reporting
    "Compiler returned 422" remotely and "Undefined control sequence" locally
    means the harder environment to investigate gets the worse message.
  */
  check(
    "the TeX error is surfaced, not the HTTP status",
    !failed.ok && failed.error === "Undefined control sequence.",
    failed.ok ? "" : failed.error,
  );

  // Anything else non-2xx — a 401 from the token, a 403 from Cloud Run's door.
  const denied = await against((_req, res) => {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("unauthorised");
  });
  check("a 401 fails rather than returning bytes", !denied.ok);
  check("the 401 status reaches the trace", denied.trace.status === 401);
  check(
    "the status is named in the error, so it is diagnosable",
    !denied.ok && denied.error.includes("401"),
  );

  /*
    A connection that goes nowhere. The trace still has to come back — a
    compile that never reached the service is exactly when someone needs the
    request id and the time window to go looking in Cloud Logging.
  */
  const stub = await serve(() => {});
  const url = stub.url;
  await stub.close();
  const previous = process.env.LATEX_SERVICE_URL;
  process.env.LATEX_SERVICE_URL = url;
  const unreachable = await compileTex("\\documentclass{article}\\begin{document}hi\\end{document}");
  if (previous === undefined) delete process.env.LATEX_SERVICE_URL;
  else process.env.LATEX_SERVICE_URL = previous;

  check("an unreachable compiler fails", !unreachable.ok);
  check("and is still traced", Boolean(unreachable.trace.requestId));
  check("with a window to search Cloud Logging by", Boolean(unreachable.trace.startedAt));
}

main();
