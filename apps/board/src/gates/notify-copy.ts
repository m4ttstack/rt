import {
  CODE_CHANGES_QUESTION_ID,
  domainForKind,
  RESPOND_PLAN_KIND,
} from '@mattstack/gate-kit';

export interface GateNotifyCopy {
  headline: string;
  summary: string;
}

/** The desktop notification's title and body for a gate the board opens,
    carried on the gate as `meta.headline` / `meta.summary` for rt's bridge
    rule. Plain words only: a question label is a `file:line` and never
    belongs here. Every respond-plan question but code-changes is a thread. */
export function gateNotifyCopy(
  kind: string,
  iid: number,
  questions: ReadonlyArray<{ id: string }>
): GateNotifyCopy {
  if (domainForKind(kind) === 'review') {
    return {
      headline: `Your review of !${iid} is ready`,
      summary: 'Pick what to post',
    };
  }
  if (kind === RESPOND_PLAN_KIND) {
    const threads = questions.filter(
      q => q.id !== CODE_CHANGES_QUESTION_ID
    ).length;
    return {
      headline: `Replies on !${iid} need you`,
      summary: `${threads} review ${threads === 1 ? 'thread' : 'threads'} waiting on your call`,
    };
  }
  if (kind === 'respond-post') {
    return {
      headline: `Replies on !${iid} are drafted`,
      summary: 'Check them before they post',
    };
  }
  return {
    headline: `!${iid} needs your call`,
    summary: 'Waiting on your decision',
  };
}
