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

  A halo present at first paint is just how the button looks; one that appears
  a moment after the page settles is movement in the corner of the eye, which
  is the entire mechanism. It also keeps the nudge out of the way of whatever
  someone came to read first.
*/
const NUDGE_DELAY_MS = 2200;

/*
  And it stops. A control that pulses until clicked has stopped suggesting and
  started nagging, and anyone who ignored six cycles has decided.
*/
const NUDGE_DURATION_MS = 15_000;

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
    <button
      type="button"
      disabled={busy}
      onClick={start}
      title="A guided walk through the site"
      className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius)] border border-invite/60 bg-invite/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-invite transition-colors hover:bg-invite/20 disabled:opacity-40 ${
        nudge
          ? "animate-invite"
          : "shadow-[0_0_0_3px_color-mix(in_srgb,var(--invite)_12%,transparent)]"
      }`}
    >
      <span aria-hidden="true">↝</span>
      <span className="hidden sm:inline">Show me around</span>
      <span className="sm:hidden">Tour</span>

      {/*
        The arrow, hung below the header and pointing back up at the button.

        Decorative and click-through: it overhangs the page, and an arrow that
        swallowed a click on whatever is underneath would be worse than no
        arrow. Screen readers skip it — the button already says what it does.

        Below rather than beside because the header is a tight row and the only
        free space is downward, and because an arrow that comes up from the
        content is pointing the way the visitor is already looking.
      */}
      {nudge && (
        <span
          aria-hidden="true"
          className="animate-point pointer-events-none absolute right-1 top-full mt-1 flex flex-col items-end"
        >
          <svg
            width="46"
            height="40"
            viewBox="0 0 46 40"
            fill="none"
            className="text-invite drop-shadow-[0_1px_6px_color-mix(in_srgb,var(--invite)_45%,transparent)]"
          >
            {/*
              Drawn as one hand-ish curve rather than a straight shaft: a
              geometric arrow in a header reads as an icon, and this needs to
              read as somebody pointing.
            */}
            <path
              d="M38 4C39 16 33 27 20 32"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <path
              d="M36 13.5 38.6 3.6 29.4 7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>

          <span className="-mt-1 mr-1 whitespace-nowrap font-display text-[13px] italic tracking-tight text-invite drop-shadow-[0_1px_6px_var(--bg)]">
            start here
          </span>
        </span>
      )}
    </button>
  );
}
