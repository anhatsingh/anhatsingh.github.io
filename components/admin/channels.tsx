import { ENGAGED, type VisitEvent } from "@/lib/analytics/source";

/*
  Which channel produces conversations.

  Deliberately not a pageview chart. For a job search the useful ranking is by
  what a channel's visitors DO — twelve people from a cold email of whom four
  opened the CV beat a thousand from an aggregator where nobody spoke, and a
  visit count alone ranks those the wrong way round.

  So the table leads with visitors, and the columns that decide anything are
  the two on the right: how many of them said something, and how many wanted
  the CV.
*/

export interface VisitRow {
  visit_id: string;
  source: string;
  medium: string | null;
  campaign: string | null;
  path: string;
  event: string;
  created_at: string;
}

interface Channel {
  source: string;
  visitors: number;
  views: number;
  engaged: number;
  chatted: number;
  resumes: number;
  campaigns: string[];
}

export function summarise(rows: VisitRow[]): Channel[] {
  const bySource = new Map<string, Channel & { seen: Set<string>; engagedIds: Set<string> }>();

  for (const row of rows) {
    // Internal navigation isn't a channel; it would otherwise top the table
    // with the site's own name on it.
    if (row.source === "internal") continue;

    const key = row.source || "direct";
    let channel = bySource.get(key);
    if (!channel) {
      channel = {
        source: key,
        visitors: 0,
        views: 0,
        engaged: 0,
        chatted: 0,
        resumes: 0,
        campaigns: [],
        seen: new Set(),
        engagedIds: new Set(),
      };
      bySource.set(key, channel);
    }

    // Counted per visit, not per row: someone reading six pages is one person
    // interested, not six.
    channel.seen.add(row.visit_id);
    if (row.event === "view") channel.views++;
    if (row.event === "chat_message") channel.chatted++;
    if (row.event === "resume") channel.resumes++;
    if (ENGAGED.includes(row.event as VisitEvent)) channel.engagedIds.add(row.visit_id);
    if (row.campaign && !channel.campaigns.includes(row.campaign)) channel.campaigns.push(row.campaign);
  }

  return [...bySource.values()]
    .map((c) => ({
      source: c.source,
      visitors: c.seen.size,
      views: c.views,
      engaged: c.engagedIds.size,
      chatted: c.chatted,
      resumes: c.resumes,
      campaigns: c.campaigns,
    }))
    /*
      Ranked by engaged visitors, then by visitors. A channel nobody engaged
      with sinks regardless of how much traffic it sent, which is the entire
      point of the table.
    */
    .sort((a, b) => b.engaged - a.engaged || b.visitors - a.visitors);
}

export function Channels({ rows }: { rows: VisitRow[] }) {
  const channels = summarise(rows);
  if (!channels.length) return null;

  const totalVisitors = channels.reduce((n, c) => n + c.visitors, 0);
  const totalEngaged = channels.reduce((n, c) => n + c.engaged, 0);

  return (
    <section>
      <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
        Where visitors come from ({totalVisitors})
      </h2>
      <p className="mt-2 text-sm text-muted">
        Ranked by how many of them did something, not how many arrived.{" "}
        <strong className="text-text">{totalEngaged}</strong> of {totalVisitors} opened the chat,
        asked something, took the tour, opened the CV or shared the conversation.
      </p>

      <div className="mt-4 overflow-x-auto rounded-[var(--radius)] border border-hairline">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-widest text-muted">
              <th className="px-4 py-2.5 font-normal">Source</th>
              <th className="px-3 py-2.5 text-right font-normal">Visitors</th>
              <th className="px-3 py-2.5 text-right font-normal">Pages</th>
              <th className="px-3 py-2.5 text-right font-normal">Engaged</th>
              <th className="px-3 py-2.5 text-right font-normal">Asked</th>
              <th className="px-4 py-2.5 text-right font-normal">CV</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {channels.map((c) => (
              <tr key={c.source}>
                <td className="px-4 py-2.5">
                  {c.source}
                  {c.campaigns.length > 0 && (
                    <span className="ml-2 font-mono text-[10px] text-muted">
                      {c.campaigns.slice(0, 3).join(", ")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{c.visitors}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted">{c.views}</td>
                <td
                  className={`px-3 py-2.5 text-right tabular-nums ${
                    c.engaged > 0 ? "text-success" : "text-muted"
                  }`}
                >
                  {c.engaged}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted">{c.chatted}</td>
                <td
                  className={`px-4 py-2.5 text-right tabular-nums ${
                    c.resumes > 0 ? "text-accent" : "text-muted"
                  }`}
                >
                  {c.resumes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        "direct" almost never means somebody typed the URL. Apps strip
        referrers, shorteners replace them, and anything opened from a native
        client arrives bare — so a large direct column is usually a pile of
        untagged links rather than a real channel.
      */}
      {channels.some((c) => c.source === "direct" && c.visitors > totalVisitors / 3) && (
        <p className="mt-3 text-xs text-warn">
          Most visits are unattributed. That&apos;s normally untagged links rather than people
          typing the address — tag them with the builder below and the table starts meaning
          something.
        </p>
      )}
    </section>
  );
}
