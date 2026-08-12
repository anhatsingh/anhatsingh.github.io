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
import { SECTION_LABELS, parseItemId } from "@/lib/content/types";

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
  registerItem: (id: string, el: HTMLElement | null) => void;
  /** Scrolls an element to roughly a third down the viewport. */
  scrollTo: (el: HTMLElement) => void;
  /** The card that should scroll itself into view, if any. */
  scrollTarget: string | null;
  consumeScrollTarget: () => void;
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

  /*
    Highlighted cards register themselves so a highlight can scroll to the card
    rather than to the section holding it. Focusing the section alone put the
    highlighted item wherever it happened to fall — often below the fold, which
    is the one place it can't be seen.
  */
  const itemEls = useRef(new Map<string, HTMLElement>());

  /*
    The card a highlight should scroll to, consumed once it has.

    Kept as state rather than acted on directly because the card may not exist
    yet: highlighting something from a detail page navigates home first, and
    the card registers only after that page mounts. The target survives the
    navigation and the card scrolls itself when it arrives.
  */
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

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

  const registerItem = useCallback((id: string, el: HTMLElement | null) => {
    if (el) itemEls.current.set(id, el);
    else itemEls.current.delete(id);
  }, []);

  /** Called by a card once it has scrolled itself into view. */
  const consumeScrollTarget = useCallback(() => setScrollTarget(null), []);

  const announce = useCallback((message: string) => {
    // Clearing first guarantees the region re-announces even if the text repeats.
    setLiveMessage("");
    requestAnimationFrame(() => setLiveMessage(message));
  }, []);

  /*
    Puts an element about a third of the way down the viewport.

    scrollIntoView can't express this. "start" tucks the element under the
    sticky header, and "center" pushes a heading so far down that the content
    it introduces falls off the bottom. A third down clears the header and
    leaves what follows on screen, which is the whole reason for scrolling
    there.
  */
  const scrollTo = useCallback((el: HTMLElement) => {
    const top = window.scrollY + el.getBoundingClientRect().top - window.innerHeight * 0.28;
    window.scrollTo({
      top: Math.max(0, top),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, []);

  const focusSection = useCallback(
    (section: SectionId, reason?: string) => {
      enqueue(() => {
        setFocusedSection(section);

        const el = sectionEls.current.get(section);
        if (el) {
          scrollTo(el);
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
    [enqueue, announce, router, scrollTo],
  );

  const setHighlights = useCallback(
    (items: Highlight[]) => {
      const capped = items.slice(0, MAX_HIGHLIGHTS);
      enqueue(() => {
        // Replace wholesale — see invariant 2 above.
        setHighlightState(Object.fromEntries(capped.map((h) => [h.itemId, h.note])));

        const first = capped[0]?.itemId;
        if (first) {
          setScrollTarget(first);

          /*
            Nothing with that id is on this page — the visitor is reading a
            project or a post. Send them to the section that holds it; the
            highlight and the scroll target survive the navigation, so the card
            highlights itself on arrival.
          */
          if (!itemEls.current.has(first)) {
            const parsed = parseItemId(first);
            if (parsed) router.push(`/#${parsed.section}`);
          }
        }

        if (capped.length) {
          announce(
            capped.length === 1
              ? "Highlighted 1 relevant item"
              : `Highlighted ${capped.length} relevant items`,
          );
        }
      });
    },
    [enqueue, announce, router],
  );

  const clearFocus = useCallback(() => {
    // Deliberately not queued: dismissing is a user action and must feel instant.
    queue.current.length = 0;
    setFocusedSection(null);
    setHighlightState({});
    setScrollTarget(null);
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
      registerItem,
      scrollTarget,
      consumeScrollTarget,
      scrollTo,
      announce,
    }),
    [
      focusedSection,
      highlights,
      focusSection,
      setHighlights,
      clearFocus,
      registerSection,
      registerItem,
      scrollTarget,
      consumeScrollTarget,
      scrollTo,
      announce,
    ],
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

/**
 * Subscribes a card to its own highlight state, and gives it a ref to register.
 *
 * The ref is what lets a highlight scroll to the card rather than to the
 * section containing it, and — because registration happens on mount — what
 * makes a highlight requested from a detail page work once the homepage has
 * loaded. The card scrolls itself when it arrives and finds it is the target.
 */
export function useHighlight(itemId: string): {
  isHighlighted: boolean;
  note: string | null;
  ref: (el: HTMLElement | null) => void;
} {
  const { highlights, registerItem, scrollTarget, consumeScrollTarget, scrollTo } = useUIControl();
  const el = useRef<HTMLElement | null>(null);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      el.current = node;
      registerItem(itemId, node);
    },
    [registerItem, itemId],
  );

  useEffect(() => {
    if (scrollTarget !== itemId || !el.current) return;
    scrollTo(el.current);
    consumeScrollTarget();
  }, [scrollTarget, itemId, scrollTo, consumeScrollTarget]);

  const note = highlights[itemId] ?? null;
  return { isHighlighted: note !== null, note, ref };
}
