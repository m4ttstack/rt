import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  attachSlack,
  buildPermalink,
  buildThreadPermalink,
  extractMrUrls,
  matchReviewMessage,
  readIndex,
  readSlackRefs,
  slackIndexPath,
  slackSweepTargets,
  sweepSlackRefs,
  writeIndex,
  writeSlackRef,
  type SlackIndex,
  type SlackMessage,
  type SlackRef,
} from '../slack.ts';
import { openStateDb } from '../state/db.ts';

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const URL_B = 'https://gitlab.com/acme/webapp/-/merge_requests/4822';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'slack-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function msg(ts: string, text: string, user = 'U1'): SlackMessage {
  return { ts, user, text };
}

describe('buildPermalink', () => {
  test('strips the dot from ts and builds the archive url', () => {
    expect(
      buildPermalink('myteam.slack.com', 'C08GY807K61', '1784046127.318759')
    ).toBe('https://myteam.slack.com/archives/C08GY807K61/p1784046127318759');
  });
});

describe('matchReviewMessage', () => {
  test('matches the message containing the MR url', () => {
    const m = matchReviewMessage(
      [msg('2', `please review <${URL_A}|!4821>`), msg('3', 'unrelated')],
      URL_A
    );
    expect(m?.ts).toBe('2');
  });

  test('prefers the earliest message when several reference the url', () => {
    const m = matchReviewMessage(
      [
        msg('30', `re: ${URL_A}`),
        msg('10', `review please ${URL_A}`),
        msg('20', `bump ${URL_A}`),
      ],
      URL_A
    );
    expect(m?.ts).toBe('10');
  });

  test("does not match a different MR's url", () => {
    expect(matchReviewMessage([msg('5', `review ${URL_B}`)], URL_A)).toBeNull();
  });

  test('returns null when nothing references the url', () => {
    expect(
      matchReviewMessage([msg('5', 'good morning team')], URL_A)
    ).toBeNull();
  });
});

describe('buildThreadPermalink', () => {
  test('includes thread_ts and cid for an in-thread reply', () => {
    expect(
      buildThreadPermalink(
        'myteam.slack.com',
        'C08GY807K61',
        '1784058445.555169',
        '1783888278.629199'
      )
    ).toBe(
      'https://myteam.slack.com/archives/C08GY807K61/p1784058445555169?thread_ts=1783888278.629199&cid=C08GY807K61'
    );
  });
});

describe('extractMrUrls', () => {
  test('returns the distinct MR urls in a message', () => {
    const text = `please review <${URL_A}|!4821> and <${URL_B}|!4822>`;
    expect(extractMrUrls(text).sort()).toEqual([URL_A, URL_B].sort());
  });
  test('collapses a repeated url to one (single-MR message)', () => {
    expect(extractMrUrls(`${URL_A} ... ${URL_A}`)).toEqual([URL_A]);
  });
  test('returns empty for a message with no MR link', () => {
    expect(extractMrUrls('just chatting')).toEqual([]);
  });
});

describe('slackIndexPath', () => {
  test('is stable per channel and distinct across channels', () => {
    expect(slackIndexPath('code-review')).not.toBe(
      slackIndexPath('team-codeowners')
    );
    expect(slackIndexPath('code-review')).toBe(slackIndexPath('code-review'));
  });

  test('slugs unsafe characters', () => {
    expect(slackIndexPath('pod/weird name!')).toBe('pod-weird-name-');
  });
});

describe('readIndex / writeIndex per-channel', () => {
  test('with nothing written yet, a fresh install starts with null per channel', () => {
    expect(readIndex('code-review', db)).toBeNull();
    expect(readIndex('team-codeowners', db)).toBeNull();
  });

  test('writeIndex writes under the channel-specific key, independent of other channels', () => {
    const idx: SlackIndex = {
      channelId: 'C2',
      teamDomain: 'acme.slack.com',
      lastTs: '200.0',
      messages: [],
    };
    writeIndex('team-codeowners', idx, db);
    expect(readIndex('team-codeowners', db)).toEqual(idx);
    expect(readIndex('code-review', db)).toBeNull();
  });
});

describe('writeSlackRef critical flag', () => {
  test('a busy write is swallowed by default, but retried-then-thrown when critical', () => {
    const ref: SlackRef = {
      mrUrl: URL_A,
      iid: 1,
      status: 'found',
      checkedAt: 1,
    };
    const originalQuery = db.query.bind(db);
    (db as unknown as { query: typeof db.query }).query = ((sql: string) => {
      if (sql.includes('INSERT INTO slack_refs')) {
        throw Object.assign(new Error('database is locked'), {
          code: 'SQLITE_BUSY',
        });
      }
      return originalQuery(sql);
    }) as typeof db.query;

    try {
      // reactToMR has already posted a Slack reply by the time it calls
      // writeSlackRef(..., true); a swallowed write there means the next
      // call posts a duplicate. Every other caller only caches a lookup, so
      // the default (uncritical) path may silently skip a busy write.
      expect(() => writeSlackRef(ref, db, false)).not.toThrow();
      expect(readSlackRefs(db).size).toBe(0);

      expect(() => writeSlackRef(ref, db, true)).toThrow();
    } finally {
      (db as unknown as { query: typeof db.query }).query = originalQuery;
    }
  });
});

describe('attachSlack', () => {
  test('attaches the client slice by webUrl, leaves others untouched', () => {
    const refs = new Map<string, SlackRef>([
      [
        URL_A,
        {
          mrUrl: URL_A,
          iid: 4821,
          status: 'found',
          messageTs: '1.2',
          permalink: 'https://x/p1',
          reactions: ['eyes'],
          checkedAt: 0,
        },
      ],
    ]);
    const [a, b] = attachSlack([{ webUrl: URL_A }, { webUrl: URL_B }], refs);
    expect(a!.slack).toEqual({
      status: 'found',
      permalink: 'https://x/p1',
      reactions: ['eyes'],
      posted: true,
    });
    expect(b!.slack).toBeUndefined();
  });

  test('defaults reactions to an empty array when the ref has none', () => {
    const refs = new Map<string, SlackRef>([
      [URL_A, { mrUrl: URL_A, iid: 4821, status: 'notfound', checkedAt: 0 }],
    ]);
    const [a] = attachSlack([{ webUrl: URL_A }], refs);
    expect(a!.slack).toEqual({
      status: 'notfound',
      permalink: undefined,
      reactions: [],
      posted: false,
    });
  });

  test('posted=true for a found multi-MR ref even before a reply is reified', () => {
    const refs = new Map<string, SlackRef>([
      [
        URL_A,
        {
          mrUrl: URL_A,
          iid: 4821,
          status: 'found',
          multi: true,
          parentTs: '1.0',
          checkedAt: 0,
        },
      ],
    ]);
    const [a] = attachSlack([{ webUrl: URL_A }], refs);
    expect(a!.slack?.posted).toBe(true);
  });
});

/** Counting stand-in for slack.com: answers just enough of the API for a
    sweep and records which methods were hit. */
function mockSlackApi(messagesByChannel: Record<string, SlackMessage[]>): {
  calls: string[];
  restore: () => void;
} {
  const real = globalThis.fetch;
  const calls: string[] = [];
  const ids: Record<string, string> = {
    'code-review': 'C_REVIEW',
    'acme-channel': 'C_ACME',
  };
  const ok = (data: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: true, ...data }));
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = url.slice('https://slack.com/api/'.length).split('?')[0]!;
    const params = Object.fromEntries(new URL(url).searchParams);
    calls.push(method);
    switch (method) {
      case 'auth.test':
        return ok({ url: 'https://mockteam.slack.com/' });
      case 'conversations.list':
        return ok({
          channels: Object.entries(ids).map(([name, id]) => ({ id, name })),
          response_metadata: { next_cursor: '' },
        });
      case 'conversations.history': {
        const name =
          Object.entries(ids).find(([, id]) => id === params.channel)?.[0] ??
          '';
        return ok({ messages: messagesByChannel[name] ?? [], has_more: false });
      }
      case 'reactions.get':
        return ok({ message: { reactions: [] } });
      default:
        return ok({});
    }
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

describe('slackSweepTargets', () => {
  const now = 1_000_000;
  const retryAfter = now - 60_000;
  const mrs = [
    { webUrl: URL_A, iid: 1 },
    { webUrl: URL_B, iid: 2 },
    { webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/3', iid: 3 },
    { webUrl: null, iid: 4 },
  ];
  const refs = new Map<string, SlackRef>([
    [
      URL_A,
      {
        mrUrl: URL_A,
        iid: 1,
        status: 'found',
        messageTs: '1.1',
        checkedAt: now - 5,
      },
    ],
    [URL_B, { mrUrl: URL_B, iid: 2, status: 'notfound', checkedAt: now - 5 }],
  ]);
  test('periodic: missing refs and stale notfound refs only', () => {
    const stale = new Map(refs);
    stale.set(URL_B, { ...refs.get(URL_B)!, checkedAt: retryAfter - 1 });
    expect(
      slackSweepTargets(mrs, stale, { retryAfter }).map(m => m.iid)
    ).toEqual([2, 3]);
  });
  test('periodic: a fresh notfound ref waits for its retry window', () => {
    expect(
      slackSweepTargets(mrs, refs, { retryAfter }).map(m => m.iid)
    ).toEqual([3]);
  });
  test('forced: every notfound ref is retried, found refs never are', () => {
    expect(
      slackSweepTargets(mrs, refs, { retryAfter, force: true }).map(m => m.iid)
    ).toEqual([2, 3]);
  });
});

describe('sweepSlackRefs', () => {
  let api: ReturnType<typeof mockSlackApi>;
  afterEach(() => api.restore());

  test('syncs each channel once, then resolves every target against that index', async () => {
    api = mockSlackApi({
      'code-review': [msg('100.1', `please review ${URL_A}`)],
    });
    const targets = [
      { mrUrl: URL_A, iid: 1, channel: 'code-review' },
      { mrUrl: URL_B, iid: 2, channel: 'code-review' },
      {
        mrUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/3',
        iid: 3,
        channel: 'code-review',
      },
    ];
    await sweepSlackRefs('tok', targets, { gapMs: 0, db });
    expect(api.calls.filter(c => c === 'conversations.history')).toHaveLength(
      1
    );
    const refs = readSlackRefs(db);
    expect(refs.get(URL_A)?.status).toBe('found');
    expect(refs.get(URL_B)?.status).toBe('notfound');
    expect(refs.get(targets[2]!.mrUrl)?.status).toBe('notfound');
  });

  test('two channels means two syncs, not one per target', async () => {
    api = mockSlackApi({
      'code-review': [],
      'acme-channel': [msg('100.2', `review ${URL_B}`)],
    });
    const targets = [
      { mrUrl: URL_A, iid: 1, channel: 'code-review' },
      { mrUrl: URL_B, iid: 2, channel: 'acme-channel' },
      {
        mrUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/3',
        iid: 3,
        channel: 'acme-channel',
      },
    ];
    await sweepSlackRefs('tok', targets, { gapMs: 0, db });
    expect(api.calls.filter(c => c === 'conversations.history')).toHaveLength(
      2
    );
    expect(readSlackRefs(db).get(URL_B)?.status).toBe('found');
  });

  test('a failing channel sync is reported and does not stop the other channel', async () => {
    api = mockSlackApi({ 'acme-channel': [] });
    const targets = [
      { mrUrl: URL_A, iid: 1, channel: 'no-such-channel' },
      { mrUrl: URL_B, iid: 2, channel: 'acme-channel' },
    ];
    const result = await sweepSlackRefs('tok', targets, { gapMs: 0, db });
    expect(result.failed).toBe(1);
    expect(readSlackRefs(db).get(URL_B)?.status).toBe('notfound');
  });
});
