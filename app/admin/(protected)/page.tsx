import Link from "next/link";
import { ADMIN_TABLES } from "@/lib/admin/schema";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Question {
  question: string;
  answered: boolean;
  kind: string;
  created_at: string;
}

/** Groups by normalised text so one question asked ten times reads as one row. */
function tally(rows: Question[]) {
  return [
    ...rows
      .reduce((acc, q) => {
        const key = q.question.toLowerCase().replace(/[^\w\s]/g, "").trim();
        const prev = acc.get(key);
        acc.set(key, {
          question: prev?.question ?? q.question,
          count: (prev?.count ?? 0) + 1,
          last: prev?.last ?? q.created_at,
        });
        return acc;
      }, new Map<string, { question: string; count: number; last: string }>())
      .values(),
  ].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
}

interface Message {
  id: string;
  name: string;
  email: string;
  message: string;
  source: string;
  created_at: string;
}

export default async function AdminDashboard() {
  const db = getServiceClient();

  // Counts per section, plus the message inbox. Both tolerate a missing
  // service key so the dashboard still renders something useful.
  const counts = new Map<string, number>();
  let messages: Message[] = [];
  let questions: Question[] = [];

  if (db) {
    await Promise.all(
      ADMIN_TABLES.filter((t) => !t.singleton).map(async (t) => {
        const { count } = await db.from(t.table).select("*", { count: "exact", head: true });
        counts.set(t.key, count ?? 0);
      }),
    );

    const { data } = await db
      .from("contact_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    messages = (data as Message[]) ?? [];

    const { data: qs } = await db
      .from("chat_questions")
      .select("question, answered, kind, created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    questions = (qs as Question[]) ?? [];
  }

  /*
    Three lists out of one table. Unanswered questions are the valuable one —
    each is a gap in the content, named by somebody who wanted it — so they
    lead.
  */
  /*
    Off-topic asks are kept out of both other lists. They aren't a gap — no
    amount of writing makes the assistant able to advise on handling Barack
    Obama — and counting them as questions visitors ask would overstate how much
    of the traffic is about the work.
  */
  const asked = questions.filter((q) => q.kind === "question");
  const unanswered = tally(asked.filter((q) => !q.answered));
  const roleInterests = tally(questions.filter((q) => q.kind === "role_interest"));
  const offTopic = tally(questions.filter((q) => q.kind === "off_topic"));

  return (
    <div className="space-y-12">
      <section>
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Content</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ADMIN_TABLES.map((t) => (
            <Link
              key={t.key}
              href={`/admin/${t.key}`}
              className="rounded-[var(--radius)] border border-hairline bg-surface p-4 transition-colors hover:border-accent"
            >
              <p className="font-display text-xl">{t.label}</p>
              <p className="mt-1 font-mono text-xs text-muted">
                {t.singleton ? "single record" : `${counts.get(t.key) ?? 0} entries`}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {unanswered.length > 0 && (
        <section>
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-warn">
            Couldn&apos;t answer ({unanswered.length})
          </h2>
          <p className="mt-2 text-sm text-muted">
            Somebody asked and the assistant had nothing to go on. Each of these is a gap in the
            content, named by the person who wanted it — the most direct list of what to write next.
          </p>
          <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-[var(--radius)] border border-warn/40">
            {unanswered.slice(0, 30).map((q) => (
              <li key={q.question} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <span className="min-w-0 text-sm">{q.question}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-warn">
                  ×{q.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {offTopic.length > 0 && (
        <section>
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
            Declined as off-topic ({offTopic.length})
          </h2>
          <p className="mt-2 text-sm text-muted">
            Not about Anhat, so the assistant turned them down. Nothing to write here — this is what
            it looks like when the scope rules are working, and it&apos;s kept out of the two lists
            above so neither is overstated.
          </p>
          <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-[var(--radius)] border border-hairline">
            {offTopic.slice(0, 15).map((q) => (
              <li key={q.question} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <span className="min-w-0 text-sm text-muted">{q.question}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                  ×{q.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {roleInterests.length > 0 && (
        <section>
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
            Roles people are hiring for ({roleInterests.length})
          </h2>
          <p className="mt-2 text-sm text-muted">
            What visitors said when the assistant asked, in their own words. The closest thing this
            site collects to market data.
          </p>
          <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-[var(--radius)] border border-hairline">
            {roleInterests.slice(0, 20).map((q) => (
              <li key={q.question} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <span className="min-w-0 text-sm">{q.question}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                  ×{q.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          What visitors ask {asked.length > 0 && `(${asked.length})`}
        </h2>

        {asked.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            Nothing yet. Recurring questions here are the fastest signal for what content is
            missing.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-[var(--radius)] border border-hairline">
            {/* Same grouping as the two lists above — one helper, so a change
                to how questions are counted can't apply to some panels only. */}
            {tally(asked)
              .slice(0, 40)
              .map((q) => (
                <li key={q.question} className="flex items-start justify-between gap-4 px-4 py-2.5">
                  <span className="min-w-0 text-sm">{q.question}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                    {q.count > 1 ? `×${q.count}` : ""}{" "}
                    {new Date(q.last).toLocaleDateString()}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          Inbox {messages.length > 0 && `(${messages.length})`}
        </h2>

        {messages.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No messages yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {messages.map((m) => (
              <li key={m.id} className="rounded-[var(--radius)] border border-hairline bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {m.name}{" "}
                    <a href={`mailto:${m.email}`} className="font-mono text-sm text-accent hover:underline">
                      &lt;{m.email}&gt;
                    </a>
                  </p>
                  <p className="font-mono text-[11px] uppercase tracking-widest text-muted">
                    {m.source === "chat" ? "via chatbot" : "form"} ·{" "}
                    {new Date(m.created_at).toLocaleDateString()}
                  </p>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{m.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
