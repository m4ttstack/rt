import { Invadr } from 'invadrs/react';

import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import { ago, cleanTitle } from './format.ts';
import type { PlanCtx, PostCtx } from './gate-ctx.ts';

export interface HeaderChip {
  key: string;
  text: string;
  hue: 'grey' | 'amber' | 'green';
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function headerChips(ctx: PlanCtx | PostCtx): HeaderChip[] {
  const chips: HeaderChip[] = [];
  if (ctx.shape === 'plan@1') {
    const { total, blocking } = ctx.threads;
    chips.push({
      key: 'threads',
      text: plural(total, 'thread', 'threads'),
      hue: 'grey',
    });
    chips.push(
      blocking > 0
        ? { key: 'blocking', text: `${blocking} blocking`, hue: 'amber' }
        : { key: 'blocking', text: 'all non-blocking', hue: 'grey' }
    );
  } else {
    chips.push({
      key: 'replies',
      text: plural(ctx.replies, 'reply', 'replies'),
      hue: 'grey',
    });
    if (ctx.fixes.length >= 3)
      chips.push({
        key: 'fixes',
        text: `${ctx.fixes.length} fixes pushed`,
        hue: 'green',
      });
    else
      ctx.fixes.forEach((fix, i) =>
        chips.push({
          key: `fix-${i}`,
          text: `fix pushed · ${fix.sha}`,
          hue: 'green',
        })
      );
  }
  if (ctx.adjudication)
    chips.push({ key: 'adjudication', text: ctx.adjudication, hue: 'green' });
  if (ctx.round !== undefined)
    chips.push({ key: 'round', text: `round ${ctx.round}`, hue: 'grey' });
  return chips;
}

/** `!<n>` from an `mr:<url>` subject: the object line's stand-in when the
    board has no row for the MR, so the card never waits on the join. */
function subjectRef(subject: string): string {
  const m = subject.startsWith('mr:') ? /(\d+)\/?$/.exec(subject) : null;
  return m ? `!${m[1]}` : subject;
}

/** A respond gate's head in the decision queue, in place of the MR strip
    and the context pane: who is being answered leads, the MR is the
    object line, and the chips say what the gate decides. */
export function RespondGateHeader({
  gate,
  mr,
  ctx,
}: {
  gate: GateRow;
  mr?: BoardMRWithReview;
  ctx: PlanCtx | PostCtx;
}) {
  const author = mr?.author?.name || mr?.author?.username;
  const meta = [
    mr?.sourceBranch,
    author,
    ago(new Date(gate.openedAt).toISOString(), Date.now()),
  ].filter(Boolean);
  return (
    <div className="tui-respond-head" data-shape={ctx.shape}>
      <div className="tui-respond-head-top">
        <Invadr
          id={ctx.reviewer}
          palette="css-vars"
          className="tui-respond-avatar"
        />
        <div className="tui-respond-head-text">
          <p className="tui-respond-headline">
            {ctx.shape === 'plan@1' ? 'Responding to ' : 'Posting replies to '}
            <strong>{ctx.reviewer}</strong>
            {"'s review"}
          </p>
          <p className="tui-respond-object">
            <span className="tui-respond-object-ref">
              {mr ? `!${mr.iid}` : subjectRef(gate.subject)}
            </span>
            {mr && (
              <span className="tui-respond-object-title">
                · {cleanTitle(mr.title)}
              </span>
            )}
          </p>
          <p className="tui-respond-meta">{meta.join(' · ')}</p>
        </div>
      </div>
      <div className="tui-respond-chips">
        {headerChips(ctx).map(chip => (
          <span
            key={chip.key}
            className="tui-respond-chip"
            data-hue={chip.hue}
            data-chip={chip.key}
          >
            {chip.text}
          </span>
        ))}
      </div>
    </div>
  );
}
