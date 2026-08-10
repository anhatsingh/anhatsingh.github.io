"use client";

import { useState } from "react";
import { Highlightable, Section } from "./section";
import { Avatar } from "@/components/ui/avatar";
import { itemId, type Testimonial } from "@/lib/content/types";

/*
  A recommendation is only as persuasive as the person behind it, so the author
  is given as much weight as the quote: photo, name, role, where they work, and
  a way to check they exist.

  Long quotes collapse. LinkedIn recommendations run to several hundred words
  and a grid of those is unreadable — the first few lines decide whether anyone
  wants the rest.
*/

/*
  Above this, the quote is clamped and gets a "Read more". Chosen from the
  actual data: LinkedIn recommendations cluster either well under this or far
  above it, so it separates the two cleanly instead of clipping by a line or two.
*/
const CLAMP_ABOVE_CHARS = 280;

function TestimonialCard({ t }: { t: Testimonial }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = t.quote.length > CLAMP_ABOVE_CHARS;

  return (
    <figure className="flex h-full flex-col rounded-[var(--radius)] border border-hairline bg-surface p-5">
      <blockquote className="flex-1">
        <p
          className={`leading-relaxed text-text ${
            isLong && !expanded ? "line-clamp-[6]" : ""
          }`}
        >
          <span className="font-display text-2xl leading-none text-accent" aria-hidden="true">
            &ldquo;
          </span>
          {t.quote}
        </p>

        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-2 font-mono text-[11px] uppercase tracking-widest text-accent hover:underline"
          >
            {expanded ? "Read less" : "Read more"}
          </button>
        )}
      </blockquote>

      <figcaption className="mt-5 flex items-start gap-3 border-t border-hairline pt-4">
        <Avatar src={t.authorImageUrl} name={t.authorName} />

        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{t.authorName}</p>

          {(t.authorTitle || t.authorCompany) && (
            <p className="truncate font-mono text-xs text-muted">
              {[t.authorTitle, t.authorCompany].filter(Boolean).join(" · ")}
            </p>
          )}

          {(t.authorUrl || t.authorEmail) && (
            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {t.authorUrl && (
                <a
                  href={t.authorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] uppercase tracking-widest text-accent hover:underline"
                >
                  Profile →
                </a>
              )}
              {t.authorEmail && (
                <a
                  href={`mailto:${t.authorEmail}`}
                  className="font-mono text-[11px] uppercase tracking-widest text-accent hover:underline"
                >
                  Email →
                </a>
              )}
            </p>
          )}
        </div>
      </figcaption>
    </figure>
  );
}

export function Testimonials({ testimonials }: { testimonials: Testimonial[] }) {
  if (!testimonials.length) return null;

  return (
    <Section id="testimonials" eyebrow="07 — Testimonials" title="What people say">
      <div className="grid items-stretch gap-6 md:grid-cols-2">
        {testimonials.map((t) => (
          <Highlightable key={t.slug} itemId={itemId("testimonials", t.slug)} fill>
            <TestimonialCard t={t} />
          </Highlightable>
        ))}
      </div>
    </Section>
  );
}
