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
  /** The final reply this gate would post; absent when there is nothing to
      post for the thread (skipped, or a fix held back). */
  reply?: ReplyEntry;
  /** The plan-step pick, when the plan gate recorded one. */
  decided?: PlanVerb;
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

/** The plan gate a post gate follows: the MR's latest respond-plan in the
    same round. */
function planGateFor(
  ctx: PostCtx,
  mr?: BoardMRWithReview
): GateRow | undefined {
  return (mr?.gates ?? [])
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
    .sort((a, b) => b.openedAt - a.openedAt)[0];
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
    const picked = raw === undefined ? undefined : unwrapGateAnswer(raw).value;
    const decided = typeof picked === 'string' ? verbOf(picked) : undefined;
    const reply = replies.find(r => r.thread === threadId);
    joined.push({
      threadId,
      label: q.label,
      thread,
      ...(reply ? { reply } : {}),
      ...(decided ? { decided } : {}),
    });
  }
  if (replies.some(r => !joined.some(j => j.threadId === r.thread)))
    return null;
  return joined;
}
