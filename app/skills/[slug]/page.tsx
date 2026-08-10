import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { DetailLayout } from "@/components/detail/detail-layout";
import { JsonLd } from "@/components/seo/json-ld";
import { getDetail, getSkillEvidence, getSlugs, type SkillEvidence } from "@/lib/content/entities";
import { detailJsonLd, detailMetadata } from "@/lib/content/detail-meta";
import { getPortfolio } from "@/lib/content";
import { entityPath } from "@/lib/content/types";

export const revalidate = 60;

export async function generateStaticParams() {
  return (await getSlugs("skills")).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const view = await getDetail("skills", slug);
  if (!view) return { title: "Not found" };

  // A skill page answers "where has he used this?", so say that in the
  // description rather than repeating the skill name back at the searcher.
  const evidence = await getSkillEvidenceFor(slug);
  const count = evidence.experience.length + evidence.projects.length;

  return {
    ...detailMetadata(view),
    description:
      count > 0
        ? `Where Anhat Singh has used ${view.title} — ${count} role${count === 1 ? "" : "s"} and project${count === 1 ? "" : "s"}, with the work behind each.`
        : `${view.title} in Anhat Singh's toolkit.`,
  };
}

async function getSkillEvidenceFor(slug: string): Promise<SkillEvidence> {
  const p = await getPortfolio();
  const skill = p.skills.find((s) => s.slug === slug);
  if (!skill) return { experience: [], projects: [], posts: [] };
  return getSkillEvidence(skill);
}

function EvidenceSection({ evidence }: { evidence: SkillEvidence }) {
  const nothing =
    evidence.experience.length === 0 && evidence.projects.length === 0;

  // Honest rather than an empty heading. A skill with no linked work is a
  // signal in itself, and pretending otherwise is what the fit report exists
  // to avoid.
  if (nothing) {
    return (
      <section className="mt-16 border-t border-hairline pt-8">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Used in</h2>
        <p className="mt-4 text-sm text-muted">
          Nothing on this site is tagged with it yet.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-16 border-t border-hairline pt-8">
      <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Used in</h2>

      {evidence.experience.length > 0 && (
        <ul className="mt-4 space-y-2">
          {evidence.experience.map((e) => (
            <li key={e.slug}>
              <Link
                href={entityPath("experience", e.slug)}
                className="group block rounded-[var(--radius)] border border-hairline bg-surface p-4 transition-colors hover:border-accent"
              >
                <span className="block text-text group-hover:text-accent">{e.role}</span>
                <span className="mt-0.5 block font-mono text-xs text-muted">
                  {e.company} · {e.startDate} — {e.endDate ?? "Present"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {evidence.projects.length > 0 && (
        <>
          <h3 className="mt-8 font-mono text-xs uppercase tracking-[0.2em] text-muted">Projects</h3>
          <ul className="mt-4 space-y-2">
            {evidence.projects.map((p) => (
              <li key={p.slug}>
                <Link
                  href={entityPath("projects", p.slug)}
                  className="group block rounded-[var(--radius)] border border-hairline bg-surface p-4 transition-colors hover:border-accent"
                >
                  <span className="block text-text group-hover:text-accent">{p.name}</span>
                  {p.summary && (
                    <span className="mt-0.5 block text-sm text-muted">{p.summary}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await getDetail("skills", slug);
  if (!view) notFound();

  const evidence = await getSkillEvidenceFor(slug);

  return (
    <>
      <JsonLd data={detailJsonLd(view)} />
      <DetailLayout view={view} posts={evidence.posts}>
        <EvidenceSection evidence={evidence} />
      </DetailLayout>
    </>
  );
}
