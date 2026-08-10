import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/auth";

/** Exchanges the magic-link code for a session cookie, then lands on the dashboard. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/admin/login?error=missing_code`);
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.redirect(`${origin}/admin/login?error=not_configured`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/admin/login?error=invalid_code`);
  }

  // The allowlist check lives in the protected layout, so a non-admin who
  // completes this flow still lands on a refusal rather than the dashboard.
  return NextResponse.redirect(`${origin}/admin`);
}
