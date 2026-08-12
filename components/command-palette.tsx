"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChatDock } from "@/components/chat/chat-provider";
import { useUIControl } from "@/components/ui-control";
import type { PaletteEntry } from "@/lib/content/palette";

/*
  ⌘K.

  Two audiences, one control. Somebody who knows what they're looking for types
  three letters and lands on it; somebody who doesn't types a question and it
  goes to the assistant. Anything that matches nothing falls through to asking
  rather than dead-ending on "no results", which is the state a search box is
  worst at.

  The entries are passed in from the server rather than fetched — the homepage
  already loads every one of these to render itself, so a second trip would buy
  nothing.
*/

export function CommandPalette({ entries }: { entries: PaletteEntry[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const router = useRouter();
  const { focusSection } = useUIControl();
  const { send } = useChatDock();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // Escape closes this before the chat dock sees it, which is why this
      // listener runs in the capture phase.
      if (e.key === "Escape" && open) {
        e.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    // A frame later: the input doesn't exist until this render commits.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  /*
    Substring matching on label and kind, not fuzzy. A list this size doesn't
    need fuzzy, and fuzzy matching surprises people by ranking something they
    didn't type above something they did.
  */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 8);
    return entries
      .filter((e) => `${e.label} ${e.kind}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [entries, query]);

  if (!open) return null;

  const askInstead = () => {
    if (!query.trim()) return;
    send(query.trim());
    setOpen(false);
  };

  const go = (entry: PaletteEntry) => {
    if (entry.href) router.push(entry.href);
    else if (entry.section) focusSection(entry.section);
    setOpen(false);
  };

  const options = matches.length;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      // Wraps past the last entry onto "ask", which is always available.
      setActive((i) => (i + 1) % (options + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + options + 1) % (options + 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active < options) go(matches[active]);
      else askInstead();
    }
  };

  return (
    <div
      data-screen-only=""
      className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[15vh]"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="animate-rise relative w-full max-w-lg overflow-hidden rounded-[var(--radius)] border border-hairline bg-surface shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Jump to, or ask…"
          aria-label="Search or ask"
          className="w-full border-b border-hairline bg-transparent px-4 py-3 text-sm text-text outline-none placeholder:text-muted"
        />

        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {matches.map((entry, i) => (
            <li key={`${entry.kind}-${entry.label}`}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(entry)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                  i === active ? "bg-elevated text-text" : "text-muted"
                }`}
              >
                <span className="min-w-0 truncate">{entry.label}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted">
                  {entry.kind}
                </span>
              </button>
            </li>
          ))}

          {/*
            Always last, always present. A search box that says "no results" has
            told somebody their question was wrong; this one hands it to
            something that can answer.
          */}
          <li>
            <button
              type="button"
              onMouseEnter={() => setActive(options)}
              onClick={askInstead}
              disabled={!query.trim()}
              className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm disabled:opacity-40 ${
                active === options ? "bg-elevated text-text" : "text-muted"
              }`}
            >
              <span className="min-w-0 truncate">
                {query.trim() ? `Ask: ${query.trim()}` : "Type to ask the assistant"}
              </span>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-accent">
                ask
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

