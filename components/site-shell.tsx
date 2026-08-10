"use client";

import { ChatDock } from "@/components/chat/chat-dock";
import { ChatProvider } from "@/components/chat/chat-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { UIControlProvider, useUIControl } from "@/components/ui-control";
import { DownloadIcon } from "@/components/ui/icons";
import { resumeLinks } from "@/lib/resume";
import { NAVIGABLE_SECTIONS, SECTION_LABELS } from "@/lib/content/types";

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

        <nav aria-label="Sections" className="hidden items-center gap-5 md:flex">
          {NAVIGABLE_SECTIONS.filter((s) => s !== "github").map((s) => (
            <a
              key={s}
              href={`#${s}`}
              className={`font-mono text-xs uppercase tracking-widest transition-colors hover:text-accent ${
                focusedSection === s ? "text-accent" : "text-muted"
              }`}
            >
              {SECTION_LABELS[s]}
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
          */}
          {resume && (
            <a
              href={resume.downloadUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-accent-ink transition-opacity hover:opacity-90"
            >
              <DownloadIcon className="h-3 w-3" />
              <span className="hidden sm:inline">Download CV</span>
              <span className="sm:hidden">CV</span>
            </a>
          )}

          <ThemeToggle />
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
  children,
}: {
  name: string;
  avatarUrl?: string;
  resumeUrl?: string;
  children: React.ReactNode;
}) {
  return (
    <UIControlProvider>
      <ChatProvider assistantName={name} assistantAvatar={avatarUrl}>
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
