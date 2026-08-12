import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ThemeProvider } from "@/components/theme-provider";
import { SiteChrome } from "@/components/site-chrome";
import { getPortfolio } from "@/lib/content";
import { listPublishedResumes } from "@/lib/resume/store";
import { getAdminSession } from "@/lib/supabase/auth";
import { buildPaletteEntries } from "@/components/command-palette";
import { addressableIds, entityTypeForId, entityPath, NAVIGABLE_SECTIONS } from "@/lib/content/types";
import { SITE_URL } from "@/lib/seo";
import "./globals.css";

// Self-hosted at build time by next/font — no external request, no layout shift.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// Display face. 700 only — the lighter weights would blur the distinction
// between headings and body, which is the whole reason for a second family.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: "700",
  display: "swap",
});

/*
  Defaults only. The homepage overrides title, description, OG and canonical in
  its own generateMetadata, derived from the live profile — so editing the
  headline in /admin changes the search result too.

  metadataBase belongs here rather than there: it's what turns the relative
  opengraph-image path into the absolute URL crawlers require.
*/
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Anhat Singh — AI/ML Engineer",
    template: "%s · Anhat Singh",
  },
  description:
    "AI/ML engineer. This site has a chatbot that actually drives the page — ask it something and watch it find the answer for you.",
  applicationName: "Anhat Singh",
  referrer: "origin-when-cross-origin",
  formatDetection: { telephone: false, address: false, email: false },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Anhat Singh",
    locale: "en_US",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // Both entries so the browser chrome matches whichever theme is active.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /*
    Read here rather than per-page so the chat can live above the routing
    boundary, which is what keeps a conversation alive across a link click.
    getPortfolio is request-cached, so the page below shares this read rather
    than issuing a second one.
  */
  const portfolio = await getPortfolio();
  const resumeOptions = (await listPublishedResumes().catch(() => [])).map((r) => r.label);

  /*
    getAdminSession revalidates the token with Supabase and checks the email
    against ADMIN_EMAILS — it never trusts the cookie alone, and it never
    throws. Anything in the URL is irrelevant to it, which is the point: a
    "?code=" someone typed is not a session.
  */
  const session = await getAdminSession();

  /*
    ⌘K entries, built from what the page already loaded. Only entries with a
    page of their own get a href — the rest are reachable by scrolling to their
    section, which is what focusSection does.
  */
  const paletteEntries = buildPaletteEntries(
    NAVIGABLE_SECTIONS,
    [...addressableIds(portfolio).entries()].flatMap(([id, entry]) => {
      const type = entityTypeForId(id);
      if (!type) return [];
      const slug = id.slice(id.indexOf(":") + 1);
      return [{ id, label: entry.label, href: entityPath(type, slug), kind: entry.section }];
    }),
  );

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable}`}
    >
      <body>
        <ThemeProvider>
          <SiteChrome
            name={portfolio.profile.name}
            avatarUrl={portfolio.profile.avatarUrl}
            resumeOptions={resumeOptions}
            paletteEntries={paletteEntries}
            adminEmail={session?.email}
          >
            {children}
          </SiteChrome>
        </ThemeProvider>
        {/* Both are cookieless and store no personal data, so no consent banner
            is required. Each is inert outside a Vercel deployment, so local dev
            and any other host are unaffected. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
