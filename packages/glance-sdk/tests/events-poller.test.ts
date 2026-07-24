/**
 * Unit tests for EventsPoller: event classification and (Task 2) cursor tick
 * logic. fetchEvents is injected, so no network is involved.
 */
import { describe, expect, test } from 'bun:test';
import { classifyEvent, type GitLabEvent } from '../src/EventsPoller.ts';

function ev(partial: Partial<GitLabEvent>): GitLabEvent {
  return {
    id: 1,
    action_name: 'opened',
    target_type: null,
    target_iid: null,
    created_at: '2026-07-23T12:00:00Z',
    ...partial,
  };
}

describe('classifyEvent', () => {
  test('MergeRequest lifecycle event invalidates mr:<iid>', () => {
    const keys = classifyEvent(ev({ action_name: 'opened', target_type: 'MergeRequest', target_iid: 42 }));
    expect(keys).toEqual([{ kind: 'mr', ref: '42', cause: 'opened' }]);
  });

  test('approval event (target_type MergeRequest) also invalidates mr:<iid>', () => {
    const keys = classifyEvent(ev({ action_name: 'approved', target_type: 'MergeRequest', target_iid: 7 }));
    expect(keys).toEqual([{ kind: 'mr', ref: '7', cause: 'approved' }]);
  });

  test('note on an MR invalidates notes:<iid> and mr:<iid>', () => {
    const keys = classifyEvent(ev({
      action_name: 'commented on',
      target_type: 'Note',
      target_iid: null,
      note: { noteable_type: 'MergeRequest', noteable_iid: 9 },
    }));
    expect(keys).toEqual([
      { kind: 'notes', ref: '9', cause: 'note added' },
      { kind: 'mr', ref: '9', cause: 'note added' },
    ]);
  });

  test('note on an Issue produces no invalidations', () => {
    const keys = classifyEvent(ev({
      action_name: 'commented on',
      target_type: 'Note',
      note: { noteable_type: 'Issue', noteable_iid: 3 },
    }));
    expect(keys).toEqual([]);
  });

  test('push invalidates branch:<ref> and pipelines:*', () => {
    const keys = classifyEvent(ev({
      action_name: 'pushed to',
      push_data: { ref: 'feature/x', ref_type: 'branch', action: 'pushed' },
    }));
    expect(keys).toEqual([
      { kind: 'branch', ref: 'feature/x', cause: 'pushed to' },
      { kind: 'pipelines', ref: '*', cause: 'pushed to feature/x' },
    ]);
  });

  test('branch deletion invalidates branch:<ref> only', () => {
    const keys = classifyEvent(ev({
      action_name: 'deleted',
      push_data: { ref: 'feature/x', ref_type: 'branch', action: 'removed' },
    }));
    expect(keys).toEqual([{ kind: 'branch', ref: 'feature/x', cause: 'deleted' }]);
  });

  test('unrelated event (e.g. joined project) produces nothing', () => {
    const keys = classifyEvent(ev({ action_name: 'joined', target_type: null }));
    expect(keys).toEqual([]);
  });
});
