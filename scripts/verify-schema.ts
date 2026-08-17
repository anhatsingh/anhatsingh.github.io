/*
  Applies lib/db/schema.sql to a real Postgres and checks what it built.

  Written after a stray line of prose that had lost its `--` prefix shipped and
  failed in the Supabase SQL editor. Nothing in the TypeScript build reads this
  file, so a syntax error in it is invisible until someone pastes it into a
  production database — which is the worst possible moment to find out.

  It also asserts the security shape, because the most valuable property of
  this schema is a negative one: `resume_sources` must have NO policy. With RLS
  enabled, absence of a policy means denial, and that absence is what keeps the
  job descriptions behind saved resumes — which reveal where Anhat is applying —
  from being world-readable alongside the resumes themselves. A well-meaning
  "add a read policy to everything" loop would silently undo that, and this is
  what would catch it.

  Needs Docker. Skips cleanly without it.

  Run: npx tsx scripts/verify-schema.ts
*/

import { execFileSync } from "node:child_process";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const CONTAINER = "verify-schema-pg";
const PORT = "55433";
const IMAGE = "pgvector/pgvector:pg16";

function sh(cmd: string, args: string[], opts: { quiet?: boolean } = {}): string {
  return execFileSync(cmd, args, {
    stdio: opts.quiet ? ["ignore", "pipe", "ignore"] : ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: "test" },
  });
}

function have(bin: string): boolean {
  try {
    execFileSync("command", ["-v", bin], { shell: "/bin/sh", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function psql(db: string, sql: string): string {
  return sh("psql", ["-h", "localhost", "-p", PORT, "-U", "postgres", "-d", db, "-qtA", "-c", sql]).trim();
}

function cleanup() {
  try {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  } catch {
    /* nothing to remove */
  }
}

async function main() {
  if (!have("docker") || !have("psql")) {
    console.log("\n  [SKIP] docker and psql are both needed to check the schema.\n");
    return;
  }

  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
  } catch {
    console.log("\n  [SKIP] Docker isn't running.\n");
    return;
  }

  console.log("\n── applying lib/db/schema.sql to a real Postgres ──");
  cleanup();

  try {
    sh("docker", ["run", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=test", "-p", `${PORT}:5432`, IMAGE], { quiet: true });
  } catch {
    console.log("  [SKIP] couldn't start Postgres — is the pgvector image pullable?\n");
    return;
  }

  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      execFileSync("docker", ["exec", CONTAINER, "pg_isready", "-U", "postgres"], { stdio: "ignore" });
      ready = true;
      break;
    } catch {
      execFileSync("sleep", ["1"]);
    }
  }
  if (!ready) {
    check("Postgres starts", false, "timed out");
    cleanup();
    process.exit(1);
  }

  try {
    psql("postgres", "create database fresh;");
    // Supabase ships these; a vanilla Postgres does not, and the policies
    // reference them by name.
    psql("fresh", "create role anon nologin; create role authenticated nologin; create role service_role nologin;");

    const apply = () =>
      sh("psql", [
        "-h", "localhost", "-p", PORT, "-U", "postgres", "-d", "fresh",
        "-v", "ON_ERROR_STOP=1", "-f", "lib/db/schema.sql",
      ]);

    try {
      apply();
      check("schema.sql applies to an empty database", true);
    } catch (err) {
      check("schema.sql applies to an empty database", false, String((err as Error).message).slice(0, 300));
      cleanup();
      process.exit(1);
    }

    // The file claims to be safe to re-run, and that claim is load-bearing —
    // it's how every migration reaches production.
    try {
      apply();
      check("re-running it is a no-op, as the header promises", true);
    } catch (err) {
      check("re-running it is a no-op, as the header promises", false, String((err as Error).message).slice(0, 300));
    }

    console.log("\n── tables ──");
    const tables = psql(
      "fresh",
      "select table_name from information_schema.tables where table_schema='public' order by 1;",
    ).split("\n");
    for (const t of [
      "profile", "experience", "projects", "skills", "education", "certifications",
      "testimonials", "writing", "resumes", "resume_sources", "content_chunks", "shared_chats",
      "contact_messages", "chat_cache", "chat_questions", "visits",
    ]) {
      check(`${t} exists`, tables.includes(t));
    }

    console.log("\n── the vector column really is a vector ──");
    check(
      "resumes.embedding is vector(1536)",
      psql("fresh", "select format_type(atttypid, atttypmod) from pg_attribute where attrelid='resumes'::regclass and attname='embedding';") === "vector(1536)",
      psql("fresh", "select format_type(atttypid, atttypmod) from pg_attribute where attrelid='resumes'::regclass and attname='embedding';"),
    );
    check(
      "content_chunks.embedding is vector(1536)",
      psql("fresh", "select format_type(atttypid, atttypmod) from pg_attribute where attrelid='content_chunks'::regclass and attname='embedding';") === "vector(1536)",
    );

    console.log("\n── row level security ──");
    const rlsOff = psql(
      "fresh",
      "select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity order by 1;",
    );
    check("every table has RLS enabled", rlsOff === "", rlsOff.replace(/\n/g, ", "));

    /*
      The negative assertions. These four hold nothing a visitor may read, and
      with RLS on, having no policy is what denies them.
    */
    /*
      shared_chats is the one table a visitor can cause a write to, and the one
      public table without an is_published gate — a share link works precisely
      because anyone holding the id can read it. What must NOT exist is an
      insert policy: writes go through the service role after an explicit
      click, so a link can't be forged into existence.
    */
    check(
      "shared_chats is readable by anyone holding the id",
      psql("fresh", "select count(*) from pg_policies where tablename='shared_chats' and cmd='SELECT';") === "1",
    );
    check(
      "shared_chats has no anon insert policy",
      psql("fresh", "select count(*) from pg_policies where tablename='shared_chats' and cmd in ('INSERT','ALL');") === "0",
    );

    /*
      The cache holds a raw reply stream, scoped to the build that produced it.
      Without the compound key a release would overwrite rather than invalidate,
      and a reply generated against the previous prompt would keep being served.
    */
    check(
      "chat_cache is keyed by question AND build",
      psql("fresh", "select count(*) from pg_indexes where tablename='chat_cache' and indexdef ilike '%question_hash%deploy_id%';") !== "0",
    );
    check(
      "chat_cache stores the stream verbatim",
      psql("fresh", "select count(*) from information_schema.columns where table_name='chat_cache' and column_name='payload';") === "1",
    );

    for (const t of ["resume_sources", "contact_messages", "chat_cache", "chat_questions", "visits"]) {
      const count = psql("fresh", `select count(*) from pg_policies where tablename='${t}';`);
      check(`${t} has NO anon policy, so RLS denies reads`, count === "0", `${count} policies`);
    }

    console.log("\n── public read policies ──");
    for (const t of ["experience", "projects", "skills", "education", "certifications", "testimonials", "writing", "resumes"]) {
      const q = psql("fresh", `select qual from pg_policies where tablename='${t}' and cmd='SELECT';`);
      check(`${t} is readable only when published`, q.includes("is_published"), q || "no policy");
    }
    check(
      "profile is readable unconditionally",
      psql("fresh", "select qual from pg_policies where tablename='profile' and cmd='SELECT';") === "true",
    );

    console.log("\n── updated_at triggers ──");
    for (const t of ["profile", "experience", "projects", "skills", "education", "certifications", "testimonials", "writing", "resumes"]) {
      check(
        `${t} has a touch trigger`,
        psql("fresh", `select count(*) from pg_trigger where tgrelid='${t}'::regclass and not tgisinternal;`) !== "0",
      );
    }

    console.log("\n── retrieval function ──");
    check(
      "match_content_chunks exists",
      psql("fresh", "select count(*) from pg_proc where proname='match_content_chunks';") === "1",
    );

    console.log("\n── constraints that matter ──");
    check(
      "resumes.slug is unique",
      psql("fresh", "select count(*) from pg_constraint where conrelid='resumes'::regclass and contype='u';") !== "0",
    );
    check(
      "a resume_source without its resume is rejected",
      (() => {
        try {
          psql("fresh", "insert into resume_sources (resume_slug, job_description) values ('nope','x');");
          return false;
        } catch {
          return true;
        }
      })(),
    );
  } finally {
    cleanup();
  }

  console.log(failures === 0 ? "\nAll schema checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
