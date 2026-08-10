"use client";

import { useChatDock } from "./chat-provider";

/*
  "Download CV" — which opens the chat instead of downloading.

  Anhat keeps several versions of his CV, each written for a different kind of
  role, so handing over a generic one wastes the best moment to find out what a
  visitor actually wants. The button starts the conversation: the assistant
  asks one open question, then serves the version that fits.

  A download control that doesn't download is a dark pattern if the visitor
  gets stuck, so the rule in lib/chat/prompt.ts is that the question is asked
  once and any brush-off — "just send it", "not sure" — produces the file
  immediately. The escape hatch is in the assistant's behaviour rather than a
  second button, because two buttons would give the game away.

  It sends a visitor turn rather than faking an assistant one: the transcript
  stays honest about who said what, and it needs nothing from useChat beyond
  what send() already does.

  Rendered by the header, the hero and the About section — one component so the
  three can't drift apart.
*/

const OPENER = "Can I get a copy of your CV?";

export function ResumeButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { send } = useChatDock();

  return (
    <button
      type="button"
      // send() opens the dock itself, so there's nothing else to coordinate.
      onClick={() => send(OPENER)}
      className={className}
    >
      {children}
    </button>
  );
}
