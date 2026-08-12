import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { JsonLd } from "@/components/seo/json-ld";
import { TalkButton } from "@/components/chat/talk-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { getBlogEntries, type BlogEntry } from "@/lib/content/entities";
import { getPortfolio } from "@/lib/content";
import { ENTITY_LABELS } from "@/lib/content/types";
import { SITE_URL, absoluteUrl } from "@/lib/seo";

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const { profile } = await getPortfolio();
  const title = "Writing";
  const description = `Notes and write-ups by ${profile.name} — on retrieval, evaluation, and shipping LLM systems.`;

  return {
    title,
    description,
    alternates: { canonical: absoluteUrl("/blog") },
    openGraph: { type: "website", url: absoluteUrl("/blog"), title, description },
  };
}

function EntryCard({ entry }: { entry: BlogEntry }) {
  const external = Boolean(entry.externalUrl);
  const href = external ? entry.externalUrl! : entry.path;

  const inner = (
    <>
      {entry.imageUrl && (
        <div className="relative aspect-[2/1] w-full overflow-hidden bg-elevated">
          <Image
            src={entry.imageUrl}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 34rem"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        </div>
      )}
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-x-3 font-mono text-[11px] uppercase tracking-widest text-muted">
          {/* Entity pages say what they are, so a job write-up in a list of
              articles doesn't read as a mistake. */}
          {entry.type !== "posts" && (
            <span className="text-accent">{ENTITY_LABELS[entry.type]}</span>
          )}
          {entry.source && <span className="text-accent">{entry.source}</span>}
          {entry.publishedAt && <span>{entry.publishedAt}</span>}
          {!external && <span>{entry.readingMinutes} min</span>}
        </div>

        <h2 className="mt-2 font-display text-xl group-hover:text-accent">
          {entry.title}
          {external && <span aria-hidden="true"> ↗</span>}
        </h2>

        {entry.summary && (
          <p className="mt-2 text-sm leading-relaxed text-muted">{entry.summary}</p>
        )}
      </div>
    </>
  );

  const className =
    "group block overflow-hidden rounded-[var(--radius)] border border-hairline bg-surface transition-colors hover:border-accent";

  // next/link for internal navigation (prefetch, no full reload); a plain
  // anchor for anything leaving the site.
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={className}>
      {inner}
    </Link>
  );
}

export default async function BlogIndex() {
  const [entries, { profile }] = await Promise.all([getBlogEntries(), getPortfolio()]);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: `Writing — ${profile.name}`,
    url: absoluteUrl("/blog"),
    author: { "@id": `${SITE_URL}/#person` },
    blogPost: entries.slice(0, 20).map((e) => ({
      "@type": "BlogPosting",
      headline: e.title,
      url: e.externalUrl ?? absoluteUrl(e.path),
      ...(e.publishedAt ? { datePublished: e.publishedAt } : {}),
    })),
  };

  return (
    <>
      <JsonLd data={jsonLd} />

      <div aria-hidden="true" className="aurora">
        <div className="aurora-orb aurora-orb-a" />
        <div className="aurora-orb aurora-orb-b" />
        <div className="aurora-orb aurora-orb-c" />
      </div>
      <div aria-hidden="true" className="grain" />

      <header className="sticky top-0 z-30 border-b border-hairline bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="font-mono text-sm tracking-tight text-text hover:text-accent"
          >
            {profile.name.toLowerCase().replace(/\s+/g, "")}
            <span className="text-accent">.</span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <TalkButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12 md:py-16">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">/// Writing</p>
        <h1 className="mt-3 font-display text-4xl leading-[1.1] md:text-5xl">
          Notes, mostly on getting LLMs to behave
        </h1>

        {entries.length === 0 ? (
          <p className="mt-8 text-muted">
            Nothing published yet. Posts written here and elsewhere will both land on this page.
          </p>
        ) : (
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {entries.map((entry) => (
              <EntryCard key={`${entry.type}:${entry.slug}`} entry={entry} />
            ))}
          </div>
        )}

        <footer className="mt-16 border-t border-hairline pt-8">
          <Link href="/" className="font-mono text-xs uppercase tracking-widest text-accent hover:underline">
            ← back to the site
          </Link>
        </footer>
      </main>
    </>
  );
}
