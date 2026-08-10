"use client";

import Image from "next/image";
import { useState } from "react";

/*
  A company / institution / issuer logo.

  Three things this handles that a bare <img> wouldn't:

  1. The white plate. Most real logos are dark ink on transparent, drawn for
     light backgrounds — on a black page they'd vanish. Everything sits on the
     same light plate so any logo works without a dark-mode variant.

  2. The monogram fallback. Rows with a logo and rows without would otherwise
     sit at different indents and the column would look ragged. A missing logo
     still occupies the same plate, showing initials.

  3. Broken URLs. Admin-pasted links rot, and hotlinked logos get blocked. On
     an image error we fall back to the monogram rather than showing a broken
     image icon on the live site.
*/

function initialsFrom(name: string): string {
  const words = name
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function LogoPlate({
  src,
  name,
  size = 44,
}: {
  src?: string;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border"
      style={{
        width: size,
        height: size,
        backgroundColor: "var(--logo-plate)",
        borderColor: "var(--logo-edge)",
      }}
      // Decorative: the company name is always in the adjacent heading, so
      // announcing it twice just makes the timeline noisier for screen readers.
      aria-hidden="true"
    >
      {showImage ? (
        <Image
          src={src!}
          alt=""
          width={size}
          height={size}
          onError={() => setFailed(true)}
          className="h-full w-full object-contain p-1.5"
        />
      ) : (
        <span
          className="font-mono text-xs font-bold"
          style={{ color: "var(--logo-ink)" }}
        >
          {initialsFrom(name)}
        </span>
      )}
    </div>
  );
}
