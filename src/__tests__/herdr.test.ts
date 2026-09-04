// src/__tests__/herdr.test.ts
import { describe, expect, test } from "bun:test";
import {
  findWorkspaceIdByLabel,
  parseTabCreate,
  parseWorkspaceCreate,
  reviewPrompt,
  respondPrompt,
  operatorNoteParagraph,
  reopenPrompt,
  parseLaunchNote,
  buildResumePaneCommand,
  mrTabLabel,
  launchReview,
  launchRespond,
  launchDoctor,
  launchLegacyResume,
  doctorPrompt,
  draftBinPath,
  statusBinPath,
  dispatchPrompt,
  type HerdrRunner,
} from "../herdr.ts";
import type { AgentIo } from "../agent-launch.ts";
import { repoIdentityField } from "../config.ts";

const WS_LIST = JSON.stringify({
  result: { type: "workspace_list", workspaces: [
    { workspace_id: "w18", label: "repo-tools" },
    { workspace_id: "w40", label: "reviews" },
  ] },
});
const TAB_CREATE = JSON.stringify({
  result: { type: "tab_created",
    tab: { tab_id: "w40:t3", workspace_id: "w40", label: "!4821" },
    root_pane: { pane_id: "w40:p7", tab_id: "w40:t3", workspace_id: "w40" } },
});
const TAB_LIST_WITH_DUP = JSON.stringify({
  result: { type: "tab_list", tabs: [
    { tab_id: "w40:t1", label: "1", workspace_id: "w40" },
    { tab_id: "w40:t9", label: "↺ !4821 Grace Hopper", workspace_id: "w40" },
  ] },
});
const WS_CREATE = JSON.stringify({
  result: { type: "workspace_created",
    workspace: { workspace_id: "w41", label: "reviews" },
    tab: { tab_id: "w41:t1" },
    root_pane: { pane_id: "w41:p1" } },
});

describe("parsers", () => {
  test("findWorkspaceIdByLabel finds the labelled workspace", () => {
    expect(findWorkspaceIdByLabel(WS_LIST, "reviews")).toBe("w40");
    expect(findWorkspaceIdByLabel(WS_LIST, "nope")).toBeNull();
  });
  test("parseTabCreate pulls tab + pane ids", () => {
    expect(parseTabCreate(TAB_CREATE)).toEqual({ tabId: "w40:t3", paneId: "w40:p7", workspaceId: "w40" });
  });
  test("parseWorkspaceCreate pulls workspace + pane ids", () => {
    expect(parseWorkspaceCreate(WS_CREATE)).toEqual({ workspaceId: "w41", tabId: "w41:t1", paneId: "w41:p1" });
  });
});

describe("command builders", () => {
  test("reviewPrompt injects status-bin, report and skill flags", () => {
    expect(
      reviewPrompt({
        mrUrl: "https://x/mr/1",
        statePath: "/s/1.json",
        statusBin: "/b/review-status.ts",
        reportPath: "/s/1.md",
        skill: "myteam:review",
      }),
    ).toBe(
      `/board:review https://x/mr/1
  --state /s/1.json
  --status-bin /b/review-status.ts
  --report /s/1.md
  --skill myteam:review`,
    );
  });
  test("reviewPrompt omits the skill flag when unconfigured", () => {
    expect(
      reviewPrompt({ mrUrl: "https://x/mr/1", statePath: "/s/1.json", statusBin: "/b/review-status.ts", reportPath: "/s/1.md" }),
    ).toBe(`/board:review https://x/mr/1
  --state /s/1.json
  --status-bin /b/review-status.ts
  --report /s/1.md`);
  });
  test("a stale channel option can no longer put --channel in the prompt", () => {
    // channel is no longer on SkillPromptOpts; this simulates a stale caller
    // (or one outside this repo) still passing it, so the cast is the point.
    const opts = {
      mrUrl: "https://x/mr/1",
      statePath: "/s/1.json",
      statusBin: "/b/review-status.ts",
      reportPath: "/s/1.md",
      channel: "code-review",
    } as unknown as Parameters<typeof reviewPrompt>[0];
    expect(reviewPrompt(opts)).not.toContain("--channel");
    expect(reviewPrompt(opts)).toBe(
      `/board:review https://x/mr/1
  --state /s/1.json
  --status-bin /b/review-status.ts
  --report /s/1.md`,
    );
  });
  test("reviewPrompt appends the operator note as a trailing paragraph", () => {
    expect(
      reviewPrompt({
        mrUrl: "https://x/mr/1", statePath: "/s/1.json", statusBin: "/b/review-status.ts",
        note: "focus on the migration files",
      }),
    ).toBe(
      `/board:review https://x/mr/1
  --state /s/1.json
  --status-bin /b/review-status.ts` +
      "\n\nOperator note (from the human who launched this pane): focus on the migration files",
    );
  });
  test("doctorPrompt appends the operator note after every flag", () => {
    const p = doctorPrompt({
      mrUrl: "https://x/mr/1", statePath: "/s/1.json", statusBin: "/b/doctor-status.ts",
      tier: "api", note: "the lint job is the real blocker",
    });
    expect(p).toBe(
      `/board:doctor https://x/mr/1
  --state /s/1.json
  --status-bin /b/doctor-status.ts
  --tier api` +
      "\n\nOperator note (from the human who launched this pane): the lint job is the real blocker",
    );
  });
  test("operatorNoteParagraph frames a note as coming from the human", () => {
    expect(operatorNoteParagraph("check CI first")).toBe(
      "Operator note (from the human who launched this pane): check CI first",
    );
  });
  test("reopenPrompt: no note leaves a plain reopen promptless (TRAP 1)", () => {
    expect(reopenPrompt(undefined)).toBeUndefined();
  });
  test("reopenPrompt: a note is the WHOLE prompt -- never the re-review dispatch command (TRAP 1)", () => {
    const p = reopenPrompt("check CI first");
    expect(p).toBe("Operator note (from the human who launched this pane): check CI first");
    expect(p).not.toContain("/board:review");
    expect(p).not.toContain("--re-review");
  });
  test("parseLaunchNote accepts absent and blank notes as undefined", () => {
    expect(parseLaunchNote({})).toEqual({ ok: true, note: undefined });
    expect(parseLaunchNote({ note: "" })).toEqual({ ok: true, note: undefined });
    expect(parseLaunchNote({ note: "   " })).toEqual({ ok: true, note: undefined });
    expect(parseLaunchNote(null)).toEqual({ ok: true, note: undefined });
  });
  test("parseLaunchNote trims and returns a real note", () => {
    expect(parseLaunchNote({ note: "  look at !42 too  " })).toEqual({ ok: true, note: "look at !42 too" });
  });
  test("parseLaunchNote rejects non-strings and over-long notes", () => {
    expect(parseLaunchNote({ note: 42 })).toEqual({ ok: false, error: "note must be a string" });
    expect(parseLaunchNote({ note: "x".repeat(2001) })).toEqual({ ok: false, error: "note too long (max 2000 chars)" });
    expect(parseLaunchNote({ note: "x".repeat(2000) })).toEqual({ ok: true, note: "x".repeat(2000) });
  });
  test("reviewPrompt appends --re-review when re-reviewing", () => {
    expect(
      reviewPrompt({ mrUrl: "https://x/mr/1", statePath: "/s/1.json", statusBin: "/b/review-status.ts", reportPath: "/s/1.md", reReview: true }),
    ).toBe(`/board:review https://x/mr/1
  --state /s/1.json
  --status-bin /b/review-status.ts
  --report /s/1.md
  --re-review`);
  });
  test("buildResumePaneCommand with no prompt drops into an interactive resume", () => {
    expect(buildResumePaneCommand("/repo", "sess-1")).toBe("cd '/repo' && claude --resume 'sess-1'");
  });
  test("buildResumePaneCommand resumes under the configured claude command", () => {
    expect(buildResumePaneCommand("/repo", "sess-1", "hi", "cswap run 2 --")).toBe(
      "cd '/repo' && cswap run 2 -- --resume 'sess-1' 'hi'",
    );
  });
  test("buildResumePaneCommand with a prompt resumes and sends it as the first message", () => {
    expect(buildResumePaneCommand("/repo", "sess-1", "re-review please")).toBe(
      "cd '/repo' && claude --resume 'sess-1' 're-review please'",
    );
  });
  test("mrTabLabel puts the author beside the id when known", () => {
    expect(mrTabLabel(4821, "Grace Hopper")).toBe("!4821 Grace Hopper");
  });
  test("mrTabLabel is just the id when no author", () => {
    expect(mrTabLabel(4821)).toBe("!4821");
    expect(mrTabLabel(4821, undefined)).toBe("!4821");
  });
  test("mrTabLabel keeps the prefix glyph ahead of the id + author", () => {
    expect(mrTabLabel(42, "Ada", "⟲")).toBe("⟲ !42 Ada");
    expect(mrTabLabel(42, undefined, "↺")).toBe("↺ !42");
  });
});

/** A fake AgentIo whose agentStart records every payload and answers with a
    fixed AgentLaunchResult-shaped record, so launchReview/Respond/Doctor tests
    assert on what they sent the rt agent daemon without spawning one. */
function fakeAgentIo(): { io: AgentIo; startCalls: Array<Record<string, unknown>> } {
  const startCalls: Array<Record<string, unknown>> = [];
  const io: AgentIo = {
    agentStart: async (payload) => {
      startCalls.push(payload as unknown as Record<string, unknown>);
      return {
        ok: true,
        data: {
          id: "agent-1", repo: payload.repo, cwd: payload.cwd, provider: "test",
          surface: "herdr" as const, sessionId: "sess-1", paneId: "pane-1",
          tabId: "tab-1", workspaceId: "ws-1", createdAt: Date.now(),
        },
      };
    },
    agentResume: async () => { throw new Error("agentResume not used by launchReview/Respond/Doctor"); },
  };
  return { io, startCalls };
}

describe("launchReview / launchRespond / launchDoctor (rt agent)", () => {
  test("launchReview starts an rt agent with repo, cwd, prompt, workspace + tab labels, and returns the launch ids", async () => {
    const { io, startCalls } = fakeAgentIo();
    const res = await launchReview(
      { mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "reviews", statePath: "/s/1.json" },
      io,
    );
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]).toMatchObject({ repo: "acme/webapp", cwd: "/repo", workspace: "reviews", tab: "!4821", surface: "herdr" });
    expect(startCalls[0]!.prompt).toContain("/board:review https://x/mr/1");
    expect(startCalls[0]!.prompt).toContain("--state /s/1.json");
    expect(res).toEqual({ agentId: "agent-1", sessionId: "sess-1", paneId: "pane-1", tabId: "tab-1", workspaceId: "ws-1", focusedExisting: false });
  });

  // Regression: startAgentPane's `repo` must reach the rt agent daemon as the
  // SERIALIZED rt identity ("remote:<encoded host/path>"), never a bare
  // GitLab project path -- `rt agent list --repo <identity>` filters on the
  // exact serialized string, so a bare path silently never matches. The
  // resolution itself (repoIdentityField + gitlabHost fallback) lives at the
  // launch call sites (server.ts, bin/triage.ts), not here -- this pins that
  // whatever identity a caller resolves survives launchReview/Respond/Doctor
  // and startAgentPane unmangled, so a future refactor can't silently swap
  // it back for a bare path without a test noticing.
  test("passes the caller-resolved repo identity through to startAgentPane verbatim, never a bare project path", async () => {
    const { io, startCalls } = fakeAgentIo();
    const identity = repoIdentityField("gitlab.com/acme/webapp")!;
    await launchReview(
      { mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: identity, workspaceLabel: "reviews", statePath: "/s/1.json" },
      io,
    );
    expect(startCalls[0]!.repo).toBe(identity);
    expect((startCalls[0]!.repo as string).startsWith("remote:")).toBe(true);
    expect(startCalls[0]!.repo).not.toBe("acme/webapp");
  });

  test("launchReview puts the author beside the id, and the re-review glyph ahead of it, in the tab label", async () => {
    const { io, startCalls } = fakeAgentIo();
    await launchReview(
      { mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "reviews", statePath: "/s/1.json", author: "Grace Hopper", reReview: true },
      io,
    );
    expect(startCalls[0]!.tab).toBe("⟲ !4821 Grace Hopper");
    expect(startCalls[0]!.prompt).toContain("--re-review");
  });

  test("threads account/model/effort into the rt agent start payload", async () => {
    const { io, startCalls } = fakeAgentIo();
    await launchReview(
      {
        mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "reviews", statePath: "/s/1.json",
        account: "matt@example.com", model: "opus", effort: "high",
      },
      io,
    );
    expect(startCalls[0]).toMatchObject({ account: "matt@example.com", model: "opus", effort: "high" });
  });

  test("launchRespond starts an rt agent with the respond prompt under the responses workspace", async () => {
    const { io, startCalls } = fakeAgentIo();
    await launchRespond(
      { mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "responds", statePath: "/s/1.json" },
      io,
    );
    expect(startCalls[0]!.prompt).toContain("/board:respond https://x/mr/1");
    expect(startCalls[0]).toMatchObject({ workspace: "responds", tab: "!4821" });
  });

  test("launchDoctor starts an rt agent with the doctor prompt and tier flag", async () => {
    const { io, startCalls } = fakeAgentIo();
    await launchDoctor(
      { mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "doctors", statePath: "/s/1.json", tier: "api" },
      io,
    );
    expect(startCalls[0]!.prompt).toContain("/board:doctor https://x/mr/1");
    expect(startCalls[0]!.prompt).toContain("--tier api");
  });

  test("threads the operator note into the launched prompt", async () => {
    const { io, startCalls } = fakeAgentIo();
    await launchReview(
      { mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "reviews", statePath: "/s/1.json", note: "skip the vendored files" },
      io,
    );
    expect(startCalls[0]!.prompt).toContain("Operator note (from the human who launched this pane): skip the vendored files");
  });

  test("adds --skill-path but keeps launching the /board:review wrapper when resolution succeeds", async () => {
    const { io, startCalls } = fakeAgentIo();
    const resolvePath = async () => "/cache/acme/skills/board-review/SKILL.md";
    await launchReview(
      { mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "reviews", statePath: "/s/1.json", skill: "acme:board-review" },
      io,
      resolvePath,
    );
    expect(startCalls[0]!.prompt).toContain("/board:review https://x/mr/1");
    expect(startCalls[0]!.prompt).toContain("--skill-path /cache/acme/skills/board-review/SKILL.md");
  });

  test("falls back to the slash form (no --skill-path) when resolution fails", async () => {
    const { io, startCalls } = fakeAgentIo();
    const resolvePath = async () => null;
    await launchReview(
      { mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "reviews", statePath: "/s/1.json", skill: "acme:board-review" },
      io,
      resolvePath,
    );
    expect(startCalls[0]!.prompt).not.toContain("--skill-path");
  });

  test("launchRespond adds --skill-path but keeps launching the /board:respond wrapper", async () => {
    const { io, startCalls } = fakeAgentIo();
    const resolvePath = async () => "/cache/acme/skills/board-respond/SKILL.md";
    await launchRespond(
      { mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "responds", statePath: "/s/1.json", skill: "acme:board-respond" },
      io,
      resolvePath,
    );
    expect(startCalls[0]!.prompt).toBe(
      await dispatchPrompt("board:respond", {
        mrUrl: "https://x/mr/1", statePath: "/s/1.json", statusBin: statusBinPath(), skill: "acme:board-respond",
      }, resolvePath),
    );
  });

  test("launchDoctor adds --skill-path but keeps launching the /board:doctor wrapper, tier intact", async () => {
    const { io, startCalls } = fakeAgentIo();
    const resolvePath = async () => "/cache/acme/attachments/board-doctor-api/SKILL.md";
    await launchDoctor(
      {
        mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "doctors", statePath: "/s/1.json",
        skill: "acme:board-doctor-api", tier: "api",
      },
      io,
      resolvePath,
    );
    expect(startCalls[0]!.prompt).toContain("/board:doctor https://x/mr/1");
    expect(startCalls[0]!.prompt).toContain("--skill-path /cache/acme/attachments/board-doctor-api/SKILL.md");
    expect(startCalls[0]!.prompt).toContain("--tier api");
  });

  test("a focusedExisting rt-agent response maps to focusedExisting: true with empty ids (no double-launch)", async () => {
    const io: AgentIo = {
      agentStart: async () => ({ ok: false, error: "already open; focused it" }),
      agentResume: async () => { throw new Error("not used"); },
    };
    const res = await launchReview(
      { mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "reviews", statePath: "/s/1.json" },
      io,
    );
    expect(res).toEqual({ agentId: "", sessionId: "", paneId: "", tabId: "", workspaceId: "", focusedExisting: true });
  });
});

describe("launchLegacyResume (pre-rt-agent sessionId resume, over HerdrRunner)", () => {
  test("reuses an existing workspace and creates a labelled tab, resuming under plain claude", async () => {
    const calls: string[][] = [];
    const runner: HerdrRunner = async (args) => {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list") return WS_LIST;
      if (args[0] === "tab" && args[1] === "create") return TAB_CREATE;
      return JSON.stringify({ result: { type: "ok" } });
    };
    const res = await launchLegacyResume(
      {
        mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "reviews", statePath: "/s/1.json",
        sessionId: "sess-1", workspaceKind: "review",
      },
      runner,
    );
    expect(res).toEqual({ tabId: "w40:t3", workspaceId: "w40" });
    expect(calls.some((c) => c[0] === "workspace" && c[1] === "create")).toBe(false);
    expect(calls).toContainEqual(["tab", "create", "--workspace", "w40", "--label", "↺ !4821", "--no-focus"]);
    const runCall = calls.find((c) => c[0] === "pane" && c[1] === "run");
    expect(runCall?.[2]).toBe("w40:p7");
    expect(runCall?.[3]).toBe("cd '/repo' && claude --resume 'sess-1'");
  });

  test("sends a prompt as the first resumed message when given, under the re-review tab glyph", async () => {
    const calls: string[][] = [];
    const runner: HerdrRunner = async (args) => {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list") return WS_LIST;
      if (args[0] === "tab" && args[1] === "create") return TAB_CREATE;
      return JSON.stringify({ result: { type: "ok" } });
    };
    await launchLegacyResume(
      {
        mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "reviews", statePath: "/s/1.json",
        sessionId: "sess-1", workspaceKind: "review", prompt: "re-review please", tabPrefix: "⟲",
      },
      runner,
    );
    const runCall = calls.find((c) => c[0] === "pane" && c[1] === "run");
    expect(runCall?.[3]).toBe("cd '/repo' && claude --resume 'sess-1' 're-review please'");
    expect(calls).toContainEqual(["tab", "create", "--workspace", "w40", "--label", "⟲ !4821", "--no-focus"]);
  });

  test("resumes under the configured claude command (the file's claudeCommand escape hatch)", async () => {
    const calls: string[][] = [];
    const runner: HerdrRunner = async (args) => {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list") return WS_LIST;
      if (args[0] === "tab" && args[1] === "create") return TAB_CREATE;
      return JSON.stringify({ result: { type: "ok" } });
    };
    await launchLegacyResume(
      {
        mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "reviews", statePath: "/s/1.json",
        sessionId: "sess-1", workspaceKind: "review", claudeCommand: "cswap run 2 --",
      },
      runner,
    );
    const runCall = calls.find((c) => c[0] === "pane" && c[1] === "run");
    expect(runCall?.[3]).toBe("cd '/repo' && cswap run 2 -- --resume 'sess-1'");
  });

  test("puts the MR author beside the id in the tab label when given", async () => {
    const calls: string[][] = [];
    const runner: HerdrRunner = async (args) => {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list") return WS_LIST;
      if (args[0] === "tab" && args[1] === "create") return TAB_CREATE;
      return JSON.stringify({ result: { type: "ok" } });
    };
    await launchLegacyResume(
      {
        mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "reviews", statePath: "/s/1.json",
        sessionId: "sess-1", workspaceKind: "review", author: "Grace Hopper",
      },
      runner,
    );
    expect(calls).toContainEqual(["tab", "create", "--workspace", "w40", "--label", "↺ !4821 Grace Hopper", "--no-focus"]);
  });

  test("dedup: a tab with the same label already open is focused, not duplicated", async () => {
    const calls: string[][] = [];
    const runner: HerdrRunner = async (args) => {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list") return WS_LIST;
      if (args[0] === "tab" && args[1] === "list") return TAB_LIST_WITH_DUP;
      return JSON.stringify({ result: { type: "ok" } });
    };
    const res = await launchLegacyResume(
      {
        mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "reviews", statePath: "/s/1.json",
        sessionId: "sess-1", workspaceKind: "review", author: "Grace Hopper",
      },
      runner,
    );
    // Returns the existing tab, does not create a new one.
    expect(res).toEqual({ tabId: "w40:t9", workspaceId: "w40" });
    expect(calls.some((c) => c[0] === "tab" && c[1] === "create")).toBe(false);
    expect(calls).toContainEqual(["tab", "focus", "w40:t9"]);
    // And it does not re-run the pane command (would double-launch in the tab).
    expect(calls.some((c) => c[0] === "pane" && c[1] === "run")).toBe(false);
  });

  test("creates the workspace when absent, reusing its initial tab (no blank tab)", async () => {
    const calls: string[][] = [];
    const runner: HerdrRunner = async (args) => {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list")
        return JSON.stringify({ result: { workspaces: [] } });
      if (args[0] === "workspace" && args[1] === "create") return WS_CREATE;
      return JSON.stringify({ result: { type: "ok" } });
    };
    const res = await launchLegacyResume(
      {
        mrUrl: "https://x/mr/2", iid: 42, cwd: "/repo", repo: "acme/webapp", workspaceLabel: "reviews", statePath: "/s/2.json",
        sessionId: "sess-2", workspaceKind: "review",
      },
      runner,
    );
    // Returns the workspace's initial tab/pane, not a second one.
    expect(res).toEqual({ tabId: "w41:t1", workspaceId: "w41" });
    expect(calls).toContainEqual(["workspace", "create", "--label", "reviews", "--no-focus"]);
    // No second tab is opened — the blank initial tab is reused, just renamed.
    expect(calls.some((c) => c[0] === "tab" && c[1] === "create")).toBe(false);
    expect(calls).toContainEqual(["tab", "rename", "w41:t1", "↺ !42"]);
    // The resume command runs in the initial pane.
    const runCall = calls.find((c) => c[0] === "pane" && c[1] === "run");
    expect(runCall?.[2]).toBe("w41:p1");
    expect(runCall?.[3]).toBe("cd '/repo' && claude --resume 'sess-2'");
  });
});

describe("doctorPrompt tier flags", () => {
  test("emits --tier, --fix-classes, and --draft-bin when given", () => {
    const p = doctorPrompt({
      mrUrl: "https://x/mr/1", statePath: "/s", statusBin: statusBinPath(),
      skill: "team:doctor-api", tier: "api", fixClasses: ["retry-flake", "inherited-note-draft"], draftBin: draftBinPath(),
    });
    expect(p).toContain("--tier api");
    expect(p).toContain("--fix-classes retry-flake,inherited-note-draft");
    expect(p).toContain(`--draft-bin ${draftBinPath()}`);
  });

  test("omits the flags when absent (manual path unchanged)", () => {
    const p = doctorPrompt({ mrUrl: "https://x/mr/1", statePath: "/s", statusBin: statusBinPath() });
    expect(p).not.toContain("--tier");
    expect(p).not.toContain("--fix-classes");
    expect(p).not.toContain("--draft-bin");
  });
});

describe("--resumed-gate flag (parked-gate resume marker)", () => {
  test("reviewPrompt emits --resumed-gate right after --skill when set", () => {
    const p = reviewPrompt({
      mrUrl: "https://x/mr/1", statePath: "/s/1.json", statusBin: "/b/review-status.ts",
      reportPath: "/s/1.md", skill: "myteam:review", resumedGate: "gate-42",
    });
    expect(p).toBe(
      `/board:review https://x/mr/1
  --state /s/1.json
  --status-bin /b/review-status.ts
  --report /s/1.md
  --skill myteam:review
  --resumed-gate gate-42`,
    );
  });

  test("a normal launch (no resumedGate) omits the flag entirely", () => {
    const p = reviewPrompt({
      mrUrl: "https://x/mr/1", statePath: "/s/1.json", statusBin: "/b/review-status.ts",
      reportPath: "/s/1.md", skill: "myteam:review",
    });
    expect(p).not.toContain("--resumed-gate");
  });

  test("a re-review (reReview: true, no resumedGate) also omits the flag", () => {
    const p = reviewPrompt({
      mrUrl: "https://x/mr/1", statePath: "/s/1.json", statusBin: "/b/review-status.ts",
      reportPath: "/s/1.md", skill: "myteam:review", reReview: true,
    });
    expect(p).not.toContain("--resumed-gate");
    expect(p).toContain("--re-review");
  });

  test("respondPrompt and doctorPrompt thread --resumed-gate the same way reviewPrompt does", () => {
    const respond = respondPrompt({
      mrUrl: "https://x/mr/1", statePath: "/s/1.json", statusBin: "/b/board", skill: "myteam:respond", resumedGate: "gate-9",
    });
    expect(respond).toContain("--resumed-gate gate-9");

    const doctor = doctorPrompt({
      mrUrl: "https://x/mr/1", statePath: "/s/1.json", statusBin: "/b/board", skill: "myteam:doctor", resumedGate: "gate-9",
    });
    expect(doctor).toContain("--resumed-gate gate-9");
  });
});

describe("dispatchPrompt (wrapper hop stays; --skill-path rides alongside --skill)", () => {
  const baseOpts = {
    mrUrl: "https://x/mr/1",
    statePath: "/s/1.json",
    statusBin: "/b/review-status.ts",
    reportPath: "/s/1.md",
    skill: "acme:board-review",
  };

  test("adds --skill-path after --skill when resolution succeeds, keeping the wrapper hop", async () => {
    const resolvePath = async (name: string) => (name === "acme:board-review" ? "/cache/acme/skills/board-review/SKILL.md" : null);
    const prompt = await dispatchPrompt("board:review", baseOpts, resolvePath);
    expect(prompt).toBe(
      `/board:review https://x/mr/1
  --state /s/1.json
  --status-bin /b/review-status.ts
  --report /s/1.md
  --skill acme:board-review
  --skill-path /cache/acme/skills/board-review/SKILL.md`,
    );
  });

  test("byte-identical to the historical slash form when path resolution returns null", async () => {
    const resolvePath = async () => null;
    const prompt = await dispatchPrompt("board:review", baseOpts, resolvePath);
    expect(prompt).toBe(reviewPrompt(baseOpts));
    expect(prompt).not.toContain("--skill-path");
  });

  test("byte-identical to the historical slash form without calling the resolver when no skill is configured", async () => {
    let called = false;
    const resolvePath = async () => {
      called = true;
      return "/should/not/be/used/SKILL.md";
    };
    const opts = { mrUrl: "https://x/mr/1", statePath: "/s/1.json", statusBin: "/b/review-status.ts" };
    const prompt = await dispatchPrompt("board:review", opts, resolvePath);
    expect(called).toBe(false);
    expect(prompt).toBe(reviewPrompt(opts));
  });

  test("keeps the operator note as a trailing paragraph after --skill-path", async () => {
    const resolvePath = async () => "/cache/acme/skills/board-review/SKILL.md";
    const prompt = await dispatchPrompt("board:review", { ...baseOpts, note: "focus on the migration files" }, resolvePath);
    expect(prompt).toContain("--skill-path /cache/acme/skills/board-review/SKILL.md");
    expect(prompt).toContain("\n\nOperator note (from the human who launched this pane): focus on the migration files");
  });

  test("carries --re-review, doctor's tier, fix-classes, and draft-bin flags verbatim alongside --skill-path", async () => {
    const resolvePath = async () => "/cache/acme/attachments/board-doctor-api/SKILL.md";
    const opts = {
      mrUrl: "https://x/mr/1", statePath: "/s", statusBin: statusBinPath(),
      skill: "acme:board-doctor-api", tier: "api",
      fixClasses: ["retry-flake"], draftBin: draftBinPath(),
    };
    const prompt = await dispatchPrompt("board:doctor", opts, resolvePath);
    expect(prompt).toBe(
      `/board:doctor https://x/mr/1
  --state /s
  --status-bin ${statusBinPath()}
  --skill acme:board-doctor-api
  --skill-path /cache/acme/attachments/board-doctor-api/SKILL.md
  --tier api
  --fix-classes retry-flake
  --draft-bin ${draftBinPath()}`,
    );
  });

  test("re-review keeps --skill-path and --re-review both present", async () => {
    const resolvePath = async () => "/cache/acme/skills/board-review/SKILL.md";
    const prompt = await dispatchPrompt("board:review", { ...baseOpts, reReview: true }, resolvePath);
    expect(prompt).toContain("--skill-path /cache/acme/skills/board-review/SKILL.md\n  --re-review");
  });
});
