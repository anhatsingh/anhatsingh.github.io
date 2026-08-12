"use client";

import { useRouter } from "next/navigation";
import type { UIMessage } from "ai";
import { useChatDock } from "@/components/chat/chat-provider";

/*
  Picks the shared conversation up and carries it on.

  Someone lands here because a colleague sent them a transcript. Reading it is
  half of what they want; the other half is the question the transcript didn't
  cover, and without this they'd have to go to the homepage and start over
  against an assistant that knows none of it.

  Loading the transcript rather than starting empty is the point: the follow-up
  they have in mind almost certainly refers to something already said.

  It goes home because the tour, the highlights and the section scrolling are
  all things the assistant does to that page. Left here, the useful half of the
  chat would be pointing at content that isn't on screen.
*/
export function ContinueButton({ messages }: { messages: UIMessage[] }) {
  const { resume } = useChatDock();
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        resume(messages);
        router.push("/");
      }}
      className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
    >
      Continue this conversation →
    </button>
  );
}
