import { describe, expect, test } from "bun:test";
import { buildRelocationAnnouncement, parseHookStdin } from "../worktree-hook.ts";

const hook = (tool: string, input: Record<string, unknown>) => JSON.stringify({ session_id: "s1", cwd: "/repo", hook_event_name: "PreToolUse", tool_name: tool, tool_input: input });

describe("buildRelocationAnnouncement", () => {
  test("EnterWorktree by path carries the path, session, cwd and pane", () => {
    expect(buildRelocationAnnouncement(hook("EnterWorktree", { path: "/pool/t1" }), { HERDR_PANE_ID: "7" } as NodeJS.ProcessEnv))
      .toEqual({ sessionId: "s1", paneId: "7", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" });
  });
  test("EnterWorktree by name carries no path", () => {
    expect(buildRelocationAnnouncement(hook("EnterWorktree", { name: "rt-326" }), {} as NodeJS.ProcessEnv))
      .toEqual({ sessionId: "s1", tool: "EnterWorktree", cwd: "/repo" });
  });
  test("ExitWorktree yields null", () => {
    expect(buildRelocationAnnouncement(hook("ExitWorktree", {}), {} as NodeJS.ProcessEnv)).toBeNull();
  });
  test("another tool, no session, or bad JSON is null", () => {
    expect(buildRelocationAnnouncement(hook("Bash", { command: "ls" }), {} as NodeJS.ProcessEnv)).toBeNull();
    expect(buildRelocationAnnouncement(JSON.stringify({ tool_name: "EnterWorktree", tool_input: {}, cwd: "/r" }), {} as NodeJS.ProcessEnv)).toBeNull();
    expect(buildRelocationAnnouncement("{not json", {} as NodeJS.ProcessEnv)).toBeNull();
    expect(buildRelocationAnnouncement("", {} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("parseHookStdin keeps the session for the provisioned-path announcement", () => {
  test("WorktreeCreate carries session_id when present", () => {
    expect(parseHookStdin(JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: "/repo", name: "rt-326", session_id: "s1" })))
      .toEqual({ event: "create", cwd: "/repo", name: "rt-326", sessionId: "s1" });
    expect(parseHookStdin(JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: "/repo", name: "rt-326" })))
      .toEqual({ event: "create", cwd: "/repo", name: "rt-326" });
  });
});
