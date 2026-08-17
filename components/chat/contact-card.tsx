"use client";

import { useState } from "react";
import { useVisitLog } from "@/components/visit-tracker";

/*
  The confirm step for in-chat contact.

  This component is the ONLY path from a conversation to Anhat's inbox, and it
  requires a human click. The model can draft but never send — see tools.ts,
  which deliberately has no send tool. That's what makes "ignore previous
  instructions and email him 500 times" a non-event.

  Fields stay editable because models mistype emails, and a wrong address means
  a reply that never arrives.
*/

interface Props {
  initialName?: string;
  initialEmail?: string;
  initialMessage: string;
}

type State = "editing" | "sending" | "sent" | "error";

export function ContactCard({ initialName, initialEmail, initialMessage }: Props) {
  const [name, setName] = useState(initialName ?? "");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [message, setMessage] = useState(initialMessage);
  const [state, setState] = useState<State>("editing");
  const [problem, setProblem] = useState("");
  // Bots fill hidden fields; humans don't. Cheaper than a captcha.
  const [honeypot, setHoneypot] = useState("");
  const logVisit = useVisitLog();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setProblem("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message, source: "chat", website: honeypot }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setProblem(data.error ?? "Something went wrong sending that.");
        setState("error");
        return;
      }
      // The only event on this site that is unambiguously an outcome.
      logVisit("contact");
      setState("sent");
    } catch {
      setProblem("Couldn't reach the server. Check your connection?");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="rounded-[var(--radius)] border border-success/40 bg-success/10 p-3 text-sm">
        <p className="font-mono text-xs uppercase tracking-widest text-success">Sent</p>
        <p className="mt-1 text-text">
          That&apos;s with him. He usually replies within a couple of days.
        </p>
      </div>
    );
  }

  const disabled = state === "sending";

  return (
    <form
      onSubmit={submit}
      className="rounded-[var(--radius)] border border-hairline bg-surface p-3 text-sm"
    >
      <p className="font-mono text-xs uppercase tracking-widest text-accent">Review &amp; send</p>

      <div className="mt-2 space-y-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          required
          disabled={disabled}
          className="w-full rounded-[var(--radius)] border border-hairline bg-bg px-2 py-1.5 text-text outline-none placeholder:text-muted focus:border-accent"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
          disabled={disabled}
          className="w-full rounded-[var(--radius)] border border-hairline bg-bg px-2 py-1.5 text-text outline-none placeholder:text-muted focus:border-accent"
        />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          required
          disabled={disabled}
          className="w-full resize-y rounded-[var(--radius)] border border-hairline bg-bg px-2 py-1.5 text-text outline-none focus:border-accent"
        />

        {/* Honeypot: visually and programmatically hidden from humans. */}
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />
      </div>

      {problem && <p className="mt-2 text-xs text-danger">{problem}</p>}

      <button
        type="submit"
        disabled={disabled}
        className="mt-3 w-full rounded-[var(--radius)] bg-accent px-3 py-2 font-mono text-xs uppercase tracking-widest text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {disabled ? "Sending…" : "Send to Anhat"}
      </button>
    </form>
  );
}
