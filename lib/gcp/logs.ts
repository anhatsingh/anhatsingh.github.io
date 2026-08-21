import { GoogleAuth } from "google-auth-library";

/*
  Cloud Run's own record of a compile.

  The trace lib/resume/compile.ts carries back explains everything the
  container was alive to report. It cannot explain the cases that matter most:
  a container killed for exceeding memory, a request that timed out at the
  front door, a cold start that took longer than the deadline, a 503 from
  Cloud Run before the process ever saw the request. In all of those the
  response is either nothing or a generic error, and the only account of what
  happened lives in Cloud Logging.

  Read-only, on demand, and entirely optional — with no service account
  configured this degrades to a stated "not set up" and the admin panel still
  shows the compile trail.

  Nothing auth-shaped is written here. google-auth-library is Google's own
  client: it holds the service-account key, signs the JWT, exchanges it and
  refreshes the token. This file builds a query string and reads a response.
*/

const ENDPOINT = "https://logging.googleapis.com/v2/entries:list";
const SCOPE = "https://www.googleapis.com/auth/logging.read";

export interface LogEntry {
  timestamp: string;
  severity: string;
  message: string;
}

export type LogQueryResult =
  | { ok: true; entries: LogEntry[] }
  | { ok: false; error: string };

/*
  Built once and reused. Constructing a GoogleAuth parses the key and is not
  free, and the library caches the access token on the instance — a new one per
  request would re-mint a token every time.
*/
let cached: GoogleAuth | null = null;

/*
  Three outcomes, not two.

  "Not set up" and "set up wrong" need different answers from whoever reads
  them — one is a setup step and the other is a key that lost its newlines
  being pasted into an env var. Collapsing them into "not configured" sends
  someone to re-do configuration they already did, which is the wrong kind of
  wrong for a panel whose entire job is explaining failures.
*/
type AuthResult = { ok: true; client: GoogleAuth } | { ok: false; error: string };

function auth(): AuthResult {
  if (cached) return { ok: true, client: cached };

  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!raw?.trim()) {
    return { ok: false, error: "Cloud Logging isn't set up — GCP_SERVICE_ACCOUNT_JSON is unset." };
  }

  try {
    cached = new GoogleAuth({ credentials: JSON.parse(raw), scopes: [SCOPE] });
    return { ok: true, client: cached };
  } catch {
    // A broken env var should not take down the resume screen, so this is
    // reported rather than thrown.
    console.error("[gcp] GCP_SERVICE_ACCOUNT_JSON isn't valid JSON.");
    return {
      ok: false,
      error: "GCP_SERVICE_ACCOUNT_JSON isn't valid JSON — paste the whole key file, braces included.",
    };
  }
}

/*
  Quoting for the filter language.

  Every value that reaches this is something we generated — a uuid, a service
  name from env — but a filter is a query language and interpolating into one
  unescaped is how injection bugs start. Escaping the two characters that can
  end a quoted string closes it off.
*/
function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Platform log entries for one compile.
 *
 * Scoped by time window always, and by request id when the service echoed one
 * — a request that never reached the container has no id in the logs, and
 * those are exactly the failures worth reading, so the window alone has to
 * work on its own.
 */
export async function fetchCloudRunLogs(opts: {
  requestId: string | null;
  since: string;
  until: string;
}): Promise<LogQueryResult> {
  const project = process.env.GCP_PROJECT_ID?.trim();
  if (!project) {
    return { ok: false, error: "Cloud Logging isn't set up — GCP_PROJECT_ID is unset." };
  }

  const client = auth();
  if (!client.ok) return client;

  const service = process.env.GCP_LATEX_SERVICE_NAME?.trim() || "latex-compiler";

  /*
    Widened by a few seconds either side. The container's clock and Vercel's
    are not the same clock, and an entry written a second after the response
    was sent would fall outside an exact window — which is the entry that
    explains a timeout.
  */
  const pad = 15_000;
  const from = new Date(new Date(opts.since).getTime() - pad).toISOString();
  const to = new Date(new Date(opts.until).getTime() + pad).toISOString();

  const clauses = [
    `resource.type="cloud_run_revision"`,
    `resource.labels.service_name=${quoted(service)}`,
    `timestamp>=${quoted(from)}`,
    `timestamp<=${quoted(to)}`,
  ];

  /*
    An OR rather than a filter on the id alone. The container's own lines carry
    it in jsonPayload; Cloud Run's request log and any crash output do not, and
    dropping those would hide the failures this exists to explain.
  */
  if (opts.requestId) {
    clauses.push(
      `(jsonPayload.requestId=${quoted(opts.requestId)} OR NOT jsonPayload.requestId:*)`,
    );
  }

  try {
    const authed = await client.client.getClient();
    const res = await authed.request<{
      entries?: Array<{
        timestamp?: string;
        severity?: string;
        textPayload?: string;
        jsonPayload?: Record<string, unknown>;
        protoPayload?: Record<string, unknown>;
      }>;
    }>({
      url: ENDPOINT,
      method: "POST",
      data: {
        resourceNames: [`projects/${project}`],
        filter: clauses.join(" AND "),
        orderBy: "timestamp desc",
        pageSize: 50,
      },
    });

    const entries = (res.data.entries ?? []).map((e) => ({
      timestamp: e.timestamp ?? "",
      severity: e.severity ?? "DEFAULT",
      message: readPayload(e),
    }));

    // Oldest first, so a request reads top to bottom the way it happened.
    return { ok: true, entries: entries.reverse() };
  } catch (err) {
    const message = (err as Error).message;
    console.error("[gcp] log query failed:", message);
    /*
      Named specifically, because this one is a permissions fix and not a bug:
      the service account needs roles/logging.viewer, and a bare "403" sends
      you looking in the wrong place.
    */
    if (message.includes("403")) {
      return { ok: false, error: "Denied by GCP — the service account needs roles/logging.viewer." };
    }
    return { ok: false, error: `Couldn't read Cloud Logging: ${message}` };
  }
}

/**
 * One readable line out of an entry.
 *
 * Cloud Logging carries a payload in one of three shapes depending on who
 * wrote it — the container's stdout, the platform's request log, or an audit
 * record — and a viewer that only understands one of them shows blanks for
 * exactly the entries that were not ours.
 */
function readPayload(entry: {
  textPayload?: string;
  jsonPayload?: Record<string, unknown>;
  protoPayload?: Record<string, unknown>;
}): string {
  if (entry.textPayload) return entry.textPayload;

  if (entry.jsonPayload) {
    const p = entry.jsonPayload;
    if (typeof p.message === "string") return p.message;
    if (typeof p.event === "string") {
      const extra = Object.entries(p)
        .filter(([k]) => !["event", "requestId", "service", "revision", "severity"].includes(k))
        .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .join(" ");
      return extra ? `${p.event} ${extra}` : String(p.event);
    }
    return JSON.stringify(p);
  }

  if (entry.protoPayload) {
    const p = entry.protoPayload as { status?: { message?: string }; methodName?: string };
    return p.status?.message ?? p.methodName ?? JSON.stringify(p);
  }

  return "";
}
