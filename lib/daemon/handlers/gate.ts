/**
 * gate:* — typed verbs over the gates store (BOARD-20/21 gate facility).
 * Thin validation + delegation; the store owns CAS/wake/persistence
 * semantics. Mirrors handlers/events.ts's shape and dual-path emit idiom.
 */

import type { Logger } from "pino";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import { gateOptionValue, GATE_BY_PANE } from "../../../packages/rt-client/src/commands.ts";
import type { CommandResult } from "./types.ts";
import type { EventsBus } from "../events-bus.ts";
import type { GatesStore, GateQuestion, GateAnswer, GateRow, GateOrigin } from "../gates-store.ts";
import type { GatePush } from "../gate-push.ts";
import { gateHints } from "../gate-push.ts";
import type { Reconciler } from "../reconciler.ts";

/**
 * gate:answer's two structured rejections: a non-owner's answer and
 * a closed gate both need fields beyond the generic `{ok:false, error}`
 * shape, so this widens just this one verb's result rather than every
 * command in the catalog.
 */
export type GateAnswerResult =
  | CommandResult<"gate:answer">
  | { ok: false; error: "owned-by"; owner: string }
  | { ok: false; error: "gate-closed"; reason: GateRow["closedReason"]; supersededBy?: string };

/** Callers that omit `push` (e.g. handler-only tests) get a no-op: gate:*
    must work identically with or without the delivery layer wired in. */
const noopPush: GatePush = {
  onAnswered: async () => {},
  onOpened: async () => {},
  onClosed: async () => {},
  retryDeadPanes: async () => ({ retried: 0, delivered: 0, gaveUp: 0 }),
};

// gates.db is a shared registry (mirrors events.ts's DEFAULT_LIST_LIMIT
// reasoning exactly): a client that omits `limit` must not be able to force
// a full-table read.
const DEFAULT_LIST_LIMIT = 500;
// Unlike events.ts's bare pass-through, a gate row carries its full
// questions+answers JSON, not a thin envelope -- a client-supplied limit
// still needs a ceiling, or a large explicit value is an oversized socket read.
const MAX_LIST_LIMIT = 1000;
const clampListLimit = (n: number | undefined): number =>
  Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(n ?? DEFAULT_LIST_LIMIT)));

const num = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function isValidQuestion(q: unknown): q is GateQuestion {
  const cand = q as Partial<GateQuestion> | null;
  return (
    typeof cand === "object" && cand !== null &&
    typeof cand.id === "string" && cand.id.length > 0 &&
    typeof cand.label === "string" &&
    typeof cand.multi === "boolean" &&
    Array.isArray(cand.options) && cand.options.every(isValidOption)
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const LABEL_CAP_BYTES = 200;
const CONTEXT_CAP_BYTES = 8192;

function isValidOption(o: unknown): boolean {
  if (typeof o === "string") return true;
  if (!isPlainObject(o)) return false;
  return typeof o.value === "string" && o.value.length > 0 && typeof o.label === "string";
}

function oversizedLabel(questions: GateQuestion[]): string | null {
  for (const q of questions) {
    for (const o of q.options) {
      if (typeof o !== "string" && Buffer.byteLength(o.label, "utf8") > LABEL_CAP_BYTES) {
        return `option label exceeds ${LABEL_CAP_BYTES} bytes (question "${q.id}")`;
      }
    }
  }
  return null;
}

const ORIGIN_STRING_KEYS: ReadonlySet<string> = new Set(["paneId", "tabId", "runId", "worktree"]);
const ORIGIN_FIELD_CAP_BYTES = 1024;

/** Returns an error message on an invalid origin, null when it validates.
    Each string field is capped like label/context: the row and the
    gate/opened payload carry origin verbatim to every surface, so an
    unbounded field defeats the "at-most-8KB payload growth" budget. */
function invalidOrigin(v: unknown): string | null {
  if (!isPlainObject(v)) return "origin must be an object of string fields with presentation form|wait";
  for (const [key, val] of Object.entries(v)) {
    if (key === "presentation") {
      if (val !== "form" && val !== "wait") {
        return "origin must be an object of string fields with presentation form|wait";
      }
      continue;
    }
    if (!ORIGIN_STRING_KEYS.has(key) || typeof val !== "string") {
      return "origin must be an object of string fields with presentation form|wait";
    }
    if (Buffer.byteLength(val, "utf8") > ORIGIN_FIELD_CAP_BYTES) {
      return `origin.${key} exceeds ${ORIGIN_FIELD_CAP_BYTES} bytes`;
    }
  }
  // A pane origin without presentation leaves gate-push unable to decide
  // whether Escape injection is safe: the opener must say "form" or "wait" up front.
  if (typeof v.paneId === "string" && v.paneId.length > 0 && v.presentation === undefined) {
    return 'pane origin requires presentation ("form" or "wait")';
  }
  return null;
}

/** gate-push resolves delivery off `nudge.session`; a malformed nudge would
    silently become "no delivery target" instead of a loud open-time reject. */
function isValidNudge(v: unknown): v is { session: string } {
  return isPlainObject(v) && typeof v.session === "string" && v.session.length > 0;
}

/** A wrapper relaunch opens a fresh gate that supersedes its own prior one
    from the SAME pane; delivering the closed-doorbell there would Escape
    the pane's brand-new form, an avoidable self-interrupt (recoverable via
    the queued doorbell, but not worth causing). Compares the effective
    injectable pane (origin.paneId, else the top-level pane -- the same
    resolution gate-push injects with) first, falling back to nudge.session
    when either side has no pane; with nothing comparable on either axis,
    the two gates are treated as different panes and the push proceeds. */
function sameOpenerPane(a: GateRow, b: GateRow): boolean {
  const paneA = a.origin?.paneId || a.pane;
  const paneB = b.origin?.paneId || b.pane;
  if (paneA && paneB) return paneA === paneB;
  const sessionA = a.nudge?.session;
  const sessionB = b.nudge?.session;
  if (sessionA && sessionB) return sessionA === sessionB;
  return false;
}

/** Both wire shapes carry the same value underneath: bare, or `{value, note?}`
    when the panel attaches free text. Validation reads only the value. */
function unwrapAnswerValue(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "value" in (raw as Record<string, unknown>)) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

/**
 * Option membership is required whenever a question declares options,
 * checked against the unwrapped value (every element, for multi); an
 * empty options array stays free-form. Every question id must also appear
 * as an answers key -- an omitted question is not a legitimate decision
 * (an intentional empty multi-select `{tiers: []}` already satisfies this).
 * The sole validation point before an answer reaches storage.
 */
function validateAnswers(questions: GateQuestion[], answers: Record<string, unknown>): string | null {
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const [qid, raw] of Object.entries(answers)) {
    const question = byId.get(qid);
    if (!question) return `unknown question id: ${qid}`;
    const value = unwrapAnswerValue(raw);
    const isArray = Array.isArray(value);
    if (question.multi && !isArray) return `question ${qid} expects an array (multi)`;
    if (!question.multi && isArray) return `question ${qid} expects a single value`;
    const values = isArray ? (value as unknown[]) : [value];
    if (!values.every((v) => typeof v === "string")) return `question ${qid} value must be a string`;
    if (question.options.length > 0) {
      const members = question.options.map(gateOptionValue);
      for (const v of values as string[]) {
        if (!members.includes(v)) return `answer for "${qid}" is not one of its options: "${v}"`;
      }
    }
  }
  const missing = questions.map((q) => q.id).filter((id) => !(id in answers));
  if (missing.length > 0) return `missing answer(s) for: ${missing.join(", ")}`;
  return null;
}

/** Herd-spawned runs own their gates; everything else (no origin, no runId,
    an unknown run, or a legacy spawner like "shepherdr") falls back to the
    human owner. */
export function deriveOwner(
  origin: GateOrigin | undefined,
  runSpawnedBy?: (runId: string) => string | null,
): string {
  const runId = origin?.runId;
  if (runId && runSpawnedBy) {
    const spawner = runSpawnedBy(runId);
    if (spawner && spawner.startsWith("herd:")) return spawner;
  }
  return "human";
}

/** Module-level, keyed by gateId (not agentId) per the frozen contract: an
    answer-time relaunch and a manual attention-gate "resume" racing the
    SAME gate id share one resumeAgent call rather than spawning a second
    executor. Exported so the single-flight property is directly testable. */
const relaunchInFlight = new Map<string, Promise<{ ok: boolean; error?: string }>>();

export function relaunchExecutor(
  resumeAgent: (agentId: string) => Promise<{ ok: boolean; error?: string }>,
  gateId: string,
  agentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const existing = relaunchInFlight.get(gateId);
  if (existing) return existing;
  const p = resumeAgent(agentId).finally(() => relaunchInFlight.delete(gateId));
  relaunchInFlight.set(gateId, p);
  return p;
}

/** Order-insensitive on object keys, order-sensitive on arrays -- matches
    how a client would legitimately re-POST the same answers payload
    (key order not guaranteed to round-trip identically through JSON). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    if (ak.length !== Object.keys(bo).length) return false;
    return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
  }
  return a === b;
}

interface GuaranteeDeps {
  store: GatesStore;
  reconciler?: Pick<Reconciler, "executorFor" | "expect" | "clear" | "agentIdFor">;
  resumeAgent?: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
  emitExecution: (gateId: string, execution: "unassigned" | null) => void;
}

/**
 * Answer-time executor guarantee (spec "Answer-time executor guarantee"),
 * non-attention gates: confirms the answering pane actually left `blocked`,
 * or actively relaunches a gone one. Scoped to nudge-bearing gates only --
 * a gate with no nudge session has no pane to wake in the first place
 * (mirrors gate-push.ts's own "no nudge means no push").
 */
async function runExecutorGuarantee(row: GateRow, deps: GuaranteeDeps): Promise<void> {
  if (!deps.reconciler || !row.nudge?.session) return;
  const hints = gateHints(row);
  const { state } = deps.reconciler.executorFor(hints);

  if (state === "live" || state === "blocked") {
    deps.reconciler.expect({ gateId: row.id, hints, expect: "leave-blocked", deadlineSweeps: 2, retriesLeft: 2 });
    return;
  }
  if (state !== "gone") return;

  const agentId = deps.reconciler.agentIdFor(row);
  if (!agentId || !deps.resumeAgent) {
    deps.store.markExecution(row.id, "unassigned");
    deps.emitExecution(row.id, "unassigned");
    return;
  }
  const res = await relaunchExecutor(deps.resumeAgent, row.id, agentId);
  if (res.ok) {
    deps.reconciler.expect({ gateId: row.id, agentId, hints, expect: "appear-live", deadlineSweeps: 4, retriesLeft: 0 });
  } else {
    deps.store.markExecution(row.id, "unassigned");
    deps.emitExecution(row.id, "unassigned");
  }
}

/**
 * Attention-gate answers (kind "pane-attention") route by the chosen
 * option instead of tracking pane liveness: the gate itself already names
 * the reconciler's diagnosis (`meta.reason`), the human is choosing what to
 * do about it. "dismiss" and "focus-pane" need nothing beyond the recorded
 * answer -- dismiss just lets the notice go, focus-pane is the board's own
 * client-side affordance.
 */
async function runAttentionRouting(row: GateRow, deps: GuaranteeDeps): Promise<void> {
  if (!deps.reconciler) return;
  const action = unwrapAnswerValue(row.answer?.answers?.["action"]);
  const agentId = typeof row.meta?.["agentId"] === "string" ? (row.meta["agentId"] as string) : undefined;
  if (!agentId) return;

  if (action === "clear") {
    deps.reconciler.clear(agentId);
    return;
  }
  if (action !== "resume") return; // "dismiss" / "focus-pane": no server-side action.

  if (!deps.resumeAgent) {
    deps.store.markExecution(row.id, "unassigned");
    deps.emitExecution(row.id, "unassigned");
    return;
  }
  const res = await relaunchExecutor(deps.resumeAgent, row.id, agentId);
  if (res.ok) {
    deps.reconciler.expect({ gateId: row.id, agentId, hints: gateHints(row), expect: "appear-live", deadlineSweeps: 4, retriesLeft: 0 });
  } else {
    deps.store.markExecution(row.id, "unassigned");
    deps.emitExecution(row.id, "unassigned");
  }
}

async function dispatchGuarantee(row: GateRow, deps: GuaranteeDeps): Promise<void> {
  if (row.kind === "pane-attention") await runAttentionRouting(row, deps);
  else await runExecutorGuarantee(row, deps);
}

export function createGateHandlers(
  store: GatesStore,
  bus: EventsBus,
  broadcast: (type: string, data: any) => void,
  deps: {
    push?: GatePush; log?: Logger;
    runSpawnedBy?: (runId: string) => string | null;
    /** Resolves a herd id to its shepherd's live session, for the owner guard below. */
    herdShepherd?: (herdId: string) => string | null;
    /** Answer-time executor guarantee (spec "Answer-time executor
        guarantee"): omitted, gate:answer's post-record side effects reduce
        to today's push-only behavior. */
    reconciler?: Pick<Reconciler, "executorFor" | "expect" | "clear" | "agentIdFor">;
    /** The daemon's agent:resume verb, exposed the same way the reconciler
        itself consumes it -- one shared closure, wired in lib/daemon.ts. */
    resumeAgent?: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
  } = {},
): { "gate:open": (payload: unknown) => Promise<CommandResult<"gate:open">> }
  & { "gate:answer": (payload: unknown) => Promise<GateAnswerResult> }
  & { "gate:wait": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"gate:wait">> }
  & { "gate:list": (payload: unknown) => Promise<CommandResult<"gate:list">> }
  & { "gate:park": (payload: unknown) => Promise<CommandResult<"gate:park">> }
  & { "gate:close": (payload: unknown) => Promise<CommandResult<"gate:close">> }
  & { "gate:subscribe": (payload: unknown) => Promise<CommandResult<"gate:subscribe">> }
  & { "gate:unsubscribe": (payload: unknown) => Promise<CommandResult<"gate:unsubscribe">> }
  & { "gate:subscriptions": (payload: unknown) => Promise<CommandResult<"gate:subscriptions">> } {
  const push = deps.push ?? noopPush;
  const log = deps.log;
  const runSpawnedBy = deps.runSpawnedBy;
  const herdShepherd = deps.herdShepherd;
  // Fire-and-forget: a push/fan-out failure must never fail the verb that
  // triggered it. The promise itself is not expected to reject (gate-push
  // catches and records delivery outcomes internally), but a logged catch
  // guards against anything unexpected escaping that contract.
  const firePush = (promise: Promise<void>, context: Record<string, unknown>): void => {
    promise.catch((err) => log?.warn({ err, ...context }, "gate-push: fire-and-forget push failed"));
  };

  // Shared dual-path emit (journal emitAt + broadcast, one timestamp) for
  // every lifecycle topic below -- mirrors the events:emit handler's path,
  // the only one live subscribers (board relay, notify bridge) ever see.
  const emitGateEvent = (topic: string, payload: Record<string, unknown>, emittedAt: number): void => {
    const eventId = bus.emitAt(topic, payload, emittedAt);
    broadcast("event", { id: eventId, topic, payload, emittedAt });
  };

  const emitReleased = (row: GateRow, emittedAt: number): void => {
    emitGateEvent(`gate/released/${row.id}`, {
      id: row.id, subject: row.subject, kind: row.kind, paneId: row.pane, delivery: row.delivery,
    }, emittedAt);
  };

  // Mirrors reconciler.ts's own emit of this topic for the sweep-driven
  // path (checkExpectations): the answer-time guarantee is the other place
  // "unassigned"/cleared execution gets decided.
  const emitExecution = (gateId: string, execution: "unassigned" | null): void => {
    emitGateEvent("reconciler.execution", { gateId, execution }, Date.now());
  };

  const guaranteeDeps: GuaranteeDeps = {
    store,
    reconciler: deps.reconciler,
    resumeAgent: deps.resumeAgent,
    emitExecution,
  };

  // Off the hot path (response already built): delivers nudge+Escape as
  // today, THEN runs the executor guarantee against a freshly-read
  // reconciler state -- never awaited by the handler itself.
  const firePostAnswerEffects = (row: GateRow): void => {
    const run = async () => {
      await push.onAnswered(row);
      await dispatchGuarantee(row, guaranteeDeps);
    };
    run().catch((err) => log?.warn({ err, gateId: row.id, kind: row.kind }, "gate:answer: post-answer executor guarantee failed"));
  };

  // Controller ruling: a retried answer (already-answered, unassigned,
  // identical answers) re-runs ONLY the guarantee -- the original push
  // already delivered, so it is not repeated.
  const fireGuaranteeRetry = (row: GateRow): void => {
    dispatchGuarantee(row, guaranteeDeps)
      .catch((err) => log?.warn({ err, gateId: row.id, kind: row.kind }, "gate:answer: retry executor guarantee failed"));
  };

  return {
    "gate:open": async (rawPayload: unknown) => {
      const payload = rawPayload as Commands["gate:open"]["payload"] | undefined;
      const subject = typeof payload?.subject === "string" ? payload.subject.trim() : "";
      const kind = typeof payload?.kind === "string" ? payload.kind.trim() : "";
      const colonAt = subject.indexOf(":");
      if (!subject || colonAt === -1 || colonAt === subject.length - 1) return { ok: false as const, error: "invalid subject" };
      if (!kind) return { ok: false as const, error: "missing kind" };
      const questions = payload?.questions;
      if (!Array.isArray(questions) || questions.length === 0 || !questions.every(isValidQuestion)) {
        return { ok: false as const, error: "invalid questions" };
      }
      const ids = questions.map((q) => q.id);
      if (new Set(ids).size !== ids.length) return { ok: false as const, error: "duplicate question id" };
      if (payload?.meta !== undefined && !isPlainObject(payload.meta)) {
        return { ok: false as const, error: "meta must be a plain object" };
      }
      if (payload?.agent !== undefined && typeof payload.agent !== "string") {
        return { ok: false as const, error: "agent must be a string" };
      }
      if (payload?.pane !== undefined && typeof payload.pane !== "string") {
        return { ok: false as const, error: "pane must be a string" };
      }
      if (payload?.nudge !== undefined && !isValidNudge(payload.nudge)) {
        return { ok: false as const, error: "nudge must be an object with a string session" };
      }
      const labelError = oversizedLabel(questions);
      if (labelError) return { ok: false as const, error: labelError };
      if (payload?.context !== undefined) {
        if (typeof payload.context !== "string") return { ok: false as const, error: "context must be a string" };
        if (Buffer.byteLength(payload.context, "utf8") > CONTEXT_CAP_BYTES) {
          return { ok: false as const, error: `context exceeds ${CONTEXT_CAP_BYTES} bytes` };
        }
      }
      if (payload?.origin !== undefined) {
        const originError = invalidOrigin(payload.origin);
        if (originError) return { ok: false as const, error: originError };
        // A form-presentation gate answered from another surface is
        // completed by doorbell-then-Escape; without a nudge session and an
        // injectable pane it opens as a gate no surface can ever unblock
        // (SKILLS-60), so refuse it here instead of blocking a pane forever.
        if (payload.origin.presentation === "form") {
          if (!payload.origin.paneId && !payload.pane) {
            return { ok: false as const, error: 'presentation "form" requires an injectable pane: set origin.paneId or the top-level pane' };
          }
          if (payload.nudge === undefined) {
            return { ok: false as const, error: 'presentation "form" requires a nudge session: the doorbell the Escape follows has no target without it' };
          }
        }
      }

      // Non-pane origins (run/tab/worktree-only) have no Escape seam to
      // guard, so they default to "wait" rather than forcing every caller
      // to spell it out; an explicit value always wins (spread order).
      const origin = payload?.origin ? { presentation: "wait" as const, ...payload.origin } : undefined;

      const owner = deriveOwner(origin, runSpawnedBy);
      const { row, supersededId } = store.open({
        subject, kind, questions,
        meta: payload?.meta, agent: payload?.agent, pane: payload?.pane, nudge: payload?.nudge,
        context: payload?.context, origin, owner,
      });

      // One timestamp for both the journal row and the broadcast frame (events:emit idiom).
      const emittedAt = Date.now();
      const label = typeof row.meta?.label === "string" ? row.meta.label : row.kind;
      const eventPayload = {
        id: row.id, subject: row.subject, kind: row.kind, questions: row.questions,
        meta: row.meta, agent: row.agent, paneId: row.pane, label,
        context: row.context, origin: row.origin, owner: row.owner,
      };
      emitGateEvent(`gate/opened/${row.id}`, eventPayload, emittedAt);

      // The supersede rule closes the old gate in the SAME store transaction;
      // its closed event fires here, alongside the opener's, sharing the
      // timestamp -- same subject/kind as the new gate (supersede only ever
      // matches on both), so no extra row fetch is needed.
      if (supersededId) {
        emitGateEvent(`gate/closed/${supersededId}`, {
          id: supersededId, subject: row.subject, kind: row.kind,
          reason: "superseded", supersededBy: row.id,
        }, emittedAt);
        // Fetched fresh (unlike the event payload above): a form-blocked pane
        // on the superseded gate never gets an answer, so it needs the same
        // doorbell-then-Escape delivery onAnswered gives a real answer.
        const supersededRow = store.get(supersededId);
        if (supersededRow && !sameOpenerPane(row, supersededRow)) {
          firePush(push.onClosed(supersededRow), { verb: "gate:open", gateId: supersededRow.id });
        }
      }

      firePush(push.onOpened(row), { verb: "gate:open", gateId: row.id });

      return { ok: true as const, data: { id: row.id, supersededId } };
    },

    "gate:answer": async (rawPayload: unknown) => {
      const payload = rawPayload as Commands["gate:answer"]["payload"] | undefined;
      const id = typeof payload?.id === "string" ? payload.id.trim() : "";
      const by = typeof payload?.by === "string" ? payload.by.trim() : "";
      if (!id) return { ok: false as const, error: "missing id" };
      if (!by) return { ok: false as const, error: "missing by" };
      const answers = payload?.answers;
      if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
        return { ok: false as const, error: "missing answers" };
      }

      const gate = store.get(id);
      if (!gate) return { ok: false as const, error: "not-found" };

      // A closed gate is a terminal rejection, checked before ownership or
      // shape: a caller answering a superseded gate needs to know what
      // replaced it, not that it lacks permission to answer a dead row.
      if (gate.status === "closed") {
        return {
          ok: false as const, error: "gate-closed", reason: gate.closedReason,
          ...(gate.supersededBy ? { supersededBy: gate.supersededBy } : {}),
        };
      }

      // Herd-owned gates require the owning shepherd's own session (or the
      // answering pane itself, or an explicit human --override); a null/
      // "human" owner is open to any caller.
      const owner = gate.owner;
      if (owner?.startsWith("herd:") && payload?.override !== true && by !== GATE_BY_PANE) {
        const shepherd = herdShepherd?.(owner.slice("herd:".length)) ?? null;
        const session = typeof payload?.session === "string" ? payload.session : "";
        if (!shepherd || session !== shepherd) return { ok: false as const, error: "owned-by", owner };
      }

      const validationError = validateAnswers(gate.questions, answers as Record<string, unknown>);
      if (validationError) return { ok: false as const, error: validationError };

      const result = store.answer(id, answers as GateAnswer["answers"], by, { overridden: payload?.override === true });
      const emittedAt = Date.now();

      if (result.ok) {
        const row = result.row;
        const eventPayload = {
          id: row.id, subject: row.subject, kind: row.kind,
          answers: row.answer?.answers, by, paneId: row.pane,
        };
        emitGateEvent(`gate/answered/${row.id}`, eventPayload, emittedAt);
        firePostAnswerEffects(row);
        // Winner-path release (by === "pane") shares the answer's timestamp:
        // one transaction, one moment, two events.
        if (result.released) emitReleased(row, emittedAt);
        return { ok: true as const, data: { row } };
      }

      // Loser-path release: a CAS-losing pane still proves it reconciled.
      if (result.released) emitReleased(result.row!, emittedAt);

      // A CAS loss is a defined outcome, not an error: the loser gets the
      // winning row typed, not an envelope hack. Controller ruling: when
      // the recorded execution is "unassigned" and the posted answers
      // deep-equal what's on the row, this is a RETRY of the same request
      // (not a genuine conflict) -- re-run the guarantee and return ok
      // clean, never conflict:true.
      if (result.reason === "already-answered") {
        const recordedRow = result.row!;
        if (recordedRow.execution === "unassigned" && deepEqual(recordedRow.answer?.answers, answers)) {
          fireGuaranteeRetry(recordedRow);
          return { ok: true as const, data: { row: recordedRow } };
        }
        return { ok: true as const, data: { row: recordedRow, conflict: true } };
      }
      return { ok: false as const, error: result.reason };
    },

    // Widened-Handler shape: receives the request AbortSignal from the seam,
    // same as events:wait, so a dead client's waiter is removed rather than
    // lingering to the cap. Clamping to 240s lives in gates-store.wait.
    "gate:wait": async (rawPayload: unknown, signal?: AbortSignal) => {
      const payload = rawPayload as Commands["gate:wait"]["payload"] | undefined;
      const id = typeof payload?.id === "string" ? payload.id.trim() : "";
      if (!id) return { ok: false as const, error: "missing id" };
      const result = await store.wait(id, { waitMs: num(payload?.waitMs), signal });
      if (result.status === "not-found") return { ok: false as const, error: "not-found" };
      if (result.status === "timeout") return { ok: true as const, data: { status: "timeout" as const } };
      return { ok: true as const, data: { status: result.status, row: result.row } };
    },

    "gate:list": async (rawPayload: unknown) => {
      const payload = rawPayload as Commands["gate:list"]["payload"] | undefined;
      const { gates, cursor } = store.list({
        open: payload?.open,
        subjectPrefix: payload?.subjectPrefix,
        kind: payload?.kind,
        cursor: num(payload?.cursor),
        limit: clampListLimit(num(payload?.limit)),
      });
      return { ok: true as const, data: { gates, cursor } };
    },

    "gate:park": async (rawPayload: unknown) => {
      const payload = rawPayload as Commands["gate:park"]["payload"] | undefined;
      const id = typeof payload?.id === "string" ? payload.id.trim() : "";
      if (!id) return { ok: false as const, error: "missing id" };
      const result = store.park(id);
      if (result.ok) {
        const row = store.get(id)!;
        emitGateEvent(`gate/parked/${row.id}`, { id: row.id, subject: row.subject, kind: row.kind }, Date.now());
        return { ok: true as const, data: { ok: true as const } };
      }
      return { ok: false as const, error: result.reason };
    },

    "gate:close": async (rawPayload: unknown) => {
      const payload = rawPayload as Commands["gate:close"]["payload"] | undefined;
      const id = typeof payload?.id === "string" ? payload.id.trim() : "";
      const reason = payload?.reason;
      if (!id) return { ok: false as const, error: "missing id" };
      if (reason !== "abandoned" && reason !== "superseded" && reason !== "pruned") {
        return { ok: false as const, error: "invalid reason" };
      }
      const result = store.close(id, reason);
      if (result.ok) {
        const row = store.get(id)!;
        emitGateEvent(`gate/closed/${row.id}`, { id: row.id, subject: row.subject, kind: row.kind, reason: row.closedReason }, Date.now());
        firePush(push.onClosed(row), { verb: "gate:close", gateId: row.id });
        return { ok: true as const, data: { ok: true as const } };
      }
      return { ok: false as const, error: result.reason };
    },

    "gate:subscribe": async (rawPayload: unknown) => {
      const payload = rawPayload as Commands["gate:subscribe"]["payload"] | undefined;
      const subjectPrefix = typeof payload?.subjectPrefix === "string" ? payload.subjectPrefix.trim() : "";
      const session = typeof payload?.session === "string" ? payload.session.trim() : "";
      const isOwnerScope = payload?.scope === "owner";
      const ownerRef = typeof payload?.ownerRef === "string" ? payload.ownerRef.trim() : "";
      if (!session) return { ok: false as const, error: "missing session" };
      // Owner rows carry an empty subjectPrefix by design (they route on
      // row.owner, not on subject), so the prefix-required check below is
      // only for prefix-scoped rows.
      if (isOwnerScope) {
        if (!ownerRef.startsWith("herd:")) return { ok: false as const, error: 'scope "owner" requires ownerRef starting "herd:"' };
      } else if (!subjectPrefix) {
        return { ok: false as const, error: "missing subjectPrefix" };
      }
      const sub = store.subscribe({
        subjectPrefix, session,
        ...(isOwnerScope && { scope: "owner" as const, ownerRef }),
      });
      return { ok: true as const, data: { id: sub.id } };
    },

    "gate:unsubscribe": async (rawPayload: unknown) => {
      const payload = rawPayload as Commands["gate:unsubscribe"]["payload"] | undefined;
      const id = typeof payload?.id === "string" ? payload.id.trim() : "";
      if (!id) return { ok: false as const, error: "missing id" };
      const removed = store.unsubscribe(id);
      return { ok: true as const, data: { removed } };
    },

    "gate:subscriptions": async (rawPayload: unknown) => {
      const payload = rawPayload as Commands["gate:subscriptions"]["payload"] | undefined;
      const session = typeof payload?.session === "string" ? payload.session.trim() : "";
      const subscriptions = store.subscriptions({ live: payload?.live, session: session || undefined });
      return { ok: true as const, data: { subscriptions } };
    },
  };
}
