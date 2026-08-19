import { extractTicketId } from "../../ticket.ts";
import type { BoardMR } from "../../data.ts";
import { nestStacks } from "../../view.ts";
import type { SlackTemplates } from "../../template.ts";
import type { BoardMRWithReview, DraftInfo } from "../types.ts";
import { CopyButton } from "../ui/CopyButton.tsx";
import { SelectBox } from "../ui/SelectBox.tsx";
import { StatusDot } from "./StatusDot.tsx";
import {
  ReviewBadge,
  RespondBadge,
  DoctorBadge,
  PeerBadge,
  NudgeChip,
  NudgedByMarker,
  DraftBadge,
  SlackPostedChip,
  SlackReactionChips,
} from "./chips.tsx";
import { statusReasons, cleanTitle, hasBoardBadges, mrLine, flattenStack, draftKey } from "./format.ts";
import { onRowClick, StatusPhrase, MetaTokens, TicketLink, AuthorTag, Watching } from "./RowView.tsx";

function GridView({
  mrs,
  now,
  showAuthor,
  local,
  slackTemplates,
  onContext,
  onOpenReview,
  onOpenDraft,
  draftResolved,
  onResumeRespond,
  selected,
  onToggleSelect,
}: {
  mrs: BoardMR[];
  now: number;
  showAuthor: boolean;
  local: boolean;
  slackTemplates: SlackTemplates;
  onContext: (e: React.MouseEvent, mr: BoardMR) => void;
  onOpenReview: (mr: BoardMRWithReview) => void;
  onOpenDraft: (mr: BoardMRWithReview, draft: DraftInfo) => void;
  draftResolved: ReadonlyMap<string, "posted" | "dismissed">;
  onResumeRespond: (mr: BoardMR) => void;
  selected: ReadonlySet<string>;
  onToggleSelect: (webUrl: string) => void;
}) {
  const renderCard = (mr: BoardMR, depth: number) => {
    const ticket = extractTicketId(mr.sourceBranch, mr.title);
    const reasons = mr.blockers?.any ? statusReasons(mr).split("\n").slice(1) : [];
    return (
          <div
            key={mr.iid}
            className="tui-card"
            style={depth > 0 ? { marginLeft: "0.7rem" } : undefined}
            data-local={local ? "1" : undefined}
            title={local ? "right-click for actions" : undefined}
            onClick={(e) => onRowClick(e, mr)}
            onContextMenu={(e) => onContext(e, mr)}
          >
            <CopyButton text={mrLine(mr, slackTemplates)} className="tui-copy-inline tui-copy-card" title="copy this MR for Slack" />
            <span className="tui-card-label">
              {mr.webUrl && (
                <SelectBox checked={selected.has(mr.webUrl)} onToggle={() => onToggleSelect(mr.webUrl!)} />
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
            {hasBoardBadges(mr) && (
              <div className="tui-card-board">
                <ReviewBadge review={(mr as BoardMRWithReview).review} onOpen={() => onOpenReview(mr as BoardMRWithReview)} />
                <RespondBadge respond={(mr as BoardMRWithReview).respond} onResume={() => onResumeRespond(mr)} />
                <DoctorBadge doctor={(mr as BoardMRWithReview).doctor} />
                {((mr as BoardMRWithReview).peerReviews ?? []).map((p) => (
                  <PeerBadge key={p.reviewer} peer={p} />
                ))}
                <NudgeChip nudge={(mr as BoardMRWithReview).sentNudge} />
                <NudgedByMarker nudges={(mr as BoardMRWithReview).nudges} now={now} />
                {((mr as BoardMRWithReview).drafts ?? []).map((d) => (
                  <DraftBadge
                    key={d.kind}
                    draft={d}
                    resolved={draftResolved.get(draftKey(mr.webUrl ?? "", d.kind))}
                    onOpen={() => onOpenDraft(mr as BoardMRWithReview, d)}
                  />
                ))}
                <SlackPostedChip slack={(mr as BoardMRWithReview).slack} />
                <SlackReactionChips reactions={(mr as BoardMRWithReview).slack?.reactions} />
              </div>
            )}
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
