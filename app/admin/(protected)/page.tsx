import Link from "next/link";
import { ADMIN_TABLES } from "@/lib/admin/schema";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
  }

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
