"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

/*
  Two ways in, password first.

  Magic link is the nicer flow but Supabase's built-in mailer is capped at a
  couple of emails per hour on the free tier — which turns "sign in" into "wait
  an hour" the moment you mistype anything. Password auth sends no email at all,
  so it can't be rate limited.

  The allowlist is unaffected: both paths produce an ordinary Supabase session,
  and the layout still checks that its email is in ADMIN_EMAILS. Auth proves who
  you are; the allowlist decides whether that matters.

  There's no self-serve password reset here, because reset is an email and email
  is the thing that's throttled. Run `npm run admin:password` instead.
*/

type Mode = "password" | "magic";
type State = "idle" | "working" | "sent" | "error";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>("idle");
  const [problem, setProblem] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { client, problem: configProblem } = getBrowserClient();

    if (!client) {
      setProblem(configProblem ?? "Supabase isn't configured yet.");
      setState("error");
      return;
    }

    setState("working");
    setProblem("");

    if (mode === "password") {
      const { error } = await client.auth.signInWithPassword({ email, password });

      if (error) {
        // Supabase deliberately returns the same message for a wrong password
        // and an unknown email. Point at the fix rather than guessing which.
        setProblem(
          /invalid login credentials/i.test(error.message)
            ? "Email or password not recognised. If you haven't set a password yet, run `npm run admin:password`."
            : error.message,
        );
        setState("error");
        return;
      }

      // The session cookie is set by the browser client; refresh so the server
      // component re-runs and the guard sees it.
      router.replace("/admin");
      router.refresh();
      return;
    }

    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/admin/auth/callback` },
    });

    if (error) {
      setProblem(
        /rate limit|too many/i.test(error.message)
          ? "Supabase's free tier only sends a couple of auth emails an hour, and that's now used up. Use the password option instead."
          : /invalid path/i.test(error.message)
            ? `Supabase rejected the request path. Check NEXT_PUBLIC_SUPABASE_URL is exactly your Project URL from Settings → API. (${error.message})`
            : error.message,
      );
      setState("error");
      return;
    }
    setState("sent");
  }

  const busy = state === "working";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="font-display text-3xl">Admin</h1>
      <p className="mt-2 text-sm text-muted">Sign in to edit the site.</p>

      {state === "sent" ? (
        <div className="mt-6 rounded-[var(--radius)] border border-success/40 bg-success/10 p-4 text-sm">
          Check your inbox — if that address is allowed, there&apos;s a sign-in link waiting.
        </div>
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Sign-in method"
            className="mt-6 flex gap-1 rounded-[var(--radius)] border border-hairline p-1"
          >
            {(
              [
                ["password", "Password"],
                ["magic", "Email link"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={mode === value}
                onClick={() => {
                  setMode(value);
                  setProblem("");
                  setState("idle");
                }}
                className={`flex-1 rounded-[calc(var(--radius)-1px)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest transition-colors ${
                  mode === value ? "bg-accent text-accent-ink" : "text-muted hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-4 space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              autoComplete="username"
              disabled={busy}
              className="w-full rounded-[var(--radius)] border border-hairline bg-surface px-3 py-2.5 outline-none placeholder:text-muted focus:border-accent"
            />

            {mode === "password" && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Password"
                autoComplete="current-password"
                disabled={busy}
                className="w-full rounded-[var(--radius)] border border-hairline bg-surface px-3 py-2.5 outline-none placeholder:text-muted focus:border-accent"
              />
            )}

            {problem && <p className="text-sm text-danger">{problem}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-[var(--radius)] bg-accent px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-accent-ink disabled:opacity-50"
            >
              {busy ? "…" : mode === "password" ? "Sign in" : "Send magic link"}
            </button>
          </form>

          <p className="mt-4 text-xs leading-relaxed text-muted">
            {mode === "password" ? (
              <>
                No password yet? Run <code className="text-accent">npm run admin:password</code> to
                set one. Nothing is emailed, so nothing is rate limited.
              </>
            ) : (
              <>Supabase&apos;s free tier caps auth emails at roughly two an hour.</>
            )}
          </p>
        </>
      )}
    </main>
  );
}
