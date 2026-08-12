import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { checkAnonKey, checkSupabaseUrl } from "@/lib/supabase/config";

/*
  Refreshes the Supabase session cookie on admin navigations.

  Server Components can't write cookies, so without this the session would
  silently expire mid-session and the next action would 401. This does not
  enforce access — that's the layout's job — it only keeps the token fresh.
*/
export async function proxy(request: NextRequest) {
  /*
    Supabase sometimes drops the magic-link code on the site root instead of the
    callback: when a redirect URL isn't in the project's allow-list it falls
    back to the configured Site URL, code and all. The visitor then lands on the
    homepage with ?code=... in the address bar and no session.

    Forwarding it is worth doing regardless of how the dashboard is configured —
    the allow-list is a setting in another system that can change without this
    one knowing.

    This only forwards. The code is exchanged, and the allow-list checked, by
    the callback and the protected layout. Nothing here grants anything.
  */
  const code = request.nextUrl.searchParams.get("code");
  if (code && request.nextUrl.pathname === "/") {
    const callback = new URL("/admin/auth/callback", request.url);
    callback.searchParams.set("code", code);
    return NextResponse.redirect(callback);
  }

  const response = NextResponse.next({ request });

  const { url } = checkSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const { key } = checkAnonKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    "/admin/:path*",
    /*
      The root, but only when a code is actually on it. Matching "/" outright
      would put a Supabase round trip in front of every homepage visit for the
      sake of a redirect that fires a few times a year.
    */
    { source: "/", has: [{ type: "query", key: "code" }] },
  ],
};
