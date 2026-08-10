import Image from "next/image";
import Link from "next/link";
import { BlockRenderer } from "@/components/blocks/block-renderer";
import { LogoPlate } from "@/components/ui/logo-plate";
import { ThemeToggle } from "@/components/theme-toggle";
import { ENTITY_LABELS, entityPath, sectionForEntity, type Writing } from "@/lib/content/types";
import type { DetailView } from "@/lib/content/entities";

/*
  The shell every detail page shares.

  Deliberately NOT wrapped in SiteShell. That mounts UIControlProvider and
  ChatProvider, whose whole model is scroll-and-highlight within one long page —
  none of which applies here, and mounting it would put a chat dock on a
  document with nothing to highlight. Detail pages get a quiet header that
  points back to the homepage section they came from.

  Server component: a long post ships no JavaScript for its content.
*/

function BackLink({ view }: { view: DetailView }) {
  const section = sectionForEntity(view.type);
  return (
    <Link
      href={`/#${section}`}
      className="font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:text-accent"
    >
      ← {ENTITY_LABELS[view.type]}
    </Link>
  );
}

function RelatedPosts({ posts }: { posts: Writing[] }) {
  if (!posts.length) return null;

  return (
    <section className="mt-16 border-t border-hairline pt-8">
      <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
        Writing about this
      </h2>
      <ul className="mt-4 space-y-3">
        {posts.map((post) => {
          // An external post links out; one hosted here opens its own page.
          const external = Boolean(post.externalUrl);
          const href = external ? post.externalUrl! : entityPath("posts", post.slug);

          return (
            <li key={post.slug}>
              <a
                href={href}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="group block rounded-[var(--radius)] border border-hairline bg-surface p-4 transition-colors hover:border-accent"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-text group-hover:text-accent">
                    {post.title}
                    {external && <span aria-hidden="true"> ↗</span>}
                  </span>
                  {post.source && (
                    <span className="shrink-0 font-mono text-[11px] uppercase tracking-widest text-muted">
                      {post.source}
                    </span>
                  )}
                </span>
                {post.summary && <span className="mt-1 block text-sm text-muted">{post.summary}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DetailLayout({
  view,
  posts = [],
  children,
}: {
  view: DetailView;
  posts?: Writing[];
  /** Extra content between the body and related posts — skill evidence, etc. */
  children?: React.ReactNode;
}) {
  const hasBody = view.body.length > 0;

  return (
    <>
      <div aria-hidden="true" className="aurora">
        <div className="aurora-orb aurora-orb-a" />
        <div className="aurora-orb aurora-orb-b" />
        <div className="aurora-orb aurora-orb-c" />
      </div>
      <div aria-hidden="true" className="grain" />

      <header className="sticky top-0 z-30 border-b border-hairline bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <BackLink view={view} />
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="font-mono text-xs uppercase tracking-widest text-muted hover:text-accent"
            >
              home
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <article>
          <div className="flex items-start gap-4">
            {view.logoUrl !== undefined && <LogoPlate src={view.logoUrl} name={view.subtitle ?? view.title} size={80} />}
            <div className="min-w-0">
              {view.subtitle && (
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
                  {view.subtitle}
                </p>
              )}
              <h1 className="mt-2 font-display text-4xl leading-[1.1] md:text-5xl">{view.title}</h1>
            </div>
          </div>

          {view.summary && (
            <p className="mt-6 text-lg leading-relaxed text-muted">{view.summary}</p>
          )}

          {(view.meta.length > 0 || hasBody) && (
            <dl className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-y border-hairline py-3 font-mono text-xs">
              {view.meta.map((item) => (
                <div key={item.label} className="flex gap-2">
                  <dt className="text-muted">{item.label}</dt>
                  <dd>
                    {item.href ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        {item.value}
                      </a>
                    ) : (
                      item.value
                    )}
                  </dd>
                </div>
              ))}
              {hasBody && (
                <div className="flex gap-2">
                  <dt className="text-muted">read</dt>
                  <dd>{view.readingMinutes} min</dd>
                </div>
              )}
            </dl>
          )}

          {view.heroImageUrl && (
            <div className="relative mt-8 aspect-[2/1] overflow-hidden rounded-[var(--radius)] border border-hairline bg-elevated">
              <Image
                src={view.heroImageUrl}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 48rem"
                className="object-cover"
                priority
              />
            </div>
          )}

          {view.tech.length > 0 && (
            <ul className="mt-8 flex flex-wrap gap-1.5">
              {view.tech.map((t) => (
                <li
                  key={t}
                  className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[11px] text-muted"
                >
                  {t}
                </li>
              ))}
            </ul>
          )}

          {hasBody ? (
            <div className="mt-10">
              <BlockRenderer blocks={view.body} />
            </div>
          ) : (
            // Honest rather than blank: the page exists because it's linked
            // from the homepage, and a structured summary is still useful.
            <p className="mt-10 text-sm text-muted">
              No write-up yet — the details above are what there is for now.
            </p>
          )}
        </article>

        {children}

        <RelatedPosts posts={posts} />

        <footer className="mt-16 border-t border-hairline pt-8">
          <Link href="/" className="font-mono text-xs uppercase tracking-widest text-accent hover:underline">
            ← back to the site
          </Link>
        </footer>
      </main>
    </>
  );
}
