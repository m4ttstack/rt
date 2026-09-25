/**
 * agent:* ... daemon handlers for `rt agent` (launch + record + resume; no
 * liveness by design - spec 2026-08-25).
 *
 * Session uuids are minted here and validated in lib/agent-argv/ before
 * any spawn; resume always runs under the RECORDED account because claude
 * transcripts are per-cswap-profile. codex mints its own id instead, so a
 * codex record's sessionId starts as rt's placeholder uuid and is replaced
 * by updateAgentSessionId once the real one is captured.
 *
 * Every launch (start and resume, herdr and headless) stamps the
 * gate-protocol env (RT_AGENT_ID, RT_GATE_SUBJECT, RT_DAEMON_SOCK)
 * unconditionally. The AskUserQuestion PreToolUse hook (docs/superpowers/
 * specs/2026-09-11-executor-reconciler-design.md "AskUserQuestion hook")
 * only gets injected via a per-agent `--settings` file when the launch
 * carries an explicit subject (a launch with no
 * subject has no gate to fork against, so the deny-by-default hook would
 * only ever degrade to allow -- skip writing it at all); see
 * resolveHookSettingsPath below.
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import {
  deleteAgent, finishAgent, getAgent, insertAgent, isValidChatName, listAgents, markAgentResumed,
  newAgentId, reserveAgentHandle, updateAgentPane, updateAgentSessionId, type AgentRecord, type AgentSurface,
} from "../../state/index.ts";
import { buildAgentArgv, buildAgentPaneCommand, CROSS_SESSION_INBOUND_SETTINGS, type AgentInvocation, type AgentProvider } from "../../agent-argv/index.ts";
import { mergeGateForkHookSettings, resolveGateForkHookPath } from "../../agent-hooks.ts";
import { defaultHerdrRunner, herdrAgentSessionId, launchInWorkspace, type HerdrRunner } from "../../agent-herdr.ts";
import { herdrRequest } from "../../herdr/client.ts";
import { acceptTrustOnPane, type TrustOutcome } from "../trust-accept.ts";
import { repoLabel } from "../../repo-label.ts";
import { getSetting } from "../../settings/resolve.ts";
import { rtDir } from "../../rt-paths.ts";
import { DAEMON_SOCK_PATH } from "../../daemon-config.ts";
import { lazyChildLogger } from "../../daemon-logger.ts";
import { formatPaneRef, parsePaneRef } from "../../../packages/rt-client/src/index.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import { bgSocketPath } from "../bg-service.ts";
import type { BgService } from "../bg-service.ts";
import type { BgClaimsStore } from "../bg-claims-store.ts";
import type { CommandResult } from "./types.ts";

export interface HeadlessChild {
  exited: Promise<number>;
  stdout: () => Promise<string>;
  /** Resolves with the provider-minted session id once seen in the stream,
      or undefined if the stream ended without one. Only populated when
      captureSessionId was requested at spawn time (claude never needs this
      -- it mints nothing, rt already chose the id). */
  sessionId: () => Promise<string | undefined>;
}

/** Scans a codex `--json` event stream for the first `thread_id` any event
    line carries, without buffering the whole stream (that's `stdout()`'s job,
    on the other half of the tee below). In practice that is the
    `thread.started` event -- confirmed against a real `codex exec --json` run
    2026-09-15, the line is `{"type":"thread.started","thread_id":"<uuid>"}`;
    codex calls this a "thread" in the stream but it is the same id `codex
    exec resume <SESSION_ID>` accepts. The match is deliberately on the field
    rather than on `type === "thread.started"`: every thread_id in one exec's
    stream is that same session's, so keying on the field survives codex
    renaming or reordering the event that first carries it. Exported so it can
    be unit-tested directly against a fake stream, rather than only
    indirectly through a test double that reimplements the parsing. */
export function extractSessionId(stream: ReadableStream<Uint8Array>): Promise<string | undefined> {
  return (async () => {
    // bun-types' ReadableStream<Uint8Array> and TextDecoderStream's
    // WritableStream<BufferSource> disagree just enough (BufferSource vs
    // Uint8Array) that pipeThrough's own generic can't unify them; the cast
    // is a type-level workaround for that mismatch, not a runtime one --
    // TextDecoderStream really does accept a Uint8Array chunk.
    const reader = (stream.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)).getReader();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let newlineAt: number;
        while ((newlineAt = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineAt);
          buffer = buffer.slice(newlineAt + 1);
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as { thread_id?: unknown };
            if (typeof event.thread_id === "string" && event.thread_id) return event.thread_id;
          } catch {
            // Not every line is JSON we care about; keep scanning.
          }
        }
      }
    } finally {
      // Cancelled, not merely released: this reader drains one branch of a
      // tee, and the tee queues every chunk an undrained branch has not taken
      // yet -- so returning early on the id without cancelling would hold a
      // long codex run's whole output twice.
      try {
        await reader.cancel();
      } catch {
        // Already closed or errored; nothing left to cancel.
      }
      reader.releaseLock();
    }
    return undefined;
  })();
}

function defaultSpawnHeadless(
  argv: string[], cwd: string, env: Record<string, string> = {},
  opts: { captureSessionId?: boolean } = {},
): HeadlessChild {
  const proc = Bun.spawn(argv as [string, ...string[]], {
    cwd,
    env: { ...process.env, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!opts.captureSessionId || !proc.stdout) {
    return {
      exited: proc.exited,
      stdout: () => new Response(proc.stdout).text(),
      sessionId: () => Promise.resolve(undefined),
    };
  }
  const [forText, forId] = proc.stdout.tee();
  const sessionIdPromise = extractSessionId(forId);
  return {
    exited: proc.exited,
    stdout: () => new Response(forText).text(),
    sessionId: () => sessionIdPromise,
  };
}

/** A declared+unset key resolves undefined without throwing, so a caught error here is already the unexpected case. */
function fromSetting<T = string>(key: string, log: Logger): T | undefined {
  try {
    return getSetting<T>(key).value ?? undefined;
  } catch (err) {
    log.warn({ err, key }, "agent: settings read failed");
    return undefined;
  }
}

/** Deterministic from the id alone, so it can be known and stored before the
    headless process is even spawned. The body written there is
    provider-dependent: claude's `--output-format json` produces one JSON
    object, codex's `--json` produces a JSONL event stream. Nothing in-repo
    parses it today; whoever adds a consumer must branch on rec.provider. */
function agentResultPath(id: string): string {
  return join(rtDir(), "agents", `${id}.json`);
}

/** Deterministic from the id alone, mirroring agentResultPath above. */
function agentHookSettingsPath(id: string): string {
  return join(rtDir(), "agent-hooks", `${id}.json`);
}

/** Tokenized the same way claudeArgs splits extraArgs, so a match here is exactly a flag claude will also see. Matches both the split ("--settings", "<path>") and "--settings=<path>" spellings. */
function extraArgsHasSettingsFlag(extraArgs: string | undefined): boolean {
  if (!extraArgs) return false;
  return extraArgs.split(/\s+/).filter(Boolean).some((tok) => tok === "--settings" || tok.startsWith("--settings="));
}

/**
 * Absolute path to a freshly written per-agent settings file carrying the
 * AskUserQuestion PreToolUse hook (Task 9), or undefined when injection is
 * skipped. Four skip cases, all non-fatal to the launch: the provider is not
 * claude (only claude reads `--settings`; codex's builders ignore
 * inv.settingsPath outright, so writing the file would leave a dead one in the
 * agent-hooks directory per launch), the launch carries no explicit subject (with no
 * subject there is no gate for the hook to check, so it would only ever
 * degrade to allow; skip writing it rather than ship a no-op hook file),
 * extraArgs already sets --settings (merge is not attempted -- the user's
 * own value wins outright), or gate-fork.sh cannot be resolved on this
 * machine.
 *
 * A launch never emits two --settings flags (repeated-flag semantics are
 * unverified against the real CLI): when this launch would otherwise get
 * the inbound-accept inline CROSS_SESSION_INBOUND_SETTINGS JSON (a
 * reserved handle, non-headless -- claudeArgs' own condition), that object
 * is folded into this SAME file via mergeGateForkHookSettings instead of
 * being emitted as a second flag. lib/agent-argv/claude.ts's claudeArgs skips its
 * inline JSON whenever settingsPath is set, so the fold here is the only
 * place that JSON survives for such a launch. A subjectless launch skips
 * this file entirely, so that inline JSON reverts to riding its own
 * --settings flag exactly as it did before the gate-fork hook existed.
 */
function resolveHookSettingsPath(rec: AgentRecord, log: Logger): string | undefined {
  if (rec.provider !== "claude") {
    log.debug({ id: rec.id, provider: rec.provider }, "agent: provider does not read --settings; gate-fork hook injection skipped");
    return undefined;
  }
  if (rec.subject === undefined) {
    log.debug({ id: rec.id }, "agent: no explicit subject; gate-fork hook injection skipped");
    return undefined;
  }
  if (extraArgsHasSettingsFlag(rec.extraArgs)) {
    log.debug({ id: rec.id }, "agent: extraArgs already sets --settings; gate-fork hook injection skipped");
    return undefined;
  }
  const hookPath = resolveGateForkHookPath();
  if (!hookPath) {
    log.debug({ id: rec.id }, "agent: gate-fork.sh not found; hook injection skipped");
    return undefined;
  }
  const inlineBase = rec.surface !== "headless" && rec.handle !== undefined ? CROSS_SESSION_INBOUND_SETTINGS : undefined;
  const settings = mergeGateForkHookSettings(inlineBase, hookPath);
  const settingsPath = agentHookSettingsPath(rec.id);
  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings));
    return settingsPath;
  } catch (err) {
    log.warn({ err, id: rec.id }, "agent: failed to write gate-fork hook settings file");
    return undefined;
  }
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return typeof v === "object" && v !== null && !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === "string");
}

// buildPaneCommand interpolates the key into the pane's shell line raw (only
// the value is quoted), so anything but a shell-inert identifier is injection.
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const agentOwner = (id: string): string => `agent:${id}`;

/** Names the real flag the caller will be looking for; codex.ts's own
    equivalent throw already spells the codex form, and a claude-worded
    message on a codex launch sends the reader to the wrong CLI's docs. */
function headlessStdinBlurb(provider: AgentProvider): string {
  return provider === "codex"
    ? "codex exec with no prompt blocks on stdin"
    : "claude -p with no prompt blocks on stdin";
}

/** herdr only learns codex's session id after the pane finishes its first
    turn (see herdrAgentSessionId), and a real codex turn routinely runs for
    many minutes, so a short budget would give up before the id ever exists.
    Matches AGENT_WAIT_TIMEOUT_MS in lib/rebase-escalation.ts, this repo's
    existing precedent for waiting on a herdr pane to finish work. */
const CODEX_HERDR_SESSION_ID_TIMEOUT_MS = 10 * 60_000;

/** herdr invoked against a freshly-spawned bg server can fail before any pane
    ever runs: the bg env's PATH may not carry herdr's own binary yet
    (`bin not found at ...`) or herdr's own process exits 127 resolving it.
    Only that shape is worth a reprobe; any other launch failure (dedup,
    workspace/tab RPC errors) reprobing would not explain. */
function isCommandNotFoundShape(message: string): boolean {
  return /\(127\)/.test(message) || /not found at/i.test(message);
}

async function renamePane(runner: HerdrRunner, paneId: string, label: string, log: Logger): Promise<void> {
  try {
    const r = await runner(["pane", "rename", paneId, label]);
    if (r.exitCode !== 0 || r.stdout.includes('"error"')) log.warn({ paneId, out: r.stdout.slice(0, 400) }, "agent: pane rename failed; pane keeps its terminal title");
  } catch (err) {
    log.warn({ err, paneId }, "agent: pane rename failed; pane keeps its terminal title");
  }
}

/** Paint budget for the folder-trust check on a freshly launched pane. */
const TRUST_PAINT_MS = 3_000;

export function createAgentHandlers(opts: {
  db: Database;
  emitEvent: (topic: string, payload?: unknown) => unknown;
  /** Daemon logger, wired from the router's ctx.log; falls back to a lazy child logger for callers (tests) that construct handlers directly. */
  log?: Logger;
  herdrRunner?: HerdrRunner;
  herdrRunnerForSocket?: (socket: string) => HerdrRunner;
  /** The JSON herdr caller the folder-trust driver uses; defaults to the real
      one (`opts.herdr ?? herdrRequest`), never skipped -- a launch whose
      handlers are built without it still checks, against the real socket. */
  herdr?: typeof herdrRequest;
  /** Shortened budgets for tests; the driver's own defaults otherwise. */
  trustBudgets?: { registerBudgetMs?: number; waitBudgetMs?: number; settleMs?: number; stepMs?: number };
  spawnHeadless?: (argv: string[], cwd: string, env: Record<string, string>, opts?: { captureSessionId?: boolean }) => HeadlessChild;
  insertAgentFn?: typeof insertAgent;
  /** The daemon-owned background herdr server `--bg` launches onto (spec "The bg service"). Omitted, `bg: true` is refused. */
  bg?: Pick<BgService, "ensure" | "reprobe">;
  bgClaims?: Pick<BgClaimsStore, "claim" | "releaseByPane">;
  /** herd-lifecycle.ts's watch is idempotent by socket, so an already-watched bg socket is a no-op here. */
  lifecycle?: { watch(socket: string): void };
  /** Suppresses codex's post-launch session-id capture on the herdr path. Set
      only by the in-process CLI fallback (commands/agent-fallback.ts), which
      returns and exits: a detached poll there would either hold the process
      open for the whole timeout or be killed mid-flight. The daemon is
      long-lived, so it leaves this false and always captures. Headless needs
      no equivalent gate: that fallback refuses the headless surface outright,
      before any handler is constructed. */
  skipSessionCapture?: boolean;
}):
  // Direct `unknown`-payload members, not `Pick<TypedHandlers, ...>`: a wider
  // `unknown` param still satisfies TypedHandlers' narrower one at the
  // command-router.ts assembly site (function parameter contravariance).
  & { "agent:start": (payload: unknown) => Promise<CommandResult<"agent:start">> }
  & { "agent:resume": (payload: unknown) => Promise<CommandResult<"agent:resume">> }
  & { "agent:get": (payload: unknown) => Promise<CommandResult<"agent:get">> }
  & { "agent:list": (payload: unknown) => Promise<CommandResult<"agent:list">> } {
  const { db, emitEvent } = opts;
  const log = opts.log ?? lazyChildLogger("agent");
  const spawnHeadless = opts.spawnHeadless ?? defaultSpawnHeadless;
  const insertAgentFn = opts.insertAgentFn ?? insertAgent;
  const skipSessionCapture = opts.skipSessionCapture ?? false;

  async function launch(
    rec: AgentRecord,
    session: AgentInvocation["session"],
    prompt: string | undefined,
    tabLabel: string,
    workspaceLabel: string,
    extra: { env?: Record<string, string>; herdrSocket?: string; trustWaitMs?: number } = {},
  ): Promise<CommandResult<"agent:start">> {
    const gateEnv: Record<string, string> = {
      RT_AGENT_ID: rec.id,
      RT_GATE_SUBJECT: rec.subject ?? agentOwner(rec.id),
      RT_DAEMON_SOCK: DAEMON_SOCK_PATH,
    };
    const settingsPath = resolveHookSettingsPath(rec, log);

    const inv: AgentInvocation = {
      session,
      headless: rec.surface === "headless",
      ...(rec.account !== undefined && { account: rec.account }),
      ...(rec.model !== undefined && { model: rec.model }),
      ...(rec.effort !== undefined && { effort: rec.effort }),
      ...(rec.handle !== undefined && { inboundAccept: true }),
      ...(rec.extraArgs !== undefined && { extraArgs: rec.extraArgs }),
      ...(rec.yolo !== undefined && { yolo: rec.yolo }),
      ...(prompt !== undefined && { prompt }),
      // Headless has no pane shell line for buildPaneCommand to interpolate
      // env into (see the payload.env rejection above); its gate env instead
      // rides the spawnHeadless call itself, below.
      ...(rec.surface === "herdr" && { env: { ...extra.env, ...gateEnv } }),
      ...(settingsPath !== undefined && { settingsPath }),
    };

    if (rec.surface === "herdr") {
      const runner = extra.herdrSocket
        ? (opts.herdrRunnerForSocket ?? ((socket: string) => defaultHerdrRunner({ ...process.env, HERDR_SOCKET_PATH: socket })))(extra.herdrSocket)
        : (opts.herdrRunner ?? defaultHerdrRunner());
      const out = await launchInWorkspace(
        { workspaceLabel, tabLabel, paneCommand: buildAgentPaneCommand(rec.provider as AgentProvider, rec.cwd, inv) },
        runner,
      );
      if (out.focusedExisting) {
        // A live tab already answers to this label: launchInWorkspace
        // focused it and ran nothing. Reporting ok:true here would insert a
        // record with a freshly minted sessionId nothing is listening on —
        // rt agent resume against it would run `claude --resume` for a
        // session that was never started.
        return { ok: false, error: `tab "${tabLabel}" already open; focused it` };
      }
      rec.paneId = out.paneId;
      rec.tabId = out.tabId;
      rec.workspaceId = out.workspaceId;
      // herdr and Flock show a pane's own name over its terminal title. Best
      // effort: the pane is already running, and a thrown rename would roll
      // back the record while leaving its labeled tab behind to dedup every
      // retry. herdr reports a failed rename in its JSON, exit code 0.
      if (rec.label) await renamePane(runner, out.paneId, rec.label, log);
      // Every claude pane the daemon opens gets the folder-trust check, not
      // just the ones herd:spawn opens: a plain `rt agent start` into a fresh
      // directory sat on the dialog until a human cleared it (RT-156). The
      // pane lives on whichever server this launch used, so the driver rides
      // the same socket.
      const trust = rec.provider === "claude"
        ? await acceptTrustOnPane({
          herdr: opts.herdr ?? herdrRequest,
          sock: extra.herdrSocket ? { sockPath: extra.herdrSocket } : {},
          pane: out.paneId, log, context: { agent: rec.id, cwd: rec.cwd },
          // A short settle budget by default: a launch that carries a prompt
          // starts working and never settles, and an interactive `rt agent
          // start` holds its caller open while it waits. The budget is only
          // there to let the dialog paint, which takes about a second, and
          // the screen is read either way afterwards. A caller that already
          // knows its pane needs longer (herd:spawn's own worktree-provision
          // window) passes its own trustWaitMs.
          waitBudgetMs: extra.trustWaitMs ?? TRUST_PAINT_MS,
          ...opts.trustBudgets,
        })
        : undefined;
      if (rec.provider === "codex" && !skipSessionCapture) {
        // `runner`, not the default: a --bg or herd launch put this pane on a
        // socket-scoped herdr server, and defaultHerdrRunner() would poll the
        // ambient visible one, which has never heard of the pane -- the whole
        // budget spent on a server that can only answer "no such pane", and
        // the record left stuck on rt's placeholder uuid forever.
        //
        // rec.sessionId returned to the caller by the handler below is
        // therefore PROVISIONAL for codex: it is rt's placeholder, and this
        // chain replaces the stored value once the real id lands. A response
        // already in flight keeps the old value, so `rt agent resume <that
        // uuid>` stops matching (getAgent keys on id OR session_id) -- the
        // record id stays stable and is the safe handle.
        void herdrAgentSessionId(out.paneId, CODEX_HERDR_SESSION_ID_TIMEOUT_MS, runner).then((sid) => {
          if (sid) updateAgentSessionId(rec.id, sid, db);
          // Two real causes, not one: `herdr integration install codex` is
          // missing/misconfigured, OR (equally likely -- herdr's
          // agent_session only populates once codex completes a turn, per
          // Step 0) this launch carried no prompt and the pane never ran
          // one. Naming only the integration cause here would send someone
          // chasing a nonexistent setup problem on a plain promptless launch.
          else log.warn({ id: rec.id }, "agent: codex herdr launch never reported a session id (either `herdr integration install codex` isn't set up, or the pane never completed a turn -- e.g. this launch had no prompt)");
        }).catch((err) => {
          // The poll has no try/catch around the runner call, so a herdr
          // binary that cannot be resolved rejects the whole chain; detached,
          // that would surface as an unhandled rejection.
          log.warn({ err, id: rec.id }, "agent: codex herdr session-id capture failed");
        });
      }
      // Mutated onto the record rather than spread into a copy: the bg branch
      // in agent:start rewrites rec.paneId into a bg: ref after this returns,
      // and a copy would not carry that rewrite back to the caller.
      if (trust !== undefined) (rec as AgentRecord & { trust?: TrustOutcome }).trust = trust;
      return { ok: true, data: rec };
    }

    const argv = buildAgentArgv(rec.provider as AgentProvider, inv);
    const resultPath = agentResultPath(rec.id);
    rec.resultPath = resultPath;
    mkdirSync(dirname(resultPath), { recursive: true });
    // The caller inserts rec before invoking launch() for every headless
    // path (start and resume alike), so the row already exists here --
    // finishAgent below can never race an insert that hasn't happened yet.
    const child = spawnHeadless(argv, rec.cwd, gateEnv, { captureSessionId: rec.provider === "codex" });
    if (rec.provider === "codex") {
      // Same provisional-sessionId caveat as the herdr branch above: the
      // record this handler returns still carries rt's placeholder uuid, and
      // this chain replaces the stored value when the real id arrives.
      void child.sessionId().then((sid) => {
        if (sid) updateAgentSessionId(rec.id, sid, db);
        else log.warn({ id: rec.id }, "agent: codex headless launch never reported a session id");
      }).catch((err) => {
        log.warn({ err, id: rec.id }, "agent: codex headless session-id capture failed");
      });
    }
    void child.exited.then(async (exitCode) => {
      try {
        writeFileSync(resultPath, await child.stdout());
      } catch (err) {
        log.warn({ err, id: rec.id }, "agent: failed to persist headless result body");
      }
      finishAgent(rec.id, { exitCode, resultPath, finishedAt: Date.now() }, db);
      emitEvent(`agent/done/${rec.id}`, { exitCode });
    });
    return { ok: true, data: rec };
  }

  return {
    "agent:start": async (rawPayload: unknown): Promise<CommandResult<"agent:start">> => {
      if (!rawPayload || typeof rawPayload !== "object") return { ok: false, error: "agent:start requires an object payload" };
      const payload = rawPayload as Commands["agent:start"]["payload"];
      const { repo, cwd } = payload;
      if (!repo || !cwd) return { ok: false, error: "agent:start requires repo (serialized identity) and cwd" };
      if (payload.surface !== undefined && payload.surface !== "herdr" && payload.surface !== "headless") {
        return { ok: false, error: `invalid surface "${payload.surface}"; must be one of herdr, headless` };
      }
      const surface: AgentSurface = payload.surface ?? "herdr";
      const providerRaw = payload.provider ?? fromSetting("agent.provider", log) ?? "claude";
      if (providerRaw !== "claude" && providerRaw !== "codex") {
        return { ok: false, error: `invalid provider "${providerRaw}"; must be one of claude, codex` };
      }
      const provider: AgentProvider = providerRaw;
      if (payload.account !== undefined && provider === "codex") {
        return { ok: false, error: "codex does not support --account in this version (see spec's Non-goals)" };
      }
      if (payload.bg && surface === "headless") {
        return { ok: false, error: "--bg is a herdr-surface option" };
      }
      if (payload.bg && (!opts.bg || !opts.bgClaims || !opts.lifecycle)) {
        return { ok: false, error: "bg launches require the rt daemon (rt daemon start)" };
      }
      const prompt = payload.prompt;
      if (surface === "headless" && !prompt) {
        return { ok: false, error: `headless launch requires a prompt (${headlessStdinBlurb(provider)})` };
      }
      if (payload.env !== undefined && !isStringRecord(payload.env)) {
        return { ok: false, error: "env must be an object of strings" };
      }
      if (payload.env !== undefined && !Object.keys(payload.env).every((k) => ENV_KEY_RE.test(k))) {
        return { ok: false, error: "invalid env key" };
      }
      // Headless spawns argv directly (no pane shell line for buildPaneCommand
      // to interpolate env into), so a silently dropped env would run without
      // the variables the caller thinks it passed.
      if (payload.env !== undefined && surface === "headless") {
        return { ok: false, error: "env is only supported for the herdr surface" };
      }
      if (payload.handle !== undefined && !isValidChatName(payload.handle)) {
        return { ok: false, error: "invalid handle" };
      }
      if (payload.subject !== undefined && (typeof payload.subject !== "string" || payload.subject.length === 0)) {
        return { ok: false, error: "subject must be a non-empty string" };
      }
      if (payload.trustWaitMs !== undefined && (typeof payload.trustWaitMs !== "number" || payload.trustWaitMs <= 0)) {
        return { ok: false, error: "trustWaitMs must be a positive number" };
      }
      const rec: AgentRecord = {
        id: newAgentId(),
        repo, cwd, provider, surface,
        sessionId: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      // Left undefined rather than defaulted to "agent:<id>" when the
      // caller passes no subject: launch()'s
      // gateEnv still falls back to agentOwner(rec.id) for RT_GATE_SUBJECT,
      // and that fallback is a pure function of rec.id, so a later resume
      // recomputing it lands on the exact same value. What DOES change on
      // this field is whether resolveHookSettingsPath sees an explicit
      // subject to gate hook injection on.
      if (payload.subject !== undefined) rec.subject = payload.subject;
      const model = payload.model ?? fromSetting(`agent.${provider}.model`, log);
      const effort = payload.effort ?? fromSetting(`agent.${provider}.effort`, log);
      const extraArgs = payload.extraArgs ?? fromSetting(`agent.${provider}.extraArgs`, log);
      const yolo = payload.yolo ?? fromSetting<boolean>(`agent.${provider}.yolo`, log) ?? false;
      if (model !== undefined) rec.model = model;
      if (effort !== undefined) rec.effort = effort;
      if (extraArgs !== undefined) rec.extraArgs = extraArgs;
      // Stored unconditionally, including false: an explicit `--no-yolo`
      // against a true `agent.<provider>.yolo` setting has to survive into the
      // record, or resume would silently re-derive nothing and leave it unset.
      rec.yolo = yolo;
      if (provider === "claude") {
        const account = payload.account ?? fromSetting("agent.claude.account", log);
        if (account !== undefined) rec.account = account;
      }
      if (payload.label !== undefined) rec.label = payload.label;
      if (payload.caller !== undefined) rec.caller = payload.caller;
      if (surface === "headless") {
        rec.resultPath = agentResultPath(rec.id);
      } else if (payload.handle) {
        rec.handle = payload.handle;
      } else if (provider === "claude") {
        // Headless never signs into chat (see claudeArgs), so reserving a
        // handle for it would only burn an LRU pool slot no one adopts. Nor
        // does codex at any surface: its builders have no chat-handle
        // mechanism (a spec Non-goal), so a reserved handle would be a pool
        // slot spent on a record signed into nothing.
        rec.handle = reserveAgentHandle(db);
      }

      const tabLabel = payload.tab ?? rec.label ?? rec.id;
      const workspaceLabel = payload.workspace ?? repoLabel(repo);
      try {
        // Inserted before launch() runs, not after: launch()'s headless
        // branch arms a completion callback that calls finishAgent, and
        // that row must already exist or the update is a silent no-op.
        // A launch failure below rolls this insert back so no phantom,
        // never-launched record survives it (unlike agent:resume, whose
        // record predates the call and must never be deleted on failure).
        insertAgentFn(rec, db);
        // insertAgent goes through runCriticalWrite: sustained SQLITE_BUSY
        // logs and returns without throwing, so the insert can silently not
        // have happened. Confirm the row exists before ever spawning.
        if (!getAgent(rec.id, db)) {
          return { ok: false, error: "state.db busy: agent not recorded, not launched" };
        }
        // Awaited before launch, not folded into the launch() extras spread:
        // a failed ensure must roll the insert back the same way a failed
        // launch does, and the socket has to be known before launch runs.
        let bgSocket: string | undefined;
        if (payload.bg) {
          const ensured = await opts.bg!.ensure();
          bgSocket = ensured.socket;
          opts.lifecycle!.watch(ensured.socket);
        }
        const effectiveSocket = bgSocket ?? payload.herdrSocket;
        const res = await launch(rec, { kind: "start", sessionId: rec.sessionId }, prompt, tabLabel, workspaceLabel, {
          ...(payload.env !== undefined && { env: payload.env }),
          ...(effectiveSocket !== undefined && { herdrSocket: effectiveSocket }),
          ...(payload.trustWaitMs !== undefined && { trustWaitMs: payload.trustWaitMs }),
        });
        if (!res.ok) {
          deleteAgent(rec.id, db);
          return res;
        }
        // A herd-spawned hidden worker rides the bg socket via herdrSocket,
        // never payload.bg (its claim is the herd's own, not this record's);
        // the ref must still store bg: or agent:resume's wasBg check misses
        // it and relaunches on the visible server. `payload.bg` stays the
        // primary signal (production and every faked-socket test agree on
        // it); the socket-equality check only widens it to the flagless
        // herd:spawn path, where the effective socket really is bgSocketPath().
        if ((payload.bg || effectiveSocket === bgSocketPath()) && rec.paneId) {
          // The pane column and AgentRecord.paneId both store the ref, never
          // the bare pane id: releaseByPane is later called with this same
          // string, and renderRecord/agent:get print it back verbatim.
          rec.paneId = formatPaneRef(rec.paneId, "bg");
        }
        if (payload.bg && rec.paneId) {
          opts.bgClaims!.claim(agentOwner(rec.id), rec.paneId);
        }
        if (surface === "herdr" && rec.paneId && rec.tabId && rec.workspaceId) {
          updateAgentPane(rec.id, { paneId: rec.paneId, tabId: rec.tabId, workspaceId: rec.workspaceId }, db);
        }
        return res;
      } catch (err) {
        deleteAgent(rec.id, db);
        const message = err instanceof Error ? err.message : String(err);
        if (payload.bg && opts.bg && isCommandNotFoundShape(message)) {
          // Advisory only: the failure this branch handles is exactly the
          // case where the bg server may be unhealthy, so the reprobe itself
          // can reject. A reprobe rejection must not replace the launch
          // error the caller actually needs.
          let drift = "";
          try {
            const report = await opts.bg.reprobe();
            if (report.drift.length > 0) drift = `; bg env drift: ${report.drift.join("; ")}`;
          } catch (probeErr) {
            log.warn({ err: probeErr, id: rec.id }, "agent: bg reprobe failed after launch error");
          }
          return { ok: false, error: `${message}${drift}` };
        }
        return { ok: false, error: message };
      }
    },

    "agent:resume": async (rawPayload: unknown): Promise<CommandResult<"agent:resume">> => {
      const payload = rawPayload as Commands["agent:resume"]["payload"];
      const rec = getAgent(payload.id, db);
      if (!rec) return { ok: false, error: `no agent record for "${payload.id}"` };
      if (payload.surface !== undefined && payload.surface !== "herdr" && payload.surface !== "headless") {
        return { ok: false, error: `invalid surface "${payload.surface}"; must be one of herdr, headless` };
      }
      const surface: AgentSurface = payload.surface ?? rec.surface;
      if (surface === "headless" && !payload.prompt) {
        return { ok: false, error: `headless resume requires a prompt (${headlessStdinBlurb(rec.provider as AgentProvider)})` };
      }
      // ↺ prefix: resume tabs must never dedup against the still-open launch
      // tab; repeated resumes share the label and dedup against each other.
      const tabLabel = payload.tab ?? `↺ ${rec.label ?? rec.id}`;
      const workspaceLabel = payload.workspace ?? repoLabel(rec.repo);
      const attempt: AgentRecord = { ...rec, surface };
      // A record whose paneId is a bg: ref was launched on the background
      // server; resuming it must follow it there, or the new pane lands on
      // the visible server while the record still claims to be backgrounded.
      // Surface can be overridden away from herdr on resume (headless has no
      // pane at all), so the bg path only applies when it stays herdr.
      const oldRef = rec.paneId;
      const wasBg = surface === "herdr" && oldRef !== undefined && parsePaneRef(oldRef).server === "bg";
      if (wasBg && (!opts.bg || !opts.bgClaims || !opts.lifecycle)) {
        return { ok: false, error: "bg launches require the rt daemon (rt daemon start)" };
      }
      try {
        let bgSocket: string | undefined;
        if (wasBg) {
          const ensured = await opts.bg!.ensure();
          bgSocket = ensured.socket;
          opts.lifecycle!.watch(ensured.socket);
        }
        const res = await launch(attempt, { kind: "resume", sessionId: rec.sessionId }, payload.prompt, tabLabel, workspaceLabel, {
          ...(bgSocket !== undefined && { herdrSocket: bgSocket }),
        });
        if (!res.ok) return res;
        const now = Date.now();
        markAgentResumed(rec.id, now, db);
        if (wasBg && attempt.paneId) {
          // Same owner, new pane: release the stale claim by the exact ref
          // it was registered under (releaseByPane's own convention), then
          // reclaim under the new ref before it is ever stored, so the DB
          // row and the claim agree from the same instant onward.
          opts.bgClaims!.releaseByPane(oldRef!);
          attempt.paneId = formatPaneRef(attempt.paneId, "bg");
          opts.bgClaims!.claim(agentOwner(rec.id), attempt.paneId);
        }
        if (surface === "herdr" && attempt.paneId && attempt.tabId && attempt.workspaceId) {
          updateAgentPane(rec.id, { paneId: attempt.paneId, tabId: attempt.tabId, workspaceId: attempt.workspaceId }, db);
        }
        return { ok: true, data: { ...(getAgent(rec.id, db) ?? attempt) } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    "agent:get": async (rawPayload: unknown): Promise<CommandResult<"agent:get">> => {
      const payload = rawPayload as Commands["agent:get"]["payload"];
      const rec = getAgent(payload.id, db);
      return rec ? { ok: true, data: rec } : { ok: false, error: `no agent record for "${payload.id}"` };
    },

    "agent:list": async (rawPayload: unknown): Promise<CommandResult<"agent:list">> => {
      const payload = rawPayload as Commands["agent:list"]["payload"];
      return { ok: true, data: { agents: listAgents({ ...(payload.repo !== undefined && { repo: payload.repo }) }, db) } };
    },
  };
}
