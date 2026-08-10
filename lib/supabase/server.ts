import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkAnonKey, checkSupabaseUrl } from "./config";

/*
  Supabase is OPTIONAL at build/run time.

  The site must render — and be demoable — before Anhat has created a project.
  So every accessor here returns null when env vars are missing, and callers fall
  back to seed content. This is what lets `npm run dev` work on a fresh clone
  with no .env at all.
*/

// Validated + normalised once at module load, so a trailing slash or a pasted
// dashboard URL fails loudly here rather than as a gateway error later.
const urlCheck = checkSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const keyCheck = checkAnonKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const url = urlCheck.url;
const anonKey = keyCheck.key;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

/** Non-null when env vars are present but wrong. Surfaced in the admin UI. */
export const supabaseConfigProblem = urlCheck.problem ?? keyCheck.problem;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (process.env.NEXT_PUBLIC_SUPABASE_URL && supabaseConfigProblem) {
  console.error(`[supabase] ${supabaseConfigProblem}`);
}

/** Anon client — subject to RLS. Use for all public reads. */
export function getPublicClient(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false },
  });
}

/**
 * Service-role client — BYPASSES RLS. Server-only, never import into a client
 * component. Used for admin writes and for inserting contact messages, which
 * the public role deliberately cannot write.
 */
export function getServiceClient(): SupabaseClient | null {
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
