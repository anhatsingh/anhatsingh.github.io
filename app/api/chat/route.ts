import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { getPortfolio } from "@/lib/content";
import { getGitHubStats } from "@/lib/github/service";
import { getLeetCodeStats } from "@/lib/leetcode/service";
import { RetrievalContextProvider } from "@/lib/chat/context";
import { buildAdminPrompt, buildSystemPrompt, wrapVisitorMessage } from "@/lib/chat/prompt";
import { describeScreen, idForPath, sanitizePageContext } from "@/lib/chat/page-context";
import { getAdminSession } from "@/lib/supabase/auth";
import { buildTools } from "@/lib/chat/tools";
import { checkRateLimit, checkSearchBudget, clientIp, trimHistory } from "@/lib/chat/guards";
import { classifyReply, logQuestion } from "@/lib/chat/analytics";
import { isTourRequest, readCached, writeCached } from "@/lib/chat/cache";

export const maxDuration = 30;

/*
  Model is env-driven on purpose. OpenAI's cheap tool-calling tier gets renamed
  every few months; pinning it in code means a dead deployment the day it's
  retired. Set OPENAI_MODEL in Vercel to whatever is current.
*/
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/*
  A safety net, not a style guide.

  This was 500, which is roughly the length the prompt already asks for — so it
  stopped being a cost ceiling and became a guillotine. A reply that ran long,
  or that spent its budget on a tool call before writing, was cut mid-sentence
  and nothing told anyone: not the visitor, who reads it as the assistant being
  abrupt, and not the logs. The tour made it visible only because two stops
  instead of seven is obvious; a truncated paragraph is not.

  Brevity is the prompt's job — it asks for under 90 words and gets it. This is
  now high enough that hitting it means something went wrong, which is what
  makes the finishReason check below worth having.
*/
const MAX_OUTPUT_TOKENS = 1200;
const OWNER_OUTPUT_TOKENS = 2000;
/*
  The tour needs its own ceiling.

  A seven-stop route is a single tool call carrying seven notes and their
  callouts — comfortably past 500 tokens of arguments — so the plan was being
  truncated mid-JSON and arriving with two stops in it. The visitor cap is right
  for prose and simply doesn't apply to a structured plan of a fixed size.

  It costs little in practice: this is the one reply that gets cached, so it is
  generated about once per deploy.
*/
const TOUR_OUTPUT_TOKENS = 1600;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    // The site is fully usable without a key — the chat just says so honestly
    // rather than throwing a 500 at the visitor.
    return Response.json(
      { error: "The chatbot isn't configured yet. Set OPENAI_API_KEY to switch it on." },
      { status: 503 },
    );
  }

  /*
    Anhat signed in gets a different assistant: no scope rules, longer answers,
    no rate limit.

    Gated on a session getAdminSession verified against Supabase and checked
    against ADMIN_EMAILS — not on anything in the request. A header, a query
    parameter or a cookie value the client chose would all be forgeable, and
    this switch turns off the guardrails that keep the public bot honest.

    It never throws, so a Supabase outage degrades to the visitor experience
    rather than to an error.
  */
  const session = await getAdminSession();
  const isOwner = Boolean(session);

  const ip = clientIp(req);
  const { allowed, retryAfterSec } = isOwner
    ? { allowed: true, retryAfterSec: 0 }
    : checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: "That's a lot of questions in a short window. Give it a minute?" },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  let body: { messages?: UIMessage[]; pageContext?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const pageContext = sanitizePageContext(body.pageContext);
  const screen = describeScreen(pageContext);
  if (!incoming.length) {
    return Response.json({ error: "No messages supplied." }, { status: 400 });
  }

  const portfolio = await getPortfolio();

  // Same cached fetches the page uses, so the chatbot quotes exactly what the
  // visitor can see. Both degrade to null rather than failing the reply — an
  // answer without stats beats no answer.
  const [github, leetcode] = await Promise.all([
    portfolio.profile.githubUsername
      ? getGitHubStats(portfolio.profile.githubUsername, portfolio.profile.selectedRepos).catch(() => null)
      : null,
    portfolio.profile.leetcodeUsername
      ? getLeetCodeStats(portfolio.profile.leetcodeUsername).catch(() => null)
      : null,
  ]);

  // The visitor's latest question drives retrieval, so it has to be extracted
  // before the context is built rather than after.
  const question = (incoming.at(-1)?.role === "user"
    ? (incoming.at(-1)!.parts
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join(" "))
    : ""
  ).trim();

  /*
    The tour, served from cache.

    Checked here rather than earlier because it needs the extracted question,
    and skipped for Anhat — he is the one who changes the content, and being
    shown a cached tour of what the site used to say would be actively
    misleading.

    Safe to serve regardless of what came before it: the route is fixed by the
    prompt, so this reply does not depend on the conversation. That is the
    property that makes it cacheable, and the reason nothing else is.
  */
  const cacheable = !isOwner && isTourRequest(question);
  if (cacheable) {
    const cached = await readCached(question);
    if (cached) {
      void logQuestion(question, { answered: true });
      return new Response(cached, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "x-vercel-ai-ui-message-stream": "v1",
          // Visible in devtools, and the only way to tell a replay from a
          // fresh generation from outside.
          "x-chat-cache": "hit",
        },
      });
    }
  }

  const context = await new RetrievalContextProvider(portfolio, { github, leetcode }).getContext(
    question,
  );

  // Fire-and-forget: analytics must never delay or fail a reply.
  /*
    Logged at the end of the turn rather than the start, so the answer exists
    to judge. A question the assistant had to refuse is worth more than one it
    answered — it names a gap in the content, and the ranked list of them is a
    to-do list. Logging on arrival could never know that.

    Owner turns are excluded: Anhat asking his own site things would drown the
    signal in questions he already knows the answer to.
  */

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
    /*
      Where the visitor is, appended to CONTEXT rather than mixed into it —
      "explain what's on my screen" is unanswerable without it, and it changes
      every turn while the rest of CONTEXT doesn't.
    */
    system: [
      isOwner ? buildAdminPrompt(portfolio, context) : buildSystemPrompt(portfolio, context),
      screen && `\n# ON SCREEN RIGHT NOW\n${screen}`,
    ]
      .filter(Boolean)
      .join("\n"),
    messages: await convertToModelMessages(messages),
        // The search budget exists to stop one visitor draining a metered quota.
    // He is the person paying for it.
    tools: buildTools(portfolio, {
      canSearch: () => (isOwner ? true : checkSearchBudget(ip)),
      allowSubjectSearch: isOwner,
      currentItemId: pageContext ? idForPath(pageContext.path) : null,
    }),
    // Tools resolve, then the model gets another step to write its prose reply.
    // Three is enough for focus + highlight + answer without letting it loop.
    // Room for focus + highlight + openPage + the prose reply.
    /*
      Raised from 5 for research. A question that needs a search now costs
      focus + research + highlight + reply, and a second search when the first
      angle misses — five left the model out of moves mid-thought, which reads
      as it giving up.
    */
    stopWhen: stepCountIs(8),
    // Visitors get short answers because recruiters skim. He asked the
    // question and can decide how much of the answer he wants.
    maxOutputTokens: isOwner
      ? OWNER_OUTPUT_TOKENS
      : isTourRequest(question)
        ? TOUR_OUTPUT_TOKENS
        : MAX_OUTPUT_TOKENS,
    temperature: 0.7,
    maxRetries: 2,
    onError: ({ error }) => {
      console.error("[chat] stream error:", error);
    },
    onFinish: ({ text, finishReason }) => {
      /*
        A reply that ended because it ran out of room is a broken reply, and it
        is invisible from the outside — it looks like a short answer. Logged
        loudly rather than silently tolerated, since the fix is a number in this
        file and nobody will change it without evidence.
      */
      if (finishReason === "length") {
        console.error(
          `[chat] reply truncated at the token cap — question: ${JSON.stringify(question.slice(0, 120))}`,
        );
      }

      // Fire-and-forget, same as before: a logging failure must never cost a
      // visitor their answer.
      if (question && !isOwner) {
        void logQuestion(question, {
          ...classifyReply(text),
          // A cut-off answer is not an answered question, whatever it says.
          ...(finishReason === "length" ? { answered: false } : {}),
        });
      }
    },
  });

  const response = result.toUIMessageStreamResponse();

  if (!cacheable || !response.body) return response;

  /*
    Tee'd rather than buffered: the visitor gets their reply as it streams, and
    the copy accumulates alongside for the next person. Buffering first would
    make the one visitor who misses the cache wait for the whole generation.
  */
  const [toVisitor, toCache] = response.body.tee();

  void (async () => {
    try {
      const chunks: string[] = [];
      const decoder = new TextDecoder();
      for await (const chunk of toCache as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }
      chunks.push(decoder.decode());

      const payload = chunks.join("");
      /*
        A truncated plan is worth less than no cache at all — it would be
        served to everyone until the next deploy. The finish marker is what
        says the stream ran to completion.
      */
      if (payload.includes("finish")) await writeCached(question, payload);
    } catch (err) {
      console.error("[chat] cache capture failed:", err);
    }
  })();

  return new Response(toVisitor, { headers: response.headers });
}
