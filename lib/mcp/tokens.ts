import { randomBytes } from "node:crypto";
import { getServiceClient } from "@/lib/supabase/server";

/*
  Tokens for the MCP server.

  Nothing security-shaped is written here. The randomness is Node's CSPRNG, the
  hashing and the constant-time comparison are pgcrypto's bcrypt inside
  Postgres, and this file only moves values between the two. There is
  deliberately no comparison loop, no regex standing between a stranger and the
  data, and no hashing of our own — those are the places where being clever
  costs the most and where a mistake passes review.

  The plaintext exists for exactly one HTTP response. It is hashed on the way
  in and never stored, so a leaked database is not a leaked set of tokens, and
  the admin screen has to say so or somebody closes the tab expecting to find
  it again.
*/

export interface McpToken {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/*
  32 bytes, base64url. Long enough that guessing is not a threat model, and
  URL-safe so it survives being pasted into a config file or a header without
  anything escaping it.
*/
function mint(): string {
  return randomBytes(32).toString("base64url");
}

export type IssuedToken = { ok: true; token: string; id: string } | { ok: false; error: string };

/** Creates a token and returns the plaintext — the only time it exists. */
export async function issueToken(label: string): Promise<IssuedToken> {
  const db = getServiceClient();
  if (!db) return { ok: false, error: "No service key, so tokens can't be issued." };

  const name = label.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Give it a label, or you won't know what you're revoking." };

  const token = mint();
  const { data, error } = await db.rpc("issue_mcp_token", { new_label: name, plaintext: token });

  if (error) {
    console.error("[mcp] issue failed:", error.message);
    return { ok: false, error: "Couldn't create that token." };
  }

  return { ok: true, token, id: String(data) };
}

/**
 * Whether a presented token is real and still live.
 *
 * The whole check happens in Postgres — this cannot read mcp_tokens itself, by
 * design, and gets back an id or nothing.
 */
export async function verifyToken(candidate: string | null): Promise<string | null> {
  if (!candidate) return null;

  const db = getServiceClient();
  /*
    Fails closed. An unconfigured deploy refuses everything rather than serving
    everything — the same posture isAllowlisted takes with an empty allowlist,
    for the same reason.
  */
  if (!db) return null;

  const { data, error } = await db.rpc("verify_mcp_token", { candidate });
  if (error) {
    console.error("[mcp] verify failed:", error.message);
    return null;
  }

  return data ? String(data) : null;
}

/** Reads the Authorization header. Bearer only. */
export function bearerFrom(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme.toLowerCase() !== "bearer") return null;
  const value = rest.join(" ").trim();
  return value || null;
}

/** Every token, for the screen they are managed on. Never the hashes. */
export async function listTokens(): Promise<McpToken[]> {
  const db = getServiceClient();
  if (!db) return [];

  const { data, error } = await db
    .from("mcp_tokens")
    .select("id, label, created_at, last_used_at, revoked_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[mcp] list failed:", error.message);
    return [];
  }

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    label: String(r.label),
    createdAt: String(r.created_at),
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
    revokedAt: r.revoked_at ? String(r.revoked_at) : null,
  }));
}

/**
 * Revokes rather than deletes.
 *
 * A token that turns up in a log six months from now is only identifiable if
 * its row still exists — and "which of these did I kill in August" is a
 * question worth being able to answer.
 */
export async function revokeToken(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getServiceClient();
  if (!db) return { ok: false, error: "No service key." };

  const { error } = await db.from("mcp_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
