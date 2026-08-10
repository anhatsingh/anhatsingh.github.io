/*
  Tells you what's wrong with .env.local, in words.

  Written after a magic-link sign-in failed with Supabase's
  "Invalid path specified in request URL" — an error that names no cause and
  sends you looking in the wrong place. Every check here reports the mistake
  rather than the symptom.

  Run: npm run check:env
*/

import { loadEnvConfig } from "@next/env";
import { checkAnonKey, checkSupabaseUrl } from "../lib/supabase/config";
import { resumeLinks } from "../lib/resume";

// Loads .env.local exactly the way `next dev` does, so this checks what the app
// will actually see rather than what's in the file.
loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });

let problems = 0;
let warnings = 0;

const ok = (m: string, d = "") => console.log(`  \x1b[32m✓\x1b[0m ${m}${d ? ` — ${d}` : ""}`);
const bad = (m: string, d = "") => { problems++; console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      ${d}` : ""}`); };
const warn = (m: string, d = "") => { warnings++; console.log(`  \x1b[33m!\x1b[0m ${m}${d ? `\n      ${d}` : ""}`); };

console.log("\n\x1b[1mSupabase\x1b[0m");

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const urlCheck = checkSupabaseUrl(rawUrl);

if (!rawUrl) {
  warn("NEXT_PUBLIC_SUPABASE_URL not set", "Site serves seed content; admin is disabled.");
} else if (urlCheck.problem) {
  bad("NEXT_PUBLIC_SUPABASE_URL is wrong", urlCheck.problem);
  console.log(`      you have: ${rawUrl}`);
} else {
  ok("NEXT_PUBLIC_SUPABASE_URL", urlCheck.url!);
  if (rawUrl !== urlCheck.url) {
    console.log(`      (normalised from "${rawUrl}" — a trailing slash would have broken auth)`);
  }
}

const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const keyCheck = checkAnonKey(rawKey);
if (!rawKey) warn("NEXT_PUBLIC_SUPABASE_ANON_KEY not set");
else if (keyCheck.problem) bad("NEXT_PUBLIC_SUPABASE_ANON_KEY is wrong", keyCheck.problem);
else ok("NEXT_PUBLIC_SUPABASE_ANON_KEY", `${rawKey.slice(0, 12)}…`);

const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!service) warn("SUPABASE_SERVICE_ROLE_KEY not set", "Admin can read but not save.");
else if (service === rawKey?.trim()) {
  bad("SUPABASE_SERVICE_ROLE_KEY is the same as the anon key",
      "They're different keys. Copy the service_role one from Settings → API.");
} else ok("SUPABASE_SERVICE_ROLE_KEY", `${service.slice(0, 12)}…`);

console.log("\n\x1b[1mAdmin access\x1b[0m");
const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
if (!admins.length) {
  bad("ADMIN_EMAILS is empty", "Nobody can sign in — this fails closed on purpose.");
} else {
  const malformed = admins.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (malformed.length) bad("ADMIN_EMAILS has malformed entries", malformed.join(", "));
  else ok("ADMIN_EMAILS", admins.join(", "));
}

console.log("\n\x1b[1mChatbot\x1b[0m");
const openai = process.env.OPENAI_API_KEY?.trim();
if (!openai) warn("OPENAI_API_KEY not set", "Chat returns a 503; the rest of the site is fine.");
else if (!openai.startsWith("sk-")) bad("OPENAI_API_KEY doesn't start with sk-", "That's probably not an API key.");
else ok("OPENAI_API_KEY", `${openai.slice(0, 7)}…`);

const model = process.env.OPENAI_MODEL?.trim();
if (!model) warn("OPENAI_MODEL not set", "Defaults to gpt-4o-mini — confirm that model still exists.");
else ok("OPENAI_MODEL", model);

console.log("\n\x1b[1mOptional\x1b[0m");
const pat = process.env.GH_STATS_PAT?.trim();
if (!pat) warn("GH_STATS_PAT not set", "GitHub section hides itself.");
else if (!/^(gh[pousr]_|github_pat_)/.test(pat)) warn("GH_STATS_PAT has an unfamiliar prefix", "Expected ghp_ or github_pat_.");
else ok("GH_STATS_PAT", `${pat.slice(0, 8)}…`);

const resend = process.env.RESEND_API_KEY?.trim();
const contact = process.env.CONTACT_EMAIL?.trim();
if (!resend || !contact) warn("Resend not fully configured", "Messages still save to the database.");
else ok("Resend", contact);

if (process.env.GOOGLE_SITE_VERIFICATION?.trim()) {
  const v = process.env.GOOGLE_SITE_VERIFICATION.trim();
  if (v.includes("<meta")) bad("GOOGLE_SITE_VERIFICATION contains a whole meta tag", "Paste only the content value.");
  else ok("GOOGLE_SITE_VERIFICATION", `${v.slice(0, 10)}…`);
} else {
  warn("GOOGLE_SITE_VERIFICATION not set", "Needed once, to verify the domain in Search Console.");
}

console.log("\n\x1b[1mResume link\x1b[0m");
// Not an env var, but the same class of paste-the-wrong-thing mistake.
const resume = resumeLinks(process.env.RESUME_URL);
if (!process.env.RESUME_URL) {
  console.log("  \x1b[2m·\x1b[0m Set from /admin, not env. Skipping.");
} else if (!resume) {
  bad("RESUME_URL isn't a usable URL");
} else {
  ok(resume.isGoogleDrive ? "Drive link converts to a download" : "Resume URL", resume.downloadUrl);
}

console.log(
  problems === 0
    ? `\n\x1b[32mNo blocking problems.\x1b[0m ${warnings} optional thing(s) unset.\n`
    : `\n\x1b[31m${problems} problem(s) to fix.\x1b[0m ${warnings} warning(s).\n`,
);
process.exit(problems === 0 ? 0 : 1);
