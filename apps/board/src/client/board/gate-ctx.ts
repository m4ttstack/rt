/** gate-ctx@1: structured context riding a gate's or a question's existing
    `context` string as a JSON object whose `"gate-ctx"` key names both the
    shape and its version. Anything that is not a conforming object of a
    known shape parses as null, and the caller renders the string as prose:
    there are no partial parses, and unknown keys are ignored so additive
    fields never need a version bump. */

export type Severity = 'blocking' | 'non-blocking' | 'question' | 'none';
export type VerdictCall =
  'valid' | 'valid-low-value' | 'pushback' | 'needs-clarification' | 'no-ask';

export interface PlanCtx {
  shape: 'plan@1';
  reviewer: string;
  round?: number;
  adjudication?: string;
  threads: { total: number; blocking: number };
}

export interface PostCtx {
  shape: 'post@1';
  reviewer: string;
  round?: number;
  adjudication?: string;
  replies: number;
  fixes: { sha: string }[];
}

export type ThreadReply =
  { kind: 'verbatim' | 'direction'; text: string } | { kind: 'none' };

export interface ThreadCtx {
  shape: 'thread@1';
  author: string;
  severity: Severity;
  claim: { summary: string; points: string[] };
  verdict: { call: VerdictCall; note?: string };
  reply: ThreadReply;
}

export interface ReplyEntry {
  thread: string;
  file: string;
  verb: 'reply' | 'fix';
  sha?: string;
  text: string;
}

export interface RepliesCtx {
  shape: 'replies@1';
  replies: ReplyEntry[];
}

export type GateCtx = PlanCtx | PostCtx | ThreadCtx | RepliesCtx;

type Obj = Record<string, unknown>;

const SEVERITIES = ['blocking', 'non-blocking', 'question', 'none'] as const;
const VERDICT_CALLS = [
  'valid',
  'valid-low-value',
  'pushback',
  'needs-clarification',
  'no-ask',
] as const;
const REPLY_KINDS = ['verbatim', 'direction', 'none'] as const;
const VERBS = ['reply', 'fix'] as const;

class Reject extends Error {}

function reject(): never {
  throw new Reject();
}

function obj(v: unknown): Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Obj)
    : reject();
}

function str(v: unknown): string {
  return typeof v === 'string' && v.trim() !== '' ? v : reject();
}

function optStr(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'string' ? v : reject();
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : reject();
}

function optRound(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : reject();
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : reject();
}

function optList<T>(v: unknown, item: (x: unknown) => T): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v.map(item) : reject();
}

function header(o: Obj): {
  reviewer: string;
  round?: number;
  adjudication?: string;
} {
  const round = optRound(o.round);
  const adjudication = optStr(o.adjudication);
  return {
    reviewer: str(o.reviewer),
    ...(round !== undefined ? { round } : {}),
    ...(adjudication !== undefined ? { adjudication } : {}),
  };
}

function readPlan(o: Obj): PlanCtx {
  const threads = obj(o.threads);
  return {
    shape: 'plan@1',
    ...header(o),
    threads: {
      total: count(threads.total),
      blocking: threads.blocking === undefined ? 0 : count(threads.blocking),
    },
  };
}

function readPost(o: Obj): PostCtx {
  return {
    shape: 'post@1',
    ...header(o),
    replies: count(o.replies),
    fixes: optList(o.fixes, f => ({ sha: str(obj(f).sha) })),
  };
}

function readReply(r: Obj): ThreadReply {
  const kind = oneOf(r.kind, REPLY_KINDS);
  if (kind !== 'none') return { kind, text: str(r.text) };
  optStr(r.text);
  return { kind };
}

function readThread(o: Obj): ThreadCtx {
  const claim = obj(o.claim);
  const verdict = obj(o.verdict);
  const note = optStr(verdict.note);
  return {
    shape: 'thread@1',
    author: str(o.author),
    severity: oneOf(o.severity, SEVERITIES),
    claim: { summary: str(claim.summary), points: optList(claim.points, str) },
    verdict: {
      call: oneOf(verdict.call, VERDICT_CALLS),
      ...(note !== undefined ? { note } : {}),
    },
    reply: readReply(obj(o.reply)),
  };
}

function readEntry(v: unknown): ReplyEntry {
  const e = obj(v);
  const sha = optStr(e.sha);
  return {
    thread: str(e.thread),
    file: str(e.file),
    verb: oneOf(e.verb, VERBS),
    ...(sha !== undefined ? { sha } : {}),
    text: str(e.text),
  };
}

function readReplies(o: Obj): RepliesCtx {
  const replies = o.replies;
  if (!Array.isArray(replies)) reject();
  return { shape: 'replies@1', replies: replies.map(readEntry) };
}

const READERS = new Map<string, (o: Obj) => GateCtx>([
  ['plan@1', readPlan],
  ['post@1', readPost],
  ['thread@1', readThread],
  ['replies@1', readReplies],
]);

export function parseGateCtx(context: string | undefined): GateCtx | null {
  if (!context || context.trimStart()[0] !== '{') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(context);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return null;
  const tag = (raw as Obj)['gate-ctx'];
  const read = typeof tag === 'string' ? READERS.get(tag) : undefined;
  if (!read) return null;
  try {
    return read(raw as Obj);
  } catch (err) {
    if (err instanceof Reject) return null;
    throw err;
  }
}
