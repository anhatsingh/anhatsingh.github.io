/*
  Working out where a visitor came from.

  Two inputs, in order of trust. A utm_source on the URL is a deliberate label —
  it says which link was clicked, which is the only way to tell an application
  email apart from a LinkedIn post when both land on the same page. The
  referring host is the fallback, and it is wrong often enough to be worth
  knowing why: apps strip referrers, link shorteners replace them with their
  own, and anything opened from a native client arrives bare.

  So the honest reading of "direct" is "unattributable", not "typed the URL in".
  Which is the case for tagging links: an untagged link is a visit you cannot
  learn anything from.
*/

export type VisitEvent =
  | "view"
  | "chat_open"
  | "chat_message"
  | "tour"
  | "resume"
  | "share"
  | "contact";

/** Events that mean somebody did more than arrive. */
export const ENGAGED: VisitEvent[] = ["chat_open", "chat_message", "tour", "resume", "share", "contact"];

/*
  Hosts worth naming. Everything else keeps its bare domain, which is more
  useful than an "other" bucket — a referrer nobody expected is exactly the one
  worth seeing.
*/
const KNOWN: Array<[RegExp, string]> = [
  [/(^|\.)news\.ycombinator\.com$/, "hacker-news"],
  [/(^|\.)lobste\.rs$/, "lobsters"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "linkedin"],
  [/(^|\.)(twitter|x)\.com$|^t\.co$/, "x"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)github\.(com|io)$/, "github"],
  [/(^|\.)google\./, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)medium\.com$/, "medium"],
  [/(^|\.)hashnode\./, "hashnode"],
  [/(^|\.)peerlist\.io$/, "peerlist"],
  [/(^|\.)ycombinator\.com$/, "ycombinator"],
];

/** Bare host, lowercased, no www. Empty for anything unparseable. */
export function hostOf(referrer: string): string {
  if (!referrer) return "";
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * The channel to file a visit under.
 *
 * A visit from this site to itself is not a referral — without that check,
 * every internal link would look like traffic from the site's own domain and
 * bury the real sources.
 */
export function resolveSource(options: {
  utmSource?: string | null;
  referrer?: string | null;
  selfHost?: string | null;
}): string {
  const tagged = clean(options.utmSource);
  if (tagged) return tagged;

  const host = hostOf(options.referrer ?? "");
  if (!host) return "direct";

  const self = (options.selfHost ?? "").toLowerCase().replace(/^www\./, "");
  if (self && host === self) return "internal";

  for (const [pattern, label] of KNOWN) {
    if (pattern.test(host)) return label;
  }
  return host;
}

/** Keeps stored labels short and predictable, so the same campaign groups. */
export function clean(value: string | null | undefined, max = 64): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

/**
 * Builds a tagged link.
 *
 * Here because attribution fails for one boring reason: links get shared
 * untagged. Generating them beats remembering the parameter names.
 */
export function taggedUrl(
  base: string,
  tags: { source: string; medium?: string; campaign?: string },
): string {
  const url = new URL(base);
  url.searchParams.set("utm_source", clean(tags.source));
  if (tags.medium) url.searchParams.set("utm_medium", clean(tags.medium));
  if (tags.campaign) url.searchParams.set("utm_campaign", clean(tags.campaign));
  return url.toString();
}
