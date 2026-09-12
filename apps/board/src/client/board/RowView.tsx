import { useEffect } from 'react';
import { Invadr } from 'invadrs/react';

import { Chip, CopyButton, SelectBox } from '@mattstack/tui-kit';
import type { BoardMR } from '../../data.ts';
import { extractTicketId, ticketUrl } from '../../ticket.ts';
import {
  behindToken,
  nestStacks,
  statusFlags,
  type FlagClass,
} from '../../view.ts';
import type { BoardMRWithReview, RowContext } from '../types.ts';
import { ThreadsLink } from './CommentsDrawer.tsx';
import {
  ago,
  cleanTitle,
  commentCount,
  flattenStack,
  getSlackMarks,
  mrLine,
  statusPhrase,
  statusReasons,
} from './format.ts';
import { Bubble, DiscCheck, Eyes, SlackLogo } from './icons.tsx';
import { rowStatus } from './row-status.ts';
import { slackLadder, type SlackStage } from './slack-ladder.ts';
import { StatusDot } from './StatusDot.tsx';
import { StatusLine } from './StatusLine.tsx';
import { markSeen, seenCount, threadNewness } from './threads-seen.ts';

/** Plain click opens the MR in GitLab; right-click opens the row action menu
    (wired separately). Clicks on inner links/buttons are left to those. */
function onRowClick(e: React.MouseEvent, mr: BoardMR) {
  if ((e.target as HTMLElement).closest('a, button')) return;
  if (mr.webUrl) {
    markSeen(mr.webUrl, commentCount(mr));
    window.open(mr.webUrl, '_blank', 'noopener');
  }
}

/** Keyed on view.ts's own `FlagClass` so a fourth token class fails to
    compile here instead of silently rendering grey. */
const FLAG_INTENT: Record<FlagClass, 'ok' | 'bad' | 'warn' | 'cyan'> = {
  't-ok': 'ok',
  't-bad': 'bad',
  't-warn': 'warn',
  't-cyan': 'cyan',
};

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
        <Chip
          key={f.text}
          intent={FLAG_INTENT[f.cls]}
          data-flag=""
          title={f.title}
        >
          {f.text}
        </Chip>
      ))}
    </>
  );
}

/** The pill's tooltip carries the merge blockers: the gutter dot has the same
    tip, but it yields to the checkbox under the pointer. */
function StatusPhrase({ mr }: { mr: BoardMR }) {
  const { text, cls } = statusPhrase(mr);
  return (
    <span className={`tui-phrase ${cls}`} title={statusReasons(mr)}>
      {text}
    </span>
  );
}

const STAGE_ICON: Record<SlackStage, () => React.JSX.Element> = {
  looking: Eyes,
  commented: Bubble,
  approved: DiscCheck,
};
const STAGE_TITLE: Record<SlackStage, string> = {
  looking: 'someone is looking at this',
  commented: 'commented in slack',
  approved: 'approved in slack',
};

/** Line 1's Slack ladder: the furthest reaction as a mono mark, then the
    brand-colored logo once the MR is posted. Nothing renders before that. */
function SlackMarks({ mr }: { mr: BoardMRWithReview }) {
  const ladder = slackLadder(mr.slack, getSlackMarks());
  if (!ladder.posted) return null;
  const Stage = ladder.stage ? STAGE_ICON[ladder.stage] : null;
  return (
    <span className="tui-row-marks">
      {Stage && ladder.stage && (
        <span
          className="tui-mark"
          data-slack-stage={ladder.stage}
          title={STAGE_TITLE[ladder.stage]}
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
      <svg
        viewBox="0 0 100 100"
        width="13"
        height="13"
        fill="currentColor"
        aria-hidden
      >
        <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1783c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3072.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99128 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3904.3487-.984.3258-1.3541-.0443L12.6587 18.074Z" />
      </svg>
    </a>
  );
}

/** The facts line's right rail: the thread count (the drawer's entry) and
    the age as the corner anchor. Newness is measured against the count the
    board last recorded for this MR; a first sighting, or a count that fell
    below the record, rewrites that baseline after commit, so an abandoned
    render never records a count the user did not see. */
function Facts({ mr, now }: { mr: BoardMR; now: number }) {
  const count = commentCount(mr);
  const seen = mr.webUrl ? seenCount(mr.webUrl) : null;
  const newness = threadNewness(seen, count);
  const { record } = newness;
  const webUrl = mr.webUrl;
  useEffect(() => {
    if (record !== null && webUrl) markSeen(webUrl, record);
  }, [record, webUrl]);
  const grew = seen === null ? 0 : count - seen;
  return (
    <span className="tui-facts">
      {count > 0 && (
        <ThreadsLink
          mr={mr}
          count={count}
          fresh={newness.fresh}
          grew={grew}
          onOpen={() => mr.webUrl && markSeen(mr.webUrl, count)}
        />
      )}
      <span className="tui-age" title="last updated">
        {ago(mr.updatedAt, now)}
      </span>
    </span>
  );
}

/** Shown when the view mixes authors (the All view grouped by anything but
    author, where the group header is not the name). */
function AuthorTag({ mr }: { mr: BoardMR }) {
  const name = mr.author.name || mr.author.username;
  return (
    <span className="tui-author-tag" title={name}>
      <Invadr
        id={mr.author.username}
        palette="css-vars"
        className="tui-avatar"
      />{' '}
      {name}
    </span>
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
    const status = rowStatus(mr, now, ctx.draftResolved);
    const behind = behindToken(mr);
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
          {mr.webUrl && (
            <SelectBox
              checked={ctx.selected.has(mr.webUrl)}
              onToggle={() => ctx.onToggleSelect(mr.webUrl!)}
            />
          )}
        </div>
        <div className="tui-row-body">
          <div className="tui-row-0">
            <span className="tui-row-flags">
              {mr.isDraft && (
                <Chip
                  intent="muted"
                  variant="subtle"
                  uppercase
                  data-draft=""
                  title="draft, right-click to mark ready"
                >
                  draft
                </Chip>
              )}
              <StatusFlags mr={mr} nested={nested} />
            </span>
            <SlackMarks mr={mr} />
            <StatusPhrase mr={mr} />
          </div>
          <div className="tui-row-1">
            <span className="tui-title">{cleanTitle(mr.title)}</span>
          </div>
          <div className="tui-row-2">
            {showAuthor && <AuthorTag mr={mr} />}
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
            {behind && (
              <span className="tui-behind" title={behind.title}>
                {behind.text}
              </span>
            )}
            <Facts mr={mr} now={now} />
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

export {
  onRowClick,
  StatusFlags,
  StatusPhrase,
  TicketLink,
  AuthorTag,
  RowView,
};
