"use client";

import { useEffect, useState } from "react";

/*
  Reading controls for a long page.

  These write-ups run to a couple of thousand words, and every choice behind
  the defaults — sans or serif, how wide the column is, how big the text — is
  an argument nobody wins. What is comfortable depends on the screen, the
  distance, and the eyes. So they are controls rather than decisions.

  Everything is applied as CSS custom properties on a wrapper, which means the
  whole article responds without a single component knowing a preference
  exists. Nothing re-renders; the browser reflows.

  Persisted in localStorage rather than session, because a reading preference
  is about the person, not the visit — somebody who needs larger text needs it
  every time, and asking twice is worse than not offering.
*/

const STORAGE_KEY = "anhat.reader.v1";

export interface ReaderPrefs {
  face: "sans" | "serif";
  /** Multiplier on the base body size. */
  size: number;
  /** Characters per line. */
  measure: number;
  leading: number;
}

const DEFAULTS: ReaderPrefs = { face: "sans", size: 1, measure: 68, leading: 1.75 };

const SIZES = [
  { label: "S", size: 0.92 },
  { label: "M", size: 1 },
  { label: "L", size: 1.12 },
  { label: "XL", size: 1.26 },
];

const WIDTHS = [
  { label: "Narrow", measure: 58 },
  { label: "Normal", measure: 68 },
  { label: "Wide", measure: 82 },
];

export function readerStyle(prefs: ReaderPrefs): React.CSSProperties {
  return {
    // Consumed by the prose styles in globals.css. Named rather than applied
    // directly so a code block or a diagram can opt out of the measure while
    // still following the size.
    "--reading-font": prefs.face === "serif" ? "var(--font-reading)" : "var(--font-sans)",
    "--reading-size": `${prefs.size}`,
    "--reading-measure": `${prefs.measure}ch`,
    "--reading-leading": `${prefs.leading}`,
  } as React.CSSProperties;
}

export function useReaderPrefs(): [ReaderPrefs, (next: Partial<ReaderPrefs>) => void] {
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULTS);

  /*
    Read after mount, not during render. Reading storage on the first render
    would disagree with the server's HTML and fail hydration — the same reason
    the chat transcript is restored in an effect.
  */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setPrefs({ ...DEFAULTS, ...(JSON.parse(saved) as Partial<ReaderPrefs>) });
    } catch {
      /* Private browsing. The defaults are perfectly good. */
    }
  }, []);

  const update = (next: Partial<ReaderPrefs>) => {
    setPrefs((current) => {
      const merged = { ...current, ...next };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {
        /* Nothing to do; it lasts the visit instead. */
      }
      return merged;
    });
  };

  return [prefs, update];
}

/*
  The control itself.

  A tab on the edge rather than a permanent sidebar: on a page whose job is
  reading, a panel of settings competing with the text is the opposite of the
  point. It sits out of the way until somebody is uncomfortable enough to look
  for it, which is exactly when they will.
*/
export function ReaderControls({
  prefs,
  update,
}: {
  prefs: ReaderPrefs;
  update: (next: Partial<ReaderPrefs>) => void;
}) {
  /*
    Open to begin with. A control nobody knows about is a control nobody uses,
    and the point of these is that the defaults will be wrong for somebody —
    showing them is what says the page can be changed at all.
  */
  const [open, setOpen] = useState(true);

  /*
    Except where there is no room. Below the width of a tablet the panel would
    sit on top of the column it exists to make readable, so it starts collapsed
    and the tab still opens it. Checked after mount, since the server has no
    viewport.
  */
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) setOpen(false);
  }, []);

  return (
    <div data-screen-only="" className="fixed right-0 top-1/2 z-30 -translate-y-1/2">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Reading settings"
          className="rounded-l-[var(--radius)] border border-r-0 border-hairline bg-surface/95 px-2 py-3 font-mono text-[10px] uppercase tracking-widest text-muted backdrop-blur transition-colors hover:text-accent"
        >
          <span className="[writing-mode:vertical-rl]">{open ? "close" : "read"}</span>
        </button>

        {open && (
          <div className="w-56 space-y-4 border-y border-l border-hairline bg-surface/95 p-4 backdrop-blur">
            <Row label="Typeface">
              {(["sans", "serif"] as const).map((face) => (
                <Choice
                  key={face}
                  active={prefs.face === face}
                  onClick={() => update({ face })}
                  // Set in the face it selects, so the choice shows itself
                  // rather than describing itself.
                  style={{
                    fontFamily: face === "serif" ? "var(--font-reading)" : "var(--font-sans)",
                  }}
                >
                  {face === "sans" ? "Sans" : "Serif"}
                </Choice>
              ))}
            </Row>

            <Row label="Size">
              {SIZES.map((s) => (
                <Choice key={s.label} active={prefs.size === s.size} onClick={() => update({ size: s.size })}>
                  {s.label}
                </Choice>
              ))}
            </Row>

            <Row label="Width">
              {WIDTHS.map((w) => (
                <Choice
                  key={w.label}
                  active={prefs.measure === w.measure}
                  onClick={() => update({ measure: w.measure })}
                >
                  {w.label}
                </Choice>
              ))}
            </Row>

            <Row label="Spacing">
              {[
                { label: "Tight", leading: 1.6 },
                { label: "Normal", leading: 1.75 },
                { label: "Loose", leading: 1.95 },
              ].map((l) => (
                <Choice
                  key={l.label}
                  active={prefs.leading === l.leading}
                  onClick={() => update({ leading: l.leading })}
                >
                  {l.label}
                </Choice>
              ))}
            </Row>

            <button
              type="button"
              onClick={() => update(DEFAULTS)}
              className="font-mono text-[10px] uppercase tracking-widest text-muted transition-colors hover:text-text"
            >
              Reset
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Choice({
  active,
  onClick,
  children,
  style,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={style}
      className={`rounded border px-2 py-1 text-xs transition-colors ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-hairline text-muted hover:border-accent/50 hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
