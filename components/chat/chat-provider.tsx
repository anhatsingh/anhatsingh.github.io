"use client";

import { useChat } from "@ai-sdk/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useUIControl } from "@/components/ui-control";
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
  send: (text: string) => void;
  open: () => void;
  close: () => void;
  stop: () => void;
  retry: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

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
  const router = useRouter();
  const { focusSection, setHighlights, clearFocus } = useUIControl();

  const { messages, sendMessage, status, error, stop, regenerate } = useChat();

  // Tool outputs arrive as stream updates, and the same part is re-rendered on
  // every token. Without this we'd re-scroll the page on each chunk.
  const handled = useRef(new Set<string>());

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
            window.open(outcome.url, "_blank", "noopener,noreferrer");
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
  }, [messages, focusSection, setHighlights, clearFocus, router]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setIsOpen(true);
      sendMessage({ text: trimmed });
    },
    [sendMessage],
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
        open: () => setIsOpen(true),
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
