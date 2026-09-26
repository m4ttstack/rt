import { mcpTools, type McpToolDef } from "../lib/mcp/tools.ts";
import { toCallResult } from "../lib/mcp/redact.ts";

declare const RT_VERSION: string;

export function mcpToolsPayload(tools: McpToolDef[] = mcpTools()): { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> } {
  return { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
}

export async function mcpToolsList(args: string[]): Promise<void> {
  const payload = mcpToolsPayload();
  if (args.includes("--json")) { console.log(JSON.stringify(payload)); return; }
  for (const t of payload.tools) console.log(t.name);
}

/**
 * McpServer.registerTool in the pinned SDK requires zod schemas, so this
 * uses the low-level Server to serve each tool's raw JSON Schema unchanged.
 */
export async function mcpServe(_args: string[]): Promise<void> {
  const [{ Server }, { StdioServerTransport }, { ListToolsRequestSchema, CallToolRequestSchema }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);

  const tools = mcpTools();
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

  const version = (typeof RT_VERSION !== "undefined" ? RT_VERSION : null) ?? process.env.RT_VERSION ?? "1.0.0";
  const server = new Server({ name: "mattstack", version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
  }));

  // The SDK aborts every in-flight tools/call on close and drops its reply
  // (it checks the abort signal before sending), so stdin EOF must wait for
  // these to settle rather than close underneath them.
  const pending = new Set<Promise<unknown>>();

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const call = (async () => {
      const tool = toolByName.get(request.params.name);
      if (!tool) return { isError: true, content: [{ type: "text" as const, text: `unknown tool: ${request.params.name}` }] };

      return toCallResult(await tool.handler((request.params.arguments ?? {}) as Record<string, unknown>, process.env));
    })();
    pending.add(call);
    call.finally(() => pending.delete(call));
    return call;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const DRAIN_TIMEOUT_MS = 5000;

  // StdioServerTransport only listens for stdin "data"/"error"; it never
  // observes EOF, so without this the process would hang forever once the
  // client disconnects.
  await new Promise<void>((resolve) => {
    server.onclose = () => resolve();
    process.stdin.on("end", () => {
      void (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((r) => { timer = setTimeout(r, DRAIN_TIMEOUT_MS); });
        await Promise.race([Promise.allSettled(pending), timeout]);
        if (timer) clearTimeout(timer);
        // A macrotask boundary flushes the SDK's own send continuation,
        // which is chained a tick past each settled call above.
        await new Promise((r) => setImmediate(r));
        server.close().catch(() => resolve());
      })();
    });
  });
}
