/**
 * The MCP tool roster: one McpToolDef per tool, each a thin wrapper over an
 * existing daemon command. No MCP SDK import here, and no import of
 * commands/herd.ts or commands/chat.ts (both pull in TUI-adjacent modules
 * that lib/mcp must stay clear of).
 */
import {
  chatAck, chatClaim, chatDm, chatPost, chatRelease,
  gateAnswer, gateAsk, gateList,
  herdAnswer, herdAsk, herdGates, herdList, herdReport,
  readProjectMRs,
  rtCommand,
} from "../../packages/rt-client/src/index.ts";
import type { Commands, GateQuestion, RtResponse } from "../../packages/rt-client/src/index.ts";
import { readChatSession } from "../chat-session.ts";
import { joinMrsToWorktrees } from "../mr-map.ts";
import { repoLabel } from "../repo-label.ts";

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

/** Matches lib/daemon-client.ts's DISCUSSIONS_TIMEOUT_MS: a GitLab post is
    slower than rtCommand's 15s default, and a client-side abort here would
    still leave the daemon posting, so a retry would duplicate the comment.
    Shared by both mr write tools (mr_reply_thread, mr_comment_inline) for
    the same reason. */
const MR_WRITE_TIMEOUT_MS = 30_000;

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

/** Matches input.repo against the daemon's repo registry, either as the raw
    serialized identity or its human-friendly label (repoLabel), and returns
    the matched identity. Deliberately does not import lib/repo-arg.ts (that
    module pulls in lib/state/index.ts, lib/settings/resolve.ts, and
    lib/ui/protocol.ts): the "repos" verb plus repoLabel is the whole lookup. */
async function resolveRepoIdentity(repo: string): Promise<{ identity: string } | { error: string }> {
  const res = await rtCommand<Commands["repos"]["data"]>("repos", {});
  if (!res.ok || !res.data) return { error: res.error ?? "failed to list repos" };
  const identities = Object.keys(res.data.repos ?? {});
  const matches = identities.filter((id) => id === repo || repoLabel(id) === repo);
  if (matches.length > 1) return { error: `"${repo}" matches more than one repo: ${matches.join(", ")}; pass the full identity` };
  const match = matches[0];
  if (!match) {
    const known = identities.map((id) => repoLabel(id)).sort().join(", ");
    return { error: `no repo matching "${repo}"; known repos: ${known}` };
  }
  return { identity: match };
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
        const res = await gateAnswer(payload);
        if (!res.ok && res.error === "owned-by") {
          const owner = (res as { owner?: string }).owner ?? "unknown";
          return err(`gate ${input.id} is owned by ${owner}; pass override: true to answer anyway`);
        }
        if (!res.ok && res.error === "gate-closed") {
          const reason = (res as { reason?: string }).reason ?? "closed";
          const supersededBy = (res as { supersededBy?: string }).supersededBy;
          return err(`gate ${input.id} is closed (${reason})${supersededBy ? `; superseded by ${supersededBy}` : ""}`);
        }
        return fromResponse(res);
      },
    },
    {
      name: "gate_list",
      description: "List gates in all statuses unless open is true, optionally filtered by subject prefix or kind and capped by limit. Pass the previous response's cursor to continue paging; an empty gates array means there is nothing more to page.",
      inputSchema: {
        type: "object",
        properties: {
          open: { type: "boolean" },
          subjectPrefix: { type: "string" },
          kind: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "number" },
        },
        additionalProperties: false,
      },
      async handler(input) {
        const payload: Commands["gate:list"]["payload"] = {};
        if (input.open !== undefined) payload.open = input.open as boolean;
        if (input.subjectPrefix !== undefined) payload.subjectPrefix = input.subjectPrefix as string;
        if (input.kind !== undefined) payload.kind = input.kind as string;
        if (input.limit !== undefined) payload.limit = input.limit as number;
        if (input.cursor !== undefined) payload.cursor = input.cursor as number;
        return fromResponse(await gateList(payload));
      },
    },
    {
      name: "gate_ask",
      description: "Open a decision gate with the daemon-side ceremony: subject resolves from this session (explicit subject wins, else its running run, else its agent record's own subject), presentation is computed, and the operator is nudged. Returns {id, presentation, subject, supersededId}; then run `rt gate wait <id>` as background bash and park. The wait itself is never a tool. Prefer {value, label} option objects; bare strings are accepted and stored normalized. Answers must be option VALUES verbatim.",
      inputSchema: {
        type: "object",
        properties: {
          questions: { type: "array", items: GATE_QUESTION_SCHEMA },
          context: { type: "string" },
          kind: { type: "string" },
          subject: { type: "string" },
        },
        required: ["questions"],
        additionalProperties: false,
      },
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "questions", type: "array" }]);
        if (bad) return err(bad);
        const payload: Commands["gate:ask"]["payload"] = {
          questions: input.questions as GateQuestion[],
        };
        if (input.context !== undefined) payload.context = input.context as string;
        if (input.kind !== undefined) payload.kind = input.kind as string;
        // No RT_GATE_SUBJECT read (contract C13): the var carries an agent:<id>
        // fallback on every rt-agent launch and would shadow the daemon
        // ladder's run rung; absent an input subject, the daemon resolves
        // session -> run -> the agent record's own subject.
        if (input.subject !== undefined) payload.subject = input.subject as string;
        if (env.CLAUDE_CODE_SESSION_ID) payload.sessionId = env.CLAUDE_CODE_SESSION_ID;
        if (env.HERDR_PANE_ID) payload.paneId = env.HERDR_PANE_ID;
        return fromResponse(await gateAsk(payload));
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
        }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
        return fromResponse(res);
      },
    },
    {
      name: "mr_comment_inline",
      description: "GitLab only. Post a NEW positioned inline comment (DiffNote) on an MR diff line, with server-side verification: the daemon re-checks the created note's type and deletes-and-retries once when GitLab silently drops the position. The retry re-fetches diff_refs; it cannot repair a position GitLab rejects outright. Use mr_reply_thread to reply to an existing thread.",
      inputSchema: {
        type: "object",
        properties: {
          repoName: { type: "string" },
          iid: { type: "number" },
          body: { type: "string" },
          path: { type: "string" },
          line: { type: "number" },
          oldPath: { type: "string" },
          oldLine: { type: "number" },
        },
        required: ["repoName", "iid", "body", "path", "line"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [
          { name: "repoName", type: "string" },
          { name: "iid", type: "number" },
          { name: "body", type: "string" },
          { name: "path", type: "string" },
          { name: "line", type: "number" },
        ]);
        if (bad) return err(bad);
        const payload: Commands["mr:comment-inline"]["payload"] = {
          repoName: input.repoName as string,
          iid: input.iid as number,
          body: input.body as string,
          path: input.path as string,
          line: input.line as number,
        };
        if (input.oldPath !== undefined) payload.oldPath = input.oldPath as string;
        if (input.oldLine !== undefined) payload.oldLine = input.oldLine as number;
        return fromResponse(await rtCommand<Commands["mr:comment-inline"]["data"]>("mr:comment-inline", payload, { timeoutMs: MR_WRITE_TIMEOUT_MS }));
      },
    },
    {
      name: "mr_map",
      description: "Open MRs for a repo joined to the local worktrees holding their branches. Lists ALL open MRs for the repo (not only yours). repo is the registered repo name.",
      inputSchema: {
        type: "object",
        properties: { repo: { type: "string" } },
        required: ["repo"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "repo", type: "string" }]);
        if (bad) return err(bad);
        const resolved = await resolveRepoIdentity(input.repo as string);
        if ("error" in resolved) return err(resolved.error);
        const identity = resolved.identity;
        const [mrsRes, treesRes] = await Promise.all([
          readProjectMRs(identity, 20_000),
          rtCommand<Commands["worktree:list"]["data"]>("worktree:list", { repoName: identity }),
        ]);
        if (!mrsRes.ok || !mrsRes.data) return err(mrsRes.error ?? "failed to read MRs");
        if (!treesRes.ok || !treesRes.data) return err(treesRes.error ?? "failed to list worktrees");

        const mrs = Object.values(mrsRes.data.mrs ?? {})
          .map((entry) => entry.pr)
          .filter((pr) => pr.state === "opened")
          .map((pr) => ({
            iid: pr.iid,
            title: pr.title,
            sourceBranch: pr.sourceBranch,
            state: pr.state,
            pipelineStatus: pr.pipeline?.status ?? null,
          }));

        const trees = (treesRes.data.trees ?? []).map((t) => ({ path: t.path, branch: t.branch }));

        return ok({ rows: joinMrsToWorktrees(mrs, trees) });
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
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "gate", type: "string" }]);
        if (bad) return err(bad);
        return fromResponse(await herdAnswer({ gate: input.gate as string, ...(env.CLAUDE_CODE_SESSION_ID ? { sessionId: env.CLAUDE_CODE_SESSION_ID } : {}) }));
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
