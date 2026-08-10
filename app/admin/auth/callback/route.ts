import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/auth";

/*
  Exchanges the magic-link code for a session cookie, then lands on the dashboard.

  The origin has to be derived from the forwarded headers, not from request.url.
  Behind Vercel's proxy, request.url carries the internal deployment host, so
  redirecting to its origin would bounce the visitor to an internal URL — or, on
  a custom domain, off the domain they started on. x-forwarded-host is the
  public host the visitor actually typed.
*/
function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!forwardedHost) return url.origin;

  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${forwardedHost}`;
}

export async function GET(request: Request) {
  const origin = publicOrigin(request);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  // Supabase reports its own failures as query params rather than an HTTP
  // error, so surface them instead of showing a generic "missing code".
  const authError = searchParams.get("error_description") ?? searchParams.get("error");
  if (authError) {
    return NextResponse.redirect(
      `${origin}/admin/login?error=${encodeURIComponent(authError)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/admin/login?error=missing_code`);
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.redirect(`${origin}/admin/login?error=not_configured`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/admin/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // The allowlist check lives in the protected layout, so a non-admin who
  // completes this flow still lands on a refusal rather than the dashboard.
  return NextResponse.redirect(`${origin}/admin`);
}
