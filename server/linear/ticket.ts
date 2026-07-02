/**
 * Where "does this MR reference a team ticket" is defined, dependency-free so both
 * the Linear fetch layer and the metric layer share one rule.
 */
import type { NormMr } from "../pipeline/model.js";

/** Build a regex that matches a Linear ticket ID for a specific team, e.g. "HUB-123" or "HUB:123". */
export function teamTicketRegex(team: string): RegExp | null {
  if (!team) return null;
  return new RegExp(`\\b${escapeRegex(team)}[-:]\\d+\\b`, "i");
}

/** The MR text scanned for ticket references. */
export function mrTicketHaystack(mr: Pick<NormMr, "title" | "sourceBranch" | "description">): string {
  return [mr.title, mr.sourceBranch, mr.description].filter(Boolean).join(" ");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
