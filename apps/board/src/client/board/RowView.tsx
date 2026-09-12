import { useEffect } from 'react';
import { Invadr } from 'invadrs/react';

import { CopyButton, SelectBox } from '@mattstack/tui-kit';
import type { BoardMR } from '../../data.ts';
import { extractTicketId, ticketUrl } from '../../ticket.ts';
import {
  behindToken,
  flattenStack,
  nestStacks,
  statusFlags,
} from '../../view.ts';
import type { BoardMRWithReview, RowContext } from '../types.ts';
import { ThreadsLink } from './CommentsDrawer.tsx';
import { ago, cleanTitle, getSlackMarks, mrLine } from './format.ts';
import {
  ArrowDownGlyph,
  ArrowOutGlyph,
  Bubble,
  DiscCheck,
  Eyes,
  FlagGlyph,
  LinearLogo,
  SlackLogo,
} from './icons.tsx';
import { rowStatus, statusPhrase, statusReasons } from './row-status.ts';
import { slackLadder, type SlackStage } from './slack-ladder.ts';
import { StatusDot } from './StatusDot.tsx';
import { StatusLine } from './StatusLine.tsx';
import {
  commentCount,
  markSeen,
  seenCount,
  threadNewness,
} from './threads-seen.ts';

/** Plain click opens the MR in GitLab; right-click opens the row action menu
    (wired separately). Clicks on inner links/buttons are left to those. */
function onRowClick(e: React.MouseEvent, mr: BoardMR) {
  if ((e.target as HTMLElement).closest('a, button')) return;
  if (mr.webUrl) {
    markSeen(mr.webUrl, commentCount(mr));
    window.open(mr.webUrl, '_blank', 'noopener');
  }
}

function StatusFlags({
  mr,
  nested = false,
}: {
  mr: BoardMR;
  nested?: boolean;
}) {
  return (
    <>
      {statusFlags(mr, { nested }).map(f => (
        <span
          key={f.key}
          className="tui-flag"
          data-flag={f.key}
          title={f.title}
        >
          <FlagGlyph kind={f.key} />
          {f.text}
        </span>
      ))}
    </>
  );
}

/** The pill's tooltip carries the merge blockers: the gutter dot has the same
    tip, but it yields to the checkbox under the pointer. */
function StatusPhrase({ mr }: { mr: BoardMR }) {
  const { text, hue } = statusPhrase(mr);
  return (
    <span className="tui-phrase" data-hue={hue} title={statusReasons(mr)}>
      {text}
    </span>
  );
}

const STAGE_ICON: Record<SlackStage, () => React.JSX.Element> = {
  looking: Eyes,
  commented: Bubble,
  approved: DiscCheck,
};

/** Line 0's Slack ladder: the furthest reaction as a mono mark, then the
    brand-colored logo once the MR is posted. Nothing renders before that. */
function SlackMarks({ mr }: { mr: BoardMRWithReview }) {
  const { posted, mark } = slackLadder(mr.slack, getSlackMarks());
  if (!posted) return null;
  const Stage = mark ? STAGE_ICON[mark.stage] : null;
  return (
    <span className="tui-row-marks">
      {Stage && mark && (
        <span
          className="tui-mark"
          data-slack-stage={mark.stage}
          title={mark.title}
        >
          <Stage />
        </span>
      )}
      <span className="tui-mark" data-slack-logo="" title="posted in slack">
        <SlackLogo />
      </span>
    </span>
  );
}

function TicketLink({ ticket }: { ticket: string }) {
  return (
    <a
      className="tui-ticket"
      href={ticketUrl(ticket)}
      target="_blank"
      rel="noopener noreferrer"
      title={`open ${ticket} in Linear`}
      aria-label={`open ${ticket} in Linear`}
      onClick={e => e.stopPropagation()}
    >
      <LinearLogo />
    </a>
  );
}

/** The facts line's right rail: the thread count (the drawer's entry) and
    the age as the corner anchor. Newness is measured against the count the
    board last recorded for this MR; a first sighting, or a count that fell
    below the record, rewrites that baseline after commit, so an abandoned
    render never records a count the user did not see. */
function Rail({
  mr,
  now,
  self,
}: {
  mr: BoardMR;
  now: number;
  self: string | null;
}) {
  const count = commentCount(mr);
  const seen = mr.webUrl ? seenCount(mr.webUrl) : null;
  const newness = threadNewness(seen, count);
  const { record } = newness;
  const webUrl = mr.webUrl;
  useEffect(() => {
    if (record !== null && webUrl) markSeen(webUrl, record);
  }, [record, webUrl]);
  const grew = seen === null ? 0 : count - seen;
  const mine = self !== null && mr.author.username === self;
  const awaitYou = mine ? (mr.threadSummary?.awaiting ?? 0) : 0;
  const my = mr.myThreads;
  const me = self
    ? mr.reviews.reviewers.find(r => r.username === self)
    : undefined;
  const approved = me?.reviewState === 'APPROVED';
  const replied =
    !mine &&
    !approved &&
    !!my &&
    my.awaiting === 0 &&
    my.replied + my.resolved > 0;
  return (
    <span className="tui-rail">
      {count > 0 && (
        <ThreadsLink
          mr={mr}
          count={count}
          fresh={newness.fresh}
          grew={grew}
          awaitYou={awaitYou}
          replied={replied}
          onOpen={() => mr.webUrl && markSeen(mr.webUrl, count)}
        />
      )}
      <span className="tui-age" title="last updated">
        {ago(mr.updatedAt, now)}
      </span>
    </span>
  );
}

/** The header line's identity slot when the view mixes authors (the All
    view grouped by anything but author). */
function AuthorTag({ mr }: { mr: BoardMR }) {
  const name = mr.author.name || mr.author.username;
  return (
    <span className="tui-author-tag" title={name}>
      <Invadr
        id={mr.author.username}
        palette="css-vars"
        className="tui-avatar"
      />
      {name}
    </span>
  );
}

/** The same slot when the author is the group header: the ticket, as a
    link, so the line still leads with identity. */
function TicketTag({ ticket }: { ticket: string }) {
  return (
    <a
      className="tui-ticket-tag"
      href={ticketUrl(ticket)}
      target="_blank"
      rel="noopener noreferrer"
      title={`open ${ticket} in Linear`}
      onClick={e => e.stopPropagation()}
    >
      {ticket}
      <ArrowOutGlyph />
    </a>
  );
}

function RowView({
  mrs,
  now,
  showAuthor,
  ctx,
}: {
  mrs: BoardMRWithReview[];
  now: number;
  showAuthor: boolean;
  ctx: RowContext;
}) {
  const renderRow = (mr: BoardMRWithReview, depth: number) => {
    const ticket = extractTicketId(mr.sourceBranch, mr.title);
    const nested = depth > 0;
    const status = rowStatus(mr, now, ctx.draftResolved, ctx.self);
    const behind = behindToken(mr);
    const url = mr.webUrl;
    return (
      <div
        key={mr.iid}
        className={nested ? 'tui-row tui-row-nested' : 'tui-row'}
        data-mr-iid={mr.iid}
        data-tone={status.bar ?? undefined}
        data-local={ctx.local ? '1' : undefined}
        title={ctx.local ? 'right-click for actions' : undefined}
        onClick={e => onRowClick(e, mr)}
        onContextMenu={e => ctx.onContext(e, mr)}
      >
        {status.bar && (
          <span className="tui-row-bar" data-tone={status.bar} aria-hidden />
        )}
        <div className="tui-row-pick">
          <StatusDot mr={mr} />
          {url && (
            <SelectBox
              checked={ctx.selected.has(url)}
              onToggle={() => ctx.onToggleSelect(url)}
            />
          )}
        </div>
        <div className="tui-row-body">
          <div className="tui-row-0">
            <span className="tui-row-lead">
              {showAuthor ? (
                <AuthorTag mr={mr} />
              ) : (
                ticket && <TicketTag ticket={ticket} />
              )}
              <StatusFlags mr={mr} nested={nested} />
              {behind && (
                <span className="tui-behind" title={behind.title}>
                  <ArrowDownGlyph />
                  {behind.text}
                </span>
              )}
            </span>
            <SlackMarks mr={mr} />
            <StatusPhrase mr={mr} />
          </div>
          <div className="tui-row-1">
            <span className="tui-title">{cleanTitle(mr.title)}</span>
          </div>
          <div className="tui-row-2">
            <span className="tui-mr-iid">!{mr.iid}</span>
            <span className="tui-branch">{mr.sourceBranch}</span>
            {mr.diff && (
              <span
                className="tui-diff"
                title={`${mr.diff.filesChanged} files changed`}
              >
                <span className="tui-adds">+{mr.diff.additions}</span>{' '}
                <span className="tui-dels">−{mr.diff.deletions}</span>
              </span>
            )}
            <Rail mr={mr} now={now} self={ctx.self} />
          </div>
          <StatusLine
            mr={mr}
            status={status}
            ctx={ctx}
            tools={
              <>
                {ticket && <TicketLink ticket={ticket} />}
                <CopyButton
                  text={mrLine(mr, ctx.slackTemplates)}
                  className="tui-copy-inline"
                  title="copy this MR for Slack"
                />
              </>
            }
          />
        </div>
      </div>
    );
  };
  return (
    <div
      className="tui-rows"
      data-selecting={ctx.selected.size > 0 ? 'true' : undefined}
    >
      {nestStacks(mrs).map(node =>
        node.children.length === 0 ? (
          renderRow(node.mr, 0)
        ) : (
          <div key={node.mr.iid} className="tui-stack-rows">
            {renderRow(node.mr, 0)}
            <div className="tui-stack-children">
              {flattenStack(node)
                .slice(1)
                .map(({ mr, depth }) => renderRow(mr, depth))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

export { RowView };
