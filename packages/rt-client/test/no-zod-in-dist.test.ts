/**
 * zod authors the schemas at dev time only. The registry sits on rt's startup
 * path, so the runtime bundle must never pull it in.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("dist/index.js", () => {
  test("does not import zod", () => {
    const js = readFileSync(join(import.meta.dir, "..", "dist", "index.js"), "utf8");
    expect(js).not.toMatch(/from\s+["']zod["']|require\(["']zod["']\)/);
  });
});
