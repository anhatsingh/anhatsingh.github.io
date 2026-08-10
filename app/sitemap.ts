import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/*
  One page, so this is short — but a sitemap still earns its place: it's what
  Search Console reads to report indexing status, which is how you find out the
  site ISN'T indexed rather than assuming it is.

  Section anchors aren't listed. They're fragments of the same document, and
  submitting them as separate URLs invites duplicate-content handling.
*/
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
