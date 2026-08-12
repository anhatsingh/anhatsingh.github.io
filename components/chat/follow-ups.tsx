"use client";

import { useChatDock } from "./chat-provider";

/*
  Three questions worth asking next, one click each.

  Most visitors ask one question and leave — not because they got what they
  needed, but because they don't know what else this thing can tell them, and
  composing a second question is more effort than closing the tab. Naming three
  specific ones turns that into a click.

  They are only shown under the newest reply. Older ones are answers to a
  conversation that has already moved on, and a scrollback littered with stale
  menus buries the thread the visitor is actually following.
*/
export function FollowUps({ questions }: { questions: string[] }) {
  const { send, status } = useChatDock();

  if (!questions.length) return null;

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
        Happy to go further — just ask
      </p>

      <ul className="mt-2 space-y-1">
        {questions.map((question) => (
          <li key={question}>
            <button
              type="button"
              disabled={busy}
              onClick={() => send(question)}
              className="group flex w-full items-start gap-2 rounded-[var(--radius)] px-2 py-1.5 text-left transition-colors hover:bg-elevated disabled:opacity-50"
            >
              {/*
                An arrow rather than a bullet: these are things that happen when
                clicked, not items in a list to be read past.
              */}
              <span
                className="mt-0.5 shrink-0 font-mono text-xs text-accent transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              >
                →
              </span>
              <span className="min-w-0 text-sm text-muted group-hover:text-text">{question}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
