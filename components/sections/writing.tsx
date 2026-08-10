"use client";

import Image from "next/image";
import { Highlightable, Section } from "./section";
import { itemId, type Writing as WritingItem } from "@/lib/content/types";

/*
  Writing entries are link cards only — title, summary, image, external URL.
  There is deliberately no post body, no MDX pipeline and no detail route:
  posts live on Medium (or wherever), and this section just points at them.
*/
export function Writing({ writing }: { writing: WritingItem[] }) {
  if (!writing.length) return null;

  return (
    <Section id="writing" eyebrow="08 — Writing" title="Things I've written">
      <div className="grid gap-6 md:grid-cols-2">
        {writing.map((w) => (
          <Highlightable key={w.slug} itemId={itemId("writing", w.slug)}>
            <a
              href={w.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group block overflow-hidden rounded-[var(--radius)] border border-hairline bg-surface transition-colors hover:border-accent"
            >
              {w.imageUrl && (
                <div className="relative aspect-[2/1] w-full overflow-hidden bg-elevated">
                  <Image
                    src={w.imageUrl}
                    alt=""
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                </div>
              )}
              <div className="p-5">
                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted">
                  {w.source && <span className="text-accent">{w.source}</span>}
                  {w.publishedAt && <span>· {w.publishedAt}</span>}
                </div>
                <h3 className="mt-2 font-display text-xl group-hover:text-accent">{w.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{w.summary}</p>
                <span className="mt-3 inline-block font-mono text-xs uppercase tracking-widest text-accent">
                  Read →
                </span>
              </div>
            </a>
          </Highlightable>
        ))}
      </div>
    </Section>
  );
}
