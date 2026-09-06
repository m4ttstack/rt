import { describe, expect, test } from 'bun:test';

import type { readProjectMRs } from '@mattstack/rt-client';
import { collectProjectPRs } from '../triage/projects.ts';

function stubReader(
  handler: (repoId: string) => Promise<{ ok: boolean; data?: unknown }>
) {
  return handler as unknown as typeof readProjectMRs;
}

describe('collectProjectPRs', () => {
  // The CRITICAL bug: a bare "host/path" rtRepos value reads back an
  // empty-but-ok result from the daemon rather than an error, so the
  // `!res.ok || !res.data` guard downstream never fires. Proving the
  // encoded identity (not the bare config string) is what actually reaches
  // readProjectMRs is the only way to catch a regression back to the bare
  // value, since a live daemon can't be exercised from a unit test.
  test('passes the ENCODED daemon identity to readProjectMRs, never the bare rtRepos value', async () => {
    const seen: string[] = [];
    const boardConfig = {
      projects: ['group/repo'],
      rtRepos: { 'group/repo': 'gitlab.com/group/repo' },
    };
    const fetchProjectMRs = stubReader(async repoId => {
      seen.push(repoId);
      return {
        ok: true,
        data: { mrs: {}, listSyncedAt: 0, source: 'poll', syncedAt: 0 },
      };
    });
    await collectProjectPRs(boardConfig, fetchProjectMRs);
    expect(seen).toEqual(['remote:gitlab.com%2Fgroup%2Frepo']);
    expect(seen).not.toContain('gitlab.com/group/repo');
  });

  test('skips a project with no rtRepos mapping without calling readProjectMRs', async () => {
    const seen: string[] = [];
    const boardConfig = { projects: ['group/repo'], rtRepos: {} };
    const fetchProjectMRs = stubReader(async repoId => {
      seen.push(repoId);
      return {
        ok: true,
        data: { mrs: {}, listSyncedAt: 0, source: 'poll', syncedAt: 0 },
      };
    });
    const { prs } = await collectProjectPRs(boardConfig, fetchProjectMRs);
    expect(seen).toEqual([]);
    expect(prs).toEqual([]);
  });

  test('collects PRs from every mapped project and skips a failed one', async () => {
    const boardConfig = {
      projects: ['a/b', 'c/d'],
      rtRepos: { 'a/b': 'gitlab.com/a/b', 'c/d': 'gitlab.com/c/d' },
    };
    const fetchProjectMRs = stubReader(async repoId => {
      if (repoId.includes('c%2Fd')) return { ok: false };
      return {
        ok: true,
        data: {
          mrs: { x: { pr: { id: repoId }, fetchedAt: 0 } },
          listSyncedAt: 0,
          source: 'poll',
          syncedAt: 0,
        },
      };
    });
    const { prs } = await collectProjectPRs(boardConfig, fetchProjectMRs);
    expect(prs).toEqual([{ id: 'remote:gitlab.com%2Fa%2Fb' }] as never);
  });

  // buildBoard keeps a codeowner-tagged MR whose author is not a configured
  // member only when it is handed these sections. Dropping them here makes
  // those MRs invisible to every pass reading from this loop.
  test('carries codeowner sections back keyed by PR id', async () => {
    const boardConfig = {
      projects: ['a/b'],
      rtRepos: { 'a/b': 'gitlab.com/a/b' },
    };
    const fetchProjectMRs = stubReader(async () => ({
      ok: true,
      data: {
        mrs: {
          tagged: {
            pr: { id: 'pr-1' },
            codeownerSections: ['islands'],
            fetchedAt: 0,
          },
          plain: { pr: { id: 'pr-2' }, fetchedAt: 0 },
        },
        listSyncedAt: 0,
        source: 'poll',
        syncedAt: 0,
      },
    }));
    const { prs, tags } = await collectProjectPRs(boardConfig, fetchProjectMRs);
    expect(prs.map(p => p.id)).toEqual(['pr-1', 'pr-2']);
    expect(tags.get('pr-1')).toEqual(['islands']);
    expect(tags.has('pr-2')).toBe(false);
  });
});
