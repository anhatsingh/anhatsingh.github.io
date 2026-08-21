import { getAdminSession } from "@/lib/supabase/auth";
import { runCheck, runSave, type PipelineEvent } from "@/lib/resume/pipeline";
import { revalidatePath } from "next/cache";
import type { Resume, ResumeMeta } from "@/lib/resume/schema";

/*
  The resume pipeline, streamed.

  A route rather than a server action because a server action returns once, and
  this takes half a minute: two compiles and up to two model calls, behind a
  button that used to say "Compiling and checking…" and nothing else. NDJSON —
  one JSON object per line — because it needs no library on either end and
  survives a chunk boundary landing mid-object, which SSE framing does not do
  for free.

  Auth is checked here, once, before anything runs. The pipeline itself knows
  nothing about who is calling it.
*/

export const runtime = "nodejs";
/*
  Long, deliberately. Two compiles plus two model calls is the worst case, and
  a pipeline killed at 60s would look exactly like a hang — the thing this
  whole change exists to make legible.
*/
export const maxDuration = 300;

interface RunRequest {
  mode: "check" | "save";
  resume: Resume;
  meta?: ResumeMeta;
  jobDescription?: string;
  isDefault?: boolean;
  isPublished?: boolean;
  override?: boolean;
}

export async function POST(req: Request): Promise<Response> {
  const session = await getAdminSession();
  if (!session) {
    return new Response(JSON.stringify({ type: "failed", error: "Not authorised." }), {
      status: 401,
      headers: { "content-type": "application/x-ndjson" },
    });
  }

  let body: RunRequest;
  try {
    body = (await req.json()) as RunRequest;
  } catch {
    return new Response(JSON.stringify({ type: "failed", error: "Malformed request." }), {
      status: 400,
      headers: { "content-type": "application/x-ndjson" },
    });
  }

  if (!body?.resume) {
    return new Response(JSON.stringify({ type: "failed", error: "No resume in the request." }), {
      status: 400,
      headers: { "content-type": "application/x-ndjson" },
    });
  }

  const events =
    body.mode === "save"
      ? runSave({
          resume: body.resume,
          meta: body.meta as ResumeMeta,
          jobDescription: body.jobDescription ?? "",
          isDefault: Boolean(body.isDefault),
          isPublished: body.isPublished !== false,
          override: Boolean(body.override),
        })
      : runCheck({ resume: body.resume, jobDescription: body.jobDescription ?? "" });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: PipelineEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        for await (const event of events) {
          send(event);

          /*
            Revalidation belongs to whoever knows a write happened, and after
            the stream closes there is no server context left to do it in.
          */
          if (event.type === "saved") {
            revalidatePath("/admin/resumes");
            revalidatePath("/");
          }
        }
      } catch (err) {
        /*
          A thrown pipeline still has to say so on the wire. Without this the
          stream just ends, and a client reading it cannot tell a crash from a
          clean finish — which is the same ambiguity this route exists to
          remove.
        */
        console.error("[resume] pipeline threw:", err);
        send({ type: "failed", error: `The pipeline stopped: ${(err as Error).message}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      /*
        Without nosniff, a chunk-sniffing proxy or browser may buffer the
        whole response before handing any of it over — which would deliver
        every event at once at the end, exactly the behaviour being replaced.
      */
      "x-content-type-options": "nosniff",
      "cache-control": "no-store, no-transform",
    },
  });
}
