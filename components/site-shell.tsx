"use client";

import { ChatDock } from "@/components/chat/chat-dock";
import { ChatProvider } from "@/components/chat/chat-provider";
import { ResumeButton } from "@/components/chat/resume-button";
import { TalkButton } from "@/components/chat/talk-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { UIControlProvider, useUIControl } from "@/components/ui-control";
import { DownloadIcon } from "@/components/ui/icons";
import { resumeLinks } from "@/lib/resume";
import type { SectionId } from "@/lib/content/types";

/*
  The header lists FOUR sections, not every navigable one.

  Every section the chatbot can reach used to appear here, which meant nine
  links competing with the one control that matters — Download CV. A visitor
  scanning a portfolio wants the work, the history, and a way to get in touch;
  the rest they'll find by scrolling, and the chatbot can jump to any of them
  on request regardless of whether it's listed.
*/
const HEADER_LINKS: Array<{ id: SectionId; label: string }> = [
  { id: "about", label: "About" },
  { id: "projects", label: "Work" },
  { id: "experience", label: "Experience" },
  { id: "contact", label: "Contact" },
];

/*
  Page chrome + the split-layout mechanics.

  When the chatbot focuses a section, the content column gains right padding on
  lg so the docked rail doesn't cover it. Below lg the dock is a bottom sheet
  and the content is left alone — overlaying 62vh of a phone screen is fine
  because the visitor is reading the chat at that point anyway.
*/

function Header({ name, resumeUrl }: { name: string; resumeUrl?: string }) {
  const { focusedSection, clearFocus } = useUIControl();
  const resume = resumeLinks(resumeUrl);

  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-bg/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <a href="#hero" className="font-mono text-sm tracking-tight text-text hover:text-accent">
          {name.toLowerCase().replace(/\s+/g, "")}
          <span className="text-accent">.</span>
        </a>

        <nav aria-label="Sections" className="hidden items-center gap-6 md:flex">
          {HEADER_LINKS.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              className={`font-mono text-xs uppercase tracking-widest transition-colors hover:text-accent ${
                focusedSection === link.id ? "text-accent" : "text-muted"
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {focusedSection && (
            <button
              onClick={clearFocus}
              className="rounded-[var(--radius)] border border-accent/40 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-widest text-accent hover:bg-accent/10"
            >
              ✕ exit focus
            </button>
          )}

          {/*
            The one filled control in the header. For a visitor who is here to
            evaluate Anhat, downloading the CV is the conversion — it stays
            reachable from every scroll position rather than only in the hero.
            Label shortens to "CV" on narrow screens so it never wraps the bar.

            It opens the chat rather than downloading: there are several
            versions of the CV, and this is the moment to find out which one
            the visitor needs. See components/chat/resume-button.tsx.
          */}
          {resume && (
            <ResumeButton className="inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-accent-ink transition-opacity hover:opacity-90">
              <DownloadIcon className="h-3 w-3" />
              <span className="hidden sm:inline">Download CV</span>
              <span className="sm:hidden">CV</span>
            </ResumeButton>
          )}

          <ThemeToggle />

          {/* Rightmost: the chat is the thing this site does that others
              don't, so it gets the last word in the bar. */}
          <TalkButton />
        </div>
      </div>
    </header>
  );
}

function Content({ children }: { children: React.ReactNode }) {
  const { isSplit } = useUIControl();

  return (
    <main
      className={`transition-[padding] duration-500 [transition-timing-function:var(--ease)] ${
        isSplit ? "lg:pr-[400px]" : ""
      }`}
    >
      <div className="mx-auto max-w-5xl px-6">{children}</div>
    </main>
  );
}

export function SiteShell({
  name,
  avatarUrl,
  resumeUrl,
  resumeOptions,
  children,
}: {
  name: string;
  avatarUrl?: string;
  resumeUrl?: string;
  resumeOptions?: string[];
  children: React.ReactNode;
}) {
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

        <Header name={name} resumeUrl={resumeUrl} />
        <Content>{children}</Content>
        <ChatDock />
      </ChatProvider>
    </UIControlProvider>
  );
}
