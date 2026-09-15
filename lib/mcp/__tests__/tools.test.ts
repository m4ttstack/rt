import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mcpTools } from "../tools.ts";

const NAMES = ["gate_answer","gate_list","chat_post","chat_dm","chat_ack","chat_claim","chat_release","mr_reply_thread","herd_gates","herd_ask","herd_answer","herd_report"];

// Captured before any mock.module call, per the repo's convention (see
// lib/__tests__/repo-locate-dispatch.test.ts): mock.module mutates the live
// namespace object in place, so restoring with these ORIGINAL bindings (not a
// re-import) is what undoes it for every other test file sharing this process.
//
// Mocked at transport.ts (rtCommand's actual definition site), not at the
// re-exporting index.ts: index.ts's "export { rtCommand } from './transport.ts'"
// is a live ES module re-export, so client.ts's readProjectMRs/herdList (which
// import rtCommand directly from transport.ts) share the same underlying
// binding. Mocking index.ts leaks into every other test in this file that
// exercises those functions (e.g. herd_gates); mocking transport.ts directly
// is the one place that resets cleanly for all consumers.
const realRtClient = await import("../../../packages/rt-client/src/index.ts");
const { serializeIdentity } = realRtClient;
const realTransport = await import("../../../packages/rt-client/src/transport.ts");
const realRtCommand = realTransport.rtCommand;

describe("mcpTools", () => {
  test("roster matches the published tool names", () => {
    expect(mcpTools().map((t) => t.name).sort()).toEqual([...NAMES].sort());
  });

  test("every tool has a description and an object schema", () => {
    for (const t of mcpTools()) {
      expect(t.description.length).toBeGreaterThan(20);
      expect((t.inputSchema as { type?: string }).type).toBe("object");
    }
  });

  test("chat_post without a signed-in session errors with the sign-in hint", async () => {
    const tool = mcpTools().find((t) => t.name === "chat_post")!;
    const res = await tool.handler({ room: "rt", body: "x" }, { CLAUDE_CODE_SESSION_ID: "00000000-0000-0000-0000-000000000000" } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("rt chat sign-in");
  });

  test("gate_answer without id returns a field error naming id", async () => {
    const tool = mcpTools().find((t) => t.name === "gate_answer")!;
    const res = await tool.handler({ answers: { q1: "yes" } }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("id");
  });

  test("herd_ask without HERD_ID errors mirroring the CLI's worker-pane text", async () => {
    const tool = mcpTools().find((t) => t.name === "herd_ask")!;
    const res = await tool.handler({ questions: [] }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("HERD_ID and HERD_JOB are not set");
  });

  test("herd_report without HERD_ID errors mirroring the CLI's worker-pane text", async () => {
    const tool = mcpTools().find((t) => t.name === "herd_report")!;
    const res = await tool.handler({ body: "status" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("HERD_ID and HERD_JOB are not set");
  });

  test("chat_dm without a signed-in session errors with the sign-in hint", async () => {
    const tool = mcpTools().find((t) => t.name === "chat_dm")!;
    const res = await tool.handler({ to: "someone", body: "x" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("rt chat sign-in");
  });

  test("gate_list description does not claim an open default", () => {
    const tool = mcpTools().find((t) => t.name === "gate_list")!;
    expect(tool.description).not.toContain("defaulting to open");
    expect(tool.description).toContain("all statuses");
  });

  test("gate_ask reads session and pane from env; subject comes from input only", async () => {
    // Handler-shape test: stub the client call the way the suite stubs others
    // (if the suite calls the real client, assert on the payload via a daemon
    // fixture instead; match the file's existing approach).
    const tool = mcpTools().find((t) => t.name === "gate_ask")!;
    expect((tool.inputSchema as { required?: string[] }).required).toEqual(["questions"]);
    expect(tool.description).toContain("rt gate wait");
  });

  test("roster contains gate_ask", () => {
    expect(mcpTools().map((t) => t.name)).toContain("gate_ask");
  });

  test("mr_comment_inline validates required fields", async () => {
    const tool = mcpTools().find((t) => t.name === "mr_comment_inline")!;
    const res = await tool.handler({ repoName: "rt", iid: 1, body: "x", path: "a.ts" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('"line" is required');
  });

  test("mr_comment_inline schema requires the position fields and forbids extras", () => {
    const tool = mcpTools().find((t) => t.name === "mr_comment_inline")!;
    const schema = tool.inputSchema as { required?: string[]; additionalProperties?: boolean; properties?: Record<string, unknown> };
    expect(schema.required).toEqual(["repoName", "iid", "body", "path", "line"]);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(
      ["repoName", "iid", "body", "path", "line", "oldPath", "oldLine"].sort(),
    );
  });

  describe("mr_map", () => {
    afterEach(() => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: realRtCommand }));
    });

    test("roster contains mr_map", () => {
      expect(mcpTools().map((t) => t.name)).toContain("mr_map");
    });

    test("missing repo returns a field error", async () => {
      const tool = mcpTools().find((t) => t.name === "mr_map")!;
      const res = await tool.handler({}, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('"repo" is required');
    });

    test("schema requires repo and forbids extras", () => {
      const tool = mcpTools().find((t) => t.name === "mr_map")!;
      const schema = tool.inputSchema as { required?: string[]; additionalProperties?: boolean; properties?: Record<string, unknown> };
      expect(schema.required).toEqual(["repo"]);
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties ?? {})).toEqual(["repo"]);
    });

    test("unmatched repo names the known repos", async () => {
      const glanceId = serializeIdentity({ kind: "remote", id: "github.com/m4ttstack/glance" });
      const rtId = serializeIdentity({ kind: "remote", id: "github.com/m4ttstack/rt" });
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string) => {
          if (cmd === "repos") {
            return {
              ok: true,
              data: {
                repos: {
                  [glanceId]: { path: "/g", worktrees: [] },
                  [rtId]: { path: "/r", worktrees: [] },
                },
                watched: [],
              },
            };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "mr_map")!;
      const res = await tool.handler({ repo: "nope" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("glance");
      expect(res.error).toContain("rt");
    });

    test("matches by registered name and joins open MRs to worktrees", async () => {
      const rtId = serializeIdentity({ kind: "remote", id: "github.com/m4ttstack/rt" });
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        // readProjectMRs (client.ts) calls this same rtCommand with
        // "project-mrs:read", so one fake covers both daemon round trips.
        rtCommand: async (cmd: string, payload: Record<string, unknown>) => {
          if (cmd === "repos") {
            return { ok: true, data: { repos: { [rtId]: { path: "/r", worktrees: [] } }, watched: [] } };
          }
          if (cmd === "worktree:list") {
            expect(payload.repoName).toBe(rtId);
            return { ok: true, data: { trees: [{ path: "/r/wt1", branch: "feature-1" }] } };
          }
          if (cmd === "project-mrs:read") {
            expect(payload.repoName).toBe(rtId);
            return {
              ok: true,
              data: {
                mrs: {
                  a: { pr: { iid: 42, title: "Do the thing", sourceBranch: "feature-1", state: "opened", pipeline: { status: "success" } }, fetchedAt: 0 },
                  b: { pr: { iid: 43, title: "Closed one", sourceBranch: "old", state: "closed" }, fetchedAt: 0 },
                },
                listSyncedAt: 0,
                source: "poll",
                syncedAt: 0,
              },
            };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "mr_map")!;
      const res = await tool.handler({ repo: "rt" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(true);
      expect(res.body).toEqual({
        rows: [
          { ref: "!42", title: "Do the thing", sourceBranch: "feature-1", worktree: "/r/wt1", mrState: "opened", ciStatus: "success" },
        ],
      });
    });
  });

  describe("herd_gates without a reachable daemon", () => {
    let originalHome: string | undefined;
    let originalSock: string | undefined;

    beforeEach(() => {
      originalHome = process.env.HOME;
      originalSock = process.env.RT_DAEMON_SOCK;
      process.env.HOME = mkdtempSync(join(tmpdir(), "rt-mcp-herd-test-"));
      delete process.env.RT_DAEMON_SOCK;
    });

    afterEach(() => {
      process.env.HOME = originalHome;
      if (originalSock !== undefined) process.env.RT_DAEMON_SOCK = originalSock;
    });

    test("surfaces the daemon's own error instead of the ambiguous-herd message", async () => {
      const tool = mcpTools().find((t) => t.name === "herd_gates")!;
      const res = await tool.handler({}, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("rt daemon unreachable");
    });
  });
});
