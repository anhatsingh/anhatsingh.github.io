"use client";

import { useState, useTransition } from "react";
import { createMcpToken, revokeMcpToken } from "@/app/admin/actions";
import type { McpToken } from "@/lib/mcp/tokens";

/*
  Issuing and revoking MCP tokens.

  The one screen in the admin where a value can be lost by navigating away, so
  the freshly-minted token is the loudest thing on the page and says outright
  that it will not be shown again. Everything else — labels, timestamps — can
  be re-read from the table at any time; this cannot.
*/

function when(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function TokenManager({ tokens }: { tokens: McpToken[] }) {
  const [label, setLabel] = useState("");
  const [minted, setMinted] = useState<{ token: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function create() {
    setError(null);
    start(async () => {
      const result = await createMcpToken(label);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMinted({ token: result.token, label: label.trim() });
      setLabel("");
      setCopied(false);
    });
  }

  function revoke(token: McpToken) {
    /*
      Confirmed, because it cannot be undone and whatever is holding the token
      stops working the moment this returns.
    */
    if (!window.confirm(`Revoke "${token.label}"? Anything using it stops working immediately.`)) return;
    setError(null);
    start(async () => {
      const result = await revokeMcpToken(token.id);
      if (!result.ok) setError(result.error);
    });
  }

  async function copy() {
    if (!minted) return;
    await navigator.clipboard.writeText(minted.token);
    setCopied(true);
  }

  return (
    <div className="space-y-6">
      {/* Mint */}
      <div className="rounded-[var(--radius)] border border-hairline bg-surface p-4">
        <label htmlFor="token-label" className="font-mono text-xs uppercase tracking-widest text-muted">
          New token
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id="token-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && label.trim() && !pending) create();
            }}
            placeholder="What's it for — 'Claude desktop', 'recruiter at X'"
            maxLength={80}
            className="min-w-0 flex-1 rounded-[var(--radius)] border border-hairline bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={create}
            disabled={pending || !label.trim()}
            className="rounded-[var(--radius)] border border-accent px-4 py-2 font-mono text-xs uppercase tracking-widest text-accent transition-colors hover:bg-accent hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-accent"
          >
            {pending ? "working…" : "issue"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          The label is how you&apos;ll know what you&apos;re revoking later. It isn&apos;t part of the token.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius)] border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {/*
        Shown once. The hash is what's stored, so there is no route, no query
        and no support path that can produce this string again.
      */}
      {minted && (
        <div className="rounded-[var(--radius)] border border-accent bg-accent/5 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">
            Copy it now — it won&apos;t be shown again
          </p>
          <p className="mt-1 text-xs text-muted">
            Only a hash is stored. If you lose this, revoke <strong>{minted.label}</strong> and issue another.
          </p>
          <code className="mt-3 block overflow-x-auto rounded-[var(--radius)] border border-hairline bg-elevated px-3 py-2 font-mono text-xs break-all">
            {minted.token}
          </code>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={copy}
              className="rounded-[var(--radius)] border border-accent px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-accent transition-colors hover:bg-accent hover:text-ink"
            >
              {copied ? "copied ✓" : "copy"}
            </button>
            <button
              onClick={() => setMinted(null)}
              className="rounded-[var(--radius)] border border-hairline px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:text-ink"
            >
              done
            </button>
          </div>
        </div>
      )}

      {/* Existing */}
      {tokens.length === 0 ? (
        <p className="text-sm text-muted">No tokens yet. Until one exists, the endpoint refuses every request.</p>
      ) : (
        <ul className="space-y-2">
          {tokens.map((t) => {
            const dead = Boolean(t.revokedAt);
            return (
              <li
                key={t.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-hairline bg-surface p-3 ${
                  dead ? "opacity-50" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className={`truncate text-sm ${dead ? "line-through" : ""}`}>{t.label}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
                    made {when(t.createdAt)} · last used {when(t.lastUsedAt)}
                    {dead && ` · revoked ${when(t.revokedAt)}`}
                  </p>
                </div>
                {!dead && (
                  <button
                    onClick={() => revoke(t)}
                    disabled={pending}
                    className="shrink-0 font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:text-danger disabled:opacity-40"
                  >
                    revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
