import { describe, expect, test } from "bun:test";
import { gateForkHookSettings, mergeGateForkHookSettings, resolveGateForkHookPath, type GateForkHookProbes } from "../agent-hooks.ts";

function probes(over: Partial<GateForkHookProbes>): GateForkHookProbes {
  return {
    exists: () => false,
    bundleRoot: () => null,
    sourceRoot: () => null,
    ...over,
  };
}

describe("resolveGateForkHookPath", () => {
  test("source checkout wins when its copy exists", () => {
    const seen: string[] = [];
    const path = resolveGateForkHookPath(probes({
      sourceRoot: () => "/repo",
      bundleRoot: () => "/Applications/mattstack.app",
      exists: (p) => { seen.push(p); return p === "/repo/scripts/hooks/gate-fork.sh"; },
    }));
    expect(path).toBe("/repo/scripts/hooks/gate-fork.sh");
    expect(seen).toEqual(["/repo/scripts/hooks/gate-fork.sh"]);
  });

  test("falls back to the bundle copy when the source copy is missing", () => {
    const path = resolveGateForkHookPath(probes({
      sourceRoot: () => "/repo",
      bundleRoot: () => "/Applications/mattstack.app",
      exists: (p) => p === "/Applications/mattstack.app/Contents/Helpers/gate-fork.sh",
    }));
    expect(path).toBe("/Applications/mattstack.app/Contents/Helpers/gate-fork.sh");
  });

  test("null when neither a source checkout nor a bundle carries it", () => {
    expect(resolveGateForkHookPath(probes({ sourceRoot: () => "/repo", bundleRoot: () => "/app" }))).toBeNull();
  });

  test("resolves for real from this source checkout", () => {
    const path = resolveGateForkHookPath();
    expect(path).toMatch(/scripts\/hooks\/gate-fork\.sh$/);
  });
});

describe("gateForkHookSettings", () => {
  test("matches Task 9's exact PreToolUse hook contract", () => {
    expect(gateForkHookSettings("/abs/gate-fork.sh")).toEqual({
      hooks: {
        PreToolUse: [
          { matcher: "AskUserQuestion", hooks: [{ type: "command", command: "/abs/gate-fork.sh" }] },
        ],
      },
    });
  });
});

describe("mergeGateForkHookSettings", () => {
  test("no base: reduces to the plain hook settings", () => {
    expect(mergeGateForkHookSettings(undefined, "/abs/gate-fork.sh")).toEqual({
      hooks: {
        PreToolUse: [
          { matcher: "AskUserQuestion", hooks: [{ type: "command", command: "/abs/gate-fork.sh" }] },
        ],
      },
    });
  });

  test("base with no hooks key: hook block added alongside base's own keys, base keys untouched", () => {
    const merged = mergeGateForkHookSettings({ crossSessionInbound: "accept" }, "/abs/gate-fork.sh");
    expect(merged).toEqual({
      crossSessionInbound: "accept",
      hooks: {
        PreToolUse: [
          { matcher: "AskUserQuestion", hooks: [{ type: "command", command: "/abs/gate-fork.sh" }] },
        ],
      },
    });
  });

  test("base already defining hooks.PreToolUse: concatenates, never displaces the base entry", () => {
    const base = {
      other: "kept",
      hooks: { PreToolUse: [{ matcher: "SomeOtherTool", hooks: [{ type: "command", command: "/other.sh" }] }] },
    };
    const merged = mergeGateForkHookSettings(base, "/abs/gate-fork.sh");
    expect(merged).toEqual({
      other: "kept",
      hooks: {
        PreToolUse: [
          { matcher: "SomeOtherTool", hooks: [{ type: "command", command: "/other.sh" }] },
          { matcher: "AskUserQuestion", hooks: [{ type: "command", command: "/abs/gate-fork.sh" }] },
        ],
      },
    });
  });
});
