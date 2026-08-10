/*
  One-time bootstrap: LinkedIn export + GitHub → projects, testimonials,
  certifications, and page bodies.

  The /admin importer covers experience, education, skills and certifications.
  This does the parts that need more than a CSV read:

   - Cross-references each LinkedIn project against GitHub, by URL where one is
     given and by name where it isn't, then pulls live metadata: description,
     language, stars, last push, and whether the repo is private.
   - Builds a real page body for each project — the LinkedIn description as
     prose, plus a github block that renders live repo data, plus a link block
     when there's a demo URL.
   - Imports recommendations as testimonials, honours and test scores as
     certifications, and volunteering as unpublished experience.

  Dry run by default. Nothing is written without --apply.

  Usage:
    npx tsx scripts/bootstrap-linkedin.ts "path/to/export.zip"
    npx tsx scripts/bootstrap-linkedin.ts "path/to/export.zip" --apply
*/

import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseLinkedInExport, type ImportResult } from "../lib/linkedin/import";
import { checkSupabaseUrl } from "../lib/supabase/config";
import type { Block } from "../lib/content/blocks";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });

const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const WARN = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

interface Repo {
  nameWithOwner: string;
  name: string;
  description: string | null;
  primaryLanguage: string | null;
  languages: string[];
  stars: number;
  isPrivate: boolean;
  pushedAt: string;
  url: string;
  homepageUrl: string | null;
}

/** Every repo the PAT can see, including private and organisation ones. */
async function fetchRepos(): Promise<Repo[]> {
  const token = process.env.GH_STATS_PAT;
  if (!token) return [];

  const query = `{
    viewer {
      repositories(first: 100, isFork: false,
        ownerAffiliations: [OWNER, ORGANIZATION_MEMBER, COLLABORATOR],
        orderBy: { field: PUSHED_AT, direction: DESC }) {
        nodes {
          nameWithOwner name description url homepageUrl
          isPrivate pushedAt stargazerCount
          primaryLanguage { name }
          languages(first: 8, orderBy: { field: SIZE, direction: DESC }) {
            edges { node { name } }
          }
        }
      }
    }
  }`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);

  const json = (await res.json()) as {
    data?: { viewer: { repositories: { nodes: Array<Record<string, unknown>> } } };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));

  return (json.data?.viewer.repositories.nodes ?? []).map((n) => ({
    nameWithOwner: n.nameWithOwner as string,
    name: n.name as string,
    description: (n.description as string) ?? null,
    primaryLanguage: (n.primaryLanguage as { name: string } | null)?.name ?? null,
    languages: ((n.languages as { edges: Array<{ node: { name: string } }> }).edges ?? []).map(
      (e) => e.node.name,
    ),
    stars: n.stargazerCount as number,
    isPrivate: n.isPrivate as boolean,
    pushedAt: n.pushedAt as string,
    url: n.url as string,
    homepageUrl: (n.homepageUrl as string) || null,
  }));
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Matches a LinkedIn project to a GitHub repo.
 *
 * URL first — it's an explicit statement and beats any heuristic. Only when
 * there's no URL does it fall back to comparing normalised names, and it
 * requires one to contain the other rather than a loose similarity score:
 * a wrong repo attached to a project is worse than no repo at all.
 */
function matchRepo(
  title: string,
  url: string | null,
  repos: Repo[],
): { repo: Repo | null; how: string } {
  if (url) {
    const m = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
    if (m) {
      const wanted = `${m[1]}/${m[2]}`.replace(/\.git$/, "").toLowerCase();
      const exact = repos.find((r) => r.nameWithOwner.toLowerCase() === wanted);
      if (exact) return { repo: exact, how: "url" };
      // The URL names a repo the token can't see, or one since renamed. Keep
      // the URL — it's still what he linked — but don't claim live metadata.
      return { repo: null, how: "url (repo not visible)" };
    }
  }

  const target = normalise(title);
  if (target.length < 4) return { repo: null, how: "—" };

  const candidates = repos.filter((r) => {
    const n = normalise(r.name);
    return n.includes(target) || target.includes(n);
  });
  if (candidates.length === 1) return { repo: candidates[0], how: "name" };
  if (candidates.length > 1) {
    // Ambiguous: prefer the most recently pushed, but say so in the report.
    const best = [...candidates].sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))[0];
    return { repo: best, how: `name (${candidates.length} matched, took newest)` };
  }
  return { repo: null, how: "—" };
}

/** Turns a LinkedIn description plus a matched repo into a real page body. */
function buildBody(description: string, repo: Repo | null, repoUrl: string | null, liveUrl: string | null): Block[] {
  const blocks: Block[] = [];

  for (const para of description.split(/\n{1,}/).map((p) => p.trim()).filter(Boolean)) {
    blocks.push({ type: "text", markdown: para });
  }

  if (repo) {
    blocks.push({
      type: "github",
      repo: repo.nameWithOwner,
      // Only add a note when the repo has its own description worth showing;
      // an empty note renders as an empty line.
      ...(repo.description ? { note: repo.description } : {}),
    });
  } else if (repoUrl) {
    blocks.push({ type: "link", url: repoUrl, title: "Source on GitHub" });
  }

  if (liveUrl) blocks.push({ type: "link", url: liveUrl, title: "Live demo" });

  return blocks;
}

function client(): SupabaseClient {
  const { url, problem } = checkSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!url) throw new Error(problem ?? "NEXT_PUBLIC_SUPABASE_URL not set");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const zipPath = args.find((a) => !a.startsWith("--"));

  if (!zipPath) {
    console.error(`\n${RED}Give it the export zip:${RESET}\n  npx tsx scripts/bootstrap-linkedin.ts "export.zip" [--apply]\n`);
    process.exit(1);
  }

  console.log(`\nReading ${DIM}${zipPath}${RESET}`);
  const parsed: ImportResult = await parseLinkedInExport(
    readFileSync(zipPath) as unknown as Blob,
  );

  console.log(`\n${GREEN}Parsed${RESET}  ${parsed.experience.length} roles · ${parsed.education.length} education · ${parsed.skills.length} skills · ${parsed.projects.length} projects · ${parsed.testimonials.length} recommendations · ${parsed.certifications.length} honours/scores · ${parsed.volunteering.length} volunteering`);

  if (parsed.skipped.length) {
    console.log(`\n${DIM}Seen and skipped:${RESET}`);
    for (const s of parsed.skipped) console.log(`  ${DIM}${s.file} (${s.rows}) — ${s.why}${RESET}`);
  }

  console.log("\nFetching GitHub repositories…");
  let repos: Repo[] = [];
  try {
    repos = await fetchRepos();
    console.log(`  ${repos.length} repos visible`);
    const orgs = [...new Set(repos.map((r) => r.nameWithOwner.split("/")[0]))].filter(
      (o) => o.toLowerCase() !== (process.env.GITHUB_LOGIN ?? "anhatsingh").toLowerCase(),
    );
    if (orgs.length) console.log(`  orgs: ${orgs.join(", ")}`);
  } catch (err) {
    console.log(`  ${WARN}GitHub unavailable (${err instanceof Error ? err.message : err}) — projects import without live metadata${RESET}`);
  }

  console.log("\n── Projects ──");
  const projectRows = parsed.projects.map((p, i) => {
    const { repo, how } = matchRepo(p.name, p.repo_url ?? p.live_url, repos);
    const tech = repo ? repo.languages.slice(0, 6) : [];
    const body = buildBody(p.description, repo, p.repo_url, p.live_url);

    console.log(
      `  ${p.name.slice(0, 40).padEnd(42)} ${repo ? GREEN + repo.nameWithOwner + (repo.isPrivate ? " [private]" : "") + RESET : DIM + "no repo" + RESET}  ${DIM}via ${how}${RESET}`,
    );
    if (tech.length) console.log(`      ${DIM}tech: ${tech.join(", ")}${RESET}`);

    return {
      slug: p.slug,
      name: p.name,
      summary: p.summary || repo?.description || "",
      description: p.description,
      repo_url: repo?.url ?? p.repo_url,
      live_url: repo?.homepageUrl ?? p.live_url,
      tech,
      body,
      featured: Boolean(repo && !repo.isPrivate),
      sort_order: i,
      // Private repos still import, but unpublished — the name alone can leak
      // a client engagement, and that's his call to make, not the script's.
      is_published: !repo?.isPrivate,
    };
  });

  console.log("\n── Testimonials ──");
  for (const t of parsed.testimonials) {
    console.log(`  ${t.author_name} ${DIM}· ${t.author_title ?? ""} @ ${t.author_company ?? ""}${RESET}`);
  }

  console.log("\n── Certifications (honours + test scores) ──");
  const certRows = parsed.certifications.map((c, i) => {
    // The long LinkedIn text becomes the page body; `issuer` stays a label.
    const body: Block[] = (c.description ?? "")
      .split(/\n{1,}/)
      .map((para) => para.trim())
      .filter(Boolean)
      .map((markdown) => ({ type: "text" as const, markdown }));

    console.log(`  ${c.name.slice(0, 52).padEnd(54)} ${DIM}${c.issuer}${body.length ? ` · ${body.length} block(s)` : ""}${RESET}`);

    return {
      slug: c.slug,
      name: c.name,
      issuer: c.issuer,
      issue_date: c.issue_date,
      credential_url: c.credential_url,
      body,
      sort_order: i,
    };
  });

  console.log("\n── Volunteering → experience, unpublished ──");
  for (const v of parsed.volunteering) console.log(`  ${v.role} ${DIM}· ${v.company}${RESET}`);

  if (!apply) {
    console.log(`\n${WARN}Dry run.${RESET} Re-run with ${GREEN}--apply${RESET} to write.\n`);
    return;
  }

  const db = client();
  console.log("\nWriting…");

  // Upsert on slug throughout: re-running must update rather than duplicate.
  const writes: Array<[string, Record<string, unknown>[]]> = [
    ["projects", projectRows],
    [
      "testimonials",
      parsed.testimonials.map((t, i) => ({
        slug: t.slug,
        quote: t.quote,
        author_name: t.author_name,
        author_title: t.author_title,
        author_company: t.author_company,
        sort_order: i,
      })),
    ],
    ["certifications", certRows],
    [
      "experience",
      parsed.volunteering.map((v, i) => ({
        slug: v.slug,
        role: v.role,
        company: v.company,
        start_date: v.start_date,
        end_date: v.end_date,
        summary: v.summary,
        sort_order: 500 + i,
        is_published: false,
      })),
    ],
  ];

  for (const [table, rows] of writes) {
    if (!rows.length) {
      console.log(`  ${DIM}${table}: nothing to write${RESET}`);
      continue;
    }
    const { error } = await db.from(table).upsert(rows, { onConflict: "slug" });
    if (error) {
      console.error(`  ${RED}${table}: ${error.message}${RESET}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`  ${GREEN}✓${RESET} ${table}: ${rows.length}`);
  }

  console.log(`\nDone. Next: ${GREEN}npm run reindex${RESET} so the chatbot can read the new bodies.\n`);
}

main().catch((err) => {
  console.error(`\n${RED}Failed:${RESET} ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
