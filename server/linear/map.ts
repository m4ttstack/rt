import type { NormLinearIssue } from "../store/model.js";
import type { RawIssue } from "./raw-types.js";

/**
 * Map a raw Linear issue (looked up by identifier) into the normalized model,
 * attributing it to the GitLab username that authored the merged MR.
 */
export function mapIssue(
  raw: RawIssue,
  assignedUser: string | null,
  linkedMrs: { iid: number; projectPath: string }[],
): NormLinearIssue {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url,
    assignedUser,
    linkedMrs,
    stateType: raw.state?.type ?? null,
    stateName: raw.state?.name ?? null,
  };
}
