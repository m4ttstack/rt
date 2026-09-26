#!/usr/bin/env bun
/**
 * fetchMergeRequestMetrics: one MR's metric-grade detail. The first query
 * carries the MR fields plus the first page of notes; later pages fetch
 * notes only. `inline` is whether the note has a diff position.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

interface Call { op: string; vars: Record<string, unknown> }

const note = (author: string | null, createdAt: string, inline = false, system = false) => ({
  system,
  createdAt,
  author: author === null ? null : { username: author },
  position: inline ? { __typename: 'DiffPosition' } : null,
});

function detail(notesPage: { hasNextPage: boolean; endCursor: string | null; nodes: unknown[] }) {
  return {
    project: {
      id: 'gid://gitlab/Project/42',
      mergeRequest: {
        description: 'closes ENG-1',
        diffStatsSummary: { additions: 30, deletions: 3, fileCount: 2 },
        diffStats: [{ path: 'src/a.ts', additions: 10, deletions: 1 }, { path: 'package.json', additions: 20, deletions: 2 }],
        labels: { nodes: [{ title: 'bug' }] },
        approvedBy: { nodes: [{ username: 'bob' }] },
        notes: { pageInfo: { hasNextPage: notesPage.hasNextPage, endCursor: notesPage.endCursor }, nodes: notesPage.nodes },
      },
    },
  };
}

function stub(provider: GitLabProvider, responses: unknown[]): Call[] {
  const calls: Call[] = [];
  (provider as any).runQuery = async (op: string, _query: string, vars: Record<string, unknown>) => {
    calls.push({ op, vars });
    return responses[calls.length - 1];
  };
  return calls;
}

describe('GitLabProvider.fetchMergeRequestMetrics', () => {
  test('maps the MR fields and classifies notes', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const calls = stub(p, [detail({ hasNextPage: false, endCursor: null, nodes: [
      note('bob', '2026-08-02T10:00:00Z', true),
      note('bob', '2026-08-02T11:00:00Z'),
      note(null, '2026-08-02T11:05:00Z', false, true),
    ] })]);
    const m = await p.fetchMergeRequestMetrics('g/p', 7);
    expect(calls).toEqual([{ op: 'fetchMergeRequestMetrics', vars: { fullPath: 'g/p', iid: '7' } }]);
    expect(m).toEqual({
      iid: 7,
      projectPath: 'g/p',
      description: 'closes ENG-1',
      diffStats: { additions: 30, deletions: 3, filesChanged: 2 },
      fileStats: [{ path: 'src/a.ts', additions: 10, deletions: 1 }, { path: 'package.json', additions: 20, deletions: 2 }],
      labels: ['bug'],
      approvedByUsernames: ['bob'],
      notes: [
        { authorUsername: 'bob', createdAt: '2026-08-02T10:00:00Z', system: false, inline: true },
        { authorUsername: 'bob', createdAt: '2026-08-02T11:00:00Z', system: false, inline: false },
        { authorUsername: null, createdAt: '2026-08-02T11:05:00Z', system: true, inline: false },
      ],
    });
  });

  test('pages notes to exhaustion with notes-only follow-up queries', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const calls = stub(p, [
      detail({ hasNextPage: true, endCursor: 'n1', nodes: [note('a', '2026-08-02T10:00:00Z')] }),
      { project: { mergeRequest: { notes: { pageInfo: { hasNextPage: true, endCursor: 'n2' }, nodes: [note('b', '2026-08-02T11:00:00Z')] } } } },
      { project: { mergeRequest: { notes: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [note('c', '2026-08-02T12:00:00Z')] } } } },
    ]);
    const m = await p.fetchMergeRequestMetrics('g/p', 7);
    expect(m!.notes.map((n) => n.authorUsername)).toEqual(['a', 'b', 'c']);
    expect(calls.map((c) => c.op)).toEqual(['fetchMergeRequestMetrics', 'fetchMergeRequestMetrics.notes', 'fetchMergeRequestMetrics.notes']);
    expect(calls[1]!.vars).toEqual({ fullPath: 'g/p', iid: '7', after: 'n1' });
    expect(calls[2]!.vars.after).toBe('n2');
  });

  test('null when the project or MR does not exist', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stub(p, [{ project: null }]);
    expect(await p.fetchMergeRequestMetrics('g/p', 7)).toBeNull();
    stub(p, [{ project: { id: 'x', mergeRequest: null } }]);
    expect(await p.fetchMergeRequestMetrics('g/p', 7)).toBeNull();
  });

  test('a notes cursor that does not advance throws', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stub(p, [
      detail({ hasNextPage: true, endCursor: 'n1', nodes: [] }),
      { project: { mergeRequest: { notes: { pageInfo: { hasNextPage: true, endCursor: 'n1' }, nodes: [] } } } },
    ]);
    await expect(p.fetchMergeRequestMetrics('g/p', 7)).rejects.toThrow('non-advancing notes cursor');
  });

  test('an MR that disappears on a follow-up notes page throws instead of returning partial notes', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stub(p, [
      detail({ hasNextPage: true, endCursor: 'n1', nodes: [note('a', '2026-08-02T10:00:00Z')] }),
      { project: { mergeRequest: null } },
    ]);
    await expect(p.fetchMergeRequestMetrics('g/p', 7)).rejects.toThrow('g/p!7 disappeared while paging notes');
  });

  test('a non-advancing cursor on the first notes page throws instead of truncating silently', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stub(p, [detail({ hasNextPage: true, endCursor: null, nodes: [note('a', '2026-08-02T10:00:00Z')] })]);
    await expect(p.fetchMergeRequestMetrics('g/p', 7)).rejects.toThrow(
      "fetchMergeRequestMetrics: non-advancing notes cursor 'null' for g/p!7"
    );
  });

  test('the capability flag is on', () => {
    expect(new GitLabProvider('https://gitlab.example', 't').capabilities.canFetchMergeRequestMetrics).toBe(true);
  });
});
