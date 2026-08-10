/*
  Validates and normalises the Supabase project URL.

  This exists because of one specific, very easy mistake. supabase-js builds
  request paths by concatenation:

      `${url}/auth/v1/otp`

  so anything unexpected in `url` produces a broken path, and Supabase's gateway
  answers with "Invalid path specified in request URL" — which says nothing about
  the cause. The two ways to get there:

    1. Pasting the DASHBOARD url:
         https://supabase.com/dashboard/project/abcdefgh      ✗
       instead of the project API url, which is what the client needs:
         https://abcdefgh.supabase.co                          ✓

    2. A trailing slash:
         https://abcdefgh.supabase.co/   ->  ...co//auth/v1/otp
       Double slash, gateway rejects it.

  Rather than let either fail at request time, we normalise what's fixable and
  report what isn't, in words that name the actual problem.
*/

export interface UrlCheck {
  /** Cleaned URL, safe to hand to supabase-js. Null when unusable. */
  url: string | null;
  /** Human-readable reason, shown in the admin UI. Null when fine. */
  problem: string | null;
}

export function checkSupabaseUrl(raw: string | undefined | null): UrlCheck {
  const value = raw?.trim();

  if (!value) {
    return { url: null, problem: "NEXT_PUBLIC_SUPABASE_URL is not set." };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      url: null,
      problem: `NEXT_PUBLIC_SUPABASE_URL isn't a valid URL ("${value}"). It should look like https://your-project.supabase.co`,
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      url: null,
      problem: `NEXT_PUBLIC_SUPABASE_URL must start with https:// (got ${parsed.protocol}//)`,
    };
  }

  // The dashboard URL — by far the most common wrong paste.
  if (parsed.hostname === "supabase.com" || parsed.hostname === "www.supabase.com") {
    const projectRef = parsed.pathname.match(/\/project\/([a-z0-9]+)/i)?.[1];
    return {
      url: null,
      problem: projectRef
        ? `That's the dashboard URL, not the API URL. Use https://${projectRef}.supabase.co instead — find it under Settings → API → Project URL.`
        : "That's the Supabase dashboard URL, not your project's API URL. Find the right one under Settings → API → Project URL.",
    };
  }

  // Any path at all is wrong: supabase-js appends its own.
  const path = parsed.pathname.replace(/\/+$/, "");
  if (path) {
    return {
      url: null,
      problem: `NEXT_PUBLIC_SUPABASE_URL should have no path after the host. Remove "${path}" — just https://${parsed.hostname}`,
    };
  }

  if (parsed.search || parsed.hash) {
    return {
      url: null,
      problem: "NEXT_PUBLIC_SUPABASE_URL shouldn't have a query string or fragment.",
    };
  }

  // A trailing slash is silently fixable, so fix it rather than complain.
  return { url: `${parsed.protocol}//${parsed.host}`, problem: null };
}

export function checkAnonKey(raw: string | undefined | null): { key: string | null; problem: string | null } {
  const value = raw?.trim();

  if (!value) return { key: null, problem: "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set." };

  // Supabase keys are JWTs — three dot-separated segments. A service_role key
  // pasted here would also be a JWT, so shape alone can't catch that; the role
  // check below reads the payload.
  const segments = value.split(".");
  if (segments.length !== 3) {
    return {
      key: null,
      problem:
        "NEXT_PUBLIC_SUPABASE_ANON_KEY doesn't look like a Supabase key. Copy the anon/public key from Settings → API.",
    };
  }

  try {
    // atob rather than Buffer: this module is imported by a client component,
    // and Buffer doesn't exist in the browser. base64url needs its padding
    // restored and its alphabet translated before atob will take it.
    const b64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(padded));

    if (payload.role === "service_role") {
      return {
        key: null,
        problem:
          "That's the service_role key, which must never be exposed to the browser. Use the anon/public key for NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      };
    }
  } catch {
    // Not decodable — newer publishable keys aren't JWTs. Not worth rejecting.
  }

  return { key: value, problem: null };
}
