"use client";

import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

/*
  Magic-link sign in.

  Note the deliberate ambiguity in the success message: it says "if that address
  is allowed" rather than confirming. Supabase will happily send a link to any
  address, and the real gate is the ADMIN_EMAILS allowlist checked after the
  session exists — so this page must not become an oracle for which email is
  the admin's.
*/

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [problem, setProblem] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = getBrowserClient();
    if (!supabase) {
      setProblem("Supabase isn't configured yet.");
      setState("error");
      return;
    }

    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/admin/auth/callback` },
    });

    if (error) {
      setProblem(error.message);
      setState("error");
      return;
    }
    setState("sent");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="font-display text-3xl">Admin</h1>
      <p className="mt-2 text-sm text-muted">Sign in to edit the site.</p>

      {state === "sent" ? (
        <div className="mt-6 rounded-[var(--radius)] border border-success/40 bg-success/10 p-4 text-sm">
          Check your inbox — if that address is allowed, there&apos;s a sign-in link waiting.
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full rounded-[var(--radius)] border border-hairline bg-surface px-3 py-2.5 outline-none placeholder:text-muted focus:border-accent"
          />
          {problem && <p className="text-sm text-danger">{problem}</p>}
          <button
            type="submit"
            disabled={state === "sending"}
            className="w-full rounded-[var(--radius)] bg-accent px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-accent-ink disabled:opacity-50"
          >
            {state === "sending" ? "Sending…" : "Send magic link"}
          </button>
        </form>
      )}
    </main>
  );
}
