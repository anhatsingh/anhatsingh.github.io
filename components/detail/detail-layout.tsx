import Image from "next/image";
import Link from "next/link";
import { BlockRenderer } from "@/components/blocks/block-renderer";
import { DetailHighlight } from "@/components/detail/detail-highlight";
import { ReadingProgress } from "@/components/detail/reading-progress";
import { ReadingSurface } from "@/components/detail/reading-surface";
import { PassageHighlight } from "@/components/detail/passage-highlight";
import { LogoPlate } from "@/components/ui/logo-plate";
import { TalkButton } from "@/components/chat/talk-button";
import { TourButton } from "@/components/chat/tour-button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  ENTITY_LABELS,
  entityPath,
  itemId,
  sectionForEntity,
  type Writing,
} from "@/lib/content/types";
import type { DetailView } from "@/lib/content/entities";

/*
  The shell every detail page shares.

  Not wrapped in SiteShell — that carries the homepage's section nav, which
  points at anchors this page doesn't have. It gets a quiet header pointing
  back to the section it came from instead.

  The chat dock is still here: it lives in the root layout now, so a
  conversation started on the homepage continues onto this page rather than
  resetting. Asking about a section from here works too — focusSection
  navigates to the homepage anchor when the section isn't on the current page.

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

      {/* Only where there's something to read — on a page of structured facts
          the bar would sit full from the start and teach people to ignore it. */}
      {view.body.length > 0 && <ReadingProgress />}

      <header className="sticky top-0 z-30 border-b border-hairline bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <BackLink view={view} />
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/"
              className="font-mono text-xs uppercase tracking-widest text-muted hover:text-accent"
            >
              home
            </Link>
            {/* Works from here too: the first stop scrolls to a homepage
                section, and focusSection navigates when the section isn't on
                this page. */}
            <TourButton />

            {/* The chat follows the visitor across pages, so the way back into
                it has to as well — a conversation started on the homepage is
                still open here, and nothing said so. */}
            <TalkButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        {/*
          Registers this page under the same id its homepage card uses, so a
          highlight for this entry lands here instead of navigating away from
          the thing the visitor just asked about.
        */}
        <DetailHighlight itemId={itemId(sectionForEntity(view.type), view.slug)} />

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
                  <dt className="uppercase tracking-widest text-muted">{item.label}</dt>
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
                  <dt className="uppercase tracking-widest text-muted">read</dt>
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

          {/*
            Highlights, which no detail page rendered until education needed
            them — experience has carried them all along and quietly dropped
            them on the way to the page.
          */}
          {view.highlights && view.highlights.length > 0 && (
            <ul className="mt-6 space-y-2">
              {view.highlights.map((h, i) => (
                <li key={i} className="flex gap-3 text-[0.9375rem] leading-relaxed text-muted">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                  <span className="min-w-0">{h}</span>
                </li>
              ))}
            </ul>
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
            /*
              Narrower than the page. The header, the hero image and the facts
              list want the full 3xl; running text does not — at 48rem a line
              is around ninety characters, well past the point where the eye
              loses its place returning to the left margin. Around 68 is the
              range every publication settles on.

              Applied here rather than inside the renderer so a code block or a
              wide image can still break out to the full width if it needs to.
            */
            <ReadingSurface>
              {/*
                Wraps the body so the highlighter has a root to search. The
                body stays a server component either way — it comes through as
                children, so nothing inside becomes client code.
              */}
              <PassageHighlight itemId={itemId(sectionForEntity(view.type), view.slug)}>
                <div className="mt-10">
                  <BlockRenderer blocks={view.body} />
                </div>
              </PassageHighlight>
            </ReadingSurface>
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
