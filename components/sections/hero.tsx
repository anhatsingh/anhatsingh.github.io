"use client";

import { HeroChatInput } from "@/components/chat/hero-chat-input";
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

      <h1 className="mt-6 max-w-3xl font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
        {profile.headline}
      </h1>

      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">{profile.bio}</p>

      <div className="mt-10">
        <HeroChatInput />
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        {profile.resumeUrl && (
          <a
            href={profile.resumeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[var(--radius)] bg-accent px-4 py-2 font-mono text-xs uppercase tracking-widest text-accent-ink transition-opacity hover:opacity-90"
          >
            Resume ↓
          </a>
        )}
        {profile.socials.github && (
          <a
            href={profile.socials.github}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[var(--radius)] border border-hairline px-4 py-2 font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:border-accent hover:text-accent"
          >
            GitHub
          </a>
        )}
        {profile.socials.linkedin && (
          <a
            href={profile.socials.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[var(--radius)] border border-hairline px-4 py-2 font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:border-accent hover:text-accent"
          >
            LinkedIn
          </a>
        )}
      </div>
    </section>
  );
}
