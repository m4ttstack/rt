import { afterEach, describe, expect, it } from 'vitest';

import {
  __setSettingReader,
  readSettings,
} from '../src/server/config/index.js';

const store = (values: Record<string, unknown>) =>
  __setSettingReader(<T>(key: string) => values[key] as T | undefined);

afterEach(() => __setSettingReader(null));

describe('readSettings', () => {
  it('maps every key and derives users from roster minus hiddenMembers', () => {
    store({
      'mattstack.roster': [
        { username: 'ada', name: 'Ada L' },
        { username: 'bob' },
        { username: 'eve', name: 'Eve M' },
      ],
      'boxscore.hiddenMembers': ['eve'],
      'boxscore.projects': ['g/p'],
      'boxscore.linearDoneStates': ['Done'],
      'boxscore.sizeBand': { tooSmall: 5, tooLarge: 300 },
      'boxscore.excludeFilePatterns': ['**/*.json'],
      'boxscore.ignoredMrs': ['g/p!9'],
      'boxscore.botPatterns': ['-bot$'],
      'boxscore.defaultRange': '7d',
      'mattstack.integrations': {
        forge: { host: 'gitlab.example', provider: 'gitlab' },
      },
    });
    const s = readSettings();
    expect(s.users).toEqual(['ada', 'bob']);
    expect(s.roster).toHaveLength(3);
    expect(s.projects).toEqual(['g/p']);
    expect(s.doneStates).toEqual(['Done']);
    expect(s.sizeBand).toEqual({ tooSmall: 5, tooLarge: 300 });
    expect(s.excludeFilePatterns).toEqual(['**/*.json']);
    expect(s.ignoredMrs).toEqual(['g/p!9']);
    expect(s.botPatterns).toEqual(['-bot$']);
    expect(s.defaultRange).toBe('7d');
    expect(s.baseUrl).toBe('https://gitlab.example');
  });

  it('applies fallbacks when every key is unset', () => {
    store({});
    const s = readSettings();
    expect(s.projects).toEqual([]);
    expect(s.users).toEqual([]);
    expect(s.doneStates).toEqual([]);
    expect(s.sizeBand).toEqual({ tooSmall: 10, tooLarge: 400 });
    expect(s.excludeFilePatterns).toEqual([]);
    expect(s.ignoredMrs).toEqual([]);
    expect(s.botPatterns).toEqual([]);
    expect(s.defaultRange).toBe('30d');
    expect(s.baseUrl).toBe('');
  });

  it('keeps an already-URL forge host as-is and clips a trailing slash', () => {
    store({
      'mattstack.integrations': { forge: { host: 'https://gl.example/' } },
    });
    expect(readSettings().baseUrl).toBe('https://gl.example');
  });

  it('reads fresh on every call (no module cache)', () => {
    store({ 'boxscore.projects': ['a/b'] });
    expect(readSettings().projects).toEqual(['a/b']);
    store({ 'boxscore.projects': ['c/d'] });
    expect(readSettings().projects).toEqual(['c/d']);
  });

  it('refuses the store-backed reader under vitest', () => {
    __setSettingReader(null);
    expect(() => readSettings()).toThrow('inject a setting reader');
  });
});
