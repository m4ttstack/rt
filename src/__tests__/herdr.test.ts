// src/__tests__/herdr.test.ts
import { describe, expect, test } from "bun:test";
import {
  findWorkspaceIdByLabel,
  parseTabCreate,
  parseWorkspaceCreate,
  reviewPrompt,
  buildPaneCommand,
  buildResumePaneCommand,
  reReviewResumePrompt,
  mrTabLabel,
  launchReview,
  type HerdrRunner,
} from "../herdr.ts";

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
    { tab_id: "w40:t9", label: "!4821 Grace Hopper", workspace_id: "w40" },
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
      "/mr-board:review https://x/mr/1 --state /s/1.json --status-bin /b/review-status.ts --report /s/1.md --skill myteam:review",
    );
  });
  test("reviewPrompt omits the skill flag when unconfigured", () => {
    expect(
      reviewPrompt({ mrUrl: "https://x/mr/1", statePath: "/s/1.json", statusBin: "/b/review-status.ts", reportPath: "/s/1.md" }),
    ).toBe("/mr-board:review https://x/mr/1 --state /s/1.json --status-bin /b/review-status.ts --report /s/1.md");
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
      "/mr-board:review https://x/mr/1 --state /s/1.json --status-bin /b/review-status.ts --report /s/1.md",
    );
  });
  test("buildPaneCommand cds then launches claude with a single-quoted prompt", () => {
    const cmd = buildPaneCommand("/repo dir", "/mr-board:review https://x/mr/1 --state /s/1.json");
    expect(cmd).toBe("cd '/repo dir' && claude '/mr-board:review https://x/mr/1 --state /s/1.json'");
  });
  test("reviewPrompt appends --re-review when re-reviewing", () => {
    expect(
      reviewPrompt({ mrUrl: "https://x/mr/1", statePath: "/s/1.json", statusBin: "/b/review-status.ts", reportPath: "/s/1.md", reReview: true }),
    ).toBe("/mr-board:review https://x/mr/1 --state /s/1.json --status-bin /b/review-status.ts --report /s/1.md --re-review");
  });
  test("buildResumePaneCommand with no prompt drops into an interactive resume", () => {
    expect(buildResumePaneCommand("/repo", "sess-1")).toBe("cd '/repo' && claude --resume 'sess-1'");
  });
  test("buildResumePaneCommand with a prompt resumes and sends it as the first message", () => {
    expect(buildResumePaneCommand("/repo", "sess-1", "re-review please")).toBe(
      "cd '/repo' && claude --resume 'sess-1' 're-review please'",
    );
  });
  test("reReviewResumePrompt tells the session it's a re-review and to fall back", () => {
    const p = reReviewResumePrompt(4821);
    expect(p).toContain("RE-REVIEW of !4821");
    expect(p).toContain("no author action found since last review");
    expect(p).toContain("fall back to a");
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

describe("launchReview", () => {
  test("reuses an existing reviews workspace and creates a labelled tab", async () => {
    const calls: string[][] = [];
    const runner: HerdrRunner = async (args) => {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list") return WS_LIST;
      if (args[0] === "tab" && args[1] === "create") return TAB_CREATE;
      return JSON.stringify({ result: { type: "ok" } });
    };
    const res = await launchReview(
      { mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", workspaceLabel: "reviews", statePath: "/s/1.json" },
      runner,
    );
    expect(res).toEqual({ tabId: "w40:t3", workspaceId: "w40" });
    // No workspace create when one already exists.
    expect(calls.some((c) => c[0] === "workspace" && c[1] === "create")).toBe(false);
    // Tab created in the existing workspace, labelled with the iid.
    expect(calls).toContainEqual(["tab", "create", "--workspace", "w40", "--label", "!4821", "--no-focus"]);
    // The pane runs the review command.
    const runCall = calls.find((c) => c[0] === "pane" && c[1] === "run");
    expect(runCall?.[2]).toBe("w40:p7");
    expect(runCall?.[3]).toContain("claude '/mr-board:review https://x/mr/1 --state /s/1.json");
    expect(runCall?.[3]).toContain("bin/review-status.ts --report /s/1.md'");
  });

  test("puts the MR author beside the id in the tab label when given", async () => {
    const calls: string[][] = [];
    const runner: HerdrRunner = async (args) => {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list") return WS_LIST;
      if (args[0] === "tab" && args[1] === "create") return TAB_CREATE;
      return JSON.stringify({ result: { type: "ok" } });
    };
    await launchReview(
      { mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", workspaceLabel: "reviews", statePath: "/s/1.json", author: "Grace Hopper" },
      runner,
    );
    expect(calls).toContainEqual(["tab", "create", "--workspace", "w40", "--label", "!4821 Grace Hopper", "--no-focus"]);
  });

  test("dedup: a tab with the same label already open is focused, not duplicated", async () => {
    const calls: string[][] = [];
    const runner: HerdrRunner = async (args) => {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list") return WS_LIST;
      if (args[0] === "tab" && args[1] === "list") return TAB_LIST_WITH_DUP;
      return JSON.stringify({ result: { type: "ok" } });
    };
    const res = await launchReview(
      { mrUrl: "https://x/mr/1", iid: 4821, cwd: "/repo", workspaceLabel: "reviews", statePath: "/s/1.json", author: "Grace Hopper" },
      runner,
    );
    // Returns the existing tab, does not create a new one.
    expect(res).toEqual({ tabId: "w40:t9", workspaceId: "w40" });
    expect(calls.some((c) => c[0] === "tab" && c[1] === "create")).toBe(false);
    expect(calls).toContainEqual(["tab", "focus", "w40:t9"]);
    // And it does not re-run the pane command (would double-launch in the tab).
    expect(calls.some((c) => c[0] === "pane" && c[1] === "run")).toBe(false);
  });

  test("creates the reviews workspace when absent, reusing its initial tab (no blank tab)", async () => {
    const calls: string[][] = [];
    const runner: HerdrRunner = async (args) => {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list")
        return JSON.stringify({ result: { workspaces: [] } });
      if (args[0] === "workspace" && args[1] === "create") return WS_CREATE;
      return JSON.stringify({ result: { type: "ok" } });
    };
    const res = await launchReview(
      { mrUrl: "https://x/mr/2", iid: 42, cwd: "/repo", workspaceLabel: "reviews", statePath: "/s/2.json" },
      runner,
    );
    // Returns the workspace's initial tab/pane, not a second one.
    expect(res).toEqual({ tabId: "w41:t1", workspaceId: "w41" });
    expect(calls).toContainEqual(["workspace", "create", "--label", "reviews", "--no-focus"]);
    // No second tab is opened — the blank initial tab is reused, just renamed.
    expect(calls.some((c) => c[0] === "tab" && c[1] === "create")).toBe(false);
    expect(calls).toContainEqual(["tab", "rename", "w41:t1", "!42"]);
    // The review command runs in the initial pane.
    const runCall = calls.find((c) => c[0] === "pane" && c[1] === "run");
    expect(runCall?.[2]).toBe("w41:p1");
    expect(runCall?.[3]).toContain("claude '/mr-board:review https://x/mr/2 --state /s/2.json");
  });
});

import { doctorPrompt, draftBinPath, statusBinPath } from "../herdr.ts";

describe("doctorPrompt tier flags", () => {
  test("emits --tier, --fix-classes, and --draft-bin when given", () => {
    const p = doctorPrompt({
      mrUrl: "https://x/mr/1", statePath: "/s", statusBin: statusBinPath("doctor"),
      skill: "team:doctor-api", tier: "api", fixClasses: ["retry-flake", "inherited-note-draft"], draftBin: draftBinPath(),
    });
    expect(p).toContain("--tier api");
    expect(p).toContain("--fix-classes retry-flake,inherited-note-draft");
    expect(p).toContain(`--draft-bin ${draftBinPath()}`);
  });

  test("omits the flags when absent (manual path unchanged)", () => {
    const p = doctorPrompt({ mrUrl: "https://x/mr/1", statePath: "/s", statusBin: statusBinPath("doctor") });
    expect(p).not.toContain("--tier");
    expect(p).not.toContain("--fix-classes");
    expect(p).not.toContain("--draft-bin");
  });
});
