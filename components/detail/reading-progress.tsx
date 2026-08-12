"use client";

import { useEffect, useState } from "react";

/*
  How far through a long page you are.

  Only on entries with a real body. On a page that is mostly structured facts
  the bar would sit at 100% from the moment it loaded, which teaches people to
  ignore it everywhere else.

  It answers a question the scrollbar answers badly on a page with a sticky
  header and a docked chat panel: how much of this is left. That matters here
  because the audience is deciding whether to commit to reading.
*/
export function ReadingProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const update = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      // A page shorter than the viewport has nothing to track; reporting 0
      // rather than dividing by zero leaves the bar invisible, which is right.
      setProgress(scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      // Decorative: the same information is in the scrollbar, and announcing a
      // percentage that changes on every scroll event would be hostile.
      aria-hidden="true"
      // Marked so print can drop it; a fixed bar prints as a stripe across
      // the top of every page.
      data-screen-only=""
      className="fixed inset-x-0 top-0 z-40 h-0.5 bg-transparent"
    >
      <div
        className="h-full bg-accent transition-[width] duration-150 ease-out"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}
