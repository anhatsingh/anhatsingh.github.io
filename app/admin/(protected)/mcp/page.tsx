import { TokenManager } from "@/components/admin/token-manager";
import { loadMcpTokens } from "@/app/admin/actions";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import { SITE_URL } from "@/lib/seo";

/*
  The MCP screen.

  Two jobs: manage the tokens, and tell you what you're handing out. The second
  matters as much as the first — a token is only safe to give someone if you
  can see, on the same page, exactly what it lets them read.
*/

export const dynamic = "force-dynamic";

export default async function McpPage() {
  const tokens = await loadMcpTokens();
  const endpoint = `${SITE_URL}/api/mcp`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl">MCP</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          An endpoint other AI agents can connect to — Claude, Cursor, a recruiter&apos;s tooling — to read
          your published record directly instead of scraping the site. Access is by token, and a token
          only ever sees what a visitor sees.
        </p>
      </div>

      <TokenManager tokens={tokens} />

      <div className="rounded-[var(--radius)] border border-hairline bg-surface p-4">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Connecting</h2>
        <code className="mt-2 block overflow-x-auto rounded-[var(--radius)] border border-hairline bg-elevated px-3 py-2 font-mono text-xs">
          {endpoint}
        </code>
        <p className="mt-2 text-xs text-muted">
          Sent as <code className="text-accent">Authorization: Bearer &lt;token&gt;</code>. Most clients ask
          for the URL and the token separately.
        </p>
      </div>

      <div>
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
          What a token can read — {MCP_TOOLS.length} tools
        </h2>
        <ul className="mt-3 space-y-2">
          {MCP_TOOLS.map((t) => (
            <li key={t.name} className="rounded-[var(--radius)] border border-hairline bg-surface p-3">
              <p className="font-mono text-xs text-accent">{t.name}</p>
              <p className="mt-1 text-sm text-muted">{t.description}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Published rows only — the same rows the website shows. Anything unpublished is invisible here
          because the database refuses it, not because this code remembers to filter it out.
        </p>
      </div>
    </div>
  );
}
