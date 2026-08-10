import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { getPortfolio } from "@/lib/content";
import { DirectContextProvider } from "@/lib/chat/context";
import { buildSystemPrompt, wrapVisitorMessage } from "@/lib/chat/prompt";
import { buildTools } from "@/lib/chat/tools";
import { checkRateLimit, clientIp, trimHistory } from "@/lib/chat/guards";

export const maxDuration = 30;

/*
  Model is env-driven on purpose. OpenAI's cheap tool-calling tier gets renamed
  every few months; pinning it in code means a dead deployment the day it's
  retired. Set OPENAI_MODEL in Vercel to whatever is current.
*/
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/** Caps the reply length. Recruiters skim, and tokens cost money. */
const MAX_OUTPUT_TOKENS = 500;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    // The site is fully usable without a key — the chat just says so honestly
    // rather than throwing a 500 at the visitor.
    return Response.json(
      { error: "The chatbot isn't configured yet. Set OPENAI_API_KEY to switch it on." },
      { status: 503 },
    );
  }

  const { allowed, retryAfterSec } = checkRateLimit(clientIp(req));
  if (!allowed) {
    return Response.json(
      { error: "That's a lot of questions in a short window. Give it a minute?" },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  let body: { messages?: UIMessage[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  if (!incoming.length) {
    return Response.json({ error: "No messages supplied." }, { status: 400 });
  }

  const portfolio = await getPortfolio();
  const context = await new DirectContextProvider(portfolio).getContext();

  // Wrap visitor turns so the model can distinguish content from instructions.
  const messages = trimHistory(incoming).map((m) =>
    m.role === "user"
      ? {
          ...m,
          parts: m.parts.map((part) =>
            part.type === "text" ? { ...part, text: wrapVisitorMessage(part.text) } : part,
          ),
        }
      : m,
  );

  const result = streamText({
    model: openai(MODEL),
    system: buildSystemPrompt(portfolio, context),
    messages: await convertToModelMessages(messages),
    tools: buildTools(portfolio),
    // Tools resolve, then the model gets another step to write its prose reply.
    // Three is enough for focus + highlight + answer without letting it loop.
    stopWhen: stepCountIs(4),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.7,
    maxRetries: 2,
    onError: ({ error }) => {
      console.error("[chat] stream error:", error);
    },
  });

  return result.toUIMessageStreamResponse();
}
