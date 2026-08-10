import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DetailLayout } from "@/components/detail/detail-layout";
import { JsonLd } from "@/components/seo/json-ld";
import { getDetail, getRelatedPosts, getSlugs } from "@/lib/content/entities";
import { detailJsonLd, detailMetadata } from "@/lib/content/detail-meta";

// Matches the homepage. Out-of-band database edits surface within a minute.
export const revalidate = 60;

export async function generateStaticParams() {
  return (await getSlugs("projects")).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const view = await getDetail("projects", slug);
  // Next needs *some* metadata even for a 404; the page itself calls notFound.
  if (!view) return { title: "Not found" };
  return detailMetadata(view);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await getDetail("projects", slug);
  // Unpublished rows never leave Supabase (RLS), so they land here as 404 —
  // no is_published check to forget.
  if (!view) notFound();

  const posts = await getRelatedPosts("projects", slug);

  return (
    <>
      <JsonLd data={detailJsonLd(view)} />
      <DetailLayout view={view} posts={posts}></DetailLayout>
    </>
  );
}
