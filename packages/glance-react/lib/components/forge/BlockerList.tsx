/**
 * BlockerList — static blocker rows (conflicts, rebase, discussions, draft, merge error).
 */

import type { MRDashboardProps } from '@mattstack/glance';

import { Row } from '../ui/flex';
import {
  BlockerConflictsIcon,
  BlockerDiscussionsIcon,
  BlockerDraftIcon,
  BlockerMergeErrorIcon,
  BlockerRebaseIcon,
} from './icons';
import { StatusIcon } from './StatusIcon';

export function BlockerList({
  blockers,
  behindTarget,
}: {
  blockers: MRDashboardProps['blockers'];
  behindTarget: number | null;
}) {
  return (
    <>
      {blockers.hasConflicts && (
        <Row gap={1.5}>
          <StatusIcon icon={BlockerConflictsIcon} color="caution" />
          Merge conflicts
        </Row>
      )}
      {blockers.needsRebase && behindTarget !== null && (
        <Row gap={1.5}>
          <StatusIcon icon={BlockerRebaseIcon} color="caution" />
          Branch is behind target by {behindTarget} commits
        </Row>
      )}
      {blockers.hasUnresolvedDiscussions && (
        <Row gap={1.5}>
          <StatusIcon icon={BlockerDiscussionsIcon} color="emphasis" />
          Unresolved discussions
        </Row>
      )}
      {blockers.isDraft && (
        <Row gap={1.5}>
          <StatusIcon icon={BlockerDraftIcon} color="neutral" />
          Draft — mark as ready before merging
        </Row>
      )}
      {blockers.mergeError && (
        <Row gap={1.5}>
          <StatusIcon icon={BlockerMergeErrorIcon} color="negative" />
          {blockers.mergeError}
        </Row>
      )}
    </>
  );
}
