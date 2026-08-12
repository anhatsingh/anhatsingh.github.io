"use client";

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
export function TourButton() {
  const { send, open, status } = useChatDock();

  const busy = status === "submitted" || status === "streaming";

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        open();
        send("Show me around");
      }}
      title="A guided walk through the site"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius)] border border-invite/60 bg-invite/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-invite shadow-[0_0_0_3px_color-mix(in_srgb,var(--invite)_12%,transparent)] transition-colors hover:bg-invite/20 disabled:opacity-40"
    >
      <span aria-hidden="true">↝</span>
      <span className="hidden sm:inline">Show me around</span>
      <span className="sm:hidden">Tour</span>
    </button>
  );
}
