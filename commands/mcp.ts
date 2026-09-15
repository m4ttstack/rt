declare const RT_VERSION: string;

/**
 * rt mcp serve — stdio MCP server over the tool registry in lib/mcp/tools.ts.
 *
 * The pinned SDK's McpServer.registerTool takes zod shapes, not raw JSON
 * Schema, so this uses the low-level Server with ListTools/CallTool request
 * handlers to serve each tool's JSON Schema verbatim.
 *
 * All SDK and registry imports are dynamic with literal specifiers so
 * `bun build --compile` can bundle them without paying startup cost on
 * every other rt command.
 */
export async function mcpServe(_args: string[]): Promise<void> {
  const [{ Server }, { StdioServerTransport }, { ListToolsRequestSchema, CallToolRequestSchema }, { mcpTools }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("@modelcontextprotocol/sdk/types.js"),
    import("../lib/mcp/tools.ts"),
  ]);

  const tools = mcpTools();
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

  const version = (typeof RT_VERSION !== "undefined" ? RT_VERSION : null) ?? process.env.RT_VERSION ?? "1.0.0";
  const server = new Server({ name: "mattstack", version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolByName.get(request.params.name);
    if (!tool) return { isError: true, content: [{ type: "text" as const, text: `unknown tool: ${request.params.name}` }] };

    const res = await tool.handler((request.params.arguments ?? {}) as Record<string, unknown>, process.env);
    if (!res.ok) return { isError: true, content: [{ type: "text" as const, text: res.error ?? "failed" }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(res.body) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // StdioServerTransport only listens for stdin "data"/"error"; it never
  // observes EOF, so without this the process would hang forever once the
  // client disconnects.
  await new Promise<void>((resolve) => {
    server.onclose = () => resolve();
    process.stdin.on("end", () => {
      server.close().catch(() => resolve());
    });
  });
}
