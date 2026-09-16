import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mcpTools } from "../tools.ts";
import { normalizeGateQuestions } from "../../../packages/rt-client/src/gate-options.ts";
import type { GateQuestion } from "../../../packages/rt-client/src/commands.ts";

const NAMES = ["gate_answer","gate_ask","gate_list","chat_post","chat_dm","chat_ack","chat_claim","chat_release","mr_reply_thread","mr_comment_inline","mr_map","herd_gates","herd_ask","herd_answer","herd_report"];

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

  test("roster has 15 tools", () => {
    expect(mcpTools().length).toBe(15);
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

  describe("gate_ask", () => {
    afterEach(() => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: realRtCommand }));
    });

    test("schema requires questions and description documents rt gate wait", () => {
      const tool = mcpTools().find((t) => t.name === "gate_ask")!;
      expect((tool.inputSchema as { required?: string[] }).required).toEqual(["questions"]);
      expect(tool.description).toContain("rt gate wait");
    });

    test("sessionId and paneId come from env; subject comes from input only, never RT_GATE_SUBJECT", async () => {
      let capturedPayload: Record<string, unknown> | undefined;
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string, payload: Record<string, unknown>) => {
          if (cmd === "gate:ask") {
            capturedPayload = payload;
            return { ok: true, data: { id: "g1", presentation: "form", subject: "input-subject" } };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "gate_ask")!;
      const env = {
        CLAUDE_CODE_SESSION_ID: "sess-1",
        HERDR_PANE_ID: "pane-1",
        RT_GATE_SUBJECT: "agent:should-be-ignored",
      } as NodeJS.ProcessEnv;
      const res = await tool.handler(
        { questions: [{ id: "q1", label: "Proceed?", multi: false, options: ["yes", "no"] }], subject: "input-subject" },
        env,
      );
      expect(res.ok).toBe(true);
      expect(capturedPayload?.sessionId).toBe("sess-1");
      expect(capturedPayload?.paneId).toBe("pane-1");
      expect(capturedPayload?.subject).toBe("input-subject");
      expect(Object.values(capturedPayload ?? {})).not.toContain("agent:should-be-ignored");
      expect(JSON.stringify(capturedPayload)).not.toContain("RT_GATE_SUBJECT");
    });

    test("with no input subject, RT_GATE_SUBJECT is still never read (contract C13)", async () => {
      let capturedPayload: Record<string, unknown> | undefined;
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string, payload: Record<string, unknown>) => {
          if (cmd === "gate:ask") {
            capturedPayload = payload;
            return { ok: true, data: { id: "g1", presentation: "form", subject: "daemon-resolved" } };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "gate_ask")!;
      const env = { RT_GATE_SUBJECT: "agent:should-be-ignored" } as NodeJS.ProcessEnv;
      const res = await tool.handler(
        { questions: [{ id: "q1", label: "Proceed?", multi: false, options: ["yes", "no"] }] },
        env,
      );
      expect(res.ok).toBe(true);
      expect(capturedPayload?.subject).toBeUndefined();
    });

    test("schema permits a recommended flag on an option object, and it survives to the payload the daemon normalizes", async () => {
      const optionSchema = (
        (tool: ReturnType<typeof mcpTools>[number]) =>
          (
            (tool.inputSchema as { properties: { questions: { items: { properties: { options: { items: { oneOf: unknown[] } } } } } } })
              .properties.questions.items.properties.options.items.oneOf[1] as { properties: { recommended?: unknown } }
          ).properties
      )(mcpTools().find((t) => t.name === "gate_ask")!);
      expect(optionSchema.recommended).toBeDefined();

      let capturedPayload: Record<string, unknown> | undefined;
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string, payload: Record<string, unknown>) => {
          if (cmd === "gate:ask") {
            capturedPayload = payload;
            return { ok: true, data: { id: "g1", presentation: "form", subject: "input-subject" } };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "gate_ask")!;
      const res = await tool.handler(
        { questions: [{ id: "q1", label: "Proceed?", multi: false, options: [{ value: "yes", label: "yes", recommended: true }] }] },
        {} as NodeJS.ProcessEnv,
      );
      expect(res.ok).toBe(true);
      const questions = capturedPayload?.questions as unknown as GateQuestion[];
      // Round-trip proof: the payload the tool actually sends, normalized by
      // the same function GatesStore.open runs in the real daemon.
      expect(normalizeGateQuestions(questions)).toEqual([
        { id: "q1", label: "Proceed?", multi: false, options: [{ value: "yes", label: "Yes (Recommended)" }] },
      ]);
    });
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

  test("every mr tool's repo-arg description names the serialized identity form", () => {
    const repoArgTools: Array<{ name: string; field: string }> = [
      { name: "mr_reply_thread", field: "repoName" },
      { name: "mr_comment_inline", field: "repoName" },
      { name: "mr_map", field: "repo" },
    ];
    for (const { name, field } of repoArgTools) {
      const tool = mcpTools().find((t) => t.name === name)!;
      const schema = tool.inputSchema as { properties?: Record<string, { description?: string }> };
      const fieldDescription = schema.properties?.[field]?.description ?? "";
      const text = `${tool.description} ${fieldDescription}`.toLowerCase();
      expect(text).toContain("serialized identity");
    }
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

    test("ambiguous repo label names all matching identities instead of picking one", async () => {
      const orgAId = serializeIdentity({ kind: "remote", id: "github.com/org-a/rt" });
      const orgBId = serializeIdentity({ kind: "remote", id: "gitlab.com/org-b/rt" });
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string) => {
          if (cmd === "repos") {
            return {
              ok: true,
              data: {
                repos: {
                  [orgAId]: { path: "/a", worktrees: [] },
                  [orgBId]: { path: "/b", worktrees: [] },
                },
                watched: [],
              },
            };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "mr_map")!;
      const res = await tool.handler({ repo: "rt" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain(orgAId);
      expect(res.error).toContain(orgBId);
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

  describe("gate_list", () => {
    afterEach(() => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: realRtCommand }));
    });

    test("schema includes cursor property for pagination", () => {
      const tool = mcpTools().find((t) => t.name === "gate_list")!;
      const schema = tool.inputSchema as { properties?: Record<string, unknown> };
      expect(schema.properties?.cursor).toEqual({ type: "number" });
    });

    test("description mentions continuation contract", () => {
      const tool = mcpTools().find((t) => t.name === "gate_list")!;
      const hasReference = tool.description.includes("cursor") || tool.description.includes("paging") || tool.description.includes("continuation");
      expect(hasReference).toBe(true);
    });

    test("forwards cursor to the payload", async () => {
      let capturedPayload: Record<string, unknown> | undefined;
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string, payload: Record<string, unknown>) => {
          if (cmd === "gate:list") {
            capturedPayload = payload;
            return { ok: true, data: { gates: [], cursor: 42 } };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "gate_list")!;
      const res = await tool.handler({ cursor: 10, limit: 5 }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(true);
      expect(capturedPayload?.cursor).toBe(10);
      expect(capturedPayload?.limit).toBe(5);
    });
  });

  describe("gate_answer rejection sentences", () => {
    afterEach(() => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: realRtCommand }));
    });

    test("owned-by rejection maps to ownership sentence", async () => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string) => {
          if (cmd === "gate:answer") {
            return { ok: false, error: "owned-by", owner: "alice" };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "gate_answer")!;
      const res = await tool.handler({ id: "g1", answers: { q1: "yes" } }, { CLAUDE_CODE_SESSION_ID: "sess-1" } as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("gate g1 is owned by alice");
      expect(res.error).toContain("override: true");
    });

    test("owned-by rejection without owner defaults to unknown", async () => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string) => {
          if (cmd === "gate:answer") {
            return { ok: false, error: "owned-by" };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "gate_answer")!;
      const res = await tool.handler({ id: "g1", answers: { q1: "yes" } }, { CLAUDE_CODE_SESSION_ID: "sess-1" } as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("owned by unknown");
    });

    test("gate-closed rejection with reason and supersededBy", async () => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string) => {
          if (cmd === "gate:answer") {
            return { ok: false, error: "gate-closed", reason: "already answered", supersededBy: "g2" };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "gate_answer")!;
      const res = await tool.handler({ id: "g1", answers: { q1: "yes" } }, { CLAUDE_CODE_SESSION_ID: "sess-1" } as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("gate g1 is closed (already answered)");
      expect(res.error).toContain("superseded by g2");
    });

    test("gate-closed rejection without supersededBy", async () => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string) => {
          if (cmd === "gate:answer") {
            return { ok: false, error: "gate-closed", reason: "expired" };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "gate_answer")!;
      const res = await tool.handler({ id: "g1", answers: { q1: "yes" } }, { CLAUDE_CODE_SESSION_ID: "sess-1" } as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("gate g1 is closed (expired)");
      expect(res.error).not.toContain("superseded");
    });

    test("gate-closed rejection without reason defaults to closed", async () => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string) => {
          if (cmd === "gate:answer") {
            return { ok: false, error: "gate-closed" };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "gate_answer")!;
      const res = await tool.handler({ id: "g1", answers: { q1: "yes" } }, { CLAUDE_CODE_SESSION_ID: "sess-1" } as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("gate g1 is closed (closed)");
    });
  });
});
