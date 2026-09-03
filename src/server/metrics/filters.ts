import { mrTicketHaystack, teamTicketRegex } from "../linear/ticket.js";
import { compileBotPatterns, isBotUsername } from "./stats.js";
import type { NormMr } from "../store/model.js";

/** Build a predicate that returns true for MRs matching the ignore list. */
export function buildIgnoredMrSet(
  entries: string[] | undefined,
): (mr: { iid: number; projectPath: string }) => boolean {
  if (!entries || entries.length === 0) return () => false;
  const byProject = new Map<string, Set<number>>();
  const global = new Set<number>();
  for (const raw of entries) {
    const s = raw.trim();
    if (!s) continue;
    const bangIdx = s.indexOf("!");
    if (bangIdx >= 1) {
      const project = s.slice(0, bangIdx);
      const iid = Number(s.slice(bangIdx + 1));
      if (Number.isFinite(iid)) {
        let set = byProject.get(project);
        if (!set) { set = new Set(); byProject.set(project, set); }
        set.add(iid);
      }
    } else {
      const iid = Number(s.replace(/^!/, ""));
      if (Number.isFinite(iid)) global.add(iid);
    }
  }
  return (mr) => global.has(mr.iid) || (byProject.get(mr.projectPath)?.has(mr.iid) ?? false);
}

function filteredLineCounts(
  mr: NormMr,
  excludeRes: readonly RegExp[],
): { additions: number; deletions: number } {
  if (excludeRes.length === 0 || mr.diffStats.length === 0) {
    return { additions: mr.additions, deletions: mr.deletions };
  }
  let additions = 0;
  let deletions = 0;
  for (const f of mr.diffStats) {
    if (excludeRes.some((re) => re.test(f.path))) continue;
    additions += f.additions;
    deletions += f.deletions;
  }
  return { additions, deletions };
}

/** Compile a minimal glob (supports *, **, and literal segments) to a RegExp. */
export function globToRegExp(pattern: string): RegExp {
  // Patterns without a "/" match at any depth (gitignore-style):
  // "*.json" should match "apps/backend/package.json" and "package.json".
  const effective = pattern.includes("/") ? pattern : `**/${pattern}`;
  return new RegExp(
    "^" +
    effective
      // \x00/\x01 are placeholder sentinels for "**/ " and "**", stashed before the
      // literal-escaping step below (which would otherwise mangle the "*" characters)
      // and swapped back for their regex fragments afterward. Neither byte can occur
      // in a real glob pattern, so they round-trip safely.
      .replace(/\*\*\//g, "\x00")
      .replace(/\*\*/g, "\x01")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      // eslint-disable-next-line no-control-regex -- matching back the \x00 sentinel stashed above
      .replace(/\x00/g, "(.*/)?")
      // eslint-disable-next-line no-control-regex -- matching back the \x01 sentinel stashed above
      .replace(/\x01/g, ".*") +
    "$",
    "i",
  );
}

/** Settings-derived predicates, compiled once per snapshot/evidence build. */
export interface MetricFilters {
  /** Additions/deletions with excluded files removed, memoized per MR. */
  lineCounts(mr: NormMr): { additions: number; deletions: number };
  isBot(username: string | null): boolean;
  hasTeamTicket(mr: Pick<NormMr, "title" | "sourceBranch" | "description">): boolean;
}

export function buildMetricFilters(
  opts: { linearTeam?: string; extraBotPatterns?: string[]; excludeFilePatterns?: string[] },
): MetricFilters {
  const excludeRes = (opts.excludeFilePatterns ?? []).map(globToRegExp);
  const extraBots = compileBotPatterns(opts.extraBotPatterns);
  const ticketRe = opts.linearTeam ? teamTicketRegex(opts.linearTeam) : null;
  const counts = new WeakMap<NormMr, { additions: number; deletions: number }>();
  return {
    lineCounts(mr) {
      let c = counts.get(mr);
      if (!c) {
        c = filteredLineCounts(mr, excludeRes);
        counts.set(mr, c);
      }
      return c;
    },
    isBot: (username) => isBotUsername(username, extraBots),
    hasTeamTicket: (mr) => !ticketRe || ticketRe.test(mrTicketHaystack(mr)),
  };
}

/**
 * True when a ticket's current state counts as "done". When doneStates is empty,
 * falls back to type-based default: issues whose stateType is "completed" or "canceled".
 */
export function isDoneState(stateType: string | null, stateName: string | null, doneStates?: string[]): boolean {
  if (stateType === null) return true; // missing data... fall open
  if (doneStates && doneStates.length > 0) {
    return stateName !== null && doneStates.includes(stateName);
  }
  return stateType === "completed" || stateType === "canceled";
}

/** True when a Linear identifier belongs to the configured team (no team = all match). */
export function matchesTeam(identifier: string, linearTeam?: string): boolean {
  return !linearTeam || identifier.toUpperCase().startsWith(linearTeam.toUpperCase() + "-");
}
