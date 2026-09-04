import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { getSetting } from "@mattstack/rt-client";
import { composeAgentCommand, loadConfigFrom } from "../config.ts";

type GetSettingFn = typeof getSetting;

function fakeResolve(values: Record<string, unknown>): GetSettingFn {
  return (<T,>(key: string) => ({ value: values[key] as T, provenance: [] })) as GetSettingFn;
}

/** The retired-key shape: getSetting throws for anything not in the registry. */
function registryOf(values: Record<string, unknown>): GetSettingFn {
  return (<T,>(key: string) => {
    if (!(key in values)) throw new Error(`rt: unknown setting "${key}"`);
    return { value: values[key] as T, provenance: [] };
  }) as GetSettingFn;
}

/** The required fields, so these tests exercise the agent keys and nothing else. */
const base = { gitlabHost: "https://gitlab.com", projects: ["org/repo"], members: [{ username: "alice" }] };

function tmpConfig(body: Record<string, unknown> = base): string {
  const path = join(mkdtempSync(join(tmpdir(), "board-agent-")), "config.json");
  writeFileSync(path, JSON.stringify(body, null, 2) + "\n");
  return path;
}

function configWith(values: Record<string, unknown>) {
  return loadConfigFrom(tmpConfig(), registryOf(values));
}

describe("composeAgentCommand", () => {
  test("all three unset gives an empty command, so the pane runs plain claude", () => {
    expect(composeAgentCommand({})).toBe("");
  });

  test("an account alone wraps claude in cswap, keeping --share-history for resume", () => {
    expect(composeAgentCommand({ account: "someone@example.com" })).toBe(
      "cswap run 'someone@example.com' --share-history --",
    );
  });

  test("the word claude never follows the cswap --, per docs/configuration.md", () => {
    expect(composeAgentCommand({ account: "a@b.c", model: "m" })).not.toContain("-- claude");
  });

  test("model and effort become claude flags, in that order", () => {
    expect(composeAgentCommand({ account: "a@b.c", model: "claude-opus-5", effort: "high" })).toBe(
      "cswap run 'a@b.c' --share-history -- --model 'claude-opus-5' --effort 'high'",
    );
  });

  test("model without an account flags plain claude rather than dropping the model", () => {
    expect(composeAgentCommand({ model: "claude-opus-5" })).toBe("claude --model 'claude-opus-5'");
    expect(composeAgentCommand({ effort: "max" })).toBe("claude --effort 'max'");
  });

  test("values carrying shell metacharacters are quoted, not interpolated", () => {
    expect(composeAgentCommand({ account: "a b; rm -rf /" })).toBe(
      "cswap run 'a b; rm -rf /' --share-history --",
    );
    expect(composeAgentCommand({ model: "claude-opus-4-8[1m]" })).toBe(
      "claude --model 'claude-opus-4-8[1m]'",
    );
  });

  test("blank and whitespace-only values are treated as unset", () => {
    expect(composeAgentCommand({ account: "", model: "  ", effort: "" })).toBe("");
  });
});

describe("loadConfig reads the board.agent.* keys", () => {
  test("composes claudeCommand from the three keys", () => {
    const cfg = configWith({
      "board.agent.account": "a@b.c",
      "board.agent.model": "claude-opus-5",
      "board.agent.effort": "high",
    });
    expect(cfg.claudeCommand).toBe("cswap run 'a@b.c' --share-history -- --model 'claude-opus-5' --effort 'high'");
  });

  test("an empty registry leaves claudeCommand empty, so panes run plain claude", () => {
    expect(configWith({}).claudeCommand).toBe("");
  });

  test("the retired board.claudeCommand is not consulted, even when a store still holds it", () => {
    const cfg = configWith({ "board.claudeCommand": "cswap run 'old' --share-history --" });
    expect(cfg.claudeCommand).toBe("");
  });

  test("a file-config claudeCommand still wins as the verbatim escape hatch", () => {
    const path = tmpConfig({ ...base, claudeCommand: "my-wrapper --" });
    expect(loadConfigFrom(path, registryOf({})).claudeCommand).toBe("my-wrapper --");
  });

  test("the store beats the file when both are set", () => {
    const path = tmpConfig({ ...base, claudeCommand: "my-wrapper --" });
    const cfg = loadConfigFrom(path, registryOf({ "board.agent.account": "a@b.c" }));
    expect(cfg.claudeCommand).toBe("cswap run 'a@b.c' --share-history --");
  });

  test("a resolver that throws on every key degrades to the file, not a crash", () => {
    const path = tmpConfig({ ...base, claudeCommand: "my-wrapper --" });
    const throwing = (() => {
      throw new Error("rt daemon unreachable");
    }) as GetSettingFn;
    expect(loadConfigFrom(path, throwing).claudeCommand).toBe("my-wrapper --");
  });

  test("unrelated keys still resolve through the same fake shape", () => {
    const cfg = configWith({ "board.title": "The Board", "board.agent.account": "a@b.c" });
    expect(cfg.title).toBe("The Board");
  });

  test("fakeResolve's absent-key-is-undefined shape composes to empty too", () => {
    expect(loadConfigFrom(tmpConfig(), fakeResolve({})).claudeCommand).toBe("");
  });
});
