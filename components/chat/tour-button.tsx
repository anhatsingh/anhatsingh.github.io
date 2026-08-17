"use client";

import { useEffect, useState } from "react";
import { useChatDock } from "./chat-provider";
import { useVisitLog } from "@/components/visit-tracker";

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

/*
  Late enough to be a change rather than part of the page.

  An effect present at first paint is just how the button looks; one that
  starts a moment after the page settles is movement in the corner of the eye,
  which is the entire mechanism. It also keeps the nudge clear of whatever
  someone came to read first.
*/
const NUDGE_DELAY_MS = 2200;

/*
  And it stops. Nothing on a page should move indefinitely, and half a minute
  is long enough to be noticed by someone reading rather than only by someone
  already looking at the header.

  Deliberately every visit rather than once per person. The tour is worth
  taking more than once — it walks whatever the site currently says — and
  somebody who ignored it in January is not somebody who has decided. It costs
  a returning visitor thirty seconds of a light in the corner of their eye.
*/
const NUDGE_DURATION_MS = 30_000;

export function TourButton() {
  const { send, open, status, messages } = useChatDock();
  const logVisit = useVisitLog();
  const [nudge, setNudge] = useState(false);

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    /*
      Someone already talking has found the chat, so pointing at it is noise.
      This also covers a reload mid-visit: the conversation is restored from
      session storage, so the nudge doesn't restart on top of it.
    */
    if (messages.length > 0) return;

    const show = setTimeout(() => setNudge(true), NUDGE_DELAY_MS);
    const hide = setTimeout(() => setNudge(false), NUDGE_DELAY_MS + NUDGE_DURATION_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [messages.length]);

  const start = () => {
    setNudge(false);
    // Logged separately from chat_open: taking the tour says the nudge worked,
    // which is a different fact from someone finding the chat on their own.
    logVisit("tour");
    open();
    send("Show me around");
  };

  return (
    /*
      Wrapped rather than merely bordered.

      A CSS border cannot carry a gradient that moves, so the ring is a two
      pixel inset: this element is the boundary, the rotating arc sits behind
      it, and the button's own opaque background covers everything but the
      edge. Idle, the wrapper is a flat violet and reads exactly as a border.

      Two pixels rather than one because one is what a border is for. The ring
      has to carry a travelling highlight, and at a single pixel on a control
      this size the light was gone before the eye found it.
    */
    <span
      className={`relative inline-flex shrink-0 overflow-hidden rounded-[var(--radius)] p-[2px] shadow-[0_0_0_3px_color-mix(in_srgb,var(--invite)_12%,transparent)] transition-colors ${
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

            No translate utilities here: the keyframes own the whole transform,
            because an animation replaces the property rather than composing
            with it.
          */
          className="animate-border-sweep pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[240%]"
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
        className="relative inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-2px)] bg-[color-mix(in_srgb,var(--invite)_10%,var(--bg))] px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-invite transition-colors hover:bg-[color-mix(in_srgb,var(--invite)_22%,var(--bg))] disabled:opacity-40"
      >
        <span aria-hidden="true">↝</span>
        <span className="hidden sm:inline">Show me around</span>
        <span className="sm:hidden">Tour</span>
      </button>
    </span>
  );
}
