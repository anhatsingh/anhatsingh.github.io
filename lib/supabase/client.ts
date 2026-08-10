"use client";

import { createBrowserClient } from "@supabase/ssr";
import { checkAnonKey, checkSupabaseUrl } from "./config";

/*
  Browser Supabase client. Anon key only — safe to ship, constrained by RLS.

  Returns the *reason* it couldn't be built rather than just null, so the login
  page can say "that's the dashboard URL" instead of letting the request go out
  and come back as "Invalid path specified in request URL".
*/
export function getBrowserClient() {
  const { url, problem: urlProblem } = checkSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const { key, problem: keyProblem } = checkAnonKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const problem = urlProblem ?? keyProblem;
  if (!url || !key) return { client: null, problem: problem ?? "Supabase isn't configured." };

  return { client: createBrowserClient(url, key), problem: null };
}
