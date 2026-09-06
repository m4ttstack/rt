import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { BoxscoreSettings, Env } from '../src/server/config/index.js';
import { withWindow } from '../src/server/leaderboard.js';
import type {
  GitProvider,
  SourceProvider,
} from '../src/server/source/index.js';
import type { RefreshProgress } from '../src/shared/types.js';
import { WINDOW } from './fixtures.js';

const dir = mkdtempSync(join(tmpdir(), 'boxscore-progress-'));
process.env.BOXSCORE_DB = join(dir, 'test.sqlite');

const { getStore, __resetStore } = await import('../src/server/store/index.js');
const { runRefresh } = await import('../src/server/refresh/index.js');

beforeEach(() => getStore().clear());
afterAll(() => {
  __resetStore();
  rmSync(dir, { recursive: true, force: true });
});

const ENV: Env = { baseUrl: 'https://gl.example', token: 'tkn' };

const SETTINGS: BoxscoreSettings = {
  projects: ['org/app'],
  roster: [{ username: 'alice' }],
  hiddenMembers: [],
  users: ['alice'],
  linearTeam: '',
  doneStates: [],
  sizeBand: { tooSmall: 10, tooLarge: 400 },
  excludeFilePatterns: [],
  ignoredMrs: [],
  botPatterns: [],
  defaultRange: '30d',
  baseUrl: ENV.baseUrl,
};

/** A hand-rolled fake, not a mock library: minimal stand-in for the real GitLab provider. */
function makeFakeProvider(): GitProvider {
  const provider: SourceProvider = {
    async fetchMergeRequestIndex() {
      return [];
    },
    async fetchMergeRequestMetrics() {
      return null;
    },
    async fetchProject(projectPath) {
      return { id: `gitlab:${projectPath}`, fullPath: projectPath };
    },
    async fetchProjectPipelines() {
      return [];
    },
    async fetchUserEvents() {
      return [];
    },
    async restRequest() {
      return new Response('[]', { status: 200 });
    },
  };
  return provider as unknown as GitProvider;
}

describe('withWindow', () => {
  it('stamps the window onto each progress event', () => {
    const seen: RefreshProgress[] = [];
    const wrapped = withWindow('prior', p => seen.push(p));
    wrapped!({
      phase: 'mrs-detail',
      label: 'Fetching MR details',
      done: 2,
      total: 5,
    });
    expect(seen).toEqual([
      {
        phase: 'mrs-detail',
        label: 'Fetching MR details',
        done: 2,
        total: 5,
        window: 'prior',
      },
    ]);
  });

  it('returns undefined when no reporter is given', () => {
    expect(withWindow('current', undefined)).toBeUndefined();
  });
});

describe('runRefresh progress emission', () => {
  it('emits the users and mrs-list phases', async () => {
    const phases = new Set<string>();
    await runRefresh({
      store: getStore(),
      provider: makeFakeProvider(),
      settings: SETTINGS,
      env: ENV,
      window: WINDOW,
      onProgress: p => phases.add(p.phase),
    });
    expect(phases.has('users')).toBe(true);
    expect(phases.has('mrs-list')).toBe(true);
  });
});
