import { Resend } from "resend";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/chat/guards";

/*
  The ONLY path from the site to Anhat's inbox.

  Reachable from two places — the contact form and the chatbot's confirm card —
  and in both cases a human clicked Send. No model can invoke this: it isn't a
  tool, it's an HTTP endpoint the browser calls after a click.

  Persisting to Supabase happens before the email, so a Resend outage still
  means the message isn't lost.
*/

const schema = z.object({
  name: z.string().min(1).max(120),
  email: z.email().max(200),
  message: z.string().min(5).max(3000),
  source: z.enum(["form", "chat"]).default("form"),
  // Honeypot: any value means a bot filled a field humans can't see.
  website: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const ip = clientIp(req);
  const { allowed } = checkRateLimit(`contact:${ip}`);
  if (!allowed) {
    return Response.json({ error: "Too many messages. Try again shortly." }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "Please check the name, email and message fields." },
      { status: 400 },
    );
  }

  const { name, email, message, source, website } = parsed.data;

  // Silently accept honeypot hits. Telling a bot it failed just teaches it.
  if (website) return Response.json({ ok: true });

  const db = getServiceClient();
  if (db) {
    const { error } = await db.from("contact_messages").insert({
      name,
      email,
      message,
      source,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    });
    if (error) console.error("[contact] failed to persist message:", error);
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_EMAIL;

  if (apiKey && to) {
    try {
      const resend = new Resend(apiKey);
      await resend.emails.send({
        // Must be a domain verified in Resend. Falls back to their sandbox sender.
        from: process.env.CONTACT_FROM ?? "Portfolio <onboarding@resend.dev>",
        to,
        replyTo: email,
        subject: `[portfolio${source === "chat" ? " · via chatbot" : ""}] ${name}`,
        text: `From: ${name} <${email}>\nSource: ${source}\n\n${message}`,
      });
    } catch (err) {
      console.error("[contact] Resend send failed:", err);
      // The message is already in the database, so this is recoverable — don't
      // make the visitor retype it.
      if (!db) {
        return Response.json(
          { error: "Couldn't deliver that. Email him directly?" },
          { status: 502 },
        );
      }
    }
  }

  if (!db && !(apiKey && to)) {
    return Response.json(
      { error: "Contact isn't configured yet. Please use the email link instead." },
      { status: 503 },
    );
  }

  return Response.json({ ok: true });
}
