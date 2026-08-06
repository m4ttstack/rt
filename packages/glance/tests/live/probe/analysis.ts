export interface ObservedEvent {
  id: string; // GitHub event id, string, numeric content
  type: string; // e.g. "PullRequestEvent"
  action?: string; // payload.action when present
  actorLogin: string;
  createdAt: string; // ISO, server-stamped
  firstObservedAt: string; // ISO, local clock, first poll where it appeared
}

export interface DrivenAction {
  label: string; // e.g. "open-pr", "comment", "approve-review"
  performedAt: string; // ISO, local clock, right after the mutating call returned
  expectedTypes: string[]; // event types that should carry it, from Task 6
}

export interface OrderingViolation {
  earlierId: string;
  laterId: string;
}

/** pairs where BigInt(id) order disagrees with createdAt order */
export function orderingViolations(events: ObservedEvent[]): OrderingViolation[] {
  const violations: OrderingViolation[] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = 0; j < events.length; j++) {
      if (i === j) continue;
      const bigger = BigInt(events[j].id) > BigInt(events[i].id);
      const earlier = Date.parse(events[j].createdAt) < Date.parse(events[i].createdAt);
      if (bigger && earlier) {
        violations.push({ earlierId: events[i].id, laterId: events[j].id });
      }
    }
  }
  violations.sort((a, b) => Number(BigInt(a.earlierId) - BigInt(b.earlierId)));
  return violations;
}

export interface LatencyRow {
  label: string;
  matchedEventId: string | null; // null = never appeared in the observation window
  latencyMs: number | null; // firstObservedAt - performedAt
}

/** match each driven action to the first observed event of an expected type
 *  created at-or-after performedAt minus skewMarginMs */
export function latencies(
  actions: DrivenAction[],
  events: ObservedEvent[],
  skewMarginMs: number
): LatencyRow[] {
  const sortedEvents = [...events].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  );
  const used = new Set<string>();
  const rows: LatencyRow[] = [];

  for (const action of actions) {
    const performedAtMs = Date.parse(action.performedAt);
    const match = sortedEvents.find(
      (event) =>
        !used.has(event.id) &&
        action.expectedTypes.includes(event.type) &&
        Date.parse(event.createdAt) >= performedAtMs - skewMarginMs
    );

    if (match) {
      used.add(match.id);
      rows.push({
        label: action.label,
        matchedEventId: match.id,
        latencyMs: Date.parse(match.firstObservedAt) - performedAtMs,
      });
    } else {
      rows.push({ label: action.label, matchedEventId: null, latencyMs: null });
    }
  }

  return rows;
}

export interface PollSample {
  at: string;
  status: number; // 200 or 304
  etagSent: boolean;
  rateLimitRemaining: number;
  xPollInterval: number | null;
}

export interface EtagSummary {
  samples: number;
  hits304: number;
  /** rate-limit points consumed across consecutive 304s: the docs claim 0 */
  remainingDropAcross304s: number;
}

export function etagSummary(samples: PollSample[]): EtagSummary {
  const hits304 = samples.filter((sample) => sample.status === 304).length;

  let remainingDropAcross304s = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (prev.status === 304 && cur.status === 304) {
      remainingDropAcross304s += Math.max(0, prev.rateLimitRemaining - cur.rateLimitRemaining);
    }
  }

  return {
    samples: samples.length,
    hits304,
    remainingDropAcross304s,
  };
}
