"use client";

import { HeroChatPanel } from "@/components/chat/hero-chat-panel";
import { BrandIcon, DownloadIcon } from "@/components/ui/icons";
import { resumeLinks } from "@/lib/resume";
import { socialLinks, type Profile } from "@/lib/content/types";
import { ResumeButton } from "@/components/chat/resume-button";

export function Hero({ profile }: { profile: Profile }) {
  const resume = resumeLinks(profile.resumeUrl);
  const socials = socialLinks(profile);

  return (
    /*
      Sized to leave the next section showing.

      At 88vh, plus the sticky header, the hero filled the screen and the only
      thing below the fold was About's top padding — so the first impression
      was a chat box and nothing else, and there was no reason to think
      scrolling would do anything. Now About's eyebrow and heading clear the
      fold, which says there is a page here far better than an arrow would.

      svh, not vh: on mobile vh is measured against the viewport with browser
      chrome retracted, so a vh-sized hero is taller than what's actually on
      screen and eats the reveal exactly where it matters most.

      The 14rem is the header plus the ~170px it takes to bring "00 — About"
      and its heading into view.
    */
    <section
      id="hero"
      className="flex min-h-[calc(100svh-14rem)] flex-col justify-center py-16"
    >
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
        {resume && (
          <ResumeButton className="inline-flex items-center gap-2 rounded-[var(--radius)] bg-accent px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-accent-ink transition-opacity hover:opacity-90">
            <DownloadIcon className="h-3.5 w-3.5" />
            Download CV
          </ResumeButton>
        )}
        {socials.map((link) => (
          <a
            key={link.key}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-hairline px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <BrandIcon name={link.key} />
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
