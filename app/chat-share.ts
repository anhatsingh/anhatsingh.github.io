"use server";

import { getPublicClient, getServiceClient } from "@/lib/supabase/server";

/*
  Storing a conversation someone chose to share.

  Deliberately not in app/admin/actions.ts: everything there is behind
  requireAdmin, and this is the one write a visitor is allowed to make. Keeping
  it separate means nobody has to remember why one export in that file skips
  the auth check.

  Sharing is always explicit. Nothing is stored until the button is pressed, and
  the stored copy holds only what was said — no ip, no session, no identifiers.
  That's the same rule chat_questions follows, and the reason this needs no
  privacy policy.
*/

/* A transcript far past this is a stress test, not a conversation. */
const MAX_MESSAGES = 60;
const MAX_BYTES = 200_000;

export type ShareResult = { ok: true; id: string } | { ok: false; error: string };

export async function shareConversation(messages: unknown): Promise<ShareResult> {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: "Nothing to share yet." };
  }

  const trimmed = messages.slice(-MAX_MESSAGES);

  // The client decides what to send, so its size is the client's choice until
  // it isn't.
  if (JSON.stringify(trimmed).length > MAX_BYTES) {
    return { ok: false, error: "That conversation is too long to share." };
  }

  const db = getServiceClient();
  if (!db) return { ok: false, error: "Sharing isn't configured." };

  const { data, error } = await db
    .from("shared_chats")
    .insert({ messages: trimmed })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[share] failed:", error?.message);
    return { ok: false, error: "Couldn't create a link. Try again?" };
  }

  return { ok: true, id: data.id as string };
}

/**
 * Reads a shared transcript.
 *
 * Through the anon client so RLS decides, exactly as the rest of the public
 * site does — a link that works here works because the policy says so, not
 * because this function chose to trust it.
 */
export async function getSharedConversation(id: string): Promise<unknown[] | null> {
  const db = getPublicClient();
  if (!db) return null;

  const { data, error } = await db.from("shared_chats").select("messages").eq("id", id).maybeSingle();
  if (error || !data) return null;

  return Array.isArray(data.messages) ? (data.messages as unknown[]) : null;
}
