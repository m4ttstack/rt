import { expect, test } from "bun:test";
import { resolveClaudeBin } from "../claude-bin.ts";

test("resolveClaudeBin returns an absolute path or null", () => {
  const bin = resolveClaudeBin();
  if (bin !== null) expect(bin.startsWith("/")).toBe(true);
});
