"use client";

import { useEffect, useState } from "react";
import { useChatDock } from "./chat-provider";

/*
  Asks for the tour, so nobody has to know they can.

  The tour was already there, as a starter chip inside the chat and a phrase
  the assistant listens for. Both require having opened the chat and read the
  suggestions first — which means the thing this site does that others don't
  was behind the step most visitors skip.

  It types the request rather than triggering a tour directly. The route is the
  model's to plan from current content, and going through the chat leaves the
  request in the transcript, so what happens next reads as an answer to
  something asked rather than the page moving on its own.

  Violet, alone on this site. Teal is the chat and green is a conversation
  already open, so a third control in either would read as another state of the
  same button rather than a different offer. This one is a different offer.
*/

/** Remembers that this person has been offered the tour. */
const SEEN_KEY = "anhat.tour.offered";

/*
  Late enough to be a change rather than part of the page.

  An effect present at first paint is just how the button looks; one that
  starts a moment after the page settles is movement in the corner of the eye,
  which is the entire mechanism. It also keeps the nudge clear of whatever
  someone came to read first.
*/
const NUDGE_DELAY_MS = 2200;

/** And it stops. Nothing on a page should move indefinitely. */
const NUDGE_DURATION_MS = 60_000;

export function TourButton() {
  const { send, open, status, messages } = useChatDock();
  const [nudge, setNudge] = useState(false);

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    // Someone already talking has found the chat; pointing at it is noise.
    if (messages.length > 0) return;

    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // Private browsing throws on read. Treat it as a first visit — being
      // offered the tour twice is a smaller cost than never being offered it.
    }
    if (seen) return;

    const show = setTimeout(() => setNudge(true), NUDGE_DELAY_MS);
    const hide = setTimeout(() => setNudge(false), NUDGE_DELAY_MS + NUDGE_DURATION_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [messages.length]);

  const start = () => {
    setNudge(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* Nothing to do; the nudge simply reappears next visit. */
    }
    open();
    send("Show me around");
  };

  return (
    /*
      Wrapped rather than merely bordered.

      A CSS border cannot carry a gradient that moves, so the ring is a 1px
      inset: this element is the boundary, the rotating arc sits behind it, and
      the button's own opaque background covers everything but the edge. Idle,
      the wrapper is a flat violet and reads exactly as a border.
    */
    <span
      className={`relative inline-flex shrink-0 overflow-hidden rounded-[var(--radius)] p-px shadow-[0_0_0_3px_color-mix(in_srgb,var(--invite)_12%,transparent)] transition-colors ${
        nudge ? "bg-invite/25" : "bg-invite/60"
      }`}
    >
      {nudge && (
        <span
          aria-hidden="true"
          /*
            Oversized and square so the arc sweeps corners as evenly as sides. A
            layer the size of the button would rotate through a rectangle, and
            the highlight would visibly stall at each corner.
          */
          className="animate-border-sweep pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[240%] -translate-x-1/2 -translate-y-1/2"
        />
      )}

      <button
        type="button"
        disabled={busy}
        onClick={start}
        title="A guided walk through the site"
        /*
          Opaque, and tinted by mixing rather than by alpha over the page: a
          translucent fill would let the sweeping arc show through the middle of
          the button instead of only around its edge.
        */
        className="relative inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-1px)] bg-[color-mix(in_srgb,var(--invite)_10%,var(--bg))] px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-invite transition-colors hover:bg-[color-mix(in_srgb,var(--invite)_22%,var(--bg))] disabled:opacity-40"
      >
        <span aria-hidden="true">↝</span>
        <span className="hidden sm:inline">Show me around</span>
        <span className="sm:hidden">Tour</span>
      </button>
    </span>
  );
}
