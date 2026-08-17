import { createHandler } from "@/lib/mcp/server";
import { bearerFrom, verifyToken } from "@/lib/mcp/tokens";

/*
  The MCP endpoint.

  What another agent connects to. Everything protocol-shaped — the JSON-RPC
  framing, the session handling, the transport — belongs to mcp-handler, which
  is built for hosting MCP in a Next route. This file's whole job is deciding
  who gets through to it.

  Node runtime, because the tools reach Supabase and the OpenAI SDK the same
  way every other route here does.
*/

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = createHandler();

/*
  Auth in front of the handler rather than inside each tool.

  A tool that forgets the check is a tool that leaks, and there are thirteen of
  them. One gate means one place to be right, and adding a tool later cannot
  quietly open a hole.

  The check itself happens entirely in Postgres — see lib/mcp/tokens.ts.
  Unconfigured means refused, which is why a missing service key returns 401
  here rather than serving the whole record to anyone who finds the URL.
*/
async function guarded(req: Request): Promise<Response> {
  const tokenId = await verifyToken(bearerFrom(req));

  if (!tokenId) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized. Send a bearer token: Authorization: Bearer <token>." },
        id: null,
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          /*
            The header a well-behaved MCP client reads to know what to do next.
            Without it, a 401 is indistinguishable from a broken endpoint.
          */
          "www-authenticate": 'Bearer realm="anhat-singh-mcp"',
        },
      },
    );
  }

  return handler(req);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
