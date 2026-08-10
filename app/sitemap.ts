import type { MetadataRoute } from "next";
import { getAllDetailPaths } from "@/lib/content/entities";
import { SITE_URL } from "@/lib/seo";

/*
  One page, so this is short — but a sitemap still earns its place: it's what
  Search Console reads to report indexing status, which is how you find out the
  site ISN'T indexed rather than assuming it is.

  Section anchors aren't listed. They're fragments of the same document, and
  submitting them as separate URLs invites duplicate-content handling.
*/
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Generated, not hardcoded. A detail page that exists but isn't listed is
  // invisible to Search Console's coverage report, which is the whole reason
  // the sitemap is here.
  const detailPaths = await getAllDetailPaths();

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/how-it-works`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/blog`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    ...detailPaths.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
