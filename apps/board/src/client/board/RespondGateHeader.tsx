import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import { ago, cleanTitle } from './format.ts';
import type { PlanCtx, PostCtx } from './gate-ctx.ts';
import { forgeNoun, MrLinks } from './MrLinks.tsx';
import { PersonLead } from './PersonLead.tsx';

export interface HeaderChip {
  key: string;
  text: string;
  hue: 'grey' | 'amber' | 'green';
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `posting`, when given, replaces a post gate's offered reply count with
    the number its submit will post, so the rail agrees with the sheet. */
export function headerChips(
  ctx: PlanCtx | PostCtx,
  posting?: number
): HeaderChip[] {
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
      text: plural(posting ?? ctx.replies, 'reply', 'replies'),
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
  return chips;
}

/** The review round and the adjudication, the context's prose facts; they
    read as a meta line rather than chips. */
export function headerMeta(ctx: PlanCtx | PostCtx): string[] {
  return [
    ctx.round !== undefined ? `round ${ctx.round}` : undefined,
    ctx.adjudication,
  ].filter((m): m is string => Boolean(m));
}

/** The reviewer's full name for a gate's reviewer handle: the board's team
    roster first, then the MR's assigned reviewers and approvers, else the
    handle itself. */
export function reviewerName(
  handle: string,
  mr?: BoardMRWithReview,
  people?: ReadonlyMap<string, string>
): string {
  const same = (u: { username: string }) => u.username === handle;
  return (
    people?.get(handle) ??
    mr?.reviews?.reviewers?.find(same)?.name ??
    mr?.reviews?.approvedBy?.find(same)?.name ??
    handle
  );
}

/** `!<n>` from an `mr:<url>` subject: the object line's stand-in when the
    board has no row for the MR, so the card never waits on the join. */
export function subjectRef(subject: string): string {
  const m = subject.startsWith('mr:') ? /(\d+)\/?$/.exec(subject) : null;
  return m ? `!${m[1]}` : subject;
}

/** A respond gate's identity card: the invader, who is being answered and
    the MR's links share the top line; the MR title, the meta line, the
    branch and the chips each take the card's full width below it. */
export function RespondGateHeader({
  gate,
  mr,
  ctx,
  people,
}: {
  gate: GateRow;
  mr?: BoardMRWithReview;
  ctx: PlanCtx | PostCtx;
  people?: ReadonlyMap<string, string>;
}) {
  const author = mr?.author?.name || mr?.author?.username;
  const meta = [
    author,
    ago(new Date(gate.openedAt).toISOString(), Date.now()),
    ...headerMeta(ctx),
  ].filter(Boolean);
  return (
    <div className="tui-id-card tui-respond-head" data-shape={ctx.shape}>
      <PersonLead
        id={ctx.reviewer}
        name={reviewerName(ctx.reviewer, mr, people)}
        trailing={mr && <MrLinks mr={mr} />}
      >
        reviewed your {forgeNoun(mr, gate.subject)}
      </PersonLead>
      {mr && <p className="tui-id-card-title">{cleanTitle(mr.title)}</p>}
      <p className="tui-id-card-meta">
        <span className="tui-id-card-ref">
          {mr ? `!${mr.iid}` : subjectRef(gate.subject)}
        </span>
        {meta.map(m => (
          <span key={m}>· {m}</span>
        ))}
      </p>
      {mr?.sourceBranch && (
        <p className="tui-id-card-branch" title={mr.sourceBranch}>
          {mr.sourceBranch}
        </p>
      )}
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
