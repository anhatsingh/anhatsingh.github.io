"use client";

import { Highlightable, Section } from "./section";
import { itemId, type Testimonial } from "@/lib/content/types";

export function Testimonials({ testimonials }: { testimonials: Testimonial[] }) {
  if (!testimonials.length) return null;

  return (
    <Section id="testimonials" eyebrow="06 — Testimonials" title="What people say">
      <div className="grid gap-6 md:grid-cols-2">
        {testimonials.map((t) => (
          <Highlightable key={t.slug} itemId={itemId("testimonials", t.slug)}>
            <figure className="rounded-[var(--radius)] border border-hairline bg-surface p-5">
              <blockquote className="leading-relaxed text-text">
                <span className="font-display text-2xl text-accent" aria-hidden="true">
                  &ldquo;
                </span>
                {t.quote}
              </blockquote>
              <figcaption className="mt-4 font-mono text-xs text-muted">
                {t.authorUrl ? (
                  <a
                    href={t.authorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    {t.authorName}
                  </a>
                ) : (
                  <span className="text-accent">{t.authorName}</span>
                )}
                {t.authorTitle && <span> · {t.authorTitle}</span>}
                {t.authorCompany && <span> · {t.authorCompany}</span>}
              </figcaption>
            </figure>
          </Highlightable>
        ))}
      </div>
    </Section>
  );
}
