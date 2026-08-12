import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { UIMessage } from "ai";
import { getSharedConversation } from "@/app/chat-share";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { ContinueButton } from "./continue-button";
import { getPortfolio } from "@/lib/content";

/*
  A shared conversation, read-only.

  Deliberately noindex. These are somebody's questions, kept because they chose
  to send them on — not content this site is publishing, and a search engine
  carrying them would turn an explicit share into a public archive.

  It renders prose only. The tool cards in a live transcript are controls for
  driving a page that isn't here, so replaying them would produce buttons that
  do nothing.
*/

export const metadata: Metadata = {
  title: "A conversation",
  robots: { index: false, follow: false },
};

export default async function SharedChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const messages = (await getSharedConversation(id)) as UIMessage[] | null;
  if (!messages) notFound();

  const { profile } = await getPortfolio();
  const first = profile.name.split(" ")[0];

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
        Shared conversation
      </p>
      <h1 className="mt-2 font-display text-3xl">About {profile.name}</h1>
      <p className="mt-2 text-sm text-muted">
        Someone asked {first}&apos;s assistant these questions and shared the answers. You can
        pick it up where they left off.
      </p>

      <div className="mt-10 space-y-6">
        {messages.map((m) => {
          const text = m.parts
            .filter((p) => p.type === "text")
            .map((p) => ("text" in p ? p.text : ""))
            .join("\n")
            .trim();
          if (!text) return null;

          return m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-accent-ink">
                {text}
              </div>
            </div>
          ) : (
            <div key={m.id} className="text-sm text-text">
              <ChatMarkdown text={text} />
            </div>
          );
        })}
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-hairline pt-6">
        <ContinueButton messages={messages} />
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:text-text"
        >
          Or start fresh →
        </Link>
      </div>
    </main>
  );
}
