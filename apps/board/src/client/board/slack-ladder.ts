import type { SlackInfo } from '../types.ts';

export type SlackStage = 'looking' | 'commented' | 'approved';

export interface SlackLadder {
  posted: boolean;
  stage: SlackStage | null;
}

const STAGES: SlackStage[] = ['looking', 'commented', 'approved'];

/** The furthest review-signal reaction on the posted message, in the
    marks' fixed order (looking, commented, approved). Reactions on an
    unposted message are noise from another thread and count for nothing. */
export function slackLadder(
  slack: SlackInfo | undefined,
  marks: ReadonlyArray<{ emoji: string }>
): SlackLadder {
  if (!slack?.posted) return { posted: false, stage: null };
  let stage: SlackStage | null = null;
  marks.forEach((mark, i) => {
    if (slack.reactions.includes(mark.emoji)) stage = STAGES[i] ?? stage;
  });
  return { posted: true, stage };
}
