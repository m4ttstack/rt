import type { GateAnswers, GateAnswerValue, GateOption, GateQuestion } from "../../gates/store.ts";

/** Which board lifecycle a gate kind belongs to. Deliberately re-declared
    rather than imported from gates/sweep.ts's own domainForKind: that
    module's type imports reach doctor-state.ts, which imports herdr.ts for
    real (Bun.spawn and friends) -- pulling it into this client program
    would both break the browser build (server-only fs/child_process code
    has no business in it) and fail typecheck (the client tsconfig carries
    no Bun globals). Kept in sync with GATE_KINDS/domainForKind by the
    gate-format test suite exercising the same kind strings. */
export type GateDomain = "review" | "respond" | "doctor";

/** UI-collected picks, keyed by question id: an array for a `multi`
    question's checked options, a bare string for a single-select's radio. */
export type GateSelections = Record<string, string | string[]>;

/** The subset of a gate GateCard needs to shape a payload: which gate the
    answer addresses, and which questions must be answered. */
export interface GateForAnswer {
  gateId: string;
  questions: GateQuestion[];
}

export interface GateAnswerPayload {
  gateId: string;
  answers: GateSelections;
}

/**
 * Shapes UI-collected selections into the `/gate/answer` POST body: a
 * `multi` question's selection becomes a string array, a single-select's
 * becomes a bare string. Every question with at least one option is
 * required -- the moment one's selection is missing or empty, this returns
 * null instead of a partial payload, so a caller can disable submit (or
 * skip the fetch) on that alone rather than let an incomplete answer reach
 * the server. A zero-option question (e.g. a `tiers` question when a clean
 * review reports no severity levels) has nothing to select, so it is
 * excluded from the required set entirely -- otherwise a clean review's
 * gate would have no possible answer and could never be closed.
 */
export function gateAnswerPayload(gate: GateForAnswer, selections: GateSelections): GateAnswerPayload | null {
  const answers: GateSelections = {};
  for (const q of gate.questions) {
    if (q.options.length === 0) continue;
    const value = selections[q.id];
    if (q.multi) {
      if (!Array.isArray(value) || value.length === 0) return null;
      answers[q.id] = value;
    } else {
      if (typeof value !== "string" || value.length === 0) return null;
      answers[q.id] = value;
    }
  }
  return { gateId: gate.gateId, answers };
}

export interface UnwrappedGateAnswer {
  value: string | string[];
  note?: string;
}

/**
 * Normalizes one answer's wire value into a uniform shape a renderer can
 * read without its own type check: a bare option string/array passes
 * through as `{value}`, and the wrapper's note form (`{value, note}`)
 * unwraps to the same shape with `note` carried alongside. GateCard uses
 * this so the object form (posted whenever a human's pane answer carries
 * free text) renders instead of crashing React on an object child.
 */
export function unwrapGateAnswer(raw: GateAnswerValue): UnwrappedGateAnswer {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw) && "value" in raw) {
    return { value: raw.value, note: raw.note };
  }
  return { value: raw };
}

export interface GateAnswerConflict {
  answers: GateAnswers;
  by: string;
}

/**
 * Parses the body of a 409 `/gate/answer` response (`{ok:false, conflict:true,
 * row}`) into the winning answer GateCard renders in place of the generic
 * retry-failure text -- a 409 means an answer WAS recorded, just not this
 * caller's. Tolerant of a missing or malformed row: the daemon's CAS win is
 * real even if the body somehow lost its answer, so this never throws.
 */
export function parseConflictResponse(body: unknown): GateAnswerConflict {
  const row = (body as { row?: { answer?: { answers?: GateAnswers; by?: string } } } | null)?.row;
  return { answers: row?.answer?.answers ?? {}, by: row?.answer?.by ?? "" };
}

export interface GateOptionDisplay {
  /** What to render. */
  text: string;
  /** The full option string, when it differs from `text` -- callers put this
      in a `title` attr so the truncated form stays inspectable. */
  title?: string;
}

/** A `<verb>:<token>` option whose token is long enough to be a real id
    (thread hash, gate id, ...) rather than a short human word like
    "addressed". Only these get compacted -- see formatGateOption. */
const VERB_TOKEN_OPTION = /^([a-z][a-z-]*):(.{12,})$/;

/**
 * Display-only transform for one gate option string. `formatGateOption`
 * NEVER changes what gets submitted -- GateQuestionField and
 * GateAnswerSummary both render `text` but keep passing the original
 * `option`/`value` string to onChange/gateAnswerPayload, so a `reply:<id>`
 * option answers with the id verbatim no matter how it displays.
 *
 * A `verb:longtoken` option (e.g. `fix:7080da2fcf93c1a2`, a thread id the
 * respond gate can't shorten without breaking the reply/fix/skip join back
 * to the report) renders as the verb plus the token's first 8 characters,
 * with the full string carried in `title`. Everything else -- a bare word
 * like "approve"/"comment", or a `verb:value` pair whose value reads as a
 * short human word rather than an id -- renders unchanged.
 */
export function formatGateOption(option: string): GateOptionDisplay {
  const m = VERB_TOKEN_OPTION.exec(option);
  if (!m) return { text: option };
  const [, verb, token] = m;
  return { text: `${verb} · ${token!.slice(0, 8)}`, title: option };
}

export function optionValue(o: GateOption): string {
  return typeof o === "string" ? o : o.value;
}

/** Labeled options render their label with the raw value as the hover
    title; bare strings keep the verb-token transform unchanged. */
export function optionDisplayFor(o: GateOption): GateOptionDisplay {
  if (typeof o !== "string") {
    const text = o.label || o.value;
    return text === o.value ? { text } : { text, title: o.value };
  }
  return formatGateOption(o);
}

export function displayForValue(value: string, options: GateOption[]): GateOptionDisplay {
  const match = options.find((o) => optionValue(o) === value);
  return match !== undefined ? optionDisplayFor(match) : formatGateOption(value);
}

/** The three verbs a respond-plan thread question ever offers. Grouping
    (see `groupThreadOptions`) only fires when every option is one of these
    verbs paired with a thread token -- any other verb leaves the question
    flat, since there'd be no fixed radio row to render. */
const THREAD_VERBS = ["reply", "fix", "skip"] as const;
type ThreadVerb = (typeof THREAD_VERBS)[number];
const THREAD_OPTION = /^(reply|fix|skip):(.+)$/;

export interface ThreadOptionEntry {
  verb: ThreadVerb;
  value: string;
  option: GateOption;
}

export interface ThreadOptionGroup {
  /** The raw token shared by this thread's verb options (e.g. a thread hash). */
  token: string;
  /** What to show as the group's heading -- a labeled option's "verb · <thread
      text>" suffix when present, else the token's own short form. */
  heading: string;
  /** This thread's verb options, ordered reply/fix/skip regardless of the
      question's original option order. */
  entries: ThreadOptionEntry[];
}

/** Pulls the human thread text back out of a labeled option's "verb · <thread
    text>" label (the same join `formatGateOption`/the server use), so the
    group heading reads as the thread rather than repeating a verb. Falls back
    to the token's short form when no option in the group carries a label. */
function threadHeading(token: string, entries: ThreadOptionEntry[]): string {
  for (const { verb, option } of entries) {
    if (typeof option === "string") continue;
    const prefix = `${verb} · `;
    if (option.label.startsWith(prefix)) return option.label.slice(prefix.length);
  }
  return token.slice(0, 8);
}

/**
 * Detects the shape a respond-plan threads question renders as N*3 flat
 * checkboxes: every option a `(reply|fix|skip):<token>` pair, spanning 2+
 * distinct tokens, each token offering the identical verb set. When it
 * matches, returns one group per token (for GateQuestionField to render as a
 * heading plus a compact verb radio row); returns null for any other shape
 * so the caller renders the flat checkbox list unchanged.
 *
 * Selection semantics are unaffected either way -- this only decides how the
 * options are grouped for display, never which values a token's entries
 * carry.
 */
export function groupThreadOptions(options: GateOption[]): ThreadOptionGroup[] | null {
  const byToken = new Map<string, ThreadOptionEntry[]>();
  for (const opt of options) {
    const value = optionValue(opt);
    const m = THREAD_OPTION.exec(value);
    if (!m) return null;
    const [, verb, token] = m as unknown as [string, ThreadVerb, string];
    const list = byToken.get(token) ?? [];
    list.push({ verb, value, option: opt });
    byToken.set(token, list);
  }
  if (byToken.size < 2) return null;
  const verbSetKey = (entries: ThreadOptionEntry[]) =>
    [...entries.map((e) => e.verb)].sort().join(",");
  const keys = [...byToken.values()].map(verbSetKey);
  if (new Set(keys).size > 1) return null;
  return [...byToken.entries()].map(([token, entries]) => {
    const ordered = [...entries].sort((a, b) => THREAD_VERBS.indexOf(a.verb) - THREAD_VERBS.indexOf(b.verb));
    return { token, heading: threadHeading(token, ordered), entries: ordered };
  });
}

export const RESPOND_PLAN_KIND = "respond-plan";
export const CODE_CHANGES_QUESTION_ID = "code-changes";
export const CODE_CHANGES_SENTINEL = "skip";

/** The respond collapse keys off the gate's own option set: only a
    respond-plan gate whose code-changes question carries the sentinel
    participates, so old gates render exactly as before. */
export function codeChangesHidden(
  kind: string,
  questions: GateQuestion[],
  selections: GateSelections,
): boolean {
  if (kind !== RESPOND_PLAN_KIND) return false;
  const q = questions.find((x) => x.id === CODE_CHANGES_QUESTION_ID);
  if (!q || !q.options.some((o) => optionValue(o) === CODE_CHANGES_SENTINEL)) return false;
  for (const [qid, sel] of Object.entries(selections)) {
    if (qid === CODE_CHANGES_QUESTION_ID) continue;
    const values = Array.isArray(sel) ? sel : [sel];
    if (values.some((v) => typeof v === "string" && v.startsWith("fix:"))) return false;
  }
  return true;
}
