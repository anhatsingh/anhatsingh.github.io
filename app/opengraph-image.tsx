import { ImageResponse } from "next/og";
import { getPortfolio } from "@/lib/content";

/*
  The card that appears when the site is shared — LinkedIn, Slack, WhatsApp,
  X, iMessage.

  Generated rather than a static file so it always matches the current headline
  and role: change them in /admin and the share card follows, with no image to
  re-export. This is the asset most likely to be seen by a recruiter before the
  site itself.
*/

export const alt = "Anhat Singh — AI/ML Engineer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const { profile } = await getPortfolio();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#06090b",
          padding: "72px",
          // Matches the site's cyan glow so the card and the page feel related.
          backgroundImage:
            "radial-gradient(circle at 18% 12%, rgba(34,211,238,0.20), transparent 45%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: "#22d3ee" }} />
          <div
            style={{
              fontSize: 24,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#22d3ee",
            }}
          >
            {profile.tagline}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 76,
              lineHeight: 1.05,
              letterSpacing: -2,
              color: "#e7eef1",
              maxWidth: 900,
            }}
          >
            {profile.headline}
          </div>
          <div style={{ fontSize: 30, color: "#8d9ba5" }}>{profile.name}</div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 22,
            color: "#64737d",
          }}
        >
          <div>anhatsingh.com</div>
          {profile.openToWork && <div style={{ color: "#35d48a" }}>● open to work</div>}
        </div>
      </div>
    ),
    size,
  );
}
