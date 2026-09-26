import { describe, expect, test } from "bun:test";
import { BASE_PERMISSIONS } from "../base-permissions.ts";

describe("BASE_PERMISSIONS", () => {
  test("carries no forge CLI, no rt runs, and no git rule; keeps the long waits", () => {
    expect(BASE_PERMISSIONS.some((r) => r.startsWith("Bash(glab"))).toBe(false);
    expect(BASE_PERMISSIONS).not.toContain("Bash(rt runs *)");
    expect(BASE_PERMISSIONS).not.toContain("Bash(rt skills sync *)");
    expect(BASE_PERMISSIONS.some((r) => r.startsWith("Bash(git"))).toBe(false);
    for (const kept of ["mcp__plugin_mattstack_mattstack", "Bash(rt gate *)", "Bash(rt chat tail *)", "Bash(rt events wait *)"]) expect(BASE_PERMISSIONS).toContain(kept);
  });
});
