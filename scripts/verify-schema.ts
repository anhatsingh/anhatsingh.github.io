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
      "contact_messages", "chat_cache", "chat_questions", "visits", "mcp_tokens",
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

    /*
      The detail columns, which nothing asserted on any table until education
      needed them. A column added to the create block but forgotten in the
      migrations section works on a fresh database and silently does not exist
      on the live one — which is the only database that matters.
    */
    console.log("\n── detail columns survive a migration ──");
    for (const [table, column] of [
      ["education", "summary"],
      ["education", "highlights"],
      ["education", "tech"],
      ["education", "body"],
      ["education", "hero_image_url"],
      ["education", "show_in_blog_list"],
      ["certifications", "body"],
      ["experience", "body"],
    ] as const) {
      check(
        `${table}.${column} exists`,
        psql("fresh", `select count(*) from information_schema.columns where table_name='${table}' and column_name='${column}';`) === "1",
      );
    }

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

    /*
      The MCP token lifecycle, exercised rather than inspected.

      A token check is the one piece of this schema where being wrong is
      silent: a verify function that matched on the wrong column, or compared
      a plaintext to a plaintext, would pass every structural check and hand
      the record to anyone. So these mint real tokens and assert the
      behaviour — that a token matches itself and nothing else, that revoking
      it actually stops it, and that the plaintext is nowhere in the table.
    */
    console.log("\n── MCP tokens ──");
    const idA = psql("fresh", "select issue_mcp_token('laptop', 'secret-tokenAAA_0123456789abcdefghijklmnopq');");
    const idB = psql("fresh", "select issue_mcp_token('recruiter', 'secret-tokenBBB_0123456789abcdefghijklmnopq');");

    check("issue_mcp_token returns an id", idA.length === 36 && idB.length === 36);
    check(
      "a token verifies against its own row",
      psql("fresh", "select verify_mcp_token('secret-tokenAAA_0123456789abcdefghijklmnopq');") === idA,
    );
    check(
      "and not against another's",
      psql("fresh", "select verify_mcp_token('secret-tokenBBB_0123456789abcdefghijklmnopq');") === idB,
    );
    check(
      "an unknown token verifies to nothing",
      psql("fresh", "select coalesce(verify_mcp_token('not-a-real-token')::text, 'NULL');") === "NULL",
    );
    check(
      "the empty string doesn't match a row",
      psql("fresh", "select coalesce(verify_mcp_token('')::text, 'NULL');") === "NULL",
    );

    /*
      The property that makes a leaked database not a leaked set of tokens.
      Checked by searching every hash for the plaintext, not by trusting that
      crypt() was called.
    */
    check(
      "the plaintext is stored nowhere",
      psql(
        "fresh",
        "select count(*) from mcp_tokens where token_hash like '%secret-token%' or label like '%secret-token%';",
      ) === "0",
    );
    check(
      "hashes are bcrypt",
      psql("fresh", "select count(*) from mcp_tokens where token_hash like '$2%';") === "2",
    );
    check(
      "two tokens never share a hash",
      psql("fresh", "select count(distinct token_hash) from mcp_tokens;") === "2",
    );

    check(
      "verifying stamps last_used_at",
      psql("fresh", "select count(*) from mcp_tokens where id = '" + idA + "' and last_used_at is not null;") === "1",
    );

    psql("fresh", "update mcp_tokens set revoked_at = now() where id = '" + idA + "';");
    check(
      "a revoked token stops verifying",
      psql("fresh", "select coalesce(verify_mcp_token('secret-tokenAAA_0123456789abcdefghijklmnopq')::text, 'NULL');") === "NULL",
    );
    check(
      "revoking one leaves the other working",
      psql("fresh", "select verify_mcp_token('secret-tokenBBB_0123456789abcdefghijklmnopq');") === idB,
    );

    /*
      The negative property, asserted the same way resume_sources' is. RLS on
      with no policy means denial — if someone later adds a blanket read
      policy, every hash becomes world-readable through PostgREST and this is
      what catches it.
    */
    check(
      "mcp_tokens has RLS enabled",
      psql("fresh", "select relrowsecurity from pg_class where relname='mcp_tokens';") === "t",
    );
    check(
      "mcp_tokens has NO policy — nothing anon can read",
      psql("fresh", "select count(*) from pg_policies where tablename='mcp_tokens';") === "0",
    );
    check(
      "verify_mcp_token is security definer",
      psql("fresh", "select prosecdef from pg_proc where proname='verify_mcp_token';") === "t",
    );
    check(
      "anon cannot execute verify_mcp_token",
      psql("fresh", "select has_function_privilege('anon', 'verify_mcp_token(text)', 'execute');") === "f",
    );
    check(
      "anon cannot execute issue_mcp_token",
      psql("fresh", "select has_function_privilege('anon', 'issue_mcp_token(text,text)', 'execute');") === "f",
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
