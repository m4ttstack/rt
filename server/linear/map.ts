import type { NormLinearIssue } from "../pipeline/model.js";
import type { RawIssue } from "./raw-types.js";

/**
 * Map a raw Linear issue into the normalized model, resolving the assignee's email back to
 * the canonical GitLab username via `userByEmail`. An issue whose assignee email isn't in
 * the map gets `assignedUser: null` and simply counts for no one ... the metric layer keys
 * everything on the GitLab username, so Linear field names never leak past this boundary.
 */
export function mapIssue(
  raw: RawIssue,
  userByEmail: Record<string, string>,
): NormLinearIssue {
  const email = raw.assignee?.email?.toLowerCase() ?? null;
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url,
    assignedUser: email ? (userByEmail[email] ?? null) : null,
    createdAt: raw.createdAt,
    completedAt: raw.completedAt,
    teamKey: raw.team?.key ?? "",
  };
}
