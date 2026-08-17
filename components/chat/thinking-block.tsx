"use client";

/*
  The shell every "the assistant is working" block wears.

  The plan used to be a left-ruled paragraph in muted text, which is to say it
  looked exactly like something the assistant had said. Reading it, you could
  not tell whether you were looking at working-out or at the answer — and it
  sat above the real answer, so the first thing anyone read was scaffolding
  they had no reason to think was scaffolding.

  The investigation, meanwhile, was a bordered box. Two things doing the same
  job in two visual languages is most of why neither read as what it was.

  So one shell, and it deliberately does not look like prose: a tinted panel,
  a mono label, and text a size down. Nothing here is a message.
*/

export function ThinkingBlock({
  label,
  working,
  children,
  right,
}: {
  label: string;
  /** Drives the live dot and the accent. False once it has finished. */
  working: boolean;
  children: React.ReactNode;
  /** Optional trailing control, e.g. a disclosure caret. */
  right?: React.ReactNode;
}) {
  return (
    <section
      /*
        Marked so print can drop it. Working-out is the first thing that should
        go when somebody puts an answer on paper.
      */
      data-screen-only=""
      aria-label={label}
      className="my-2 overflow-hidden rounded-[var(--radius)] border border-dashed border-hairline bg-elevated/40"
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        {/*
          A live dot while it works, a static glyph once it has stopped. The
          dot is what separates "still going" from "this is what it did",
          which the label alone cannot say.
        */}
        {working ? (
          <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
        ) : (
          <span aria-hidden="true" className="shrink-0 font-mono text-[10px] text-muted">
            ⌁
          </span>
        )}

        <span
          className={`min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-widest ${
            working ? "text-accent" : "text-muted"
          }`}
        >
          {label}
        </span>

        {right}
      </div>

      {/*
        A rule between the label and the working, so the panel reads as a thing
        with a header rather than as a paragraph that happens to start small.
      */}
      <div className="border-t border-dashed border-hairline px-3 py-2">{children}</div>
    </section>
  );
}
