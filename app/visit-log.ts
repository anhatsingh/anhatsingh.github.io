"use server";

import { getServiceClient } from "@/lib/supabase/server";
import { clean, type VisitEvent } from "@/lib/analytics/source";

/*
  Recording a visit.

  Separate from app/admin/actions.ts for the same reason chat-share is:
  everything there is behind requireAdmin, and this is a write a visitor
  causes. Keeping them apart means nobody has to remember why one export skips
  the auth check.

  Never throws and never awaited by the caller. Analytics that can break a page
  view is worse than no analytics.
*/

const EVENTS = new Set<VisitEvent>([
  "view",
  "chat_open",
  "chat_message",
  "tour",
  "resume",
  "share",
  "contact",
]);

export interface VisitInput {
  visitId: string;
  source: string;
  medium?: string | null;
  campaign?: string | null;
  referrerHost?: string | null;
  path: string;
  event: string;
}

export async function logVisit(input: VisitInput): Promise<void> {
  const db = getServiceClient();
  if (!db) return;

  const event = (EVENTS.has(input.event as VisitEvent) ? input.event : "view") as VisitEvent;

  // The client supplies all of this, so none of it is trusted for length or
  // shape. A path is kept as-is apart from its query string — which is where
  // the utm tags live, and they're already extracted into columns.
  const path = (input.path || "/").split("?")[0].slice(0, 200);
  const visitId = clean(input.visitId, 40);
  if (!visitId) return;

  try {
    await db.from("visits").insert({
      visit_id: visitId,
      source: clean(input.source) || "direct",
      medium: clean(input.medium) || null,
      campaign: clean(input.campaign) || null,
      referrer_host: clean(input.referrerHost, 100) || null,
      path,
      event,
    });
  } catch (err) {
    console.error("[visits] insert failed:", err);
  }
}
