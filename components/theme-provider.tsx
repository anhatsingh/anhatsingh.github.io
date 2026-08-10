"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/*
  next-themes injects its own blocking <script> before paint, and that script
  already wraps the localStorage read in try/catch — which matters more than it
  sounds: in Safari private mode an unguarded read *throws*, and a naive
  hand-rolled theme script silently loses dark mode entirely. We use theirs
  rather than duplicating it.

  attribute="data-theme" matches the selectors in globals.css.
*/
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
