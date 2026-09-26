// packages/glance/tests/eventcursor-compat.test.ts
import { describe, expect, test } from 'bun:test';
import type { EventCursor } from '../src/types.ts';

describe('EventCursor compat', () => {
  test('a numeric GitLab cursor still typechecks and round-trips JSON', () => {
    const cursor: EventCursor = { since: '2026-08-06T00:00:00Z', lastEventId: 12345 };
    const back = JSON.parse(JSON.stringify(cursor)) as EventCursor;
    expect(back.lastEventId).toBe(12345);
    expect(back.seenIds).toBeUndefined();
  });

  test('a GitHub cursor carries string id and seenIds through JSON', () => {
    const cursor: EventCursor = {
      since: '2026-08-06T00:00:00Z',
      lastEventId: '16878075933',
      seenIds: ['12860960092', '16878075933'],
    };
    const back = JSON.parse(JSON.stringify(cursor)) as EventCursor;
    expect(back.lastEventId).toBe('16878075933');
    expect(back.seenIds).toEqual(['12860960092', '16878075933']);
  });
});
