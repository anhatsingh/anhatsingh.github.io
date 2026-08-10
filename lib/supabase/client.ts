"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client. Anon key only — safe to ship, constrained by RLS. */
export function getBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
