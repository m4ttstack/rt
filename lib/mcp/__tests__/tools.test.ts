import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mcpTools } from "../tools.ts";
import { normalizeGateQuestions } from "../../../packages/rt-client/src/gate-options.ts";
import type { GateQuestion } from "../../../packages/rt-client/src/commands.ts";
import { REPO_INDEX_NS } from "../../repo-index.ts";
import { closeStateDb, setKvValue } from "../../state/index.ts";

const NAMES = ["gate_answer","gate_ask","gate_list","chat_post","chat_dm","chat_ack","chat_claim","chat_release","mr_reply_thread","mr_comment_inline","mr_comment","mr_create","mr_approve","mr_resolve_thread","mr_ready","mr_retry","mr_rebase","mr_map","herd_gates","herd_ask","herd_answer","herd_report","rt_verb"];

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

  test("roster has 23 tools", () => {
    expect(mcpTools().length).toBe(23);
  });

  test("every tool has a description and a closed object schema", () => {
    for (const t of mcpTools()) {
      expect(t.description.length).toBeGreaterThan(20);
      expect((t.inputSchema as { type?: string }).type).toBe("object");
      expect((t.inputSchema as { additionalProperties?: unknown }).additionalProperties, t.name).toBe(false);
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

  test("gate_answer's object answer form accepts text beside note", () => {
    const tool = mcpTools().find((t) => t.name === "gate_answer")!;
    const schema = tool.inputSchema as {
      properties: { answers: { additionalProperties: { oneOf: Array<{ type: string; properties?: Record<string, unknown> }> } } };
    };
    const objectForm = schema.properties.answers.additionalProperties.oneOf.find((b) => b.type === "object")!;
    expect(Object.keys(objectForm.properties!)).toEqual(["value", "note", "text"]);
    expect(objectForm.properties!.text).toMatchObject({ type: "string", pattern: "\\S" });
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

    // A form gate told to background a wait never reaches the pane's form:
    // the wait is the wait branch only.
    test("description branches on the returned presentation: form asks in the pane, only wait backgrounds rt gate wait", () => {
      const tool = mcpTools().find((t) => t.name === "gate_ask")!;
      expect(tool.description).toContain("act on the returned presentation");
      expect(tool.description).toContain("form: ask it in the pane with AskUserQuestion");
      expect(tool.description).toContain("rt gate answer <id> --answers <json> --by pane");
      expect(tool.description).toContain("wait: run `rt gate wait <id>` as background bash and end the turn");
      expect(tool.description.indexOf("rt gate wait")).toBeGreaterThan(tool.description.indexOf("wait:"));
    });

    // RT-177: the description is where a caller learns not to self-censor the
    // context, which is what produced the bare form in the board.
    test("description tells callers to always pass context and that oversize is reported back", () => {
      const tool = mcpTools().find((t) => t.name === "gate_ask")!;
      expect(tool.description).toContain("contextOmitted");
      expect(tool.description.toLowerCase()).toContain("always");
    });

    // Contract pin: the daemon's field must not be filtered out of the body
    // on its way to the caller, which is the only place it can act on it.
    test("contextOmitted rides the tool result so the caller learns immediately", async () => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string) => {
          if (cmd === "gate:ask") {
            return { ok: true, data: { id: "g1", presentation: "form", subject: "mr:x", supersededId: null, contextOmitted: true } };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "gate_ask")!;
      const res = await tool.handler(
        { questions: [{ id: "q1", label: "Proceed?", multi: false, options: ["yes", "no"] }], subject: "mr:x", context: "x" },
        {} as NodeJS.ProcessEnv,
      );
      expect(res.ok).toBe(true);
      expect((res.body as { contextOmitted?: boolean }).contextOmitted).toBe(true);
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

    test("schema documents description on an option object and context on a question, and both survive normalization", async () => {
      const questionSchema = (
        mcpTools().find((t) => t.name === "gate_ask")!.inputSchema as {
          properties: { questions: { items: { properties: Record<string, { description?: string }> & { options: { items: { oneOf: unknown[] } } } } } };
        }
      ).properties.questions.items;
      expect(questionSchema.properties.context?.description).toMatch(/question/i);
      const optionObject = questionSchema.properties.options.items.oneOf[1] as { properties: Record<string, { description?: string }> };
      expect(optionObject.properties.description?.description).toMatch(/option/i);

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
        {
          questions: [{
            id: "q1", label: "Proceed?", multi: false, context: "what this one turns on",
            options: [{ value: "yes", label: "yes", description: "ship it" }],
          }],
        },
        {} as NodeJS.ProcessEnv,
      );
      expect(res.ok).toBe(true);
      const questions = capturedPayload?.questions as unknown as GateQuestion[];
      expect(normalizeGateQuestions(questions)).toEqual([
        { id: "q1", label: "Proceed?", multi: false, context: "what this one turns on", options: [{ value: "yes", label: "Yes", description: "ship it" }] },
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

  test("mr_comment_inline schema requires the position fields, offers mrUrl and forbids extras", () => {
    const tool = mcpTools().find((t) => t.name === "mr_comment_inline")!;
    const schema = tool.inputSchema as { required?: string[]; additionalProperties?: boolean; properties?: Record<string, unknown> };
    expect(schema.required).toEqual(["body", "path", "line"]);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(
      ["repoName", "iid", "mrUrl", "body", "path", "line", "oldPath", "oldLine"].sort(),
    );
  });

  test("every mr tool's repo-arg description names the serialized identity form", () => {
    const repoArgTools: Array<{ name: string; field: string }> = [
      { name: "mr_reply_thread", field: "repoName" },
      { name: "mr_comment_inline", field: "repoName" },
      { name: "mr_comment", field: "repoName" },
      { name: "mr_create", field: "repoName" },
      { name: "mr_approve", field: "repoName" },
      { name: "mr_resolve_thread", field: "repoName" },
      { name: "mr_ready", field: "repoName" },
      { name: "mr_retry", field: "repoName" },
      { name: "mr_rebase", field: "repoName" },
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

  test("mr_reply_thread's description says GitLab only and names an MR discussion thread", () => {
    const tool = mcpTools().find((t) => t.name === "mr_reply_thread")!;
    expect(tool.description.startsWith("GitLab only.")).toBe(true);
    expect(tool.description).toContain("MR discussion thread");
    expect(tool.description).not.toContain("merge or pull request discussion thread");
  });

  describe("mr write tools: mr_comment, mr_create", () => {
    afterEach(() => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: realRtCommand }));
    });

    function fakeDaemon(reply: (cmd: string, payload: Record<string, unknown>) => unknown) {
      const calls: Array<{ cmd: string; payload: Record<string, unknown>; timeoutMs?: number }> = [];
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string, payload: Record<string, unknown>, opts?: { timeoutMs?: number }) => {
          calls.push({ cmd, payload, timeoutMs: opts?.timeoutMs });
          return reply(cmd, payload);
        },
      }));
      return calls;
    }

    const COMMENT_DATA = { noteId: 1, discussionId: "d1", resolvable: true, url: "u#note_1", mrUrl: "u" };

    test("mr_comment schema requires only body and offers the target props and resolvable", () => {
      const schema = mcpTools().find((t) => t.name === "mr_comment")!.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
      expect(schema.required).toEqual(["body"]);
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["body", "iid", "mrUrl", "repoName", "resolvable"]);
    });

    test("mr_comment sends mr:comment with the write timeout and returns the daemon's data", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: COMMENT_DATA }));
      const tool = mcpTools().find((t) => t.name === "mr_comment")!;
      const res = await tool.handler({ repoName: "remote:x", iid: 7, body: "hi" }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: true, body: COMMENT_DATA });
      expect(calls).toEqual([{ cmd: "mr:comment", payload: { repoName: "remote:x", iid: 7, body: "hi" }, timeoutMs: 30_000 }]);
    });

    test("mr_comment forwards resolvable:false", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: COMMENT_DATA }));
      const tool = mcpTools().find((t) => t.name === "mr_comment")!;
      await tool.handler({ repoName: "remote:x", iid: 7, body: "hi", resolvable: false }, {} as NodeJS.ProcessEnv);
      expect(calls[0]!.payload.resolvable).toBe(false);
    });

    test("mr_comment refuses a string resolvable before calling the daemon", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: COMMENT_DATA }));
      const tool = mcpTools().find((t) => t.name === "mr_comment")!;
      const res = await tool.handler({ repoName: "remote:x", iid: 7, body: "hi", resolvable: "false" }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: false, body: undefined, error: '"resolvable" must be a boolean' });
      expect(calls).toEqual([]);
    });

    test("a timed-out mr_comment says the note may still land and where to check", async () => {
      fakeDaemon(() => ({ ok: false, error: "rt daemon unreachable at /x.sock: The operation timed out." }));
      const tool = mcpTools().find((t) => t.name === "mr_comment")!;
      const res = await tool.handler({ repoName: "remote:x", iid: 7, body: "hi" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("may still land");
      expect(res.error).toContain("discussions");
    });

    test("a gateway-timeout mr_comment error also gets the landing hint", async () => {
      fakeDaemon(() => ({ ok: false, error: "createDiscussion failed: 504 Gateway Timeout" }));
      const tool = mcpTools().find((t) => t.name === "mr_comment")!;
      const res = await tool.handler({ repoName: "remote:x", iid: 7, body: "hi" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("may still land");
    });

    test("a daemon error that is not a timeout passes through without the landing hint", async () => {
      fakeDaemon(() => ({ ok: false, error: "no gitlabToken in secrets" }));
      const tool = mcpTools().find((t) => t.name === "mr_comment")!;
      const res = await tool.handler({ repoName: "remote:x", iid: 7, body: "hi" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe("no gitlabToken in secrets");
    });

    test("mr_create schema requires the branches and title, offers repoName and mrUrl, and has no iid", () => {
      const schema = mcpTools().find((t) => t.name === "mr_create")!.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
      expect(schema.required).toEqual(["sourceBranch", "targetBranch", "title"]);
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["description", "draft", "mrUrl", "repoName", "sourceBranch", "targetBranch", "title"]);
    });

    test("mr_create sends mr:create, leaving draft to the daemon default when omitted", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: { iid: 12, url: "u" } }));
      const tool = mcpTools().find((t) => t.name === "mr_create")!;
      const res = await tool.handler({ repoName: "remote:x", sourceBranch: "feat", targetBranch: "main", title: "T" }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: true, body: { iid: 12, url: "u" } });
      expect(calls).toEqual([{ cmd: "mr:create", payload: { repoName: "remote:x", sourceBranch: "feat", targetBranch: "main", title: "T" }, timeoutMs: 30_000 }]);
    });

    test("mr_create refuses a string draft before calling the daemon", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: { iid: 12, url: "u" } }));
      const tool = mcpTools().find((t) => t.name === "mr_create")!;
      const res = await tool.handler({ repoName: "remote:x", sourceBranch: "feat", targetBranch: "main", title: "T", draft: "true" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe('"draft" must be a boolean');
      expect(calls).toEqual([]);
    });

    test("a timed-out mr_create says the MR may still land and to check mr_map", async () => {
      fakeDaemon(() => ({ ok: false, error: "rt daemon unreachable at /x.sock: The operation timed out." }));
      const tool = mcpTools().find((t) => t.name === "mr_create")!;
      const res = await tool.handler({ repoName: "remote:x", sourceBranch: "feat", targetBranch: "main", title: "T" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toContain("may still land");
      expect(res.error).toContain("mr_map");
    });
  });

  describe("mr state tools over mr:action and discussions:resolve", () => {
    afterEach(() => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: realRtCommand }));
    });

    function fakeDaemon(reply: (cmd: string) => unknown = () => ({ ok: true })) {
      const calls: Array<{ cmd: string; payload: Record<string, unknown>; timeoutMs?: number }> = [];
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string, payload: Record<string, unknown>, opts?: { timeoutMs?: number }) => {
          calls.push({ cmd, payload, timeoutMs: opts?.timeoutMs });
          return reply(cmd);
        },
      }));
      return calls;
    }

    const T = { repoName: "remote:x", iid: 7 };
    const cases: Array<{ tool: string; input: Record<string, unknown>; action: string; args: unknown[]; body: unknown }> = [
      { tool: "mr_approve", input: {}, action: "approve", args: [], body: { approved: true } },
      { tool: "mr_approve", input: { approved: false }, action: "unapprove", args: [], body: { approved: false } },
      { tool: "mr_ready", input: {}, action: "toggleDraft", args: [false], body: { ready: true } },
      { tool: "mr_ready", input: { ready: false }, action: "toggleDraft", args: [true], body: { ready: false } },
      { tool: "mr_retry", input: { jobId: 812 }, action: "retryJob", args: [812], body: { jobId: 812 } },
      { tool: "mr_retry", input: { pipelineId: 555 }, action: "retryPipeline", args: [555], body: { pipelineId: 555 } },
      { tool: "mr_rebase", input: {}, action: "rebase", args: [], body: { rebased: true } },
    ];

    for (const c of cases) {
      test(`${c.tool} ${JSON.stringify(c.input)} sends mr:action ${c.action} ${JSON.stringify(c.args)}`, async () => {
        const calls = fakeDaemon();
        const tool = mcpTools().find((t) => t.name === c.tool)!;
        const res = await tool.handler({ ...T, ...c.input }, {} as NodeJS.ProcessEnv);
        expect(res).toEqual({ ok: true, body: c.body });
        expect(calls).toEqual([{ cmd: "mr:action", payload: { ...T, action: c.action, args: c.args }, timeoutMs: 30_000 }]);
      });
    }

    for (const [tool, field] of [["mr_approve", "approved"], ["mr_ready", "ready"], ["mr_resolve_thread", "resolved"]] as const) {
      test(`${tool} refuses ${field}: "false" before calling the daemon`, async () => {
        const calls = fakeDaemon();
        const t = mcpTools().find((x) => x.name === tool)!;
        const res = await t.handler({ ...T, discussionId: "d1", [field]: "false" }, {} as NodeJS.ProcessEnv);
        expect(res.error).toBe(`"${field}" must be a boolean`);
        expect(calls).toEqual([]);
      });
    }

    test("mr_retry refuses both ids and neither id before calling the daemon", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_retry")!;
      const both = await tool.handler({ ...T, jobId: 1, pipelineId: 2 }, {} as NodeJS.ProcessEnv);
      const neither = await tool.handler({ ...T }, {} as NodeJS.ProcessEnv);
      expect(both.error).toBe('pass exactly one of "jobId" or "pipelineId"');
      expect(neither.error).toBe('pass exactly one of "jobId" or "pipelineId"');
      expect(calls).toEqual([]);
    });

    test("mr_retry refuses a string jobId", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_retry")!;
      const res = await tool.handler({ ...T, jobId: "812" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe('"jobId" must be a number');
      expect(calls).toEqual([]);
    });

    test("mr_approve refuses a non-positive-integer iid", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_approve")!;
      const zero = await tool.handler({ repoName: "remote:x", iid: 0 }, {} as NodeJS.ProcessEnv);
      const fractional = await tool.handler({ repoName: "remote:x", iid: 1.5 }, {} as NodeJS.ProcessEnv);
      expect(zero.error).toBe('"iid" must be a positive integer');
      expect(fractional.error).toBe('"iid" must be a positive integer');
      expect(calls).toEqual([]);
    });

    test("mr_retry refuses a negative jobId", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_retry")!;
      const res = await tool.handler({ ...T, jobId: -1 }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe('"jobId" must be a positive integer');
      expect(calls).toEqual([]);
    });

    test("an mr:action daemon error is explained, not returned as a bare code", async () => {
      fakeDaemon(() => ({ ok: false, error: "repo-unknown" }));
      const tool = mcpTools().find((t) => t.name === "mr_approve")!;
      const res = await tool.handler({ ...T }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).not.toBe("repo-unknown");
      expect(res.error).toContain("unknown repo");
    });

    test("mr_resolve_thread resolves by default and returns a compact body, not the discussions list", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: { discussions: [{ id: "d1" }], fetchedAt: 1 } }));
      const tool = mcpTools().find((t) => t.name === "mr_resolve_thread")!;
      const res = await tool.handler({ ...T, discussionId: "d1" }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: true, body: { discussionId: "d1", resolved: true } });
      expect(calls).toEqual([{ cmd: "discussions:resolve", payload: { ...T, discussionId: "d1", resolved: true }, timeoutMs: 30_000 }]);
    });

    test("mr_resolve_thread resolved:false unresolves", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: { discussions: [], fetchedAt: 1 } }));
      const tool = mcpTools().find((t) => t.name === "mr_resolve_thread")!;
      const res = await tool.handler({ ...T, discussionId: "d1", resolved: false }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: true, body: { discussionId: "d1", resolved: false } });
      expect(calls[0]!.payload.resolved).toBe(false);
    });
  });

  describe("mr target resolution wiring", () => {
    const APP = "remote:gitlab.example.com%2Facme%2Fapp";
    const SUB = "remote:gitlab.example.com%2Facme%2Fplatform%2Fapp";
    const origHome = process.env.HOME;
    let home: string;

    beforeEach(() => {
      home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mcp-target-")));
      process.env.HOME = home;
      closeStateDb();
    });

    afterEach(() => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: realRtCommand }));
      process.env.HOME = origHome;
      closeStateDb();
      rmSync(home, { recursive: true, force: true });
    });

    function fakeDaemon(reply: (cmd: string) => unknown = () => ({ ok: true })) {
      const calls: Array<{ cmd: string; payload: Record<string, unknown>; timeoutMs?: number }> = [];
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string, payload: Record<string, unknown>, opts?: { timeoutMs?: number }) => {
          calls.push({ cmd, payload, timeoutMs: opts?.timeoutMs });
          return reply(cmd);
        },
      }));
      return calls;
    }

    test("a repo label resolves to the registered identity before the daemon call", async () => {
      setKvValue(REPO_INDEX_NS, APP, "/repos/app");
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_approve")!;
      const res = await tool.handler({ repoName: "app", iid: 7 }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: true, body: { approved: true } });
      expect(calls).toEqual([{ cmd: "mr:action", payload: { repoName: APP, iid: 7, action: "approve", args: [] }, timeoutMs: 30_000 }]);
    });

    test("mrUrl alone targets a registered repo and supplies iid", async () => {
      setKvValue(REPO_INDEX_NS, APP, "/repos/app");
      const calls = fakeDaemon(() => ({ ok: true, data: { noteId: 1, discussionId: "d1", resolvable: true, url: "u", mrUrl: "m" } }));
      const tool = mcpTools().find((t) => t.name === "mr_comment")!;
      const res = await tool.handler({ mrUrl: "https://gitlab.example.com/acme/app/-/merge_requests/7/diffs#note_1", body: "hi" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(true);
      expect(calls[0]!.payload).toEqual({ repoName: APP, iid: 7, body: "hi" });
    });

    test("mr_create takes the repo from mrUrl and sends no iid", async () => {
      setKvValue(REPO_INDEX_NS, APP, "/repos/app");
      const calls = fakeDaemon(() => ({ ok: true, data: { iid: 12, url: "u" } }));
      const tool = mcpTools().find((t) => t.name === "mr_create")!;
      await tool.handler({ mrUrl: "https://gitlab.example.com/acme/app/-/merge_requests/7", sourceBranch: "feat", targetBranch: "main", title: "T" }, {} as NodeJS.ProcessEnv);
      expect(calls[0]!.payload).toEqual({ repoName: APP, sourceBranch: "feat", targetBranch: "main", title: "T" });
    });

    test("an mrUrl for a repo rt has not registered is refused with no daemon call", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_ready")!;
      const res = await tool.handler({ mrUrl: "https://gitlab.example.com/acme/app/-/merge_requests/7" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("not registered with rt");
      expect(res.error).toContain(APP);
      expect(calls).toEqual([]);
    });

    test("repoName and mrUrl that disagree are refused with no daemon call", async () => {
      setKvValue(REPO_INDEX_NS, APP, "/repos/app");
      setKvValue(REPO_INDEX_NS, SUB, "/repos/sub");
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_rebase")!;
      const res = await tool.handler({ repoName: SUB, mrUrl: "https://gitlab.example.com/acme/app/-/merge_requests/7" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe(`repoName resolves to ${SUB} but mrUrl names ${APP}; pass one of them, or make them agree`);
      expect(calls).toEqual([]);
    });

    test("a tool given neither repoName nor mrUrl is refused with no daemon call", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_rebase")!;
      const res = await tool.handler({}, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe('pass "repoName" or "mrUrl"');
      expect(calls).toEqual([]);
    });

    test("non-target input errors come before any resolution", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_reply_thread")!;
      const res = await tool.handler({ mrUrl: "https://gitlab.example.com/acme/app/-/merge_requests/7", discussionId: "d1" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe('"body" is required');
      expect(calls).toEqual([]);
    });

    test("every MR-level write tool offers repoName, iid and mrUrl with none required; mr_create offers repoName and mrUrl", () => {
      for (const name of ["mr_reply_thread", "mr_comment_inline", "mr_comment", "mr_approve", "mr_resolve_thread", "mr_ready", "mr_retry", "mr_rebase"]) {
        const schema = mcpTools().find((t) => t.name === name)!.inputSchema as { properties: Record<string, unknown>; required?: string[] };
        expect(Object.keys(schema.properties), name).toEqual(expect.arrayContaining(["repoName", "iid", "mrUrl"]));
        expect(schema.required ?? [], name).not.toContain("repoName");
        expect(schema.required ?? [], name).not.toContain("iid");
      }
      const create = mcpTools().find((t) => t.name === "mr_create")!.inputSchema as { properties: Record<string, unknown>; required?: string[] };
      expect(Object.keys(create.properties)).toEqual(expect.arrayContaining(["repoName", "mrUrl"]));
      expect(create.properties.iid).toBeUndefined();
      expect(create.required).not.toContain("repoName");
    });
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

    test("heal-pair rows (legacy name key + identity key at the same path) collapse instead of reading ambiguous", async () => {
      const rtId = serializeIdentity({ kind: "remote", id: "github.com/m4ttstack/rt" });
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string, payload: Record<string, unknown>) => {
          if (cmd === "repos") {
            return {
              ok: true,
              data: {
                repos: {
                  rt: { path: "/same/path", worktrees: [] },
                  [rtId]: { path: "/same/path", worktrees: [] },
                },
                watched: [],
              },
            };
          }
          if (cmd === "worktree:list") {
            expect(payload.repoName).toBe(rtId);
            return { ok: true, data: { trees: [] } };
          }
          if (cmd === "project-mrs:read") {
            expect(payload.repoName).toBe(rtId);
            return { ok: true, data: { mrs: {}, listSyncedAt: 0, source: "poll", syncedAt: 0 } };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "mr_map")!;
      const res = await tool.handler({ repo: "rt" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(true);
      expect(res.body).toEqual({ rows: [] });
    });

    test("a raw daemon error code from worktree:list is explained instead of returned bare", async () => {
      const rtId = serializeIdentity({ kind: "remote", id: "github.com/m4ttstack/rt" });
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string) => {
          if (cmd === "repos") {
            return { ok: true, data: { repos: { [rtId]: { path: "/r", worktrees: [] } }, watched: [] } };
          }
          if (cmd === "worktree:list") {
            return { ok: false, error: "repo-unknown" };
          }
          if (cmd === "project-mrs:read") {
            return { ok: true, data: { mrs: {}, listSyncedAt: 0, source: "poll", syncedAt: 0 } };
          }
          throw new Error(`unexpected rtCommand("${cmd}")`);
        },
      }));
      const tool = mcpTools().find((t) => t.name === "mr_map")!;
      const res = await tool.handler({ repo: "rt" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).not.toBe("repo-unknown");
      expect(res.error).toContain("unknown repo");
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
