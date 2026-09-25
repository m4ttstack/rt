/**
 * The hand-written SHAPES table as it stood before schemas replaced it,
 * frozen so the schema-derived shapes can be asserted against it.
 * Never edit to match the live table.
 */
import { DEFAULT_SLACK_EMOJI, NOTIFICATION_EVENTS, type LeafType } from "../shapes.ts";

const SNAPSHOT_FIELDS = {
  enabled: "boolean", debounceSec: "number", pushDelaySec: "number",
  janitorThresholdHours: "number", janitorIntervalMin: "number",
} as const satisfies Record<string, LeafType>;

const STRING_LIST = { kind: "stringList" } as const;
const BOARD_EDITOR = { kind: "external", app: "board" } as const;

export const LEGACY_SHAPES = {
  "board.projects": STRING_LIST,
  "board.botUsernames": STRING_LIST,
  "board.ticketPrefixes": STRING_LIST,
  "board.workspaces": { kind: "leaves", fields: { reviews: "string", responds: "string", doctors: "string" } },
  "board.cwds": { kind: "leaves", fields: { review: "string", respond: "string", doctor: "string" } },
  "board.slack": {
    kind: "leaves",
    fields: {
      channel: "string", singleTemplate: "string", multiHeader: "string", multiItem: "string",
      autoResolveIntervalMinutes: "number",
      "emoji.looking": "string", "emoji.commented": "string", "emoji.approved": "string",
    },
    fallbacks: {
      "emoji.looking": DEFAULT_SLACK_EMOJI.looking,
      "emoji.commented": DEFAULT_SLACK_EMOJI.commented,
      "emoji.approved": DEFAULT_SLACK_EMOJI.approved,
    },
  },
  "board.triage": {
    kind: "leaves",
    fields: {
      enabled: "boolean", cooldownMinutes: "number", dailyAttemptBudget: "number",
      notify: { enum: ["rt", "badge-only"] }, tier: { enum: ["api", "checkout"] },
      "fixClasses.retryFlake": "boolean", "fixClasses.inheritedNoteDraft": "boolean",
      "fixClasses.cleanApiRebase": "boolean", "fixClasses.mechanicalLint": "boolean",
      "fixClasses.codeFix": "boolean",
    },
  },
  "board.reReview": { kind: "leaves", fields: { enabled: "boolean" } },
  "board.tabs": BOARD_EDITOR,
  "board.members": BOARD_EDITOR,
  "board.hiddenMembers": BOARD_EDITOR,
  "rt.homeSnapshot": { kind: "leaves", fields: { ...SNAPSHOT_FIELDS } },
  "rt.teamSnapshot": { kind: "leaves", fields: { ...SNAPSHOT_FIELDS, pullIntervalSec: "number" } },
  "rt.gitStatus": { kind: "leaves", fields: { sweep: "boolean", sweepIntervalSec: "number", fetchIntervalSec: "number" } },
  "rt.worktreeApp": {
    kind: "leaves",
    fields: { enabled: "boolean", killProcesses: "boolean", claudeHook: { enum: ["installed", "declined"] } },
  },
  "rt.notifications": {
    kind: "leaves",
    fields: Object.fromEntries(NOTIFICATION_EVENTS.map((k) => [k, "boolean" as const])),
  },
  "rt.repoRoots": STRING_LIST,
  "rt.trustedBrowserOrigins": STRING_LIST,
  "setup.waived": STRING_LIST,
  "rt.repoIdentityOverrides": { kind: "stringMap", labels: ["remote URL", "identity"] },
  "boxscore.projects": STRING_LIST,
  "boxscore.linearDoneStates": STRING_LIST,
  "boxscore.excludeFilePatterns": STRING_LIST,
  "boxscore.ignoredMrs": STRING_LIST,
  "boxscore.botPatterns": STRING_LIST,
  "boxscore.sizeBand": { kind: "leaves", fields: { tooSmall: "number", tooLarge: "number" } },
  "gitq.workSlots": { kind: "leaves", fields: { workSlotLocation: "string", maxWorkSlots: "number" } },
} as const;
