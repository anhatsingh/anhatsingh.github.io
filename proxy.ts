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
  matcher: ["/admin/:path*"],
};
