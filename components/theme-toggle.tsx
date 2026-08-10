"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // resolvedTheme is unknown until hydration; rendering the real icon before
  // then produces a flash of the wrong one.
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={mounted ? `Switch to ${isDark ? "light" : "dark"} mode` : "Toggle theme"}
      className="rounded-[var(--radius)] border border-hairline px-2.5 py-1.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent"
    >
      <span aria-hidden="true">{mounted ? (isDark ? "☀" : "☾") : "◐"}</span>
    </button>
  );
}
