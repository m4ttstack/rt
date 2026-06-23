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
  ],
  currentUser: "m4ttheweric",

  defaultRange: "30d",

  concurrency: 6,

  sizeBand: { tooSmall: 10, tooLarge: 400 },
};
