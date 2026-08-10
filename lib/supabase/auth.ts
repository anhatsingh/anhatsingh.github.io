import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/*
  ADMIN AUTH
  ==========
  Two gates, both required:
    1. A valid Supabase session (proves the email was verified via magic link).
    2. That session's email appears in ADMIN_EMAILS.

  Gate 2 is the important one. Supabase projects allow public sign-up by
  default, so a valid session alone proves only that someone owns *an* email
  address — not that they're Anhat. Every admin surface calls requireAdmin(),
  and every mutation re-checks server-side rather than trusting the page guard.
*/

function allowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowlisted(email: string | undefined | null): boolean {
  if (!email) return false;
  const list = allowlist();
  // An empty allowlist denies everyone. Failing closed matters more than
  // convenience here — a misconfigured deploy must not become an open door.
  if (!list.length) return false;
  return list.includes(email.toLowerCase());
}

export async function getSupabaseServerClient(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Session refresh is handled in middleware, so this is safe to ignore.
        }
      },
    },
  });
}

export interface AdminSession {
  user: User;
  email: string;
}

/** Returns the signed-in admin, or null. Never throws. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;

  // getUser() revalidates against Supabase rather than trusting the cookie,
  // which is what makes this safe to gate on.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  if (!isAllowlisted(data.user.email)) return null;

  return { user: data.user, email: data.user.email! };
}
