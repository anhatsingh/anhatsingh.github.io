"use client";

import { useState } from "react";
import { Section } from "./section";
import { useChatDock } from "@/components/chat/chat-provider";
import { socialLinks, type Profile } from "@/lib/content/types";

type State = "idle" | "sending" | "sent" | "error";

export function Contact({ profile }: { profile: Profile }) {
  const { send } = useChatDock();
  const [state, setState] = useState<State>("idle");
  const [problem, setProblem] = useState("");
  const socials = socialLinks(profile);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    setState("sending");
    setProblem("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          message: data.get("message"),
          website: data.get("website"), // honeypot
          source: "form",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setProblem(body.error ?? "Something went wrong.");
        setState("error");
        return;
      }

      form.reset();
      setState("sent");
    } catch {
      setProblem("Couldn't reach the server. Check your connection?");
      setState("error");
    }
  }

  return (
    <Section id="contact" eyebrow="09 — Contact" title="Get in touch">
      <div className="grid gap-10 md:grid-cols-2">
        <div>
          <p className="max-w-md leading-relaxed text-muted">
            {profile.openToWork
              ? "I'm actively looking right now, so if you've got something interesting, I'd genuinely like to hear about it."
              : "Always happy to talk shop — drop me a line."}
          </p>

          <dl className="mt-6 space-y-3 font-mono text-sm">
            <div className="flex gap-3">
              <dt className="w-20 shrink-0 text-muted">email</dt>
              <dd>
                <a href={`mailto:${profile.email}`} className="text-accent hover:underline">
                  {profile.email}
                </a>
              </dd>
            </div>
            {profile.location && (
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted">location</dt>
                <dd>{profile.location}</dd>
              </div>
            )}
            {socials.map((link) => (
              <div key={link.key} className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted">{link.label.toLowerCase()}</dt>
                <dd className="min-w-0">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-accent hover:underline"
                  >
                    {/* Show the handle rather than the whole URL — derived from
                        the link so it can't drift from where it points. */}
                    {link.url.replace(/\/+$/, "").split("/").pop()}
                  </a>
                </dd>
              </div>
            ))}
          </dl>

          <button
            onClick={() => send("I'd like to get in touch with Anhat")}
            className="mt-6 font-mono text-xs uppercase tracking-widest text-accent hover:underline"
          >
            ⌁ or just tell the chatbot →
          </button>
        </div>

        {state === "sent" ? (
          <div className="rounded-[var(--radius)] border border-success/40 bg-success/10 p-5">
            <p className="font-mono text-xs uppercase tracking-widest text-success">Sent</p>
            <p className="mt-2">Thanks — he&apos;ll get back to you.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              name="name"
              required
              placeholder="Your name"
              disabled={state === "sending"}
              className="w-full rounded-[var(--radius)] border border-hairline bg-surface px-3 py-2.5 outline-none placeholder:text-muted focus:border-accent"
            />
            <input
              name="email"
              type="email"
              required
              placeholder="you@company.com"
              disabled={state === "sending"}
              className="w-full rounded-[var(--radius)] border border-hairline bg-surface px-3 py-2.5 outline-none placeholder:text-muted focus:border-accent"
            />
            <textarea
              name="message"
              required
              rows={5}
              placeholder="What's on your mind?"
              disabled={state === "sending"}
              className="w-full resize-y rounded-[var(--radius)] border border-hairline bg-surface px-3 py-2.5 outline-none placeholder:text-muted focus:border-accent"
            />

            {/* Honeypot — hidden from humans, catnip for bots. */}
            <input
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute left-[-9999px] h-0 w-0 opacity-0"
            />

            {problem && <p className="text-sm text-danger">{problem}</p>}

            <button
              type="submit"
              disabled={state === "sending"}
              className="w-full rounded-[var(--radius)] bg-accent px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {state === "sending" ? "Sending…" : "Send message"}
            </button>
          </form>
        )}
      </div>
    </Section>
  );
}
