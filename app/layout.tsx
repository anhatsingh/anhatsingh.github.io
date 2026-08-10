import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable}`}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
