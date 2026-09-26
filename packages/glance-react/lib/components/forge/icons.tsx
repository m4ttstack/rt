/**
 * Canonical icon map for the Forge UI layer.
 *
 * Every icon used across MRStatusBadge, MRRow, PipelineBadge, ReviewerList,
 * and MRCard is defined here once. Components import from this file instead
 * of importing icon libraries directly — preventing icon drift between
 * components that represent the same concept.
 *
 * Icons are exported as React component references so consumers can set
 * their own className (size, color) at the call site.
 */

// ── Font Awesome (spinner only — Octicons has no animated spinner) ──────────────
import { faCircleNotch } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

// ── GitHub Octicons (primary icon set) ─────────────────────────────────────────

export {
  // Generic (still used in some places)
  GoAlert as AlertIcon,
  GoArrowSwitch as ArrowSwitchIcon,
  GoCheck as CheckIcon,
  GoCheckCircleFill as CheckCircleFillIcon,
  GoClock as ClockIcon,
  GoComment as CommentIcon,
  GoGitBranch as GitBranchIcon,
  GoGitPullRequest as GitPullRequestIcon,
  GoPencil as PencilIcon,
  GoChevronRight as ExpandIcon,
  GoXCircleFill as XCircleFillIcon,

  // ── MR status (MRStatusBadge, MRRow) ──────────────────────────────────────
  GoCheckCircleFill as GitReadyToMergeGlyph,
  GoBlocked as GitBlockedIcon,
  GoGitPullRequestDraft as GitDraftIcon,
  GoGitMerge as GitMergeGlyph,
  GoGitPullRequestClosed as GitPullRequestClosedIcon,

  // ── Pipeline (PipelineBadge, MRRow) ───────────────────────────────────────
  GoShieldCheck as PipelinePassedIcon,
  GoShield as PipelinePassedWithWarnings,
  GoShieldX as PipelineFailedIcon,
  GoShieldSlash as NoPipelineIcon,

  // ── Blockers (MRCard) ─────────────────────────────────────────────────────
  GoAlert as BlockerConflictsIcon,
  GoArrowSwitch as BlockerRebaseIcon,
  GoXCircleFill as BlockerPipelineIcon,
  GoClock as BlockerApprovalsIcon,
  GoComment as BlockerDiscussionsIcon,
  GoPencil as BlockerDraftIcon,
  GoShieldX as BlockerMergeErrorIcon,

  // ── Reviewer states (ReviewerList) ────────────────────────────────────────
  GoCheck as ReviewApprovedIcon,
  GoComment as ReviewCommentedIcon,
  GoAlert as ReviewChangesRequestedIcon,
  GoClock as ReviewAwaitingIcon,

  // ── MRNode / MRSidebar ─────────────────────────────────────────────────────
  GoX as CloseIcon,
  GoCopy as CopyIcon,
  GoLink as LinkIcon,
} from 'react-icons/go';

// ── VS Code Codicons ───────────────────────────────────────────────────────────
export { VscEye as EyeIcon } from 'react-icons/vsc';
export { VscEye as ReviewReviewingIcon } from 'react-icons/vsc';
export { VscDebugDisconnect as DisconnectedIcon } from 'react-icons/vsc';
export { MdSignalWifiStatusbarConnectedNoInternet1 as DisconnectedIconAlt } from 'react-icons/md';

// ── Spinner ────────────────────────────────────────────────────────────────────
export function SpinnerIcon({ className }: { className?: string }) {
  return <FontAwesomeIcon icon={faCircleNotch} className={className} />;
}

export const PipelineRunningIcon = SpinnerIcon;
export const MrLoadingIcon = SpinnerIcon;
