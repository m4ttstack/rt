import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import type { getSetting, setSetting } from '@mattstack/rt-client';
import {
  applyRosterEdit,
  DEFAULT_SLACK_EMOJI,
  displayName,
  loadConfigFrom,
  saveMemberHidden,
  saveRosterMembers,
  saveSwitchboardUrl,
  saveTabs,
  type TabConfig,
} from '../config.ts';

type GetSettingFn = typeof getSetting;
type SetSettingFn = typeof setSetting;

/** A resolve stand-in returning `values[key]` (or undefined for an absent
    key), matching getSetting's shape without touching any real store --
    same "tests inject a stand-in" precedent as deck's platform-settings
    latch tests (local-apps-settings-wt), just for the success path too. */
function fakeResolve(values: Record<string, unknown>): GetSettingFn {
  return (<T>(key: string) => ({
    value: values[key] as T,
    provenance: [],
  })) as GetSettingFn;
}

function throwingResolve(message = 'rt daemon unreachable'): GetSettingFn {
  return (() => {
    throw new Error(message);
  }) as GetSettingFn;
}

/** Records every setSetting call instead of writing anywhere real. */
function fakeWrite(
  calls: Array<{ key: string; value: unknown; scope: string }>
): SetSettingFn {
  return ((key: string, value: unknown, scope: string) => {
    calls.push({ key, value, scope });
  }) as SetSettingFn;
}

const base = {
  gitlabHost: 'https://gitlab.com',
  projects: ['org/repo'],
  members: [{ username: 'alice', name: 'Alice Ng' }, { username: 'bob' }],
};

function tmpConfig(body: Record<string, unknown> = base): string {
  const p = join(mkdtempSync(join(tmpdir(), 'board-latch-')), 'config.json');
  writeFileSync(p, JSON.stringify(body, null, 2) + '\n');
  return p;
}

describe('loadConfigFrom: per-key store-wins fallback', () => {
  test("an unowned key falls back to config.json's value", () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(p, fakeResolve({}));
    expect(cfg.gitlabHost).toBe('https://gitlab.com');
    expect(cfg.projects).toEqual(['org/repo']);
    expect(cfg.title).toBe('MRs ready for review');
  });

  test("a store-owned scalar key wins over config.json's value", () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(
      p,
      fakeResolve({
        'board.gitlabHost': 'https://gitlab.example.com',
        'board.title': 'Team Board',
      })
    );
    expect(cfg.gitlabHost).toBe('https://gitlab.example.com');
    expect(cfg.title).toBe('Team Board');
    // untouched keys still fall back to the file
    expect(cfg.projects).toEqual(['org/repo']);
  });

  test('board.workspaces wins per sub-field, not wholesale', () => {
    const p = tmpConfig({
      ...base,
      reviewsWorkspace: 'file-reviews',
      respondsWorkspace: 'file-responds',
      doctorsWorkspace: 'file-doctors',
    });
    const cfg = loadConfigFrom(
      p,
      fakeResolve({ 'board.workspaces': { reviews: 'store-reviews' } })
    );
    expect(cfg.reviewsWorkspace).toBe('store-reviews');
    expect(cfg.respondsWorkspace).toBe('file-responds');
    expect(cfg.doctorsWorkspace).toBe('file-doctors');
  });

  test('board.cwds wins per sub-field, not wholesale', () => {
    const p = tmpConfig({
      ...base,
      reviewCwd: '/file/review',
      respondCwd: '/file/respond',
      doctorCwd: '/file/doctor',
    });
    const cfg = loadConfigFrom(
      p,
      fakeResolve({ 'board.cwds': { doctor: '/store/doctor' } })
    );
    expect(cfg.reviewCwd).toBe('/file/review');
    expect(cfg.respondCwd).toBe('/file/respond');
    expect(cfg.doctorCwd).toBe('/store/doctor');
  });

  test('rtRepos derives from board.projects and board.gitlabHost; board.rtRepos in the store is not read', () => {
    const p = tmpConfig({ ...base, projects: ['org/repo'] });
    const cfg = loadConfigFrom(
      p,
      fakeResolve({
        'board.gitlabHost': 'https://GitLab.example.com',
        'board.projects': ['org/repo', 'org/other'],
        'board.rtRepos': [{ project: 'org/repo', repo: 'store-repo-name' }],
      })
    );
    expect(cfg.rtRepos).toEqual({
      'org/repo': 'gitlab.example.com/org/repo',
      'org/other': 'gitlab.example.com/org/other',
    });
  });

  test('a config.json rtRepos entry still overrides the derived identity for its project (a fork or a renamed remote)', () => {
    const p = tmpConfig({
      ...base,
      projects: ['org/repo', 'org/other'],
      rtRepos: { 'org/repo': 'gitlab.com/forks/repo' },
    });
    const cfg = loadConfigFrom(p, fakeResolve({}));
    expect(cfg.rtRepos).toEqual({
      'org/repo': 'gitlab.com/forks/repo',
      'org/other': 'gitlab.com/org/other',
    });
    expect(cfg.rtRepoOverrides).toEqual({
      'org/repo': 'gitlab.com/forks/repo',
    });
  });

  test("rtRepoOverrides holds only config.json's explicit entries after the store overlay, never the derived map", () => {
    const p = tmpConfig({ ...base, projects: ['org/repo'] });
    const cfg = loadConfigFrom(
      p,
      fakeResolve({ 'board.projects': ['org/repo', 'org/other'] })
    );
    expect(cfg.rtRepoOverrides).toEqual({});
    expect(Object.keys(cfg.rtRepos).sort()).toEqual(['org/other', 'org/repo']);
  });

  test("a store gitlabHost or projects of the wrong type fails parseConfig's validation, never a TypeError inside derivation", () => {
    const p = tmpConfig({ ...base, projects: ['org/repo'] });
    expect(() =>
      loadConfigFrom(p, fakeResolve({ 'board.gitlabHost': 42 }))
    ).toThrow(/gitlabHost/);
    expect(() =>
      loadConfigFrom(p, fakeResolve({ 'board.projects': 'org/repo' }))
    ).toThrow(/projects/);
  });

  test("a resolver throw degrades that key to config.json's value, never crashes the load", () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(p, throwingResolve());
    expect(cfg.gitlabHost).toBe('https://gitlab.com');
    expect(cfg.title).toBe('MRs ready for review');
  });

  test('gateGraceMinutes fails open to 90 when the store key is unregistered (a resolver throw), even with no config.json value', () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(
      p,
      throwingResolve('unknown setting "board.gateGraceMinutes"')
    );
    expect(cfg.gateGraceMinutes).toBe(90);
  });

  test("gateGraceMinutes: store-owned value wins over config.json's", () => {
    const p = tmpConfig({ ...base, gateGraceMinutes: 45 });
    const cfg = loadConfigFrom(
      p,
      fakeResolve({ 'board.gateGraceMinutes': 120 })
    );
    expect(cfg.gateGraceMinutes).toBe(120);
  });

  test('mattstack.roster wins over board.members', () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(
      p,
      fakeResolve({
        'mattstack.roster': [{ username: 'suite', name: 'Suite Wide' }],
        'board.members': [{ username: 'legacy' }],
      })
    );
    expect(cfg.members).toEqual([{ username: 'suite', name: 'Suite Wide' }]);
  });

  test('board.members still wins over config.json when mattstack.roster is unset', () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(
      p,
      fakeResolve({ 'board.members': [{ username: 'legacy' }] })
    );
    expect(cfg.members).toEqual([{ username: 'legacy' }]);
  });

  test('an empty mattstack.roster is still ownership, not absence', () => {
    // [] is a value: it must not fall through to board.members. parseConfig
    // refuses an empty roster, so this proves ownership by the throw.
    const p = tmpConfig();
    expect(() =>
      loadConfigFrom(
        p,
        fakeResolve({
          'mattstack.roster': [],
          'board.members': [{ username: 'legacy' }],
        })
      )
    ).toThrow(/missing required field "members"/);
  });

  test('board.hiddenMembers overlays a mattstack.roster roster the same way', () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(
      p,
      fakeResolve({
        'mattstack.roster': [{ username: 'ann' }, { username: 'bo' }],
        'board.hiddenMembers': ['bo'],
      })
    );
    expect(cfg.members).toEqual([
      { username: 'ann' },
      { username: 'bo', hidden: true },
    ]);
  });
});

describe('loadConfigFrom: store values get the same normalization/validation the file path gets', () => {
  test('a lowercase store ticketPrefixes normalizes (trim + uppercase), same as the file path', () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(
      p,
      fakeResolve({ 'board.ticketPrefixes': ['cv', ' int '] })
    );
    expect(cfg.ticketPrefixes).toEqual(['CV', 'INT']);
  });

  test("a partial store slack object gets DEFAULT_SLACK fill for the fields it doesn't carry", () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(
      p,
      fakeResolve({ 'board.slack': { channel: 'store-channel' } })
    );
    expect(cfg.slack).toEqual({
      channel: 'store-channel',
      singleTemplate: '{title}: {url}',
      multiHeader: "{count} MR's ready for review :pray:",
      multiItem: '- {title}: {url}',
      autoResolveIntervalMinutes: 15,
      emoji: DEFAULT_SLACK_EMOJI,
    });
  });

  test("a store switchboardUrl with a trailing slash strips it, same as parseSwitchboard's file-side rule", () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(
      p,
      fakeResolve({ 'board.switchboardUrl': 'https://sb.example.app/' })
    );
    expect(cfg.switchboard.url).toBe('https://sb.example.app');
  });

  test('a bad store defaultMember (not "all" or a known member) is rejected the same way a bad file one is', () => {
    const p = tmpConfig();
    expect(() =>
      loadConfigFrom(p, fakeResolve({ 'board.defaultMember': 'ghost' }))
    ).toThrow(/defaultMember/);
  });

  test('a store member with no username is rejected the same way a bad file one is', () => {
    const p = tmpConfig();
    expect(() =>
      loadConfigFrom(p, fakeResolve({ 'board.members': [{ name: 'No User' }] }))
    ).toThrow(/username/);
  });

  test("a malformed store value's error names the settings store, never config.json", () => {
    const p = tmpConfig();
    expect(() =>
      loadConfigFrom(p, fakeResolve({ 'board.defaultMember': 'ghost' }))
    ).toThrow(/settings-store value/);
    try {
      loadConfigFrom(p, fakeResolve({ 'board.defaultMember': 'ghost' }));
    } catch (err) {
      expect((err as Error).message).not.toContain('config.json');
    }
  });
});

describe('loadConfigFrom: members roster + hiddenMembers overlay', () => {
  test("unowned board.members and board.hiddenMembers: hidden comes from config.json's inline flags", () => {
    const p = tmpConfig({
      ...base,
      members: [{ username: 'alice', hidden: true }, { username: 'bob' }],
    });
    const cfg = loadConfigFrom(p, fakeResolve({}));
    expect(cfg.members).toEqual([
      { username: 'alice', hidden: true },
      { username: 'bob' },
    ]);
  });

  test('owned board.hiddenMembers overlays hidden by username onto the file roster, replacing inline flags', () => {
    const p = tmpConfig({
      ...base,
      members: [{ username: 'alice', hidden: true }, { username: 'bob' }],
    });
    const cfg = loadConfigFrom(
      p,
      fakeResolve({ 'board.hiddenMembers': ['bob'] })
    );
    expect(cfg.members).toEqual([
      { username: 'alice' },
      { username: 'bob', hidden: true },
    ]);
  });

  test('owned board.members (team roster) with owned board.hiddenMembers (user overlay) compose', () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(
      p,
      fakeResolve({
        'board.members': [
          { username: 'carol', name: 'Carol' },
          { username: 'dave' },
        ],
        'board.hiddenMembers': ['dave'],
      })
    );
    expect(cfg.members).toEqual([
      { username: 'carol', name: 'Carol' },
      { username: 'dave', hidden: true },
    ]);
  });

  test("owned board.members with unowned board.hiddenMembers falls back to the store roster's own inline hidden flags", () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(
      p,
      fakeResolve({
        'board.members': [
          { username: 'carol', hidden: true },
          { username: 'dave' },
        ],
      })
    );
    expect(cfg.members).toEqual([
      { username: 'carol', hidden: true },
      { username: 'dave' },
    ]);
  });
});

describe('loadConfigFrom: config.json-optional boot once the team store owns the required fields', () => {
  test('a missing file with the store fully owning gitlabHost/projects/members loads from the store alone', () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), 'board-latch-nofile-')),
      'config.json'
    );
    const cfg = loadConfigFrom(
      missing,
      fakeResolve({
        'board.gitlabHost': 'https://gitlab.example.com',
        'board.projects': ['team/repo'],
        'board.members': [{ username: 'carol' }],
      })
    );
    expect(cfg.gitlabHost).toBe('https://gitlab.example.com');
    expect(cfg.projects).toEqual(['team/repo']);
    expect(cfg.members).toEqual([{ username: 'carol' }]);
  });

  test('a missing file with the store only partially owning the required fields still throws', () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), 'board-latch-nofile-')),
      'config.json'
    );
    expect(() =>
      loadConfigFrom(
        missing,
        fakeResolve({ 'board.gitlabHost': 'https://gitlab.example.com' })
      )
    ).toThrow(/config\.json not found/);
  });

  test('a missing file with nothing in the store throws the same instructive error as before', () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), 'board-latch-nofile-')),
      'config.json'
    );
    expect(() => loadConfigFrom(missing, fakeResolve({}))).toThrow(
      /config\.json not found/
    );
  });
});

describe('loadConfigFrom: board.tabs overlay', () => {
  test('board.tabs store value overlays config.json', () => {
    const p = tmpConfig();
    const resolve = fakeResolve({
      'board.tabs': [
        {
          id: 'q',
          label: 'Q',
          source: { kind: 'codeowners', section: 'Acme', excludeMembers: true },
          slackChannel: 'team-codeowners',
        },
      ],
    });
    const cfg = loadConfigFrom(p, resolve);
    expect(cfg.tabs[0]!.id).toBe('q');
  });
});

describe('saveRosterMembers: latch-gated writer', () => {
  test("unowned: rewrites config.json's members, store untouched", () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const next = [{ username: 'alice' }, { username: 'bob', name: 'Bob' }];
    const cfg = saveRosterMembers(next, p, fakeResolve({}), fakeWrite(calls));
    expect(calls).toEqual([]);
    expect(cfg.members).toEqual(next);
    expect(JSON.parse(readFileSync(p, 'utf8')).members).toEqual(next);
  });

  test('owned: writes board.members (team), config.json untouched', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const before = readFileSync(p, 'utf8');
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const next = [{ username: 'alice' }, { username: 'bob' }];
    saveRosterMembers(
      next,
      p,
      fakeResolve({ 'board.members': [{ username: 'alice' }] }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.members', value: next, scope: 'team' },
    ]);
    expect(readFileSync(p, 'utf8')).toBe(before);
    expect(
      loadConfigFrom(p, fakeResolve({ 'board.members': next })).members
    ).toEqual(next);
  });

  test('removal round-trips through the same writer', () => {
    const p = tmpConfig({
      ...base,
      members: [{ username: 'alice' }, { username: 'bob' }],
    });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const stored = [{ username: 'alice' }, { username: 'bob' }];
    saveRosterMembers(
      [{ username: 'alice' }],
      p,
      fakeResolve({ 'board.members': stored }),
      fakeWrite(calls)
    );
    expect(calls[0]!.value).toEqual([{ username: 'alice' }]);
  });

  test('owned by mattstack.roster: writes that key, not board.members', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const next = [{ username: 'alice' }, { username: 'bob', name: 'Bob Ng' }];
    saveRosterMembers(
      next,
      p,
      fakeResolve({
        'mattstack.roster': [{ username: 'alice' }],
        'board.members': [{ username: 'legacy' }],
      }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'mattstack.roster', value: next, scope: 'team' },
    ]);
  });

  test('a write to mattstack.roster strips hidden: that key has no such field', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveRosterMembers(
      [{ username: 'alice' }, { username: 'bob', hidden: true, name: 'Bob' }],
      p,
      fakeResolve({ 'mattstack.roster': [{ username: 'alice' }] }),
      fakeWrite(calls)
    );
    expect(calls[0]!.value).toEqual([
      { username: 'alice' },
      { username: 'bob', name: 'Bob' },
    ]);
  });

  test('a write to board.members keeps hidden: that key still carries it', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const next = [{ username: 'alice' }, { username: 'bob', hidden: true }];
    saveRosterMembers(
      next,
      p,
      fakeResolve({ 'board.members': [{ username: 'alice' }] }),
      fakeWrite(calls)
    );
    expect(calls[0]!.value).toEqual(next);
  });
});

describe('saveMemberHidden: latch-gated writer', () => {
  test("unowned: writes config.json's inline hidden flag, store untouched", () => {
    const p = tmpConfig({
      ...base,
      members: [{ username: 'alice' }, { username: 'bob' }],
    });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const cfg = saveMemberHidden(
      'bob',
      true,
      p,
      fakeResolve({}),
      fakeWrite(calls)
    );
    expect(calls).toEqual([]);
    expect(cfg.members).toEqual([
      { username: 'alice' },
      { username: 'bob', hidden: true },
    ]);
    const onDisk = JSON.parse(readFileSync(p, 'utf8'));
    expect(
      onDisk.members.find((m: { username: string }) => m.username === 'bob')
        .hidden
    ).toBe(true);
  });

  test('owned: writes board.hiddenMembers (user), config.json untouched', () => {
    const p = tmpConfig({
      ...base,
      members: [{ username: 'alice' }, { username: 'bob' }],
    });
    const before = readFileSync(p, 'utf8');
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden(
      'bob',
      true,
      p,
      fakeResolve({ 'board.hiddenMembers': [] }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: ['bob'], scope: 'user' },
    ]);
    expect(readFileSync(p, 'utf8')).toBe(before);
    // A resolver that already reflects the write's own value proves the overlay reads it back correctly.
    const reloaded = loadConfigFrom(
      p,
      fakeResolve({ 'board.hiddenMembers': ['bob'] })
    );
    expect(reloaded.members).toEqual([
      { username: 'alice' },
      { username: 'bob', hidden: true },
    ]);
  });

  test('owned: unhiding removes the username from the stored array rather than appending a duplicate', () => {
    const p = tmpConfig({
      ...base,
      members: [{ username: 'alice' }, { username: 'bob' }],
    });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden(
      'alice',
      false,
      p,
      fakeResolve({ 'board.hiddenMembers': ['alice', 'bob'] }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: ['bob'], scope: 'user' },
    ]);
  });

  test('owned: an unknown member throws before any write', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    expect(() =>
      saveMemberHidden(
        'ghost',
        true,
        p,
        fakeResolve({ 'board.hiddenMembers': [] }),
        fakeWrite(calls)
      )
    ).toThrow(/unknown member/);
    expect(calls).toEqual([]);
  });

  test('a resolver throw on the ownership probe degrades to unowned, still writes the file', () => {
    const p = tmpConfig({
      ...base,
      members: [{ username: 'alice' }, { username: 'bob' }],
    });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const cfg = saveMemberHidden(
      'bob',
      true,
      p,
      throwingResolve(),
      fakeWrite(calls)
    );
    expect(calls).toEqual([]);
    expect(cfg.members).toEqual([
      { username: 'alice' },
      { username: 'bob', hidden: true },
    ]);
  });
});

describe('saveMemberHidden / saveSwitchboardUrl: config.json-free still succeeds (RULING: file-authority is meaningless with no file)', () => {
  const teamOwned = {
    'board.gitlabHost': 'https://gitlab.example.com',
    'board.projects': ['team/repo'],
    'board.members': [
      { username: 'carol', hidden: true },
      { username: 'dave' },
    ],
    // board.hiddenMembers/board.switchboardUrl deliberately absent -- unowned going in
  };

  test('saveMemberHidden with owned team keys and no config.json establishes board.hiddenMembers ownership, seeded from the resolved hidden set', () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), 'board-latch-nofile-')),
      'config.json'
    );
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const cfg = saveMemberHidden(
      'dave',
      true,
      missing,
      fakeResolve(teamOwned),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: ['carol', 'dave'], scope: 'user' },
    ]);
    expect(cfg.members).toEqual([
      { username: 'carol', hidden: true },
      { username: 'dave' },
    ]); // fakeResolve is static; the write landed, the reload just doesn't see it back
  });

  test('saveMemberHidden with owned team keys, no config.json, and an unknown member throws before any write', () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), 'board-latch-nofile-')),
      'config.json'
    );
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    expect(() =>
      saveMemberHidden(
        'ghost',
        true,
        missing,
        fakeResolve(teamOwned),
        fakeWrite(calls)
      )
    ).toThrow(/unknown member/);
    expect(calls).toEqual([]);
  });

  test('saveMemberHidden with no config.json and NO owned team keys throws the same instructive error as loadConfigFrom', () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), 'board-latch-nofile-')),
      'config.json'
    );
    expect(() =>
      saveMemberHidden('dave', true, missing, fakeResolve({}), fakeWrite([]))
    ).toThrow(/config\.json not found/);
  });

  test('saveSwitchboardUrl with owned team keys and no config.json establishes board.switchboardUrl ownership', () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), 'board-latch-nofile-')),
      'config.json'
    );
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const cfg = saveSwitchboardUrl(
      'https://sb.example.app/',
      missing,
      fakeResolve(teamOwned),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      {
        key: 'board.switchboardUrl',
        value: 'https://sb.example.app',
        scope: 'machine',
      },
    ]); // slash-free, per the switchboardUrl round-trip fix
    expect(cfg.gitlabHost).toBe('https://gitlab.example.com'); // the reload succeeded off the store alone
  });
});

describe('saveMemberHidden: a store-owned roster decides the writer, not config.json existing', () => {
  test('hiding a member the store roster has but config.json lacks writes board.hiddenMembers, config.json untouched', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const before = readFileSync(p, 'utf8');
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden(
      'carol',
      true,
      p,
      fakeResolve({
        'mattstack.roster': [{ username: 'alice' }, { username: 'carol' }],
      }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: ['carol'], scope: 'user' },
    ]);
    expect(readFileSync(p, 'utf8')).toBe(before);
  });

  test('the overlay write seeds from a member already hidden via an inline store-roster flag', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden(
      'carol',
      true,
      p,
      fakeResolve({
        'mattstack.roster': [
          { username: 'alice', hidden: true },
          { username: 'carol' },
        ],
      }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: ['alice', 'carol'], scope: 'user' },
    ]);
  });

  test('un-hiding omits the username but keeps another seeded one', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden(
      'carol',
      false,
      p,
      fakeResolve({
        'mattstack.roster': [
          { username: 'alice', hidden: true },
          { username: 'carol', hidden: true },
        ],
      }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: ['alice'], scope: 'user' },
    ]);
  });

  test('un-hiding the only currently-hidden member writes an empty array, which still latches ownership', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden(
      'carol',
      false,
      p,
      fakeResolve({
        'mattstack.roster': [
          { username: 'alice' },
          { username: 'carol', hidden: true },
        ],
      }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: [], scope: 'user' },
    ]);
  });

  test('un-hiding a member who was never hidden writes the seed unchanged', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden(
      'carol',
      false,
      p,
      fakeResolve({
        'mattstack.roster': [
          { username: 'alice', hidden: true },
          { username: 'carol' },
        ],
      }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: ['alice'], scope: 'user' },
    ]);
  });

  test('an unknown username throws before any write', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    expect(() =>
      saveMemberHidden(
        'ghost',
        true,
        p,
        fakeResolve({
          'mattstack.roster': [{ username: 'alice' }, { username: 'carol' }],
        }),
        fakeWrite(calls)
      )
    ).toThrow(/unknown member "ghost"/);
    expect(calls).toEqual([]);
  });
});

describe('saveSwitchboardUrl: latch-gated writer', () => {
  test('unowned: writes config.json (temp-file-plus-rename), store untouched', () => {
    const p = tmpConfig();
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const cfg = saveSwitchboardUrl(
      'https://sb.example.app/',
      p,
      fakeResolve({}),
      fakeWrite(calls)
    );
    expect(calls).toEqual([]);
    expect(cfg.switchboard.url).toBe('https://sb.example.app');
    const onDisk = JSON.parse(readFileSync(p, 'utf8'));
    expect(onDisk.switchboard).toEqual({ url: 'https://sb.example.app/' });
  });

  test('owned: writes board.switchboardUrl (machine), config.json untouched', () => {
    const p = tmpConfig();
    const before = readFileSync(p, 'utf8');
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveSwitchboardUrl(
      'https://sb.example.app',
      p,
      fakeResolve({ 'board.switchboardUrl': 'https://old.example.app' }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      {
        key: 'board.switchboardUrl',
        value: 'https://sb.example.app',
        scope: 'machine',
      },
    ]);
    expect(readFileSync(p, 'utf8')).toBe(before);
    // A resolver that already reflects the write's own value proves the reload reads it back correctly.
    const reloaded = loadConfigFrom(
      p,
      fakeResolve({ 'board.switchboardUrl': 'https://sb.example.app' })
    );
    expect(reloaded.switchboard.url).toBe('https://sb.example.app');
  });
});

describe('slack default emoji re-export sanity', () => {
  test('still the standard set (unaffected by the migration)', () => {
    expect(DEFAULT_SLACK_EMOJI).toEqual({
      looking: 'eyes',
      commented: 'speech_balloon',
      approved: 'white_check_mark',
    });
  });
});

describe('saveTabs: latch-gated writer', () => {
  const codeowners: TabConfig = {
    id: 'acme',
    label: 'Acme',
    source: { kind: 'codeowners', section: 'Acme', excludeMembers: true },
  };
  const team: TabConfig = {
    id: 'team',
    label: 'Team',
    source: { kind: 'authors' },
  };

  test("unowned: rewrites config.json's tabs, store untouched", () => {
    const p = tmpConfig();
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const cfg = saveTabs(
      [team, codeowners],
      p,
      fakeResolve({}),
      fakeWrite(calls)
    );
    expect(calls).toEqual([]);
    expect(cfg.tabs.map(t => t.id)).toEqual(['team', 'acme']);
    expect(JSON.parse(readFileSync(p, 'utf8')).tabs).toEqual([
      team,
      codeowners,
    ]);
  });

  test('owned: writes board.tabs (team), config.json untouched', () => {
    const p = tmpConfig({ ...base, tabs: [team] });
    const before = readFileSync(p, 'utf8');
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveTabs(
      [team, codeowners],
      p,
      fakeResolve({ 'board.tabs': [team] }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.tabs', value: [team, codeowners], scope: 'team' },
    ]);
    expect(readFileSync(p, 'utf8')).toBe(before);
  });

  test('no config.json with owned team keys establishes board.tabs ownership', () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), 'board-latch-nofile-')),
      'config.json'
    );
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const owned = {
      'board.gitlabHost': 'https://gitlab.example.com',
      'board.projects': ['team/repo'],
      'board.members': [{ username: 'carol' }],
    };
    saveTabs([team, codeowners], missing, fakeResolve(owned), fakeWrite(calls));
    expect(calls).toEqual([
      { key: 'board.tabs', value: [team, codeowners], scope: 'team' },
    ]);
  });

  test('an invalid list throws before any write, on either side of the latch', () => {
    const p = tmpConfig();
    const before = readFileSync(p, 'utf8');
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    expect(() => saveTabs([], p, fakeResolve({}), fakeWrite(calls))).toThrow(
      /must not be empty/
    );
    expect(() =>
      saveTabs(
        [team, team],
        p,
        fakeResolve({ 'board.tabs': [team] }),
        fakeWrite(calls)
      )
    ).toThrow(/duplicate tab id/);
    expect(() =>
      saveTabs(
        [{ id: 'x', label: 'X', source: { kind: 'codeowners' } }],
        p,
        fakeResolve({}),
        fakeWrite(calls)
      )
    ).toThrow(/section/);
    expect(calls).toEqual([]);
    expect(readFileSync(p, 'utf8')).toBe(before);
  });

  test('optional per-tab fields survive the round trip and absent ones stay absent', () => {
    const p = tmpConfig();
    const cfg = saveTabs(
      [
        {
          ...codeowners,
          slackChannel: 'team-codeowners',
          reviewSkill: 'external-review',
        },
      ],
      p,
      fakeResolve({}),
      fakeWrite([])
    );
    expect(cfg.tabs[0]).toEqual({
      ...codeowners,
      slackChannel: 'team-codeowners',
      reviewSkill: 'external-review',
    });
    expect(
      'slackChannel' in
        saveTabs([team], p, fakeResolve({}), fakeWrite([])).tabs[0]!
    ).toBe(false);
  });
});

describe('storeOwnsRequiredFields: config.json-free boot', () => {
  test('mattstack.roster satisfies the roster requirement with no config.json', () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), 'board-noconfig-')),
      'config.json'
    );
    const cfg = loadConfigFrom(
      missing,
      fakeResolve({
        'board.gitlabHost': 'https://gitlab.example.com',
        'board.projects': ['g/p'],
        'mattstack.roster': [{ username: 'ann' }],
      })
    );
    expect(cfg.members).toEqual([{ username: 'ann' }]);
    expect(cfg.gitlabHost).toBe('https://gitlab.example.com');
  });

  test('no roster key at all with no config.json still throws the seed message', () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), 'board-noconfig-')),
      'config.json'
    );
    expect(() =>
      loadConfigFrom(
        missing,
        fakeResolve({
          'board.gitlabHost': 'https://gitlab.example.com',
          'board.projects': ['g/p'],
        })
      )
    ).toThrow(/config.json not found/);
  });
});

describe('displayName: stored name beats the GitLab profile', () => {
  test('a stored name wins over the GitLab profile name', () => {
    expect(displayName({ username: 'dee', name: 'Dee Fox' }, 'D. Fox')).toBe(
      'Dee Fox'
    );
  });

  test('the GitLab profile fills in when there is no stored name', () => {
    expect(displayName({ username: 'bo' }, 'Bo Chen')).toBe('Bo Chen');
  });

  test('null when neither side has one', () => {
    expect(displayName({ username: 'cy' }, null)).toBeNull();
    expect(displayName({ username: 'cy' }, undefined)).toBeNull();
  });

  test('a blank stored name does not shadow the profile', () => {
    expect(displayName({ username: 'x', name: '   ' }, 'Real Name')).toBe(
      'Real Name'
    );
  });
});

describe('applyRosterEdit: pure roster mutation', () => {
  const roster = [
    { username: 'ann', name: 'Ann Lee' },
    { username: 'bo' },
    { username: 'cy', hidden: true },
  ];

  test('add appends with a name', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'add', username: 'dee', name: 'Dee Fox' },
      'ann'
    );
    expect(r).toEqual({
      ok: true,
      members: [...roster, { username: 'dee', name: 'Dee Fox' }],
    });
  });

  test('add without a name omits the field rather than storing empty', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'add', username: 'dee', name: '  ' },
      'ann'
    );
    expect(r.ok && r.members.at(-1)).toEqual({ username: 'dee' });
  });

  test('add trims the username', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'add', username: '  dee  ' },
      'ann'
    );
    expect(r.ok && r.members.at(-1)).toEqual({ username: 'dee' });
  });

  test('add rejects a duplicate', () => {
    expect(
      applyRosterEdit(roster, { action: 'add', username: 'bo' }, 'ann')
    ).toEqual({ ok: false, error: '"bo" is already on the roster' });
  });

  test('remove drops the entry', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'remove', username: 'bo' },
      'ann'
    );
    expect(r.ok && r.members.map(m => m.username)).toEqual(['ann', 'cy']);
  });

  test('remove rejects an unknown username', () => {
    expect(
      applyRosterEdit(roster, { action: 'remove', username: 'zed' }, 'ann')
    ).toEqual({ ok: false, error: 'unknown member "zed"' });
  });

  test('remove refuses to empty the roster', () => {
    expect(
      applyRosterEdit(
        [{ username: 'ann' }],
        { action: 'remove', username: 'ann' },
        null
      )
    ).toEqual({ ok: false, error: 'the roster cannot be emptied' });
  });

  test('remove refuses to drop the board owner', () => {
    expect(
      applyRosterEdit(roster, { action: 'remove', username: 'ann' }, 'ann')
    ).toEqual({
      ok: false,
      error: 'you cannot drop yourself: this board runs as you',
    });
  });

  test('rename sets a name on an existing member, in place', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'rename', username: 'bo', name: 'Bo Chen' },
      'ann'
    );
    expect(r.ok && r.members).toEqual([
      { username: 'ann', name: 'Ann Lee' },
      { username: 'bo', name: 'Bo Chen' },
      { username: 'cy', hidden: true },
    ]);
  });

  test('rename replaces an existing name', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'rename', username: 'ann', name: 'Ann Marie Lee' },
      'ann'
    );
    expect(r.ok && r.members[0]).toEqual({
      username: 'ann',
      name: 'Ann Marie Lee',
    });
  });

  test('rename to blank clears the name so the gitlab profile takes over', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'rename', username: 'ann', name: '   ' },
      'ann'
    );
    expect(r.ok && r.members[0]).toEqual({ username: 'ann' });
  });

  test('rename preserves a hidden flag', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'rename', username: 'cy', name: 'Cy Park' },
      'ann'
    );
    expect(r.ok && r.members[2]).toEqual({
      username: 'cy',
      name: 'Cy Park',
      hidden: true,
    });
  });

  test('rename rejects an unknown username', () => {
    expect(
      applyRosterEdit(
        roster,
        { action: 'rename', username: 'zed', name: 'Z' },
        'ann'
      )
    ).toEqual({ ok: false, error: 'unknown member "zed"' });
  });

  test('the input roster is never mutated', () => {
    const snapshot = JSON.parse(JSON.stringify(roster));
    applyRosterEdit(
      roster,
      { action: 'rename', username: 'bo', name: 'Bo' },
      'ann'
    );
    applyRosterEdit(roster, { action: 'remove', username: 'bo' }, 'ann');
    expect(roster).toEqual(snapshot);
  });
});
