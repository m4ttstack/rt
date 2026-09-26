// packages/glance/tests/live/probe/analysis.test.ts
import { describe, expect, test } from 'bun:test';
import {
  etagSummary,
  latencies,
  orderingViolations,
  type DrivenAction,
  type ObservedEvent,
  type PollSample,
} from './analysis.ts';

const ev = (id: string, createdAt: string, over: Partial<ObservedEvent> = {}): ObservedEvent => ({
  id,
  type: 'PullRequestEvent',
  actorLogin: 'm4ttheweric',
  createdAt,
  firstObservedAt: createdAt,
  ...over,
});

describe('orderingViolations', () => {
  test('empty when id order matches createdAt order', () => {
    const events = [
      ev('100', '2026-08-05T10:00:00Z'),
      ev('200', '2026-08-05T10:01:00Z'),
    ];
    expect(orderingViolations(events)).toEqual([]);
  });

  test('reports each pair where a bigger id has an earlier createdAt', () => {
    const events = [
      ev('100', '2026-08-05T10:00:00Z'),
      ev('300', '2026-08-05T09:59:00Z'), // newer id, older timestamp
      ev('200', '2026-08-05T10:01:00Z'),
    ];
    expect(orderingViolations(events)).toEqual([
      { earlierId: '100', laterId: '300' },
      { earlierId: '200', laterId: '300' },
    ]);
  });

  test('compares ids numerically, not lexically', () => {
    // lexically '9' > '10'; numerically 9 < 10. No violation here.
    const events = [
      ev('9', '2026-08-05T10:00:00Z'),
      ev('10', '2026-08-05T10:01:00Z'),
    ];
    expect(orderingViolations(events)).toEqual([]);
  });
});

describe('latencies', () => {
  const action: DrivenAction = {
    label: 'open-pr',
    performedAt: '2026-08-05T10:00:00Z',
    expectedTypes: ['PullRequestEvent'],
  };

  test('matches the first expected-type event at-or-after performedAt minus skew', () => {
    const events = [
      ev('1', '2026-08-05T09:59:30Z', { firstObservedAt: '2026-08-05T10:02:00Z' }),
      ev('2', '2026-08-05T10:03:00Z', { firstObservedAt: '2026-08-05T10:04:00Z' }),
    ];
    // 60s skew margin admits the 09:59:30 event
    expect(latencies([action], events, 60_000)).toEqual([
      { label: 'open-pr', matchedEventId: '1', latencyMs: 120_000 },
    ]);
  });

  test('never-appeared action reports null latency', () => {
    const events = [ev('1', '2026-08-05T10:03:00Z', { type: 'PushEvent' })];
    expect(latencies([action], events, 60_000)).toEqual([
      { label: 'open-pr', matchedEventId: null, latencyMs: null },
    ]);
  });

  test('a matched event is not reused for a second action', () => {
    const two: DrivenAction[] = [
      action,
      { label: 'reopen-pr', performedAt: '2026-08-05T10:05:00Z', expectedTypes: ['PullRequestEvent'] },
    ];
    const events = [
      ev('1', '2026-08-05T10:01:00Z', { firstObservedAt: '2026-08-05T10:02:00Z' }),
      ev('2', '2026-08-05T10:06:00Z', { firstObservedAt: '2026-08-05T10:07:00Z' }),
    ];
    expect(latencies(two, events, 0).map((r) => r.matchedEventId)).toEqual(['1', '2']);
  });

  test('processes actions in performedAt order regardless of input array order', () => {
    // Array order is [second-performed, first-performed] -- the reverse of
    // performedAt order. Only one event is available and both actions
    // could claim it (its createdAt is after both performedAt values), so
    // the winner reveals which order the greedy match actually used.
    const outOfOrder: DrivenAction[] = [
      { label: 'second-performed', performedAt: '2026-08-05T10:02:00Z', expectedTypes: ['PullRequestEvent'] },
      { label: 'first-performed', performedAt: '2026-08-05T10:00:00Z', expectedTypes: ['PullRequestEvent'] },
    ];
    const events = [ev('1', '2026-08-05T10:05:00Z')];
    expect(latencies(outOfOrder, events, 0)).toEqual([
      { label: 'first-performed', matchedEventId: '1', latencyMs: 300_000 },
      { label: 'second-performed', matchedEventId: null, latencyMs: null },
    ]);
  });
});

describe('etagSummary', () => {
  test('counts 304s and rate-limit drop across consecutive 304s', () => {
    const samples: PollSample[] = [
      { at: '2026-08-05T10:00:00Z', status: 200, etagSent: false, rateLimitRemaining: 5000, xPollInterval: 60 },
      { at: '2026-08-05T10:00:10Z', status: 304, etagSent: true, rateLimitRemaining: 4999, xPollInterval: 60 },
      { at: '2026-08-05T10:00:20Z', status: 304, etagSent: true, rateLimitRemaining: 4999, xPollInterval: 60 },
      { at: '2026-08-05T10:00:30Z', status: 200, etagSent: true, rateLimitRemaining: 4998, xPollInterval: 60 },
    ];
    expect(etagSummary(samples)).toEqual({
      samples: 4,
      hits304: 2,
      remainingDropAcross304s: 0, // 4999 -> 4999 across the consecutive-304 run
    });
  });
});
