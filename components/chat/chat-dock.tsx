"use client";

import { isToolUIPart, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { useChatDock } from "./chat-provider";
import { AssistantAvatar } from "./assistant-avatar";
import { ContactCard } from "./contact-card";
import { FitReport } from "./fit-report";
import { Activity, isBusy } from "./activity";
import { ChatMarkdown } from "./chat-markdown";
import { FollowUps } from "./follow-ups";
import { ShareButton } from "./share-button";
import { ResumeCard } from "./resume-card";
import { SourceList } from "./source-list";
import { ResumeList } from "./resume-list";
import { RoleChips } from "./role-chips";
import { useRouter } from "next/navigation";
import { useUIControl } from "@/components/ui-control";
import type { ToolOutcome } from "@/lib/chat/tools";

/*
  The docked chat panel.

  Mounted once, always present in the DOM, shown/hidden with CSS. Moving it
  between containers would remount it and wipe the transcript, so its position
  is purely a styling concern.

  Desktop: right rail. Below lg: bottom sheet. The layout shift on the content
  side is handled by the page shell reading `isSplit`.
*/

/*
  Renders what the bot DID, so its agency reads as deliberate rather than spooky.

  Clickable, because the record of an action is also the way back to it. A
  visitor who scrolls on, or asks three more questions, loses the highlight and
  the scroll position — and re-reading "highlighted 1 item" without being able
  to see which one is worse than not saying it. Clicking replays exactly what
  the assistant did.

  Actions with a card of their own — fit, draft, resume, resumeList,
  roleOptions, followUps — are handled earlier and never reach here; a pill
  under a card that already says the same thing is noise.
*/
function ActionPill({ outcome }: { outcome: ToolOutcome }) {
  const { focusSection, setHighlights } = useUIControl();
  const router = useRouter();

  if (outcome.ok !== true) return null;

  let label: string | null = null;
  if (outcome.action === "focus") label = `focused ${outcome.label}`;
  else if (outcome.action === "highlight")
    label = `highlighted ${outcome.items.length} item${outcome.items.length > 1 ? "s" : ""}`;
  else if (outcome.action === "clear") label = "cleared focus";
  else if (outcome.action === "navigate") label = `opened ${outcome.label}`;

  if (!label) return null;

  const replay = () => {
    if (outcome.action === "focus") focusSection(outcome.section, outcome.reason);
    else if (outcome.action === "highlight") setHighlights(outcome.items);
    else if (outcome.action === "navigate") router.push(outcome.url);
  };

  const replayable =
    outcome.action === "focus" || outcome.action === "highlight" || outcome.action === "navigate";

  if (!replayable) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
        <span aria-hidden="true">↳</span>
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={replay}
      title="Show me again"
      className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent transition-colors hover:border-accent hover:bg-accent/20"
    >
      <span aria-hidden="true">↳</span>
      {label}
    </button>
  );
}

function MessageParts({ message }: { message: UIMessage }) {
  /*
    Citations belong under the answer, not above it.

    Tool parts arrive in the order they ran, and research runs before the model
    writes — so rendering parts in sequence put a list of links where the answer
    should be, and the reader met the sources before the point they support.
    They're collected out and appended instead.
  */
  /*
    Kept on every reply, not just the newest.

    Trimming them to the last answer assumed the conversation only moves
    forward. It doesn't — someone reads three replies, then wants the question
    they skipped two answers ago, and finding it gone means retyping something
    that was on screen a moment earlier.
  */
  const followUps = message.parts.flatMap((part) => {
    if (!isToolUIPart(part) || part.state !== "output-available") return [];
    const outcome = part.output as ToolOutcome;
    return outcome?.ok === true && outcome.action === "followUps" ? outcome.questions : [];
  });

  const sources = message.parts.flatMap((part) => {
    if (!isToolUIPart(part) || part.state !== "output-available") return [];
    const outcome = part.output as ToolOutcome;
    return outcome?.ok === true && outcome.action === "sources"
      ? [{ id: part.toolCallId, topic: outcome.topic, results: outcome.results }]
      : [];
  });

  return (
    <>
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          if (!part.text.trim()) return null;
          return <ChatMarkdown key={i} text={part.text} />;
        }

        if (isToolUIPart(part) && part.state === "output-available") {
          const outcome = part.output as ToolOutcome;

          if (outcome?.ok === true && outcome.action === "fit") {
            return (
              <FitReport
                key={i}
                verdict={outcome.verdict}
                matches={outcome.matches}
                gaps={outcome.gaps}
                summary={outcome.summary}
              />
            );
          }

          if (outcome?.ok === true && outcome.action === "resume") {
            return <ResumeCard key={part.toolCallId} url={outcome.url} label={outcome.label} />;
          }

          if (outcome?.ok === true && outcome.action === "followUps") {
            // Rendered below the answer, not inline where it ran.
            return null;
          }

          if (outcome?.ok === true && outcome.action === "roleOptions") {
            return <RoleChips key={part.toolCallId} />;
          }

          if (outcome?.ok === true && outcome.action === "resumeList") {
            return <ResumeList key={part.toolCallId} resumes={outcome.resumes} />;
          }

          if (outcome?.ok === true && outcome.action === "draft") {
            return (
              <div key={i} className="my-2">
                <ContactCard
                  initialName={outcome.name}
                  initialEmail={outcome.email}
                  initialMessage={outcome.message}
                />
              </div>
            );
          }

          return (
            <div key={i} className="my-1">
              <ActionPill outcome={outcome} />
            </div>
          );
        }

        return null;
      })}

      {sources.map((s) => (
        <SourceList key={s.id} topic={s.topic} results={s.results} />
      ))}

      {followUps.length > 0 && <FollowUps questions={followUps} />}
    </>
  );
}

const STARTERS = [
  "Show me around",
  "Walk me through his best project",
  "Paste a job description →",
  "I'd like to reach out",
];

export function ChatDock() {
  const { messages, status, error, isOpen, send, close, stop, retry, assistantAvatar, assistantName } =
    useChatDock();
  const { isSplit } = useUIControl();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const busy = status === "submitted" || status === "streaming";

  // The turn in flight, if the assistant has started one — its tool parts are
  // what the indicator reads to name what's running.
  const last = messages[messages.length - 1];
  const inFlight = last?.role === "assistant" ? last : undefined;

  useEffect(() => {
    // Keep the newest content in view as tokens arrive.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    send(draft);
    setDraft("");
  }

  return (
    <aside
      aria-label="Chat with Anhat's assistant"
      data-open={isOpen}
      // Marks the dock so a selection made inside it doesn't offer to explain
      // the assistant's own answer back to it.
      data-chat-dock=""
      className={[
        "fixed z-40 flex flex-col border-hairline bg-surface/95 backdrop-blur transition-all duration-500",
        "[transition-timing-function:var(--ease)]",
        // Bottom sheet on small screens
        "inset-x-0 bottom-0 max-h-[62vh] rounded-t-xl border-t",
        // Right rail from lg up
        "lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[400px] lg:rounded-none lg:border-l lg:border-t-0",
        isOpen
          ? "pointer-events-auto translate-y-0 opacity-100 lg:translate-x-0"
          : "pointer-events-none translate-y-full opacity-0 lg:translate-x-full lg:translate-y-0",
      ].join(" ")}
    >
      <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${busy ? "bg-accent animate-pulse" : "bg-success"}`}
            aria-hidden="true"
          />
          <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
            {busy ? "thinking" : "assistant · online"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {busy && (
            <button
              onClick={stop}
              className="rounded px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-muted hover:text-text"
            >
              stop
            </button>
          )}
          {/* Only worth offering once there's something to send. */}
          {messages.length > 0 && <ShareButton messages={messages} />}
          <button
            onClick={close}
            aria-label="Close chat"
            className="rounded px-2 py-1 text-muted transition-colors hover:text-text"
          >
            ✕
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-muted">
              Ask me anything about Anhat. I&apos;ll pull up the relevant part of the page as I answer.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-hairline px-2.5 py-1 text-left text-xs text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-accent-ink">
                <MessageParts message={m} />
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-2.5">
              <AssistantAvatar src={assistantAvatar} name={assistantName} size={26} />
              <div className="min-w-0 flex-1 space-y-1 text-text">
                <MessageParts message={m} />
              </div>
            </div>
          ),
        )}

        {/*
          Named rather than a bare three dots. A turn can spend seconds
          searching, and "Searching the web" reads as considered where dots
          read as stuck. Shown while streaming too, since a tool called
          mid-answer keeps working long after the first token lands.
        */}
        {/*
          Last in the list, under the conversation, so it sits where the next
          answer will appear rather than above what has already been said.
        */}
        {isBusy(status) && (
          <div className="flex items-center gap-2.5">
            <AssistantAvatar src={assistantAvatar} name={assistantName} size={26} />
            <Activity message={inFlight} streaming={status === "streaming"} />
          </div>
        )}

        {error && (
          <div className="rounded-[var(--radius)] border border-danger/40 bg-danger/10 p-3">
            <p className="text-danger">{error.message || "That didn't work."}</p>
            <button
              onClick={retry}
              className="mt-2 font-mono text-[11px] uppercase tracking-widest text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-hairline p-3">
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-hairline bg-bg px-3 py-2 focus-within:border-accent">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about his work…"
            aria-label="Message"
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-text outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Send"
            className="font-mono text-xs uppercase tracking-widest text-accent disabled:opacity-40"
          >
            send
          </button>
        </div>
        {isSplit && (
          <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted">
            press esc to exit focus view
          </p>
        )}
      </form>
    </aside>
  );
}
