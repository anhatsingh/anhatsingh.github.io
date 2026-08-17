"use client";

import { useChat } from "@ai-sdk/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useUIControl } from "@/components/ui-control";
import { useVisitLog } from "@/components/visit-tracker";
import type { PageContext } from "@/lib/chat/page-context";
import type { ToolOutcome } from "@/lib/chat/tools";
import type { SectionId } from "@/lib/content/types";

/*
  Owns the single chat instance for the whole page.

  Why a provider rather than useChat inside the panel: the hero has its own
  entry input, and the docked panel has another. Both must drive the same
  conversation, and the transcript must survive the hero→rail transition
  without remounting (a remount would visibly wipe the history mid-answer).
  One chat instance, two views.
*/

interface ChatContextValue {
  messages: UIMessage[];
  status: ReturnType<typeof useChat>["status"];
  error: Error | undefined;
  isOpen: boolean;
  /** Anhat's portrait, shown on assistant messages. */
  assistantAvatar?: string;
  assistantName: string;
  /*
    Labels of the saved resume variants, resolved on the server and passed in.

    Deliberately not routed through the model: it asks the open question and
    emits a marker, and these are rendered as controls beside its answer. That
    way it still cannot enumerate the variants in prose or be talked into
    naming them, while the visitor gets something to click.
  */
  resumeOptions: string[];
  /**
   * Sends a turn, attaching where the visitor is and what they highlighted.
   *
   * The selection is per-message rather than sticky: it describes this
   * question, not the conversation.
   */
  send: (text: string, selection?: string) => void;
  open: () => void;
  /**
   * Loads a transcript into the live chat and opens it.
   *
   * For someone who arrived on a shared conversation and wants to carry it on.
   * The read-only page can show them what was said; only this can hand it back
   * to a model that will answer, with everything already said as context.
   */
  resume: (messages: UIMessage[]) => void;
  close: () => void;
  stop: () => void;
  retry: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/** One visit, one conversation. Bumped if the stored shape ever changes. */
const STORAGE_KEY = "anhat.chat.v1";

export function ChatProvider({
  children,
  assistantName,
  assistantAvatar,
  resumeOptions = [],
}: {
  children: React.ReactNode;
  assistantName: string;
  resumeOptions?: string[];
  assistantAvatar?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const router = useRouter();
  const { focusSection, setHighlights, clearFocus, visibleSection } = useUIControl();
  const pathname = usePathname();

  const { messages, sendMessage, setMessages, status, error, stop, regenerate } = useChat();

  /*
    What a visit was worth, not just that it happened. Opening the chat and
    asking something are the two events that separate a channel worth funding
    from one that only produces pageviews.
  */
  const logVisit = useVisitLog();

  /*
    The conversation outlives the page.

    Client-side navigation keeps this provider mounted, so state survives a
    link click on its own. A hard reload does not, and that is the case worth
    handling: somebody who opened the chat, followed a link and refreshed
    should not find their conversation gone and the dock shut. Only closing it
    closes it.

    sessionStorage rather than localStorage: this belongs to the visit. A
    recruiter returning next week should get a clean slate, not a half-finished
    exchange they no longer remember.

    Restored after mount rather than seeded into useChat, because reading
    storage during the first render would disagree with the server's empty
    output and hydration would fail.
  */
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { open?: boolean; messages?: UIMessage[] };
      if (Array.isArray(parsed.messages) && parsed.messages.length) setMessages(parsed.messages);
      if (parsed.open) setIsOpen(true);
    } catch {
      // Corrupt or unavailable storage is not worth failing the page over.
    }
    setRestored(true);
  }, [setMessages]);

  // Tool outputs arrive as stream updates, and the same part is re-rendered on
  // every token. Without this we'd re-scroll the page on each chunk.
  const handled = useRef(new Set<string>());

  /*
    Writing back only after the restore has run. Without this the first render
    would persist an empty conversation over a real one and undo the restore
    before it happened.
  */
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ open: isOpen, messages }));
    } catch {
      // Private browsing and full quotas both throw here; neither is a reason
      // to break the chat.
    }
  }, [restored, isOpen, messages]);

  useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue;

      for (const part of message.parts) {
        if (!isToolUIPart(part)) continue;
        if (part.state !== "output-available") continue;

        const key = part.toolCallId;
        if (handled.current.has(key)) continue;

        const outcome = part.output as ToolOutcome | undefined;
        if (!outcome || outcome.ok !== true) {
          // A rejected tool call (bad id, missing resume) is already reported
          // back to the model, which will retry. Nothing for the UI to do.
          handled.current.add(key);
          continue;
        }

        handled.current.add(key);

        switch (outcome.action) {
          case "focus":
            focusSection(outcome.section as SectionId, outcome.reason);
            break;
          case "highlight":
            setHighlights(outcome.items);
            break;
          case "clear":
            clearFocus();
            break;
          case "resume":
            // The strongest signal this site produces: somebody wanted the CV.
            logVisit("resume");
            window.open(outcome.url, "_blank", "noopener,noreferrer");
            break;
          case "tour":
            /*
              Deliberately inert. The tour card drives the page itself, one stop
              at a time, at whatever pace the visitor sets — firing the route
              from here would run the whole walk the moment the reply landed,
              which is the behaviour the card exists to replace.
            */
            break;
          case "followUps":
            // Nothing to do — the questions render under the answer and only
            // do anything when clicked.
            break;
          case "sources":
            // Nothing to do — the citation card renders below the answer, and
            // opening tabs the visitor didn't ask for would be hostile.
            break;
          case "roleOptions":
            // Nothing to do — the chips render from data the client already
            // holds. Listed so the switch stays exhaustive.
            break;
          case "resumeList":
            // Deliberately no side effect. Opening five tabs because someone
            // asked what versions exist would be hostile; the card below the
            // message carries the links.
            break;
          case "navigate":
            // Deliberately NOT through the UIControl queue. That cooldown exists
            // to stop scroll-thrash within one page; a route change is a
            // decision the visitor asked for and should feel immediate.
            router.push(outcome.url);
            break;
          case "draft":
            // Rendered inline in the transcript by ContactCard; no page effect.
            break;
        }

        void getToolName(part);
      }
    }
  }, [messages, focusSection, setHighlights, clearFocus, router, logVisit]);

  const send = useCallback(
    (text: string, selection?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setIsOpen(true);

      /*
        Read at send time rather than kept in state: the visitor may have
        scrolled or navigated since the last render, and what matters is where
        they were when they asked.
      */
      const pageContext: PageContext = {
        path: pathname,
        title: document.querySelector("h1")?.textContent?.trim() || undefined,
        visibleSection: visibleSection ?? undefined,
        selection,
      };

      logVisit("chat_message");
      sendMessage({ text: trimmed }, { body: { pageContext } });
    },
    [sendMessage, pathname, visibleSection, logVisit],
  );

  const resume = useCallback(
    (transcript: UIMessage[]) => {
      /*
        The visitor's own conversation wins if there is one. Someone who has
        been talking here and follows a shared link back has more invested in
        what they typed than in what a stranger did, and replacing it silently
        would be the one thing this can do that cannot be undone.
      */
      setMessages((current) =>
        current.length ? current : (transcript as typeof current),
      );
      setIsOpen(true);
    },
    [setMessages],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    clearFocus();
  }, [clearFocus]);

  return (
    <ChatContext.Provider
      value={{
        messages,
        status,
        error,
        isOpen,
        assistantAvatar,
        assistantName,
        resumeOptions,
        send,
        open: () => {
          logVisit("chat_open");
          setIsOpen(true);
        },
        resume,
        close,
        stop,
        retry: () => regenerate(),
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChatDock(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatDock must be used inside <ChatProvider>");
  return ctx;
}
