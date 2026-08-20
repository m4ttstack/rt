import { Invadr } from "invadrs/react";
import { extractTicketId, ticketUrl } from "../../ticket.ts";
import type { BoardMR } from "../../data.ts";
import { nestStacks, statusFlags } from "../../view.ts";
import type { BoardMRWithReview, RowContext } from "../types.ts";
import { Chip, CopyButton, SelectBox } from "@mattstack/tui-kit";
import { StatusDot } from "./StatusDot.tsx";
import { CommentsButton, CommentsToken } from "./CommentsDrawer.tsx";
import { BoardBadges } from "./BoardBadges.tsx";
import { ago, activeReviewers, cleanTitle, mrLine, statusPhrase, flattenStack } from "./format.ts";

/** Plain click opens the MR in GitLab; right-click opens the row action menu
    (wired separately). Clicks on inner links/buttons are left to those. */
function onRowClick(e: React.MouseEvent, mr: BoardMR) {
  if ((e.target as HTMLElement).closest("a, button")) return;
  if (mr.webUrl) window.open(mr.webUrl, "_blank", "noopener");
}

/** statusFlags() keeps emitting the board's own token classes (`.tui-phrase`
    shares them), so the flag row translates them to Chip intents here rather
    than making view.ts -- a DOM-free module with its own tests -- speak the
    kit's vocabulary. `data-flag` is the hook style.css scopes the flag's
    standing 0.9 dim and its own zero-padding box to. */
const FLAG_INTENT: Record<string, "bad" | "warn" | "cyan"> = {
  "t-bad": "bad",
  "t-warn": "warn",
  "t-cyan": "cyan",
};

function StatusFlags({ mr, nested = false }: { mr: BoardMR; nested?: boolean }) {
  return (
    <>
      {statusFlags(mr, { nested }).map((f) => (
        <Chip key={f.text} intent={FLAG_INTENT[f.cls] ?? "muted"} data-flag="">
          {f.text}
        </Chip>
      ))}
    </>
  );
}

function StatusPhrase({ mr }: { mr: BoardMR }) {
  const { text, cls, comments } = statusPhrase(mr);
  if (comments) return <CommentsButton mr={mr} label={text} cls={cls} />;
  return <span className={`tui-phrase ${cls}`}>{text}</span>;
}

function MetaTokens({ mr, now }: { mr: BoardMR; now: number }) {
  return (
    <span className="tui-meta">
      {mr.diff && (
        <span className="t-dim" title={`${mr.diff.filesChanged} files changed`}>
          <span className="t-ok">+{mr.diff.additions}</span> <span className="t-bad">−{mr.diff.deletions}</span>
        </span>
      )}
      <CommentsToken mr={mr} />
      <span className="t-muted" title="last updated">{ago(mr.updatedAt, now)}</span>
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
      onClick={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 100 100" width="13" height="13" fill="currentColor" aria-hidden>
        <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1783c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3072.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99128 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3904.3487-.984.3258-1.3541-.0443L12.6587 18.074Z" />
      </svg>
    </a>
  );
}

function Watching({ mr }: { mr: BoardMR }) {
  const names = activeReviewers(mr);
  if (!names.length) return null;
  return (
    <div className="tui-watching">
      👀 {names.join(", ")} {names.length === 1 ? "is" : "are"} reviewing right now
    </div>
  );
}

// ── views ──────────────────────────────────────────────────────────────────

/** Author identity for a row — shown when the view mixes authors (the All
    view grouped by anything but author, where the group header isn't the name). */
function AuthorTag({ mr }: { mr: BoardMR }) {
  const name = mr.author.name || mr.author.username;
  return (
    <span className="tui-author-tag" title={name}>
      <Invadr id={mr.author.username} palette="css-vars" className="tui-avatar" /> {name}
    </span>
  );
}

function RowView({
  mrs,
  now,
  showAuthor,
  ctx,
}: {
  mrs: BoardMR[];
  now: number;
  showAuthor: boolean;
  ctx: RowContext;
}) {
  const renderRow = (mr: BoardMR, depth: number) => {
    const ticket = extractTicketId(mr.sourceBranch, mr.title);
    const nested = depth > 0;
    return (
          <div
            key={mr.iid}
            className={nested ? "tui-row tui-row-nested" : "tui-row"}
            data-local={ctx.local ? "1" : undefined}
            title={ctx.local ? "right-click for actions" : undefined}
            onClick={(e) => onRowClick(e, mr)}
            onContextMenu={(e) => ctx.onContext(e, mr)}
          >
            {/* Its own leftmost column, full row height, so the checkbox is a
                target you can hit without aiming and never crowds the title. */}
            <div className="tui-row-pick">
              {mr.webUrl && (
                <SelectBox checked={ctx.selected.has(mr.webUrl)} onToggle={() => ctx.onToggleSelect(mr.webUrl!)} />
              )}
            </div>
            <div className="tui-row-body">
            {statusFlags(mr, { nested }).length > 0 && (
              <div className="tui-row-review">
                <StatusFlags mr={mr} nested={nested} />
              </div>
            )}
            <div className="tui-row-1">
              <StatusDot mr={mr} />
              {/* The draft marker is the chip family's small-caps register
                  (`uppercase`); its tighter pill is the one part of the old
                  `.tui-draft` box the recipe does not carry, restored from
                  style.css off `data-draft`. */}
              {mr.isDraft && (
                <Chip intent="muted" variant="subtle" uppercase data-draft="" title="draft — right-click to mark ready">
                  draft
                </Chip>
              )}
              <span className="tui-title">{cleanTitle(mr.title)}</span>
              <StatusPhrase mr={mr} />
              {ticket && <TicketLink ticket={ticket} />}
              <CopyButton text={mrLine(mr, ctx.slackTemplates)} className="tui-copy-inline" title="copy this MR for Slack" />
            </div>
            <div className="tui-row-2">
              {showAuthor && <AuthorTag mr={mr} />}
              <span className="tui-mr-iid">!{mr.iid}</span>
              <span className="tui-row-sep">|</span>
              <span className="tui-branch">
                {mr.sourceBranch}
              </span>
              <MetaTokens mr={mr} now={now} />
            </div>
            <BoardBadges mr={mr as BoardMRWithReview} now={now} ctx={ctx} className="tui-row-board" />
            <Watching mr={mr} />
            </div>
          </div>
    );
  };
  return (
    <div className="tui-rows">
      {nestStacks(mrs).map((node) =>
        node.children.length === 0 ? (
          renderRow(node.mr, 0)
        ) : (
          <div key={node.mr.iid} className="tui-stack-rows">
            {renderRow(node.mr, 0)}
            {/* The children get their own box so the thread rail can span
                exactly them, whatever heights the rows come out at. */}
            <div className="tui-stack-children">
              {flattenStack(node)
                .slice(1)
                .map(({ mr, depth }) => renderRow(mr, depth))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

export { onRowClick, StatusFlags, StatusPhrase, MetaTokens, TicketLink, AuthorTag, Watching, RowView };
