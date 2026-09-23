import { optionValue, unwrapGateAnswer } from '@mattstack/gate-kit';
import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import {
  parseGateCtx,
  type PostCtx,
  type ReplyEntry,
  type ThreadCtx,
} from './gate-ctx.ts';

export type PlanVerb = 'reply' | 'fix' | 'skip';

const PLAN_VERBS: readonly PlanVerb[] = ['reply', 'fix', 'skip'];

/** One thread of a respond-post gate, drawn with its plan-step card. */
export interface JoinedThread {
  threadId: string;
  /** The plan question's label: the thread's file:line. */
  label: string;
  /** Claim, verdict and severity, from the plan gate. */
  thread: ThreadCtx;
  /** The final reply this gate offers; absent when it offers none for the
      thread: skipped, a fix held back, or a reply-only thread, which posts
      without this gate's pick (see `replyOnly`). */
  reply?: ReplyEntry;
  /** The plan-step pick, when the plan gate recorded one. */
  decided?: PlanVerb;
  /** A thread Gate 1 decided `reply` that this gate does not offer: its
      reply posts once this gate proceeds, as `text` reads. `edited` when
      the text is the developer's Gate 1 edit rather than the draft. */
  replyOnly?: { text: string; edited: boolean };
}

/** Plan option values are `<verb>:<threadId>`, one thread per question. */
function threadIdOf(options: GateRow['questions'][number]['options']): string {
  const value = options[0] ? optionValue(options[0]) : '';
  return value.slice(value.indexOf(':') + 1);
}

function verbOf(value: string): PlanVerb | undefined {
  const verb = value.slice(0, value.indexOf(':'));
  return PLAN_VERBS.find(v => v === verb);
}

/** The plan gate a post gate follows: the MR's latest answered respond-plan
    in the same round, else the newest matching plan when none is answered.
    A flattened context has no round, so a newer plan still open must not
    shadow the answered one. */
function planGateFor(
  ctx: PostCtx,
  mr?: BoardMRWithReview
): GateRow | undefined {
  const plans = (mr?.gates ?? [])
    .filter(g => {
      if (g.kind !== 'respond-plan') return false;
      const plan = parseGateCtx(g.context);
      return (
        plan?.shape === 'plan@1' &&
        (ctx.round === undefined ||
          plan.round === undefined ||
          plan.round === ctx.round)
      );
    })
    .sort((a, b) => b.openedAt - a.openedAt);
  return plans.find(g => g.status === 'answered') ?? plans[0];
}

/** The matched plan's thread ids in question order. */
export function planThreadOrder(
  ctx: PostCtx,
  mr?: BoardMRWithReview
): string[] {
  return (planGateFor(ctx, mr)?.questions ?? []).flatMap(q => {
    const first = q.options[0] ? optionValue(q.options[0]) : '';
    return verbOf(first) ? [threadIdOf(q.options)] : [];
  });
}

/** A respond-post gate's replies joined to the plan gate's threads by
    thread id, in plan order. Null when the replies and the question's
    `offered` option values are not one to one, when no plan gate matches,
    or when a reply names a thread the plan does not have, so the sheet
    falls back to the plain checklist rather than drawing a card it cannot
    fill or a pick it cannot post. */
export function joinPlan(
  ctx: PostCtx,
  replies: ReplyEntry[],
  offered: readonly string[],
  mr?: BoardMRWithReview
): JoinedThread[] | null {
  const threads = new Set(replies.map(r => r.thread));
  if (
    threads.size !== replies.length ||
    threads.size !== new Set(offered).size ||
    offered.some(v => !threads.has(v))
  )
    return null;
  const plan = planGateFor(ctx, mr);
  if (!plan) return null;
  const joined: JoinedThread[] = [];
  for (const q of plan.questions) {
    const thread = parseGateCtx(q.context);
    if (thread?.shape !== 'thread@1') continue;
    const threadId = threadIdOf(q.options);
    if (!threadId) continue;
    const raw = plan.answers?.[q.id];
    const answer = raw === undefined ? undefined : unwrapGateAnswer(raw);
    const decided =
      typeof answer?.value === 'string' ? verbOf(answer.value) : undefined;
    const reply = replies.find(r => r.thread === threadId);
    const text =
      answer?.text ??
      (thread.reply.kind === 'verbatim' ? thread.reply.text : undefined);
    const replyOnly =
      decided === 'reply' && !reply && text !== undefined
        ? { text, edited: answer?.text !== undefined }
        : undefined;
    joined.push({
      threadId,
      label: q.label,
      thread,
      ...(reply ? { reply } : {}),
      ...(decided ? { decided } : {}),
      ...(replyOnly ? { replyOnly } : {}),
    });
  }
  if (replies.some(r => !joined.some(j => j.threadId === r.thread)))
    return null;
  return joined;
}

/** A Gate 1 reply-only thread read from the plan alone, for a post gate
    that cannot be joined card by card. `text` is the answer's edit, else the
    card's verbatim draft; absent when neither is known. `thread` is the plan
    card, when its context still parses. */
export interface StepReply {
  threadId: string;
  label: string;
  text?: string;
  edited: boolean;
  thread?: ThreadCtx;
}

/** Every `reply:` answer in the matched plan whose thread this gate does not
    offer, in plan order: each posts once this gate proceeds. */
export function replyOnlyThreads(
  ctx: PostCtx,
  offered: readonly string[],
  mr?: BoardMRWithReview
): StepReply[] {
  const plan = planGateFor(ctx, mr);
  if (!plan) return [];
  const offeredIds = new Set(offered);
  return plan.questions.flatMap(q => {
    const raw = plan.answers?.[q.id];
    if (raw === undefined) return [];
    const answer = unwrapGateAnswer(raw);
    if (typeof answer.value !== 'string' || verbOf(answer.value) !== 'reply')
      return [];
    const threadId = answer.value.slice(answer.value.indexOf(':') + 1);
    if (offeredIds.has(threadId)) return [];
    const card = parseGateCtx(q.context);
    const thread = card?.shape === 'thread@1' ? card : undefined;
    const text =
      answer.text ??
      (thread?.reply.kind === 'verbatim' ? thread.reply.text : undefined);
    return [
      {
        threadId,
        label: q.label,
        edited: answer.text !== undefined,
        ...(text !== undefined ? { text } : {}),
        ...(thread ? { thread } : {}),
      },
    ];
  });
}
