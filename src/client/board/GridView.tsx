import { extractTicketId } from "../../ticket.ts";
import type { BoardMR } from "../../data.ts";
import { nestStacks } from "../../view.ts";
import type { BoardMRWithReview, RowContext } from "../types.ts";
import { CopyButton } from "../ui/CopyButton.tsx";
import { SelectBox } from "../ui/SelectBox.tsx";
import { StatusDot } from "./StatusDot.tsx";
import { BoardBadges } from "./BoardBadges.tsx";
import { statusReasons, cleanTitle, mrLine, flattenStack } from "./format.ts";
import { onRowClick, StatusPhrase, MetaTokens, TicketLink, AuthorTag, Watching } from "./RowView.tsx";

function GridView({
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
  const renderCard = (mr: BoardMR, depth: number) => {
    const ticket = extractTicketId(mr.sourceBranch, mr.title);
    const reasons = mr.blockers?.any ? statusReasons(mr).split("\n").slice(1) : [];
    return (
          <div
            key={mr.iid}
            className="tui-card"
            style={depth > 0 ? { marginLeft: "0.7rem" } : undefined}
            data-local={ctx.local ? "1" : undefined}
            title={ctx.local ? "right-click for actions" : undefined}
            onClick={(e) => onRowClick(e, mr)}
            onContextMenu={(e) => ctx.onContext(e, mr)}
          >
            <CopyButton text={mrLine(mr, ctx.slackTemplates)} className="tui-copy-inline tui-copy-card" title="copy this MR for Slack" />
            <span className="tui-card-label">
              {mr.webUrl && (
                <SelectBox checked={ctx.selected.has(mr.webUrl)} onToggle={() => ctx.onToggleSelect(mr.webUrl!)} />
              )}
              <StatusDot mr={mr} /> !{mr.iid}
              {ticket && <TicketLink ticket={ticket} />}
            </span>
            <div className="tui-card-title">{cleanTitle(mr.title)}</div>
            <div className="tui-card-branch" title={`${mr.sourceBranch} → ${mr.targetBranch}`}>
              {mr.sourceBranch} <span className="tui-arrow">→</span> {mr.targetBranch}
            </div>
            <div className="tui-card-tokens">
              {showAuthor && <AuthorTag mr={mr} />} <StatusPhrase mr={mr} /> <MetaTokens mr={mr} now={now} />
            </div>
            <BoardBadges mr={mr as BoardMRWithReview} now={now} ctx={ctx} className="tui-card-board" />
            {reasons.length > 0 && (
              <ul className="tui-blockers">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <Watching mr={mr} />
          </div>
    );
  };
  return (
    <div className="tui-grid">
      {nestStacks(mrs).map((node) => {
        if (node.children.length === 0) return renderCard(node.mr, 0);
        const chain = flattenStack(node);
        return (
          <div key={node.mr.iid} className="tui-stack-cluster">
            <div className="tui-stack-label">stack · {chain.length}</div>
            {chain.map(({ mr, depth }) => renderCard(mr, depth))}
          </div>
        );
      })}
    </div>
  );
}

export { GridView };
