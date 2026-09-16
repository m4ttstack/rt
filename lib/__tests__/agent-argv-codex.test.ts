import { describe, expect, test } from "bun:test";
import { buildCodexArgv, buildCodexPaneCommand } from "../agent-argv/index.ts";

const UUID = "6e225e74-4cb7-4aea-8807-6aa9011d4112";

describe("buildCodexArgv", () => {
  const bins = { codex: "/abs/codex" };

  test("headless start: exec --json, no session id emitted", () => {
    const argv = buildCodexArgv({ session: { kind: "start", sessionId: UUID }, headless: true, prompt: "do it" }, bins);
    expect(argv).toEqual(["/abs/codex", "exec", "--json", "do it"]);
    expect(argv).not.toContain(UUID);
  });

  test("all knobs, headless start", () => {
    const argv = buildCodexArgv({
      model: "gpt-6-astra", effort: "high", yolo: true, extraArgs: "--search",
      session: { kind: "start", sessionId: UUID }, headless: true, prompt: "do it",
    }, bins);
    expect(argv).toEqual([
      "/abs/codex", "exec", "--json",
      "-m", "gpt-6-astra", "-c", "model_reasoning_effort=high",
      "--dangerously-bypass-approvals-and-sandbox", "--search", "do it",
    ]);
  });

  test("headless resume: exec resume --json <flags> <id> <prompt>", () => {
    const argv = buildCodexArgv({ model: "gpt-6-astra", session: { kind: "resume", sessionId: UUID }, headless: true, prompt: "q" }, bins);
    expect(argv).toEqual(["/abs/codex", "exec", "resume", "--json", "-m", "gpt-6-astra", UUID, "q"]);
  });

  test("non-headless resume emits no --json", () => {
    const argv = buildCodexArgv({ session: { kind: "resume", sessionId: UUID }, headless: false }, bins);
    expect(argv).toEqual(["/abs/codex", "exec", "resume", UUID]);
  });

  test("herdr start has no --json", () => {
    const argv = buildCodexArgv({ session: { kind: "start", sessionId: UUID }, headless: false }, bins);
    expect(argv).not.toContain("--json");
    expect(argv).toEqual(["/abs/codex", "exec"]);
  });

  test("headless without a prompt throws", () => {
    expect(() => buildCodexArgv({ session: { kind: "start", sessionId: UUID }, headless: true }, bins)).toThrow(/prompt/);
  });
});

describe("buildCodexPaneCommand", () => {
  test("start: cd + bare codex + flags + quoted prompt", () => {
    const cmd = buildCodexPaneCommand("/repo dir", {
      model: "gpt-6-astra",
      session: { kind: "start", sessionId: UUID }, headless: false, prompt: "hi 'there'",
    });
    expect(cmd).toBe(`cd '/repo dir' && codex '-m' 'gpt-6-astra' 'hi '\\''there'\\'''`);
  });

  test("resume: codex resume <flags> <quoted id>", () => {
    const cmd = buildCodexPaneCommand("/r", { session: { kind: "resume", sessionId: UUID }, headless: false });
    expect(cmd).toBe(`cd '/r' && codex resume '${UUID}'`);
  });

  test("env assignments precede the codex head", () => {
    const cmd = buildCodexPaneCommand("/w/x", {
      session: { kind: "start", sessionId: UUID },
      headless: false,
      env: { RT_AGENT_ID: "ag-1" },
    });
    expect(cmd).toContain("cd '/w/x' && RT_AGENT_ID='ag-1' codex");
  });

  test("yolo maps to --dangerously-bypass-approvals-and-sandbox", () => {
    const cmd = buildCodexPaneCommand("/r", { yolo: true, session: { kind: "start", sessionId: UUID }, headless: false });
    expect(cmd).toContain("--dangerously-bypass-approvals-and-sandbox");
  });
});
