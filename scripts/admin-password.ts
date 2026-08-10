/*
  Creates the admin user, or sets a new password on an existing one.

  Exists because Supabase's free tier throttles auth emails to roughly two an
  hour, which makes both magic-link sign-in AND the password-reset email useless
  as a way back in. This talks to the Admin API with the service-role key
  directly, so no email is involved at any point.

  Run: npm run admin:password

  The password is read from a hidden prompt rather than argv, so it doesn't end
  up in shell history or the process list.
*/

import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { createInterface } from "node:readline";
import { checkSupabaseUrl } from "../lib/supabase/config";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function fail(message: string): never {
  console.error(`\n${RED}✗${RESET} ${message}\n`);
  process.exit(1);
}

/** Reads a line without echoing it. Falls back to visible input if not a TTY. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const input = process.stdin;
    const rl = createInterface({ input, output: process.stdout, terminal: true });

    // readline echoes by default; intercept the output stream while asking.
    const originalWrite = (rl as unknown as { _writeToOutput?: (s: string) => void })
      ._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = function (
      chunk: string,
    ) {
      if (chunk.includes(question)) originalWrite?.call(rl, chunk);
      // Everything else is the typed characters — swallow them.
    };

    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const { url, problem } = checkSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!url) fail(problem ?? "NEXT_PUBLIC_SUPABASE_URL is not set.");

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) {
    fail("SUPABASE_SERVICE_ROLE_KEY is not set. Find it under Settings → API in Supabase.");
  }

  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (!admins.length) {
    fail("ADMIN_EMAILS is empty. Set it first — the allowlist is what makes a login count.");
  }

  const email = admins[0];
  if (admins.length > 1) {
    console.log(`${DIM}ADMIN_EMAILS has several entries; using the first: ${email}${RESET}`);
  }

  console.log(`\nSetting the admin password for ${GREEN}${email}${RESET}`);
  console.log(`${DIM}Nothing is emailed, so nothing is rate limited.${RESET}\n`);

  const password = await promptHidden("New password (min 8 chars): ");
  if (password.length < 8) fail("Too short — Supabase requires at least 8 characters.");

  const confirm = await promptHidden("Confirm password: ");
  if (password !== confirm) fail("Passwords don't match.");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // listUsers is paginated; the admin's account is realistically on page one,
  // but be explicit rather than relying on a default that could change.
  const { data: list, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) fail(`Couldn't read the user list: ${listError.message}`);

  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      // Without this an unconfirmed account still can't sign in — and confirming
      // it normally means an email, which is the thing we're routing around.
      email_confirm: true,
    });
    if (error) fail(`Couldn't update the password: ${error.message}`);
    console.log(`${GREEN}✓${RESET} Password updated for the existing user.`);
  } else {
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) fail(`Couldn't create the user: ${error.message}`);
    console.log(`${GREEN}✓${RESET} Admin user created and confirmed.`);
  }

  console.log(`\nSign in at ${GREEN}/admin/login${RESET} using the Password tab.\n`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
