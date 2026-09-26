import type { SlackInfo } from '../types.ts';

export type SlackStage = 'looking' | 'commented' | 'approved';

const RUNG: Record<SlackStage, number> = {
  looking: 0,
  commented: 1,
  approved: 2,
};

/** The furthest review-signal reaction on the posted message, returned as
    the mark that carries it (its stage, icon title, emoji). Reactions on an
    unposted message are noise from another thread and count for nothing. */
export function slackLadder<M extends { emoji: string; stage: SlackStage }>(
  slack: SlackInfo | undefined,
  marks: ReadonlyArray<M>
): { posted: boolean; mark: M | null } {
  if (!slack?.posted) return { posted: false, mark: null };
  let mark: M | null = null;
  for (const m of marks) {
    if (!slack.reactions.includes(m.emoji)) continue;
    if (!mark || RUNG[m.stage] > RUNG[mark.stage]) mark = m;
  }
  return { posted: true, mark };
}
