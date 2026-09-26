import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("mcp serve output", () => {
  test("every tools/call goes through callTool, never a raw handler call or serialization", () => {
    const src = readFileSync(join(import.meta.dir, "../../../commands/mcp.ts"), "utf8");
    expect(src).toContain("return callTool(tool,");
    expect(src).not.toContain("tool.handler(");
    expect(src).not.toContain("JSON.stringify(res.body");
    expect(src).not.toMatch(/text:\s*res\.error/);
  });
});
