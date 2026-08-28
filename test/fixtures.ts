import type { FetchResult, NormLinearIssue, NormMr, NormNote } from "../server/pipeline/model.js";
import type { TimeWindow } from "../shared/types.js";

export const WINDOW: TimeWindow = {
  start: "2026-05-01T00:00:00.000Z",
  end: "2026-05-31T00:00:00.000Z",
  key: "custom",
};

const note = (
  author: string | null,
  createdAt: string,
  opts: { inline?: boolean; system?: boolean } = {},
): NormNote => ({
  authorUsername: author,
  createdAt,
  system: opts.system ?? false,
  inline: opts.inline ?? false,
});

export const mr = (m: Partial<NormMr> & Pick<NormMr, "iid" | "authorUsername" | "title">): NormMr => ({
  projectPath: "org/app",
  state: "merged",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: m.updatedAt ?? m.createdAt ?? "2026-05-01T00:00:00.000Z",
  preparedAt: null,
  mergedAt: null,
  sourceBranch: null,
  description: null,
  labels: [],
  additions: 0,
  deletions: 0,
  fileCount: 1,
  approvedByUsernames: [],
  notes: [],
  diffStats: [],
  ...m,
});

// alice authors MR1 (reverted later) + MR2 (tiny). bob authors MR3 + MR4 (the revert).
const MR1 = mr({
  iid: 1,
  authorUsername: "alice",
  title: "Add feature X",
  createdAt: "2026-05-08T08:00:00.000Z",
  mergedAt: "2026-05-10T00:00:00.000Z",
  additions: 100,
  deletions: 20,
  fileCount: 3,
  approvedByUsernames: ["bob"],
  notes: [
    // A GitLab group bot comments 1 min after creation ... must be excluded from
    // "first review" latency and from reciprocity's reviewer count.
    note("group_6451920_bot_abc123", "2026-05-08T08:01:00.000Z"),
    note("bob", "2026-05-09T10:00:00.000Z", { inline: true }),
    note("bob", "2026-05-09T11:00:00.000Z"),
    note("alice", "2026-05-09T12:00:00.000Z"),
  ],
});

const MR2 = mr({
  iid: 2,
  authorUsername: "alice",
  title: "tiny fix",
  createdAt: "2026-05-09T08:00:00.000Z",
  mergedAt: "2026-05-11T00:00:00.000Z", // day after MR1 (05-10) → alice has a 2-day merge streak
  additions: 5,
  deletions: 2,
});

const MR3 = mr({
  iid: 3,
  authorUsername: "bob",
  title: "Refactor module",
  createdAt: "2026-05-12T09:00:00.000Z",
  mergedAt: "2026-05-15T00:00:00.000Z",
  additions: 50,
  deletions: 50,
  approvedByUsernames: ["alice"],
  notes: [
    note("alice", "2026-05-13T09:00:00.000Z", { inline: true }),
    note("alice", "2026-05-13T12:00:00.000Z", { inline: true }),
    note("alice", "2026-05-14T09:00:00.000Z"),
    note(null, "2026-05-13T09:05:00.000Z", { system: true }),
  ],
});

const MR4 = mr({
  iid: 4,
  authorUsername: "bob",
  title: 'Revert "Add feature X"',
  createdAt: "2026-05-24T09:00:00.000Z",
  mergedAt: "2026-05-25T00:00:00.000Z",
  additions: 20,
  deletions: 100,
});

const li = (
  identifier: string,
  assignedUser: string | null,
): NormLinearIssue => ({
  id: identifier,
  identifier,
  title: `Issue ${identifier}`,
  url: `https://linear.app/acme/issue/${identifier}`,
  assignedUser,
  linkedMrs: [],
  stateType: "completed",
  stateName: "Done",
});

export const FETCH: FetchResult = {
  mrs: [MR1, MR2, MR3, MR4],
  linearIssues: [
    li("ENG-1", "alice"),
    li("ENG-2", "alice"),
    li("ENG-3", "bob"),
    li("ENG-5", null), // unlinked ticket ... counts for no one
  ],
  pipelines: [
    { projectPath: "org/app", username: "alice", status: "success", createdAt: "2026-05-10T01:00:00.000Z" },
    { projectPath: "org/app", username: "alice", status: "failed", createdAt: "2026-05-11T01:00:00.000Z" },
    { projectPath: "org/app", username: "bob", status: "success", createdAt: "2026-05-15T01:00:00.000Z" },
    // out of window ... must be ignored
    { projectPath: "org/app", username: "alice", status: "success", createdAt: "2026-06-10T01:00:00.000Z" },
  ],
  pushEvents: [
    { username: "alice", createdAt: "2026-05-08T09:00:00.000Z" },
    { username: "alice", createdAt: "2026-05-09T09:00:00.000Z" },
    { username: "alice", createdAt: "2026-05-10T09:00:00.000Z" },
    { username: "alice", createdAt: "2026-05-10T15:00:00.000Z" }, // same day, dedup
    { username: "alice", createdAt: "2026-05-20T09:00:00.000Z" },
    { username: "bob", createdAt: "2026-05-12T09:00:00.000Z" },
    { username: "bob", createdAt: "2026-05-13T09:00:00.000Z" },
    { username: "bob", createdAt: "2026-05-14T09:00:00.000Z" },
    { username: "bob", createdAt: "2026-05-15T09:00:00.000Z" },
  ],
  approvalsAvailable: true,
};

export const USERS = ["alice", "bob"] as const;
