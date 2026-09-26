import { describe, expect, test } from "bun:test";
import { mcpToolsPayload } from "../mcp.ts";
import { mcpTools } from "../../lib/mcp/tools.ts";

describe("mcpToolsPayload", () => {
  test("carries every roster tool with its description and schema, in roster order", () => {
    const roster = mcpTools();
    const payload = mcpToolsPayload(roster);
    expect(payload.tools.map((t) => t.name)).toEqual(roster.map((t) => t.name));
    for (const [i, t] of payload.tools.entries()) {
      expect(t.description).toBe(roster[i]!.description);
      expect(t.inputSchema).toEqual(roster[i]!.inputSchema);
      expect(Object.keys(t)).toEqual(["name", "description", "inputSchema"]);
    }
  });
  test("is plain JSON (no handlers, no functions)", () => {
    const text = JSON.stringify(mcpToolsPayload());
    expect(JSON.parse(text).tools.length).toBe(mcpTools().length);
    expect(text).not.toContain("handler");
  });
});
