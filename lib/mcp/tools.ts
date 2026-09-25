/**
 * The MCP tool roster: one McpToolDef per tool, each a thin wrapper over an
 * existing daemon command, except rt_verb, which runs agent-safe CLI leaves
 * (some reads, a setting or a file, need no daemon, and putting one in their
 * path would make a daemon outage cost the caller the read). No MCP SDK
 * import here, and no import of commands/herd.ts or commands/chat.ts (both
 * pull in TUI-adjacent modules that lib/mcp must stay clear of).
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
import { reverseLookupByName } from "../repo-name-lookup.ts";
import { parseIdentity } from "../settings/identity.ts";
import { explainError } from "../explain-error.ts";
import { runRtVerb } from "./rt-verb.ts";
import { resolveMrTarget, resolveRepoTarget } from "./mr-target.ts";

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

/** Runs a daemon error through explainError before returning it, so every
    tool in the roster gets the same CLI-shaped prose instead of a bare code
    (RT-172), not just the mr tools that happen to hit worktree verbs. An
    error explainError does not recognize passes through unchanged. */
function fromResponse<T>(res: RtResponse<T>): ToolResult {
  return res.ok ? ok(res.data) : err(explainError(res.error ?? "request failed"));
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

/** Optional fields get the same check: a string "false" must never read as true. */
function checkOptional(input: Record<string, unknown>, fields: Array<{ name: string; type: "string" | "number" | "boolean" }>): string | undefined {
  for (const f of fields) {
    const v = input[f.name];
    if (v !== undefined && typeof v !== f.type) return `"${f.name}" must be a ${f.type}`;
  }
  return undefined;
}

/** mr:action only checks typeof on jobId/pipelineId, so 0, negative, fractional or NaN
    would otherwise reach the forge as a 404 instead of a clear input error. iid gets the
    same check inside resolveMrTarget. */
function checkPositiveInts(input: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const v = input[name];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return `"${name}" must be a positive integer`;
  }
  return undefined;
}

function checkStringArray(input: Record<string, unknown>, name: string): string | undefined {
  const v = input[name];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return `"${name}" must be an array of strings`;
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

/** Matches lib/daemon-client.ts's DISCUSSIONS_TIMEOUT_MS: a GitLab write is
    slower than rtCommand's 15s default, and a client-side abort here would
    still leave the daemon writing, so a retry would duplicate the write.
    Shared by every mr write tool for that reason. */
const MR_WRITE_TIMEOUT_MS = 30_000;

/** A 50 MB multipart POST over a slow link outlives the 30s write timeout. */
const MR_UPLOAD_TIMEOUT_MS = 120_000;

const REPO_NAME_RULE = "Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.";

const MR_TARGET_PROPS = {
  repoName: { type: "string", description: "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo." },
  iid: { type: "number" },
  mrUrl: { type: "string", description: "The MR's https URL; supplies both the repo and iid." },
};

const REPO_TARGET_PROPS = {
  repoName: MR_TARGET_PROPS.repoName,
  mrUrl: { type: "string", description: "An MR URL in the target project; names the repo, its iid is not used." },
};

/** A timed-out or gateway-timed-out create or post may still land daemon-side (see
    MR_WRITE_TIMEOUT_MS); the pattern also matches GitLab's own wording (e.g. "504 Gateway Timeout"). */
function withLandingHint(res: ToolResult, check: string): ToolResult {
  if (res.ok || !/timed ?out|timeout/i.test(res.error ?? "")) return res;
  return err(`${res.error}; the write may still land, so check ${check} before retrying`);
}

type MrActionName = Commands["mr:action"]["payload"]["action"];

/** mr:action replies a bare {ok:true}, so each tool names its own result body. */
async function runMrAction(target: { identity: string; iid: number }, action: MrActionName, args: unknown[], body: unknown): Promise<ToolResult> {
  const res = await rtCommand<Commands["mr:action"]["data"]>("mr:action", {
    repoName: target.identity,
    iid: target.iid,
    action,
    args,
  }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
  return res.ok ? ok(body) : err(explainError(res.error ?? "request failed"));
}

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
    the matched identity. Shares reverseLookupByName (lib/repo-name-lookup.ts)
    with the CLI's tryResolveRepoArg so a legacy-name/identity heal pair
    collapses to one match here too, instead of reading ambiguous. Deliberately
    does not import lib/repo-arg.ts itself (that module pulls in
    lib/state/index.ts and lib/settings/resolve.ts on top of the daemon round
    trip this tool already does): reverseLookupByName is pure over the id-path
    map the "repos" verb already returns. */
async function resolveRepoIdentity(repo: string): Promise<{ identity: string } | { error: string }> {
  const res = await rtCommand<Commands["repos"]["data"]>("repos", {});
  if (!res.ok || !res.data) return { error: res.error ?? "failed to list repos" };
  const repos = res.data.repos ?? {};
  const identities = Object.keys(repos);
  if (parseIdentity(repo) && identities.includes(repo)) return { identity: repo };
  const index: Record<string, string> = {};
  for (const [id, entry] of Object.entries(repos)) index[id] = entry.path;
  const matches = reverseLookupByName(repo, index);
  if (matches.length > 1) {
    return { error: `"${repo}" matches more than one repo: ${matches.map(([id]) => id).join(", ")}; pass the full identity` };
  }
  const match = matches[0];
  if (!match) {
    const known = identities.map((id) => repoLabel(id)).sort().join(", ");
    return { error: `no repo matching "${repo}"; known repos: ${known}` };
  }
  return { identity: match[0] };
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
        text: { type: "string", pattern: "\\S", description: "Replacement for text the gate offered (an edited reply), used in its place. Comments go in note, never here." },
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
      properties: {
        value: { type: "string" },
        label: { type: "string" },
        recommended: { type: "boolean", description: "Marks this option as the recommended choice; lifts into a '(Recommended)' label suffix." },
        description: { type: "string", description: "One or two sentences on what choosing this option means; shown under the option's label on every surface, stored verbatim. At most 1024 bytes." },
      },
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
    context: { type: "string", description: "Material specific to this one question (what its choice turns on), shown with it; the top-level context stays the whole ask's. Shares the 8192-byte context budget with the top-level context." },
  },
  required: ["id", "label", "multi", "options"],
  additionalProperties: false,
};

export function mcpTools(): McpToolDef[] {
  return [
    {
      name: "gate_answer",
      description: "Answer an open gate's questions as this pane. Answer values must be option VALUES verbatim; nuance goes in {value, note}, and replacement text for something the gate offered goes in {value, text}.",
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
        if (!res.ok && res.error === "not-found") return err(`no gate ${input.id}`);
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
      description: "Open a decision gate with the daemon-side ceremony: subject resolves from this session (explicit subject wins, else its running run, else its agent record's own subject), presentation is computed, and the operator is nudged. Always pass context, quoted from the material the reader decides on, and never trim or skip it for size: over the shared 8192-byte budget (top-level context plus every question's context), question contexts are dropped server-side first, then the top-level context if it is over on its own, and the drop is reported back as contextOmitted: true. A human-owned gate with no context is refused. The in-pane form caps every question at 4 options: keep navigation verbs (iterate, go back, hold) as their own next question and split a larger selection into <id>-1, <id>-2, ... questions whose answers read as one union; one over-cap question makes the whole gate present as wait, reported back as formCapExceeded with the remedy. Returns {id, presentation, subject, supersededId}; then act on the returned presentation. form: ask it in the pane with AskUserQuestion (the gate-fork hook allows it once this gate is open), then answer with `rt gate answer <id> --answers <json> --by pane`. wait: run `rt gate wait <id>` as background bash and end the turn; the wait itself is never a tool. Prefer {value, label} option objects; bare strings are accepted and stored normalized. Answers must be option VALUES verbatim.",
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
      description: `GitLab only. Reply to an existing MR discussion thread. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS, discussionId: { type: "string" }, body: { type: "string" } },
        required: ["discussionId", "body"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "discussionId", type: "string" }, { name: "body", type: "string" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const res = await rtCommand<Commands["discussions:reply"]["data"]>("discussions:reply", {
          repoName: target.identity,
          iid: target.iid,
          discussionId: input.discussionId as string,
          body: input.body as string,
        }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
        return fromResponse(res);
      },
    },
    {
      name: "mr_comment_inline",
      description: `GitLab only. Post a NEW positioned inline comment (DiffNote) on an MR diff line, with server-side verification: the daemon re-checks the created note's type and deletes-and-retries once when GitLab silently drops the position. The retry re-fetches diff_refs; it cannot repair a position GitLab rejects outright. Use mr_reply_thread to reply to an existing thread. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...MR_TARGET_PROPS,
          body: { type: "string" },
          path: { type: "string" },
          line: { type: "number" },
          oldPath: { type: "string" },
          oldLine: { type: "number" },
        },
        required: ["body", "path", "line"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [
          { name: "body", type: "string" },
          { name: "path", type: "string" },
          { name: "line", type: "number" },
        ]) ?? checkOptional(input, [{ name: "oldPath", type: "string" }, { name: "oldLine", type: "number" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["mr:comment-inline"]["payload"] = {
          repoName: target.identity,
          iid: target.iid,
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
      name: "mr_comment",
      description: `GitLab only. Post a NEW top-level note on an MR: a review's summary, or anything with no diff line to anchor to. resolvable (default true) opens a discussion a human can resolve; false posts a plain note, for a summary that carries nothing to resolve. Posts once and never retries. Returns noteId, discussionId (null for a plain note), resolvable as GitLab reports it, url (the note) and mrUrl. Use mr_comment_inline for a diff line and mr_reply_thread for an existing thread. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS, body: { type: "string" }, resolvable: { type: "boolean" } },
        required: ["body"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "body", type: "string" }]) ?? checkOptional(input, [{ name: "resolvable", type: "boolean" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["mr:comment"]["payload"] = { repoName: target.identity, iid: target.iid, body: input.body as string };
        if (input.resolvable !== undefined) payload.resolvable = input.resolvable as boolean;
        const res = await rtCommand<Commands["mr:comment"]["data"]>("mr:comment", payload, { timeoutMs: MR_WRITE_TIMEOUT_MS });
        return withLandingHint(fromResponse(res), "the MR's discussions");
      },
    },
    {
      name: "mr_create",
      description: `GitLab only. Create a merge request from an already-pushed sourceBranch into targetBranch. Pass targetBranch explicitly (read the default branch from git); it is never guessed. draft defaults to true. Write the title, and optionally the description, yourself (e.g. from the branch's commits). labels apply at creation; squash sets the MR's squash-on-merge flag right after it. Creates once and never retries. Returns iid, url (null when GitLab created the MR but reading it back failed) and, when squash was passed, squashApplied; squashApplied false with squashError means the MR exists, so set squash with mr_update rather than creating again. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...REPO_TARGET_PROPS,
          sourceBranch: { type: "string" },
          targetBranch: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          draft: { type: "boolean" },
          labels: { type: "array", items: { type: "string" } },
          squash: { type: "boolean" },
        },
        required: ["sourceBranch", "targetBranch", "title"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [
          { name: "sourceBranch", type: "string" },
          { name: "targetBranch", type: "string" },
          { name: "title", type: "string" },
        ]) ?? checkOptional(input, [{ name: "description", type: "string" }, { name: "draft", type: "boolean" }, { name: "squash", type: "boolean" }])
          ?? checkStringArray(input, "labels");
        if (bad) return err(bad);
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["mr:create"]["payload"] = {
          repoName: target.identity,
          sourceBranch: input.sourceBranch as string,
          targetBranch: input.targetBranch as string,
          title: input.title as string,
        };
        if (input.description !== undefined) payload.description = input.description as string;
        if (input.draft !== undefined) payload.draft = input.draft as boolean;
        if (input.labels !== undefined) payload.labels = input.labels as string[];
        if (input.squash !== undefined) payload.squash = input.squash as boolean;
        const res = await rtCommand<Commands["mr:create"]["data"]>("mr:create", payload, { timeoutMs: MR_WRITE_TIMEOUT_MS });
        return withLandingHint(fromResponse(res), "mr_map for an open MR on the source branch");
      },
    },
    {
      name: "mr_update",
      description: `GitLab only. Edit an open MR: title, description, addLabels, removeLabels (add and remove, never the whole set, so labels CI or teammates set survive) and squash (the MR's squash-on-merge flag). Pass at least one. A title change keeps the MR's draft state. Title and description are written first, then labels and squash in one call; a partial failure names what landed, and every field is idempotent, so retry with only the failed fields. Returns iid, url and applied (the fields that landed). ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...MR_TARGET_PROPS,
          title: { type: "string" },
          description: { type: "string" },
          addLabels: { type: "array", items: { type: "string" } },
          removeLabels: { type: "array", items: { type: "string" } },
          squash: { type: "boolean" },
        },
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "title", type: "string" }, { name: "description", type: "string" }, { name: "squash", type: "boolean" }])
          ?? checkStringArray(input, "addLabels") ?? checkStringArray(input, "removeLabels");
        if (bad) return err(bad);
        const changes = ["title", "description", "addLabels", "removeLabels", "squash"]
          .filter((f) => input[f] !== undefined && !(Array.isArray(input[f]) && (input[f] as unknown[]).length === 0));
        if (changes.length === 0) return err('nothing to update; pass at least one of "title", "description", "addLabels", "removeLabels" or "squash"');
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["mr:update"]["payload"] = { repoName: target.identity, iid: target.iid };
        if (input.title !== undefined) payload.title = input.title as string;
        if (input.description !== undefined) payload.description = input.description as string;
        if (input.addLabels !== undefined) payload.addLabels = input.addLabels as string[];
        if (input.removeLabels !== undefined) payload.removeLabels = input.removeLabels as string[];
        if (input.squash !== undefined) payload.squash = input.squash as boolean;
        const res = await rtCommand<Commands["mr:update"]["data"]>("mr:update", payload, { timeoutMs: MR_WRITE_TIMEOUT_MS });
        return withLandingHint(fromResponse(res), "the MR's title, labels and squash setting");
      },
    },
    {
      name: "mr_upload",
      description: `GitLab only. Upload one local image or video (png, jpg, jpeg, gif, webp, mp4, mov, webm; at most 50 MB) to the target project and get back url and markdown; paste the markdown into an MR description or note (mr_create, mr_update, mr_comment). Works before an MR exists. path must be absolute and under an allowed root: a worktree of the target repo, this user's Claude Code temp root (the session scratchpad lives there), or a directory in the rt.mcp.uploadRoots setting; anything else, a directory, or a file whose bytes do not match its extension is refused. Uploads once; a timed-out upload may have landed, but an unused upload is harmless, so retrying is safe. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...REPO_TARGET_PROPS, path: { type: "string", description: "Absolute path of the file to upload." } },
        required: ["path"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "path", type: "string" }]);
        if (bad) return err(bad);
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const res = await rtCommand<Commands["mr:upload"]["data"]>("mr:upload", { repoName: target.identity, path: input.path as string }, { timeoutMs: MR_UPLOAD_TIMEOUT_MS });
        const out = fromResponse(res);
        if (out.ok || !/timed ?out|timeout/i.test(out.error ?? "")) return out;
        return err(`${out.error}; the upload may have landed anyway, and an unused upload is harmless, so retrying is safe`);
      },
    },
    {
      name: "mr_approve",
      description: `GitLab only. Approve an MR as the token's user, or withdraw that approval with approved: false. Call it only once approving is decided (a review's Approve disposition, after its findings have posted). ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS, approved: { type: "boolean" } },
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "approved", type: "boolean" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const approved = input.approved !== false;
        return runMrAction(target, approved ? "approve" : "unapprove", [], { approved });
      },
    },
    {
      name: "mr_resolve_thread",
      description: `GitLab only. Resolve an MR discussion thread, or reopen it with resolved: false. Post any reply first with mr_reply_thread; resolving does not post. Returns {discussionId, resolved}. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS, discussionId: { type: "string" }, resolved: { type: "boolean" } },
        required: ["discussionId"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "discussionId", type: "string" }]) ?? checkOptional(input, [{ name: "resolved", type: "boolean" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const discussionId = input.discussionId as string;
        const resolved = input.resolved !== false;
        const res = await rtCommand<Commands["discussions:resolve"]["data"]>("discussions:resolve", {
          repoName: target.identity,
          iid: target.iid,
          discussionId,
          resolved,
        }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
        return res.ok ? ok({ discussionId, resolved }) : err(explainError(res.error ?? "request failed"));
      },
    },
    {
      name: "mr_ready",
      description: `GitLab only. Mark a draft MR ready for review, or back to draft with ready: false. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS, ready: { type: "boolean" } },
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "ready", type: "boolean" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const ready = input.ready !== false;
        return runMrAction(target, "toggleDraft", [!ready], { ready });
      },
    },
    {
      name: "mr_retry",
      description: `GitLab only. Retry one CI job (jobId) or a whole pipeline (pipelineId) on an MR; pass exactly one. The MR named by the target is the one whose state is refreshed afterward. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS, jobId: { type: "number" }, pipelineId: { type: "number" } },
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "jobId", type: "number" }, { name: "pipelineId", type: "number" }])
          ?? checkPositiveInts(input, ["jobId", "pipelineId"]);
        if (bad) return err(bad);
        const hasJob = input.jobId !== undefined;
        if (hasJob === (input.pipelineId !== undefined)) return err('pass exactly one of "jobId" or "pipelineId"');
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        return hasJob
          ? runMrAction(target, "retryJob", [input.jobId], { jobId: input.jobId })
          : runMrAction(target, "retryPipeline", [input.pipelineId], { pipelineId: input.pipelineId });
      },
    },
    {
      name: "mr_rebase",
      description: `GitLab only. Ask GitLab to rebase the MR's source branch onto its target server-side (no checkout). GitLab accepts the request and rebases asynchronously, so re-read the MR before assuming the rebase finished or succeeded. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS },
        additionalProperties: false,
      },
      async handler(input) {
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        return runMrAction(target, "rebase", [], { rebased: true });
      },
    },
    {
      name: "mr_map",
      description: "Open MRs for a repo joined to the local worktrees holding their branches. Lists ALL open MRs for the repo (not only yours). repo is the repo's registered name: either its serialized identity (e.g. remote:gitlab.com%2Facme%2Facme-dev) or its short repo-label alias.",
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
        if (!mrsRes.ok || !mrsRes.data) return err(explainError(mrsRes.error ?? "failed to read MRs"));
        if (!treesRes.ok || !treesRes.data) return err(explainError(treesRes.error ?? "failed to list worktrees"));

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
    {
      name: "rt_verb",
      description: "Run one read-only rt verb and return its --json result. Only verbs marked agent-safe run; anything else is refused with the list of verbs that do. Pass args without the leading \"rt\" (e.g. [\"worktree\", \"list\"]) and cwd when the verb depends on the current repo, since this server's working directory is fixed at session start and does not follow cd or EnterWorktree.",
      inputSchema: {
        type: "object",
        properties: {
          args: { type: "array", items: { type: "string" }, minItems: 1 },
          cwd: { type: "string", description: "Absolute directory to run in; defaults to the server's own." },
        },
        required: ["args"],
        additionalProperties: false,
      },
      async handler(input) {
        const r = await runRtVerb(input);
        return r.ok ? ok(r.body) : err(r.error);
      },
    },
  ];
}
