"use client";

import { useEffect, useRef, useState } from "react";

/*
  Diagrams, drawn in the browser.

  Written as ```mermaid fences inside a text block, which is how somebody
  drafting a write-up naturally reaches for a flowchart. Before this they
  rendered as several lines of literal "A[Prescription Data] --> B[...]",
  which is worse than not supporting them: it looks like a page that broke.

  Client-side and imported on demand. Mermaid is a couple of megabytes and most
  pages have no diagram at all, so a static import would put it in the bundle
  for everyone to pay for and nobody to use. This loads it the first time a
  diagram is actually on screen.

  It re-renders on theme change, because mermaid bakes colours into the SVG at
  draw time rather than reading them from CSS — a diagram drawn in light mode
  stays light after a toggle, black lines on a black page.
*/

/** Redrawn whenever this changes, which is what makes the theme toggle work. */
function currentTheme(): "dark" | "light" {
  if (typeof document === "undefined") return "light";
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark" || explicit === "light") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Reads the page's own palette so a diagram belongs to the page. */
function palette() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;

  return {
    accent: token("--accent", "#0e7490"),
    text: token("--text", "#151a23"),
    muted: token("--muted", "#5b6472"),
    surface: token("--surface", "#ffffff"),
    hairline: token("--hairline", "#e2e5e7"),
  };
}

export function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("light");

  // After mount, so the server and the first client render agree. Reading the
  // theme during render would disagree with the server's HTML and break
  // hydration.
  useEffect(() => setTheme(currentTheme()), []);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(currentTheme());
    media.addEventListener("change", onChange);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const colors = palette();

        mermaid.initialize({
          startOnLoad: false,
          // Mermaid's own dark theme, then overridden with this site's tokens
          // so a diagram doesn't arrive as a differently-coloured guest.
          theme: theme === "dark" ? "dark" : "neutral",
          themeVariables: {
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontSize: "14px",
            primaryColor: colors.surface,
            primaryTextColor: colors.text,
            primaryBorderColor: colors.accent,
            lineColor: colors.muted,
            secondaryColor: colors.surface,
            tertiaryColor: colors.surface,
            background: colors.surface,
            mainBkg: colors.surface,
            nodeBorder: colors.accent,
            clusterBkg: colors.surface,
            clusterBorder: colors.hairline,
            titleColor: colors.text,
            edgeLabelBackground: colors.surface,
          },
          securityLevel: "strict",
        });

        // A unique id per render: mermaid caches by id, and a reused one
        // silently returns the previous drawing after a theme change.
        const id = `m${Math.random().toString(36).slice(2)}`;
        const { svg: drawn } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(drawn);
          setFailed(false);
        }
      } catch {
        // A malformed diagram costs the diagram, not the page. The source is
        // shown instead, which is more useful than an empty box — it is
        // readable, and it says where the mistake is.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (failed) {
    return (
      <figure className="overflow-hidden rounded-[var(--radius)] border border-hairline bg-surface">
        <figcaption className="border-b border-hairline px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-muted">
          diagram
        </figcaption>
        <pre className="overflow-x-auto p-4 font-mono text-[0.8125rem] leading-relaxed">
          <code>{code}</code>
        </pre>
      </figure>
    );
  }

  return (
    <div
      ref={ref}
      /*
        Scrolls inside itself. A wide flowchart in a 68-character column would
        otherwise push the whole page sideways, which breaks every other line
        of text on it.
      */
      className="not-prose overflow-x-auto rounded-[var(--radius)] border border-hairline bg-surface p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-none"
      // Mermaid's own output, from source Anhat wrote, rendered with
      // securityLevel "strict" so embedded scripts and click handlers are
      // stripped before this ever sees it.
      dangerouslySetInnerHTML={{ __html: svg }}
      // Until it draws, the box is empty rather than jumping — announcing a
      // half-drawn diagram helps nobody.
      aria-hidden={!svg}
    />
  );
}
