import { createMcpHandler } from "mcp-handler";
import { MCP_TOOLS } from "@/lib/mcp/tools";

/*
  The MCP server itself, with no opinion about who may reach it.

  Separate from the route so the protocol layer can be driven directly in a
  test — initialize, tools/list, a real tools/call — without either standing up
  auth or, worse, putting a bypass in the gate so the test can get past it. The
  route is the only thing that mounts this, and it puts the token check in
  front.
*/

export function createHandler(): (request: Request) => Promise<Response> {
  return createMcpHandler(
    (server) => {
      for (const tool of MCP_TOOLS) {
        server.registerTool(
          tool.name,
          { description: tool.description, inputSchema: tool.inputSchema },
          /*
            The one cast. MCP_TOOLS is heterogeneous — each entry's run() takes
            its own argument type — so the array cannot express the link
            between a tool's schema and its handler. The SDK has already
            validated the arguments against that schema by the time run() is
            called, which is what makes this safe rather than merely quiet.
          */
          tool.run as never,
        );
      }
    },
    {
      serverInfo: { name: "anhat-singh", version: "1.0.0" },
      /*
        No subscription streams. Every tool here answers and is done — nothing
        pushes updates — so an open SSE stream would be a held connection with
        nothing to send down it.
      */
      maxSubscriptions: 0,
    },
  );
}
