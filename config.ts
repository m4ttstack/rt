import type { RangePreset } from "./shared/types.js";

/**
 * Non-secret comparison config. Committed to the repo.
 * Secrets (token, base URL) live in .env ... see .env.example.
 *
 * Edit the values below to point at your own group/projects and people.
 */
export interface AppConfig {
  /** Provide ONE of groupPath or projectPaths. groupPath is preferred (one bulk query). */
  groupPath?: string;
  /** Fallback: explicit "group/project" full paths when you don't have a single group. */
  projectPaths?: string[];

  /** The hand-picked comparison set, by GitLab username. */
  users: string[];

  /** Highlighted + ranked in the UI. Must appear in `users`. */
  currentUser: string;

  /** Default window; the UI can override without a restart. */
  defaultRange: RangePreset;

  /** Max concurrent GitLab requests (rate-limit politeness). */
  concurrency: number;

  /**
   * MR size health bands, in changed lines (additions + deletions).
   * MRs at or below `tooSmall` or above `tooLarge` fall outside the healthy band.
   */
  sizeBand: { tooSmall: number; tooLarge: number };

  /**
   * Linear delivery metrics (optional). The API key lives in .env (LINEAR_API_KEY); this
   * is just the non-secret identity map. Omit the block, or leave emailByUser empty, to
   * disable the "Issues done" metric. Issues are counted by assignee across all teams.
   */
  linear?: {
    /** GitLab username -> Linear account email. Unmapped users get no Linear data. */
    emailByUser: Record<string, string>;
    /**
     * Exclude stale backlog from "Issues done": skip issues completed more than this many
     * days after they were created. Bulk-closing months-old issues otherwise inflates the
     * count (an EM grooming the backlog scored 47, of which 43 were ~223 days old). Set to
     * 0 or omit to count every completed issue regardless of age. Default 90.
     */
    maxIssueAgeDays?: number;
  };
}

export const config: AppConfig = {
  groupPath: "",
  projectPaths: ["acme/acme-web"],

  users: [
    "m4ttheweric", // Matthew Goodwin (you)
    "westonnovelli", // Weston Novelli
    "geoff82", // Geoff Miller
    "nadia1", // Nadia Fenwick
    "samkestrel", // Sam Kestrel
    "john.west.acme.claims", // John West
    "owen-at-acme", // Owen Marsh
    // acme-web Islands pod (#pod-acme-web-internal, active in apps/acme-app/.../acme-webIslands)
    "peterfrench-acme", // Peter French
    "nightowl2", // Reggie Voss
    "priyamalhotra", // Priya Malhotra
    "marcovillanueva", // Marco Villanueva
    "MilesChandler-Acme", // Miles Chandler
    "fabian-acme", // Fabian Buentello
    "jerry.hong1", // Jerry Hong
  ],
  currentUser: "m4ttheweric",

  defaultRange: "30d",

  concurrency: 6,

  sizeBand: { tooSmall: 10, tooLarge: 400 },

  // Linear emails resolved from the acme workspace. Edit when people join/leave.
  linear: {
    emailByUser: {
      m4ttheweric: "matthew.goodwin@acme.claims",
      westonnovelli: "weston@acme.claims",
      geoff82: "geoff@acme.claims",
      nadia1: "leath@acme.claims",
      samkestrel: "ed.rocha@acme.claims",
      "john.west.acme.claims": "john.west@acme.claims",
      "owen-at-acme": "doug@acme.claims",
      "peterfrench-acme": "peter.french@acme.claims",
      nightowl2: "darrell.banks@acme.claims",
      priyamalhotra: "djam@acme.claims",
      marcovillanueva: "jorge@acme.claims",
      "MilesChandler-Acme": "caleb.dudley@acme.claims",
      "fabian-acme": "fabian.buentello@acme.claims",
      "jeremy.brown.acme": "jeremy.brown@acme.claims",
      "jerry.hong1": "jerry.hong@acme.claims",
    },
    maxIssueAgeDays: 90,
  },
};
