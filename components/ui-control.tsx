"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SectionId } from "@/lib/content/types";
import { SECTION_LABELS } from "@/lib/content/types";

/*
  THE ACTION BUS
  ==============
  This is what turns a model tool-call into page behaviour.

  Design rule: sections and cards do NOT know the chatbot exists. They register
  themselves by id and subscribe to "am I highlighted?". Everything about
  sequencing, cooldowns and scrolling lives here. That keeps the chat feature
  from leaking into every presentational component.

  Two invariants worth preserving if you edit this:
   1. Navigations are QUEUED, never dropped. Dropping one produces an answer
      that references something the page never moved to.
   2. Highlights are capped and replaced per turn, not accumulated — otherwise
      three questions in a row leave the page covered in stale callouts.
*/

/** Minimum spacing between page-moving actions, so answers don't yank the view. */
const NAV_COOLDOWN_MS = 1200;

/** Hard cap on callouts per turn. Also enforced server-side in the tool schema. */
export const MAX_HIGHLIGHTS = 3;

export interface Highlight {
  itemId: string;
  note: string;
}

/** A record of something the chatbot did, rendered as a pill in the transcript. */
export interface UIAction {
  id: string;
  kind: "focus" | "highlight" | "clear" | "resume";
  label: string;
}

interface UIControlValue {
  focusedSection: SectionId | null;
  highlights: Record<string, string>;
  isSplit: boolean;

  focusSection: (section: SectionId, reason?: string) => void;
  setHighlights: (items: Highlight[]) => void;
  clearFocus: () => void;

  registerSection: (section: SectionId, el: HTMLElement | null) => void;
  announce: (message: string) => void;
}

const UIControlContext = createContext<UIControlValue | null>(null);

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function UIControlProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [focusedSection, setFocusedSection] = useState<SectionId | null>(null);
  const [highlights, setHighlightState] = useState<Record<string, string>>({});
  const [liveMessage, setLiveMessage] = useState("");

  const sectionEls = useRef(new Map<SectionId, HTMLElement>());

  // Serialised navigation queue. Each entry waits out the cooldown from the
  // previous one so a multi-tool turn reads as a guided tour rather than a jump cut.
  const queue = useRef<Array<() => void>>([]);
  const draining = useRef(false);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const drain = useCallback(() => {
    if (draining.current) return;
    const next = queue.current.shift();
    if (!next) return;

    draining.current = true;
    next();

    const t = setTimeout(() => {
      timers.current.delete(t);
      draining.current = false;
      drain();
    }, NAV_COOLDOWN_MS);
    timers.current.add(t);
  }, []);

  const enqueue = useCallback(
    (fn: () => void) => {
      queue.current.push(fn);
      drain();
    },
    [drain],
  );

  const registerSection = useCallback((section: SectionId, el: HTMLElement | null) => {
    if (el) sectionEls.current.set(section, el);
    else sectionEls.current.delete(section);
  }, []);

  const announce = useCallback((message: string) => {
    // Clearing first guarantees the region re-announces even if the text repeats.
    setLiveMessage("");
    requestAnimationFrame(() => setLiveMessage(message));
  }, []);

  const focusSection = useCallback(
    (section: SectionId, reason?: string) => {
      enqueue(() => {
        setFocusedSection(section);

        const el = sectionEls.current.get(section);
        if (el) {
          el.scrollIntoView({
            behavior: prefersReducedMotion() ? "auto" : "smooth",
            block: "start",
          });
          // Move the screen-reader cursor too. A visual scroll alone leaves
          // keyboard users stranded wherever they were.
          el.focus({ preventScroll: true });
        } else {
          /*
            The section isn't on this page.

            Now that the chat follows the visitor onto detail pages, asking
            about projects from a blog post is ordinary rather than a mistake —
            and doing nothing would look like the assistant had simply failed.
            Sending them to the homepage anchor is what it meant to do.
          */
          router.push(`/#${section}`);
        }

        announce(reason ?? `Showing ${SECTION_LABELS[section]}`);
      });
    },
    [enqueue, announce, router],
  );

  const setHighlights = useCallback(
    (items: Highlight[]) => {
      const capped = items.slice(0, MAX_HIGHLIGHTS);
      enqueue(() => {
        // Replace wholesale — see invariant 2 above.
        setHighlightState(Object.fromEntries(capped.map((h) => [h.itemId, h.note])));
        if (capped.length) {
          announce(
            capped.length === 1
              ? "Highlighted 1 relevant item"
              : `Highlighted ${capped.length} relevant items`,
          );
        }
      });
    },
    [enqueue, announce],
  );

  const clearFocus = useCallback(() => {
    // Deliberately not queued: dismissing is a user action and must feel instant.
    queue.current.length = 0;
    setFocusedSection(null);
    setHighlightState({});
    announce("Exited focus view");
  }, [announce]);

  const value = useMemo<UIControlValue>(
    () => ({
      focusedSection,
      highlights,
      isSplit: focusedSection !== null,
      focusSection,
      setHighlights,
      clearFocus,
      registerSection,
      announce,
    }),
    [focusedSection, highlights, focusSection, setHighlights, clearFocus, registerSection, announce],
  );

  return (
    <UIControlContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMessage}
      </div>
    </UIControlContext.Provider>
  );
}

export function useUIControl(): UIControlValue {
  const ctx = useContext(UIControlContext);
  if (!ctx) throw new Error("useUIControl must be used inside <UIControlProvider>");
  return ctx;
}

/**
 * Attach the returned ref to a section wrapper to make it a navigation target.
 * The wrapper needs tabIndex={-1} for the focus move to land.
 */
export function useSectionRef(section: SectionId) {
  const { registerSection } = useUIControl();
  return useCallback(
    (el: HTMLElement | null) => registerSection(section, el),
    [registerSection, section],
  );
}

/** Subscribe a card to its own highlight state. */
export function useHighlight(itemId: string): { isHighlighted: boolean; note: string | null } {
  const { highlights } = useUIControl();
  const note = highlights[itemId] ?? null;
  return { isHighlighted: note !== null, note };
}
