// src/__tests__/herdr.test.ts
import { describe, expect, test } from "bun:test";
import {
  findWorkspaceIdByLabel,
  parseTabCreate,
  parseWorkspaceCreate,
  reviewPrompt,
  buildPaneCommand,
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
  test("reviewPrompt is the slash command with args", () => {
    expect(reviewPrompt("https://x/mr/1", "/s/1.json"))
      .toBe("/mattstack:mr-board-review https://x/mr/1 --state /s/1.json");
  });
  test("buildPaneCommand cds then launches claude with a single-quoted prompt", () => {
    const cmd = buildPaneCommand("/repo dir", "https://x/mr/1", "/s/1.json");
    expect(cmd).toBe("cd '/repo dir' && claude '/mattstack:mr-board-review https://x/mr/1 --state /s/1.json'");
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
    expect(runCall?.[3]).toContain("claude '/mattstack:mr-board-review https://x/mr/1 --state /s/1.json'");
  });

  test("creates the reviews workspace when absent", async () => {
    const calls: string[][] = [];
    const runner: HerdrRunner = async (args) => {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list")
        return JSON.stringify({ result: { workspaces: [] } });
      if (args[0] === "workspace" && args[1] === "create") return WS_CREATE;
      if (args[0] === "tab" && args[1] === "create")
        return JSON.stringify({ result: { tab: { tab_id: "w41:t2", workspace_id: "w41" }, root_pane: { pane_id: "w41:p2" } } });
      return JSON.stringify({ result: { type: "ok" } });
    };
    const res = await launchReview(
      { mrUrl: "https://x/mr/2", iid: 42, cwd: "/repo", workspaceLabel: "reviews", statePath: "/s/2.json" },
      runner,
    );
    expect(res.workspaceId).toBe("w41");
    expect(calls).toContainEqual(["workspace", "create", "--label", "reviews", "--no-focus"]);
  });
});
