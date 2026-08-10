"use client";

import Image from "next/image";
import { defaultAvatar } from "@/components/ui/default-avatar";

/*
  Anhat's face on the assistant's messages.

  It's a deliberate signal that the bot speaks FOR him, not AS him — the system
  prompt keeps it in third person ("he built…"), so pairing the portrait with
  that voice reads as "his assistant" rather than an impersonation.
*/
export function AssistantAvatar({ src, name, size = 24 }: { src?: string; name: string; size?: number }) {
  const portrait = src?.trim() || defaultAvatar;

  return (
    <span
      className="relative shrink-0 overflow-hidden rounded-full border border-hairline"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Image src={portrait} alt="" fill sizes={`${size}px`} className="object-cover" />
      <span className="sr-only">{name}</span>
    </span>
  );
}
