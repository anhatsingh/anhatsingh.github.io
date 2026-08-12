"use client";

import { usePathname } from "next/navigation";
import { ChatDock } from "@/components/chat/chat-dock";
import { ChatProvider, useChatDock } from "@/components/chat/chat-provider";
import { UIControlProvider } from "@/components/ui-control";

/*
  Everything that wraps every public page.

  This lives in the root layout rather than in SiteShell so the chat survives
  navigation. A provider mounted above the routing boundary keeps its state
  when a link is followed, which is what makes the conversation continue from
  the homepage onto a project page instead of resetting — and the dock is only
  ever closed by the person who opened it.

  It also means the decorative layers and the page shift are defined once, for
  every page, rather than only on the homepage.
*/

/*
  The page moves aside for the dock.

  Wrapping the children — header included — rather than only the article is the
  point: a sticky header that stayed full width would sit under the dock, and
  the two would overlap at exactly the moment the visitor is using both.

  Only from lg. Below that the dock is a bottom sheet and the page is fine
  where it is; shifting a phone screen sideways for a 400px panel would leave
  nothing to shift into.
*/
function PageShift({ children }: { children: React.ReactNode }) {
  const { isOpen } = useChatDock();

  return (
    <div
      className={`transition-[padding] duration-500 [transition-timing-function:var(--ease)] ${
        isOpen ? "lg:pr-[400px]" : ""
      }`}
    >
      {children}
    </div>
  );
}

export function SiteChrome({
  children,
  name,
  avatarUrl,
  resumeOptions,
}: {
  children: React.ReactNode;
  name: string;
  avatarUrl?: string;
  resumeOptions: string[];
}) {
  const pathname = usePathname();

  /*
    The admin panel is a different application that happens to share a domain.
    A chat dock over the editor would be noise, and the visitor-facing UI
    control machinery has nothing to drive there.
  */
  if (pathname.startsWith("/admin")) return <>{children}</>;

  return (
    <UIControlProvider>
      <ChatProvider assistantName={name} assistantAvatar={avatarUrl} resumeOptions={resumeOptions}>
        {/* Fixed decorative layers, behind everything, non-interactive. */}
        <div aria-hidden="true" className="aurora">
          <div className="aurora-orb aurora-orb-a" />
          <div className="aurora-orb aurora-orb-b" />
          <div className="aurora-orb aurora-orb-c" />
        </div>
        <div aria-hidden="true" className="grain" />

        <PageShift>{children}</PageShift>
        <ChatDock />
      </ChatProvider>
    </UIControlProvider>
  );
}
