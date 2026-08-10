"use client";

import { HeroChatPanel } from "@/components/chat/hero-chat-panel";
import { DownloadIcon, GitHubIcon, LinkedInIcon } from "@/components/ui/icons";
import type { Profile } from "@/lib/content/types";

export function Hero({ profile }: { profile: Profile }) {
  return (
    <section id="hero" className="flex min-h-[88vh] flex-col justify-center py-20">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
          /// {profile.tagline}
        </span>
        {profile.openToWork && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
            open to work
          </span>
        )}
      </div>

      {/* Tracking comes from .font-display (-0.03em); a tracking-* utility here
          would be silently overridden, so it's deliberately omitted. */}
      <h1 className="mt-6 max-w-3xl font-display text-5xl leading-[1.05] sm:text-6xl md:text-7xl">
        {profile.headline}
      </h1>

      {/* The bio lives in About now — the hero was carrying too much. */}
      <div className="mt-10">
        <HeroChatPanel />
      </div>

      {/*
        Icons sit alongside the labels rather than replacing them. A bare mark
        would be smaller to hit and ambiguous out of context; the pairing gives
        the recognisable shape to scan for AND keeps the accessible name in the
        text, so nothing depends on the SVG being announced.
      */}
      <div className="mt-10 flex flex-wrap items-center gap-3">
        {profile.resumeUrl && (
          <a
            href={profile.resumeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-[var(--radius)] bg-accent px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-accent-ink transition-opacity hover:opacity-90"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            Resume
          </a>
        )}
        {profile.socials.github && (
          <a
            href={profile.socials.github}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-hairline px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <GitHubIcon className="h-4 w-4" />
            GitHub
          </a>
        )}
        {profile.socials.linkedin && (
          <a
            href={profile.socials.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-hairline px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <LinkedInIcon className="h-4 w-4" />
            LinkedIn
          </a>
        )}
      </div>
    </section>
  );
}
