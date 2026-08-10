"use client";

import Image from "next/image";
import { useState } from "react";

/*
  A company / institution / issuer logo.

  Four things this handles that a bare <img> wouldn't:

  1. The white plate. Most real logos are dark ink on transparent, drawn for
     light backgrounds — on a black page they'd vanish. Everything sits on the
     same light plate so any logo works without a dark-mode variant.

  2. The shape. Real logos are mostly wordmarks: of the ones actually in use
     here, one is 200x60 ink inside a 200x200 file and another is 183x63. A
     fixed square plate scales those to fit its width and centres them, which
     leaves a band of white above and below taller than the logo itself. So the
     plate takes the image's own aspect ratio once it loads, and hugs it.

  3. Alignment. The plate sits in a fixed-size slot and is centred in it, so a
     wide wordmark and a square mark still leave the heading beside them at the
     same indent — and a row with no logo doesn't sit at a different one.

  4. Broken URLs. Admin-pasted links rot, and hotlinked logos get blocked. On
     an image error we fall back to the monogram rather than showing a broken
     image icon on the live site.
*/

/**
 * The plate's dimensions for a logo of a given aspect ratio.
 *
 * Pure so it can be tested: the failure here is a logo that renders squashed
 * or in a box far bigger than itself, which is invisible to a type checker and
 * easy to get subtly wrong at the clamp.
 */
export function plateSize(
  size: number,
  slotWidth: number,
  aspect: number | null,
): { width: number; height: number } {
  // Square until the real shape is known, so the layout doesn't guess wide.
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) {
    return { width: size, height: size };
  }
  if (aspect >= 1) {
    // Wide: grow to the logo's width, but never past the slot. Past that it
    // fits inside instead, which is the one case a little letterboxing is
    // unavoidable — the alternative is a plate wider than the column.
    const width = Math.min(slotWidth, Math.round(size * aspect));
    return { width, height: Math.round(width / aspect) };
  }
  // Tall: height is the constraint.
  return { width: Math.round(size * aspect), height: size };
}

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
  size = 60,
  /**
   * How wide a wordmark may get before it stops growing and starts fitting
   * inside instead. Also the slot width, so headings stay aligned.
   */
  maxWidth,
}: {
  src?: string;
  name: string;
  size?: number;
  maxWidth?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [aspect, setAspect] = useState<number | null>(null);

  const showImage = Boolean(src) && !failed;
  const slotWidth = maxWidth ?? Math.round(size * 1.75);

  /*
    Before the image loads, the plate is square. Sizing it from the natural
    dimensions afterwards means one reflow of a ~60px box, which is preferable
    to guessing wrong and either clipping a wordmark or reserving a wide gap
    for a square logo that never needed it.
  */
  const { width: plateW, height: plateH } = plateSize(size, slotWidth, showImage ? aspect : null);

  // Just enough margin that a logo with a hard edge doesn't touch the plate's
  // own border. Scales with the plate so a bigger plate doesn't gain a frame.
  const inset = Math.max(2, Math.round(Math.min(plateW, plateH) * 0.06));

  return (
    <div
      className="flex shrink-0 items-center justify-center"
      style={{ width: slotWidth, height: size }}
      // Decorative: the company name is always in the adjacent heading, so
      // announcing it twice just makes the timeline noisier for screen readers.
      aria-hidden="true"
    >
      <div
        className="flex items-center justify-center overflow-hidden rounded-lg border"
        style={{
          width: plateW,
          height: plateH,
          backgroundColor: "var(--logo-plate)",
          borderColor: "var(--logo-edge)",
        }}
      >
        {showImage ? (
          <Image
            src={src!}
            alt=""
            // Requested at 2x the slot so a retina panel doesn't upscale it.
            width={slotWidth * 2}
            height={size * 2}
            onError={() => setFailed(true)}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setAspect(img.naturalWidth / img.naturalHeight);
              }
            }}
            className="h-full w-full object-contain"
            style={{ padding: inset }}
          />
        ) : (
          <span
            className="font-mono font-bold"
            style={{ color: "var(--logo-ink)", fontSize: Math.round(size * 0.3) }}
          >
            {initialsFrom(name)}
          </span>
        )}
      </div>
    </div>
  );
}
