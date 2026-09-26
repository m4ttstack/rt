import type { LinkedMr, NormLinearIssue } from '../store/model.js';
import type { RawIssue } from './raw-types.js';

/**
 * Map a raw Linear issue (looked up by identifier) into the normalized model,
 * attributing it to the GitLab username that authored the merged MR.
 */
export function mapIssue(
  raw: RawIssue,
  creditedUser: string | null,
  linkedMrs: LinkedMr[],
  closedAt: string | null
): NormLinearIssue {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url,
    creditedUser,
    linkedMrs,
    closedAt,
    stateType: raw.state?.type ?? null,
    stateName: raw.state?.name ?? null,
  };
}
