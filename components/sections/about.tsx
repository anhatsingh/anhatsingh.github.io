"use client";

import Image from "next/image";
import { Section } from "./section";
import { defaultAvatar } from "@/components/ui/default-avatar";
import type { Profile } from "@/lib/content/types";

/*
  About: portrait plus the full bio.

  The bio used to live in the hero, which left the hero carrying an eyebrow, a
  headline, a paragraph, a chat panel and a button row — too much for a first
  screen. Moving it here gives the photo somewhere to be and lets the hero land
  on the headline and the chatbot alone.
*/
export function About({ profile }: { profile: Profile }) {
  // Empty avatar_url falls back to the bundled, content-hashed default.
  const portrait = profile.avatarUrl?.trim() || defaultAvatar;

  return (
    <Section id="about" eyebrow="00 — About" title="Nice to meet you">
      <div className="grid gap-10 md:grid-cols-[minmax(0,18rem)_1fr] md:gap-12">
        {/*
          Square, not portrait. Profile photos are overwhelmingly square
          (LinkedIn, GitHub, every headshot crop), and object-cover in a 4:5
          frame would slice the sides off one — which on a tightly-framed
          headshot means clipping the subject. Square crops a portrait source
          far more gracefully than portrait crops a square one.

          `fill` rather than intrinsic sizing because avatar_url accepts any
          admin-pasted URL, so the real dimensions aren't knowable at build time.
        */}
        <div className="relative aspect-square w-full max-w-xs overflow-hidden rounded-xl border border-hairline bg-elevated">
          <Image
            src={portrait}
            alt={`Portrait of ${profile.name}`}
            fill
            sizes="(max-width: 768px) 100vw, 18rem"
            className="object-cover"
            // Sits just below the fold — worth prioritising so it isn't still
            // resolving by the time the visitor scrolls to it.
            priority
          />
        </div>

        <div className="max-w-2xl">
          <p className="text-lg leading-relaxed">{profile.bio}</p>

          <dl className="mt-8 space-y-2 font-mono text-sm">
            {profile.location && (
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-muted">based in</dt>
                <dd>{profile.location}</dd>
              </div>
            )}
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-muted">status</dt>
              <dd className={profile.openToWork ? "text-success" : ""}>
                {profile.openToWork ? "open to work" : "not looking right now"}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-muted">email</dt>
              <dd>
                <a href={`mailto:${profile.email}`} className="text-accent hover:underline">
                  {profile.email}
                </a>
              </dd>
            </div>
          </dl>

          {profile.resumeUrl && (
            <a
              href={profile.resumeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-block rounded-[var(--radius)] border border-accent px-4 py-2 font-mono text-xs uppercase tracking-widest text-accent transition-colors hover:bg-accent hover:text-accent-ink"
            >
              Read the resume ↓
            </a>
          )}
        </div>
      </div>
    </Section>
  );
}
