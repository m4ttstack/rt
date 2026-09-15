/**
 * The MCP tool roster: one McpToolDef per tool, each a thin wrapper over an
 * existing daemon command. No MCP SDK import here, and no import of
 * commands/herd.ts or commands/chat.ts (both pull in TUI-adjacent modules
 * that lib/mcp must stay clear of).
 */
import {
  chatAck, chatClaim, chatDm, chatPost, chatRelease,
  gateAnswer, gateList,
  herdAnswer, herdAsk, herdGates, herdList, herdReport,
  rtCommand,
} from "../../packages/rt-client/src/index.ts";
import type { Commands, GateQuestion, RtResponse } from "../../packages/rt-client/src/index.ts";
import { readChatSession } from "../chat-session.ts";

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(input: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; body: unknown; error?: string }>;
}

type ToolResult = { ok: boolean; body: unknown; error?: string };

function ok(body: unknown): ToolResult {
  return { ok: true, body };
}

function err(message: string): ToolResult {
  return { ok: false, body: undefined, error: message };
}

function fromResponse<T>(res: RtResponse<T>): ToolResult {
  return res.ok ? ok(res.data) : err(res.error ?? "request failed");
}

type FieldType = "string" | "number" | "boolean" | "object" | "array";

/** The server does not validate input against inputSchema, so a wrong-shaped
    required field must return an error rather than throw. */
function checkRequired(input: Record<string, unknown>, fields: Array<{ name: string; type: FieldType }>): string | undefined {
  for (const f of fields) {
    const v = input[f.name];
    if (v === undefined || v === null) return `"${f.name}" is required`;
    if (f.type === "array" && !Array.isArray(v)) return `"${f.name}" must be an array`;
    else if (f.type === "object" && (typeof v !== "object" || Array.isArray(v))) return `"${f.name}" must be an object`;
    else if ((f.type === "string" || f.type === "number" || f.type === "boolean") && typeof v !== f.type) return `"${f.name}" must be a ${f.type}`;
  }
  return undefined;
}

const SIGN_IN_HINT = "no signed-in chat session for this pane; run `rt chat sign-in` in bash first";

/** No derived-handle fallback: a tool call with no session file is a hard error, unlike the CLI's resolveHandle. */
function requireChatHandle(env: NodeJS.ProcessEnv): { handle: string } | { error: string } {
  const session = readChatSession(env.CLAUDE_CODE_SESSION_ID);
  if (!session) return { error: SIGN_IN_HINT };
  return { handle: session.handle };
}

const HERD_ENV_ERROR = "HERD_ID and HERD_JOB are not set; this verb runs inside a herd worker pane";

function requireJobEnv(env: NodeJS.ProcessEnv): { herd: string; job: string } | { error: string } {
  const herd = env.HERD_ID, job = env.HERD_JOB;
  if (!herd || !job) return { error: HERD_ENV_ERROR };
  return { herd, job };
}

function requireWorkerEnv(env: NodeJS.ProcessEnv): { herd: string; job: string; session: string; pane?: string } | { error: string } {
  const j = requireJobEnv(env);
  if ("error" in j) return j;
  const session = env.CLAUDE_CODE_SESSION_ID;
  if (!session) return { error: "CLAUDE_CODE_SESSION_ID is not set; this verb runs inside a Claude Code session" };
  return { ...j, session, ...(env.HERDR_PANE_ID && { pane: env.HERDR_PANE_ID }) };
}

/** Mirrors herd.ts's soleHerdId without importing it (that module pulls in lib/repo-arg.ts). */
async function resolveSoleHerd(): Promise<{ herd: string } | { error: string }> {
  const res = await herdList({});
  if (!res.ok) return { error: res.error ?? "rt daemon unreachable" };
  const herds = res.data?.herds ?? [];
  if (herds.length === 0) return { error: "no herds are active (rt herd list shows the herds)" };
  if (herds.length === 1) return { herd: herds[0]!.id };
  return { error: "more than one herd is active (rt herd list shows the herds)" };
}

const ANSWER_VALUE_SCHEMA = {
  oneOf: [
    { type: "string" },
    { type: "array", items: { type: "string" } },
    {
      type: "object",
      properties: {
        value: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
        note: { type: "string" },
      },
      required: ["value"],
      additionalProperties: false,
    },
  ],
};

const GATE_OPTION_SCHEMA = {
  oneOf: [
    { type: "string" },
    {
      type: "object",
      properties: { value: { type: "string" }, label: { type: "string" } },
      required: ["value", "label"],
      additionalProperties: false,
    },
  ],
};

const GATE_QUESTION_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    multi: { type: "boolean" },
    options: { type: "array", items: GATE_OPTION_SCHEMA },
  },
  required: ["id", "label", "multi", "options"],
  additionalProperties: false,
};

export function mcpTools(): McpToolDef[] {
  return [
    {
      name: "gate_answer",
      description: "Answer an open gate's questions as this pane. Answer values must be option VALUES verbatim; nuance goes in {value, note}.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          answers: { type: "object", additionalProperties: ANSWER_VALUE_SCHEMA },
          override: { type: "boolean" },
        },
        required: ["id", "answers"],
        additionalProperties: false,
      },
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "id", type: "string" }, { name: "answers", type: "object" }]);
        if (bad) return err(bad);
        const payload: Commands["gate:answer"]["payload"] = {
          id: input.id as string,
          answers: input.answers as Commands["gate:answer"]["payload"]["answers"],
          by: "pane",
          session: env.CLAUDE_CODE_SESSION_ID,
        };
        if (input.override !== undefined) payload.override = input.override as boolean;
        return fromResponse(await gateAnswer(payload));
      },
    },
    {
      name: "gate_list",
      description: "List gates in all statuses unless open is true, optionally filtered by subject prefix or kind and capped by limit.",
      inputSchema: {
        type: "object",
        properties: {
          open: { type: "boolean" },
          subjectPrefix: { type: "string" },
          kind: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      async handler(input) {
        const payload: Commands["gate:list"]["payload"] = {};
        if (input.open !== undefined) payload.open = input.open as boolean;
        if (input.subjectPrefix !== undefined) payload.subjectPrefix = input.subjectPrefix as string;
        if (input.kind !== undefined) payload.kind = input.kind as string;
        if (input.limit !== undefined) payload.limit = input.limit as number;
        return fromResponse(await gateList(payload));
      },
    },
    {
      name: "chat_post",
      description: "Post a message to an rt chat room as the signed-in handle. Requires a signed-in chat session; run `rt chat sign-in` in bash first.",
      inputSchema: {
        type: "object",
        properties: {
          room: { type: "string" },
          body: { type: "string" },
          mentions: { type: "array", items: { type: "string" } },
          quiet: { type: "boolean" },
        },
        required: ["room", "body"],
        additionalProperties: false,
      },
      async handler(input, env) {
        const identity = requireChatHandle(env);
        if ("error" in identity) return err(identity.error);
        const bad = checkRequired(input, [{ name: "room", type: "string" }, { name: "body", type: "string" }]);
        if (bad) return err(bad);
        const payload: Commands["chat:post"]["payload"] = { room: input.room as string, handle: identity.handle, body: input.body as string };
        if (input.mentions !== undefined) payload.mentions = input.mentions as string[];
        if (input.quiet !== undefined) payload.quiet = input.quiet as boolean;
        return fromResponse(await chatPost(payload));
      },
    },
    {
      name: "chat_dm",
      description: "Send a direct message to another rt chat handle. Requires a signed-in chat session; run `rt chat sign-in` in bash first.",
      inputSchema: {
        type: "object",
        properties: { to: { type: "string" }, body: { type: "string" } },
        required: ["to", "body"],
        additionalProperties: false,
      },
      async handler(input, env) {
        const identity = requireChatHandle(env);
        if ("error" in identity) return err(identity.error);
        const bad = checkRequired(input, [{ name: "to", type: "string" }, { name: "body", type: "string" }]);
        if (bad) return err(bad);
        return fromResponse(await chatDm({ from: identity.handle, to: input.to as string, body: input.body as string, sessionId: env.CLAUDE_CODE_SESSION_ID }));
      },
    },
    {
      name: "chat_ack",
      description: "Acknowledge a chat message by id as the signed-in handle. Requires a signed-in chat session; run `rt chat sign-in` in bash first.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
        additionalProperties: false,
      },
      async handler(input, env) {
        const identity = requireChatHandle(env);
        if ("error" in identity) return err(identity.error);
        const bad = checkRequired(input, [{ name: "id", type: "number" }]);
        if (bad) return err(bad);
        return fromResponse(await chatAck({ id: input.id as number, handle: identity.handle }));
      },
    },
    {
      name: "chat_claim",
      description: "Claim a chat message by id so other agents skip answering it. Requires a signed-in chat session; run `rt chat sign-in` in bash first.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
        additionalProperties: false,
      },
      async handler(input, env) {
        const identity = requireChatHandle(env);
        if ("error" in identity) return err(identity.error);
        const bad = checkRequired(input, [{ name: "id", type: "number" }]);
        if (bad) return err(bad);
        return fromResponse(await chatClaim({ id: input.id as number, handle: identity.handle }));
      },
    },
    {
      name: "chat_release",
      description: "Release a previously claimed chat message by id. Requires a signed-in chat session; run `rt chat sign-in` in bash first.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
        additionalProperties: false,
      },
      async handler(input, env) {
        const identity = requireChatHandle(env);
        if ("error" in identity) return err(identity.error);
        const bad = checkRequired(input, [{ name: "id", type: "number" }]);
        if (bad) return err(bad);
        return fromResponse(await chatRelease({ id: input.id as number, handle: identity.handle }));
      },
    },
    {
      name: "mr_reply_thread",
      description: "Reply to an existing merge or pull request discussion thread on the given repo and IID.",
      inputSchema: {
        type: "object",
        properties: {
          repoName: { type: "string" },
          iid: { type: "number" },
          discussionId: { type: "string" },
          body: { type: "string" },
        },
        required: ["repoName", "iid", "discussionId", "body"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [
          { name: "repoName", type: "string" },
          { name: "iid", type: "number" },
          { name: "discussionId", type: "string" },
          { name: "body", type: "string" },
        ]);
        if (bad) return err(bad);
        const res = await rtCommand<Commands["discussions:reply"]["data"]>("discussions:reply", {
          repoName: input.repoName as string,
          iid: input.iid as number,
          discussionId: input.discussionId as string,
          body: input.body as string,
        });
        return fromResponse(res);
      },
    },
    {
      name: "herd_gates",
      description: "List a herd's open gates, defaulting to HERD_ID or the sole active herd when herd is omitted.",
      inputSchema: {
        type: "object",
        properties: { herd: { type: "string" } },
        additionalProperties: false,
      },
      async handler(input, env) {
        const explicit = (input.herd as string | undefined) ?? env.HERD_ID;
        if (explicit) return fromResponse(await herdGates({ herd: explicit }));
        const resolved = await resolveSoleHerd();
        if ("error" in resolved) return err(resolved.error);
        return fromResponse(await herdGates({ herd: resolved.herd }));
      },
    },
    {
      name: "herd_ask",
      description: "Open a gate asking the herd operator one or more questions, using this worker pane's herd, job, and session identity.",
      inputSchema: {
        type: "object",
        properties: {
          questions: { type: "array", items: GATE_QUESTION_SCHEMA },
          context: { type: "string" },
        },
        required: ["questions"],
        additionalProperties: false,
      },
      async handler(input, env) {
        const w = requireWorkerEnv(env);
        if ("error" in w) return err(w.error);
        const bad = checkRequired(input, [{ name: "questions", type: "array" }]);
        if (bad) return err(bad);
        const payload: Commands["herd:ask"]["payload"] = { ...w, questions: input.questions as GateQuestion[] };
        if (input.context !== undefined) payload.context = input.context as string;
        return fromResponse(await herdAsk(payload));
      },
    },
    {
      name: "herd_answer",
      description: "Read the answer to a gate previously opened with herd_ask.",
      inputSchema: {
        type: "object",
        properties: { gate: { type: "string" } },
        required: ["gate"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "gate", type: "string" }]);
        if (bad) return err(bad);
        return fromResponse(await herdAnswer({ gate: input.gate as string }));
      },
    },
    {
      name: "herd_report",
      description: "Post a status report message to this worker's herd room, using HERD_ID and HERD_JOB from the environment.",
      inputSchema: {
        type: "object",
        properties: { body: { type: "string" } },
        required: ["body"],
        additionalProperties: false,
      },
      async handler(input, env) {
        const j = requireJobEnv(env);
        if ("error" in j) return err(j.error);
        const bad = checkRequired(input, [{ name: "body", type: "string" }]);
        if (bad) return err(bad);
        return fromResponse(await herdReport({ herd: j.herd, job: j.job, body: input.body as string }));
      },
    },
  ];
}
