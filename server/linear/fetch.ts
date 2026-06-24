import { collectIssues, linearRequest } from "./client.js";
import { mapIssue } from "./map.js";
import { COMPLETED_ISSUES_QUERY } from "./queries.js";
import type { IssueFilter, RawIssueConnection } from "./raw-types.js";
import type { NormLinearIssue } from "../pipeline/model.js";
import type { LeaderboardWarning, TimeWindow } from "../../shared/types.js";

export interface LinearOptions {
  apiKey: string;
  /** GitLab username -> Linear email. Drives both the query filter and the reverse mapping. */
  emailByUser: Record<string, string>;
}

/**
 * Fetch Linear issues completed in the window for the configured people. Filters by
 * assignee email server-side, then keys each issue back to its GitLab username.
 *
 * Resilient by design: a missing key, network failure, or rate-limit pushes a warning and
 * returns [] so the GitLab leaderboard is never blocked by Linear.
 */
export async function fetchLinearIssues(
  linear: LinearOptions | null,
  window: TimeWindow,
  warnings: LeaderboardWarning[],
): Promise<NormLinearIssue[]> {
  if (!linear) return [];

  const emails = Object.values(linear.emailByUser).filter((e) => e.length > 0);
  if (emails.length === 0) return [];

  // Reverse map for keying issues back to GitLab usernames. Lowercased so email casing
  // differences between config and Linear never cause a silent miss.
  const userByEmail: Record<string, string> = {};
  for (const [user, email] of Object.entries(linear.emailByUser)) {
    if (email) userByEmail[email.toLowerCase()] = user;
  }

  const filter: IssueFilter = {
    completedAt: { gte: window.start, lte: window.end },
    assignee: { email: { in: emails } },
  };

  try {
    const nodes = await collectIssues(async (after) => {
      const data = await linearRequest<{ issues: RawIssueConnection }>(
        linear.apiKey,
        COMPLETED_ISSUES_QUERY,
        { after, filter },
      );
      return data.issues;
    });
    return nodes.map((n) => mapIssue(n, userByEmail));
  } catch (err) {
    warnings.push({
      code: "linear_fetch_failed",
      message: `Linear issues unavailable, "Issues done" will be zero: ${(err as Error).message}`,
    });
    return [];
  }
}
