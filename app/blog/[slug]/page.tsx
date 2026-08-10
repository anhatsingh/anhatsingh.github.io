import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { DetailLayout } from "@/components/detail/detail-layout";
import { JsonLd } from "@/components/seo/json-ld";
import { getDetail, getSlugs } from "@/lib/content/entities";
import { detailJsonLd, detailMetadata } from "@/lib/content/detail-meta";
import { getPortfolio } from "@/lib/content";

export const revalidate = 60;

export async function generateStaticParams() {
  // Only posts with a body get a page here. An external-only post has nothing
  // to render, so it must not become an empty route.
  const p = await getPortfolio();
  return p.writing.filter((w) => w.body.length > 0).map((w) => ({ slug: w.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const view = await getDetail("posts", slug);
  if (!view) return { title: "Not found" };
  return detailMetadata(view);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await getDetail("posts", slug);
  if (!view) notFound();

  // An external post with no body has no page of its own — send the visitor to
  // where it actually lives rather than showing them an empty article.
  const external = view.meta.find((m) => m.label === "original")?.href;
  if (view.body.length === 0 && external) redirect(external);
  if (view.body.length === 0) notFound();

  return (
    <>
      <JsonLd data={detailJsonLd(view)} />
      <DetailLayout view={view} />
    </>
  );
}
