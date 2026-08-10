"use client";

import Image from "next/image";
import { useState } from "react";

/*
  A person's photo.

  Deliberately not <LogoPlate>: that draws a light plate and letterboxes the
  image with object-contain, which is right for a company mark on transparent
  background and wrong for a face. Here the image fills a circle, and the
  fallback is initials on a tinted disc rather than a white card.

  Same error handling though — profile photo URLs rot, and a broken-image icon
  next to someone's recommendation looks worse than their initials.
*/

function initialsFrom(name: string): string {
  const words = name
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function Avatar({
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
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-hairline bg-accent/10"
      style={{ width: size, height: size }}
      // The name always sits in the adjacent caption; announcing it here too
      // just doubles it up for screen readers.
      aria-hidden="true"
    >
      {showImage ? (
        <Image
          src={src!}
          alt=""
          width={size}
          height={size}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="font-mono text-xs font-bold text-accent">{initialsFrom(name)}</span>
      )}
    </div>
  );
}
