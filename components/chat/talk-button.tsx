"use client";

import { useChatDock } from "./chat-provider";

/*
  The header's entry point into the chat.

  It changes with the conversation rather than staying a static label. Before
  anything is said it invites — "Talk with AI". Once there is a transcript it
  becomes "Continue conv with AI" and switches colour, because at that point it
  is doing a different job: not an invitation but a way back to something the
  visitor already has open. Somebody who scrolled away mid-conversation needs
  to find their way back more than they need to be asked again.

  The colour change is not the only signal — the label changes too. Anyone who
  can't distinguish the two states by hue still reads a different word.
*/
export function TalkButton() {
  const { messages, isOpen, open } = useChatDock();

  const started = messages.length > 0;

  return (
    <button
      type="button"
      onClick={open}
      // The dock can be open while the header is still visible, so this stays
      // useful as a way back to it rather than being hidden.
      aria-expanded={isOpen}
      className={
        started
          ? "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius)] border border-success/50 bg-success/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-success transition-colors hover:bg-success/20"
          : "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius)] border border-hairline px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-muted transition-colors hover:border-accent hover:text-accent"
      }
    >
      {/*
        A filled dot once the conversation exists, hollow before — the same
        present/absent grammar the timeline nodes use.
      */}
      <span
        className={`h-1.5 w-1.5 rounded-full ${started ? "bg-success" : "bg-current opacity-50"}`}
        aria-hidden="true"
      />
      {started ? (
        <>
          <span className="hidden sm:inline">Continue conv with AI</span>
          <span className="sm:hidden">Continue</span>
        </>
      ) : (
        <>
          <span className="hidden sm:inline">Talk with AI</span>
          <span className="sm:hidden">Talk</span>
        </>
      )}
    </button>
  );
}
