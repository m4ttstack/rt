/** gate-ctx@1: structured context riding a gate's or a question's existing
    `context` string as a JSON object whose `"gate-ctx"` key names both the
    shape and its version. Anything that is not a conforming object of a
    known shape parses as null, and the caller renders the string as prose:
    there are no partial parses, and unknown keys are ignored so additive
    fields never need a version bump. */

export type Severity = 'blocking' | 'non-blocking' | 'question' | 'none';
export type VerdictCall =
  'valid' | 'valid-low-value' | 'pushback' | 'needs-clarification' | 'no-ask';
export type Readiness = 'yes' | 'no' | 'with-fixes';
export type FindingSeverity = 'critical' | 'important' | 'minor';
export type Disposition = 'new' | 'still-open' | 'addressed-check';

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

export interface ReviewCtx {
  shape: 'review@1';
  reviewer?: string;
  readiness: Readiness;
  summary: string;
  findings: Record<FindingSeverity, number>;
  round?: number;
  re_review: boolean;
  prior?: { addressed: number; still_open: number };
}

export interface FindingEntry {
  id: string;
  severity: FindingSeverity;
  title: string;
  body: string;
  file?: string;
  fix?: string;
  evidence?: string;
  disposition?: Disposition;
}

export interface FindingsCtx {
  shape: 'findings@1';
  findings: FindingEntry[];
}

export type GateCtx =
  PlanCtx | PostCtx | ThreadCtx | RepliesCtx | ReviewCtx | FindingsCtx;

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
const READINESS = ['yes', 'no', 'with-fixes'] as const;
const FINDING_SEVERITIES = ['critical', 'important', 'minor'] as const;
const DISPOSITIONS = ['new', 'still-open', 'addressed-check'] as const;

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
  if (typeof v !== 'string') reject();
  return v.trim() === '' ? undefined : v;
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : reject();
}

function optRound(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : reject();
}

function optCount(v: unknown): number {
  return v === undefined ? 0 : count(v);
}

function optFlag(v: unknown): boolean {
  if (v === undefined) return false;
  return typeof v === 'boolean' ? v : reject();
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

function readReview(o: Obj): ReviewCtx {
  const findings = obj(o.findings);
  const reviewer = optStr(o.reviewer);
  const round = optRound(o.round);
  const prior = o.prior === undefined ? undefined : obj(o.prior);
  return {
    shape: 'review@1',
    ...(reviewer !== undefined ? { reviewer } : {}),
    readiness: oneOf(o.readiness, READINESS),
    summary: str(o.summary),
    findings: {
      critical: optCount(findings.critical),
      important: optCount(findings.important),
      minor: optCount(findings.minor),
    },
    ...(round !== undefined ? { round } : {}),
    re_review: optFlag(o.re_review),
    ...(prior
      ? {
          prior: {
            addressed: count(prior.addressed),
            still_open: count(prior.still_open),
          },
        }
      : {}),
  };
}

function readFinding(v: unknown): FindingEntry {
  const e = obj(v);
  const file = optStr(e.file);
  const fix = optStr(e.fix);
  const evidence = optStr(e.evidence);
  const disposition =
    e.disposition === undefined
      ? undefined
      : oneOf(e.disposition, DISPOSITIONS);
  return {
    id: str(e.id),
    severity: oneOf(e.severity, FINDING_SEVERITIES),
    title: str(e.title),
    body: str(e.body),
    ...(file !== undefined ? { file } : {}),
    ...(fix !== undefined ? { fix } : {}),
    ...(evidence !== undefined ? { evidence } : {}),
    ...(disposition !== undefined ? { disposition } : {}),
  };
}

function readFindings(o: Obj): FindingsCtx {
  const findings = o.findings;
  if (!Array.isArray(findings)) reject();
  return { shape: 'findings@1', findings: findings.map(readFinding) };
}

const READERS = new Map<string, (o: Obj) => GateCtx>([
  ['plan@1', readPlan],
  ['post@1', readPost],
  ['thread@1', readThread],
  ['replies@1', readReplies],
  ['review@1', readReview],
  ['findings@1', readFindings],
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
