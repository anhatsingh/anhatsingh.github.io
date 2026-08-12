import { renderDetailCard, size, contentType } from "@/lib/seo/detail-card";

/*
  Per-entry share card. One renderer for all five routes — see
  lib/seo/detail-card.tsx for why this file is three lines.
*/
export { size, contentType };
export const alt = "A project by Anhat Singh";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return renderDetailCard("projects", slug);
}
