import { ImageResponse } from "next/og";
import { getDetail } from "@/lib/content/entities";
import { getPortfolio } from "@/lib/content";
import { ENTITY_LABELS, type EntityType } from "@/lib/content/types";

/*
  The share card for a single entry.

  The root card in app/opengraph-image.tsx already covers the site, and Next
  inherits it to every route — so before this, a project link pasted into
  LinkedIn looked exactly like the homepage, and five different links looked
  like the same link.

  One renderer for all five detail routes rather than a file each. They differ
  only in which entity type they load, and five copies of a layout would drift
  the first time one of them was tweaked.
*/

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* Matched to the site's tokens so the card and the page look related. */
const INK = "#e7eef1";
const MUTED = "#8d9ba5";
const FAINT = "#64737d";
const ACCENT = "#22d3ee";

/** Long project titles have to shrink or they run off the card. */
function titleSize(title: string): number {
  if (title.length > 68) return 46;
  if (title.length > 44) return 56;
  return 68;
}

export async function renderDetailCard(type: EntityType, slug: string) {
  const [view, { profile }] = await Promise.all([getDetail(type, slug), getPortfolio()]);

  /*
    An unpublished or missing entry still has to return an image — a crawler
    asking for one gets a 500 otherwise, and a broken card is worse than a
    generic one. Falls back to the person, which is true of every page here.
  */
  const title = view?.title ?? profile.name;
  const subtitle = view?.subtitle ?? profile.tagline;
  const dates = view?.meta.find((m) => /date|year|when/i.test(m.label))?.value;

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
          backgroundImage:
            "radial-gradient(circle at 18% 12%, rgba(34,211,238,0.20), transparent 45%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: ACCENT }} />
          <div
            style={{
              fontSize: 24,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: ACCENT,
            }}
          >
            {ENTITY_LABELS[type]}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: titleSize(title),
              lineHeight: 1.05,
              letterSpacing: -2,
              color: INK,
              maxWidth: 1000,
            }}
          >
            {title}
          </div>

          {subtitle && (
            <div style={{ fontSize: 32, color: MUTED, maxWidth: 900 }}>{subtitle}</div>
          )}

          {/* Tech tags, when there are any — the fastest way for a recruiter
              scanning a feed to tell whether the link is worth opening. */}
          {view?.tech.length ? (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", maxWidth: 1000 }}>
              {view.tech.slice(0, 6).map((t) => (
                <div
                  key={t}
                  style={{
                    fontSize: 22,
                    color: MUTED,
                    border: "1px solid #223038",
                    borderRadius: 999,
                    padding: "6px 18px",
                  }}
                >
                  {t}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 22,
            color: FAINT,
          }}
        >
          {/*
            One text node, not two. Satori requires an explicit display on any
            div with more than one child, and "{name} · anhatsingh.com" is two
            children as far as JSX is concerned — which crashes the renderer
            rather than warning.
          */}
          <div>{`${profile.name} · anhatsingh.com`}</div>
          {dates && <div>{dates}</div>}
        </div>
      </div>
    ),
    size,
  );
}
