import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("mcp serve output", () => {
  test("every tools/call result goes through toCallResult, never a raw serialization", () => {
    const src = readFileSync(join(import.meta.dir, "../../../commands/mcp.ts"), "utf8");
    expect(src).toContain("toCallResult(await tool.handler(");
    expect(src).not.toContain("JSON.stringify(res.body");
    expect(src).not.toMatch(/text:\s*res\.error/);
  });
});
