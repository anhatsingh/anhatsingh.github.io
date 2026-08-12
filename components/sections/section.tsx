"use client";

import { useHighlight, useSectionRef, useUIControl } from "@/components/ui-control";
import type { SectionId } from "@/lib/content/types";

/*
  Section + highlight primitives.

  Sections register themselves so the chatbot can scroll to them; cards
  subscribe to their own highlight state. Neither knows the chatbot exists —
  they only know about ids. That's what keeps the AI feature from leaking into
  every presentational component.
*/

export function Section({
  id,
  eyebrow,
  title,
  children,
  className = "",
}: {
  id: SectionId;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useSectionRef(id);
  const { focusedSection } = useUIControl();
  const isFocused = focusedSection === id;

  return (
    <section
      id={id}
      ref={ref}
      // tabIndex allows programmatic focus when the chatbot navigates here,
      // which moves the screen-reader cursor rather than only the viewport.
      tabIndex={-1}
      aria-labelledby={`${id}-heading`}
      className={`scroll-mt-24 py-20 outline-none ${className}`}
    >
      <div className="mb-8 flex items-baseline gap-3">
        <span
          className={`font-mono text-xs uppercase tracking-[0.2em] transition-colors ${
            isFocused ? "text-accent" : "text-muted"
          }`}
        >
          {eyebrow}
        </span>
        <span
          aria-hidden="true"
          className={`h-px flex-1 transition-colors ${isFocused ? "bg-accent/40" : "bg-hairline"}`}
        />
      </div>
      <h2 id={`${id}-heading`} className="mb-10 font-display text-4xl md:text-5xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Wraps any addressable card. When the chatbot highlights this item, a cyan
 * callout appears above it explaining why it's relevant.
 */
export function Highlightable({
  itemId,
  children,
  className = "",
  fill = false,
}: {
  itemId: string;
  children: React.ReactNode;
  className?: string;
  /**
   * Stretches the wrapper to the grid row's height. Card layouts need the
   * height to reach the child, and there are two wrapper divs in the way.
   */
  fill?: boolean;
}) {
  const { isHighlighted, note, ref } = useHighlight(itemId);

  return (
    <div ref={ref} className={`relative ${fill ? "flex h-full flex-col" : ""} ${className}`}>
      {isHighlighted && note && (
        <div
          role="note"
          className="animate-rise mb-2 inline-flex items-start gap-2 rounded-[var(--radius)] border border-callout-border bg-callout-bg px-3 py-2"
        >
          <span className="font-mono text-xs text-accent" aria-hidden="true">
            ⌁
          </span>
          <span className="text-sm text-text">{note}</span>
        </div>
      )}
      <div
        className={`transition-[border-color,box-shadow] duration-300 ${
          fill ? "flex-1" : ""
        } ${isHighlighted ? "border-l-2 border-accent pl-4" : "border-l-2 border-transparent pl-4"}`}
      >
        {children}
      </div>
    </div>
  );
}
