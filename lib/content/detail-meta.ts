import type { Metadata } from "next";
import { blocksToPlainText } from "./blocks";
import type { DetailView } from "./entities";
import { SITE_URL, absoluteUrl } from "@/lib/seo";

/*
  One metadata builder for every detail route, so a new page type can't ship
  without a canonical or an OG image.

  The description falls back through summary → body text → title. A page with
  no description at all gets one invented by the search engine, usually from
  whatever text happens to be first.
*/
export function detailMetadata(view: DetailView): Metadata {
  const description =
    view.summary || blocksToPlainText(view.body).slice(0, 160) || `${view.title} — Anhat Singh`;

  const title = view.subtitle ? `${view.title} · ${view.subtitle}` : view.title;

  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(view.path) },
    openGraph: {
      type: "article",
      url: absoluteUrl(view.path),
      title,
      description,
      ...(view.heroImageUrl ? { images: [view.heroImageUrl] } : {}),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * Article structured data. `author` points at the same `#person` node the
 * homepage defines, so a detail page reinforces the entity rather than
 * introducing a second, unlinked one.
 */
export function detailJsonLd(view: DetailView) {
  const description = view.summary || blocksToPlainText(view.body).slice(0, 200);

  return {
    "@context": "https://schema.org",
    "@type": view.type === "projects" ? "TechArticle" : "Article",
    headline: view.title,
    description,
    url: absoluteUrl(view.path),
    mainEntityOfPage: absoluteUrl(view.path),
    author: { "@id": `${SITE_URL}/#person` },
    publisher: { "@id": `${SITE_URL}/#person` },
    ...(view.heroImageUrl ? { image: view.heroImageUrl } : {}),
    ...(view.body.length ? { wordCount: blocksToPlainText(view.body).split(/\s+/).length } : {}),
  };
}
