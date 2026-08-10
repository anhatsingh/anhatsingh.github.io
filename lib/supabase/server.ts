import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/*
  Supabase is OPTIONAL at build/run time.

  The site must render — and be demoable — before Anhat has created a project.
  So every accessor here returns null when env vars are missing, and callers fall
  back to seed content. This is what lets `npm run dev` work on a fresh clone
  with no .env at all.
*/

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

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
