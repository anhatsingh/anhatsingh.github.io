import Image from "next/image";
import { InlineMarkdown } from "./inline-markdown";
import { GitHubIcon } from "@/components/ui/icons";
import { formatNumber } from "@/lib/format";
import { normalizeVideoUrl, type Block } from "@/lib/content/blocks";

/*
  Renders a body.

  Server component throughout — these are static documents, and keeping them off
  the client means a long post ships no JavaScript beyond what the page shell
  already loads.

  Every block is self-contained and degrades on its own: a dead image, an
  unreachable repo or an unparseable video URL costs that block, not the page.
*/

const PROSE = "leading-relaxed text-[1.0625rem] text-muted";

/*
  Live repo metadata, fetched at render.

  Stored copies of a description and star count go stale silently; this can't.
  Unauthenticated REST is 60 req/hr per IP, but the hour-long cache plus ISR
  means a page serves thousands of visitors on one call. Any failure renders the
  plain link instead — a repo block should never be the reason a page 500s.
*/
async function fetchRepo(repo: string) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;

  try {
    const token = process.env.GH_STATS_PAT;
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: token ? { Authorization: `bearer ${token}` } : undefined,
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      description: string | null;
      stargazers_count: number;
      language: string | null;
      html_url: string;
    };
    return data;
  } catch {
    return null;
  }
}

async function GitHubCard({ repo, note }: { repo: string; note?: string }) {
  const data = await fetchRepo(repo);
  const href = data?.html_url ?? `https://github.com/${repo}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-3 rounded-[var(--radius)] border border-hairline bg-surface p-4 transition-colors hover:border-accent"
    >
      <GitHubIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted group-hover:text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-sm text-text group-hover:text-accent">{repo}</span>
        {(note || data?.description) && (
          <span className="mt-1 block text-sm text-muted">{note ?? data?.description}</span>
        )}
        {data && (
          <span className="mt-2 flex flex-wrap gap-x-4 font-mono text-[11px] text-muted">
            {data.language && <span>{data.language}</span>}
            {data.stargazers_count > 0 && <span>★ {formatNumber(data.stargazers_count)}</span>}
          </span>
        )}
      </span>
    </a>
  );
}

function VideoBlock({ url, caption }: { url: string; caption?: string }) {
  const video = normalizeVideoUrl(url);
  if (!video) return null;

  return (
    <figure className="space-y-2">
      <div className="overflow-hidden rounded-[var(--radius)] border border-hairline bg-elevated">
        {video.kind === "direct" ? (
          // A real <video> for direct files: keyboard accessible, and it won't
          // autoplay past a reduced-motion preference the way an embed can.
          <video src={video.src} controls preload="metadata" className="aspect-video w-full">
            <track kind="captions" />
          </video>
        ) : (
          <iframe
            src={video.src}
            title={caption ?? "Embedded video"}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            className="aspect-video w-full border-0"
          />
        )}
      </div>
      {caption && <figcaption className="text-sm text-muted">{caption}</figcaption>}
    </figure>
  );
}

const CALLOUT_STYLE = {
  note: { border: "border-accent/40", bg: "bg-accent/5", mark: "text-accent", label: "Note" },
  warning: { border: "border-[var(--warn)]/40", bg: "bg-[var(--warn)]/5", mark: "text-[var(--warn)]", label: "Watch out" },
  success: { border: "border-success/40", bg: "bg-success/5", mark: "text-success", label: "Result" },
} as const;

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "text":
      return (
        <p className={PROSE}>
          <InlineMarkdown text={block.markdown} />
        </p>
      );

    case "heading":
      // h2/h3 only — the page title owns h1, so heading order stays valid.
      return block.level === 2 ? (
        <h2 className="mt-4 font-display text-2xl md:text-3xl">{block.text}</h2>
      ) : (
        <h3 className="mt-2 font-display text-xl">{block.text}</h3>
      );

    case "code":
      return (
        <figure className="overflow-hidden rounded-[var(--radius)] border border-hairline bg-surface">
          <figcaption className="flex items-center justify-between border-b border-hairline px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-muted">
            <span>{block.filename ?? block.language}</span>
            {block.filename && <span>{block.language}</span>}
          </figcaption>
          <pre className="overflow-x-auto p-4 font-mono text-[0.8125rem] leading-relaxed">
            <code>{block.code}</code>
          </pre>
        </figure>
      );

    case "image":
      return (
        <figure className="space-y-2">
          <div className="relative overflow-hidden rounded-[var(--radius)] border border-hairline bg-elevated">
            <Image
              src={block.url}
              alt={block.alt}
              width={1200}
              height={675}
              sizes="(max-width: 768px) 100vw, 42rem"
              className="h-auto w-full object-contain"
            />
          </div>
          {block.caption && <figcaption className="text-sm text-muted">{block.caption}</figcaption>}
        </figure>
      );

    case "video":
      return <VideoBlock url={block.url} caption={block.caption} />;

    case "github":
      return <GitHubCard repo={block.repo} note={block.note} />;

    case "link":
      return (
        <a
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group block rounded-[var(--radius)] border border-hairline bg-surface p-4 transition-colors hover:border-accent"
        >
          <span className="block text-text group-hover:text-accent">
            {block.title} <span aria-hidden="true">↗</span>
          </span>
          {block.description && (
            <span className="mt-1 block text-sm text-muted">{block.description}</span>
          )}
          <span className="mt-2 block truncate font-mono text-[11px] text-muted">{block.url}</span>
        </a>
      );

    case "callout": {
      const style = CALLOUT_STYLE[block.tone];
      return (
        <aside className={`rounded-[var(--radius)] border ${style.border} ${style.bg} p-4`}>
          <p className={`font-mono text-[11px] uppercase tracking-widest ${style.mark}`}>
            {style.label}
          </p>
          <p className="mt-1.5 leading-relaxed">
            <InlineMarkdown text={block.text} />
          </p>
        </aside>
      );
    }

    case "steps":
      return (
        <ol className="space-y-4">
          {block.steps.map((step, i) => (
            <li key={i} className="flex gap-4">
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/40 font-mono text-xs text-accent"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-text">{step.title}</span>
                <span className={`mt-1 block ${PROSE}`}>
                  <InlineMarkdown text={step.body} />
                </span>
              </span>
            </li>
          ))}
        </ol>
      );

    case "embed":
      return (
        <div className="overflow-hidden rounded-[var(--radius)] border border-hairline bg-elevated">
          <iframe
            src={block.url}
            title={block.title}
            loading="lazy"
            style={{ height: block.height ?? 460 }}
            // sandbox without allow-same-origin would break most demos; scripts
            // and forms are the point of an embed. It's still a separate origin
            // with no access to this page's DOM or cookies.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            className="w-full border-0"
          />
        </div>
      );
  }
}

export function BlockRenderer({ blocks }: { blocks: Block[] }) {
  if (!blocks.length) return null;

  return (
    <div className="space-y-6">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}
