/** Shared by the server, the status CLI and the browser client, so this module
    must never import `fs`: server.ts bundles client.tsx for the browser. */

export type RespondStatus = "queued" | "triaging" | "implementing" | "drafting" | "done" | "error";

export type RespondOutcome = "posted" | "partial" | "drafted" | "none" | "unknown";

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/** What the run did with its drafted replies, derived from the two counts the
    respond wrapper reports rather than from an enum it also reports. One fact
    to get right means it cannot claim "posted" over a zero, and the four
    endings a single `done` used to blur stay distinguishable. */
export function respondOutcome(posted?: number, threads?: number): RespondOutcome {
  if (!isCount(posted) || !isCount(threads)) return "unknown";
  if (threads === 0) return "none";
  const answered = Math.min(posted, threads);
  if (answered === 0) return "drafted";
  return answered === threads ? "posted" : "partial";
}

export function respondDoneLabel(posted?: number, threads?: number): string {
  const outcome = respondOutcome(posted, threads);
  switch (outcome) {
    case "posted":
      return "replies posted";
    case "drafted":
      return "replies drafted, not posted";
    case "none":
      return "no threads to answer";
    case "partial":
      // Both counts are integers here by construction; the fallbacks only exist
      // to keep this arithmetic free of non-null assertions.
      return `${Math.min(posted ?? 0, threads ?? 0)} of ${threads ?? 0} posted`;
    case "unknown":
      return "responded";
  }
}

/** Outcomes where replies are still sitting unposted in the agent's pane, so
    the badge should nag rather than read as a clean finish. */
export function respondNeedsAttention(outcome: RespondOutcome): boolean {
  return outcome === "partial" || outcome === "drafted";
}
