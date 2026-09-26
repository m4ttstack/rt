import { describe, expect, test } from 'bun:test';

import {
  parseThreadReply,
  parseThreadResolve,
  replyToThread,
  resolveThread,
  type ThreadWriteSend,
} from '../thread-write.ts';

const REPO = 'gitlab.example.com/g/p';

function glanceNote(id: number, username: string, resolved = false) {
  return {
    id,
    body: `note ${id}`,
    author: {
      id: `gitlab:user:${username}`,
      username,
      name: username,
      avatarUrl: null,
    },
    createdAt: `2026-09-2${id % 10}T00:00:00Z`,
    system: false,
    type: 'DiscussionNote',
    resolvable: true,
    resolved,
    position: null,
  };
}

/** A stand-in daemon: records every call and answers with the discussions
    the real one returns after its post-write refresh. */
function fakeDaemon(
  answer: { ok: true; discussions: unknown[] } | { ok: false; error: string }
): { send: ThreadWriteSend; calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  const send: ThreadWriteSend = async (verb, payload) => {
    calls.push([verb, payload]);
    return answer.ok
      ? {
          ok: true,
          data: { discussions: answer.discussions as never, fetchedAt: 1 },
        }
      : { ok: false, error: answer.error };
  };
  return { send, calls };
}

describe('parseThreadReply', () => {
  const valid = {
    repo: REPO,
    iid: 7,
    discussionId: 'abc123',
    author: 'dorothy',
    body: 'done in the next push',
  };

  test('accepts a reply and keeps its fields', () => {
    expect(parseThreadReply(valid)).toEqual(valid);
  });

  test('a null author is allowed (the drawer reads threads without a seat)', () => {
    expect(parseThreadReply({ ...valid, author: null })?.author).toBeNull();
  });

  test('refuses a blank body, so an empty note is never posted', () => {
    expect(parseThreadReply({ ...valid, body: '  \n ' })).toBeNull();
  });

  test('refuses a missing discussion id or a non-numeric iid', () => {
    expect(parseThreadReply({ ...valid, discussionId: '' })).toBeNull();
    expect(parseThreadReply({ ...valid, iid: '7' })).toBeNull();
    expect(parseThreadReply({ ...valid, repo: undefined })).toBeNull();
    expect(parseThreadReply(null)).toBeNull();
  });
});

describe('parseThreadResolve', () => {
  const valid = {
    repo: REPO,
    iid: 7,
    discussionId: 'abc123',
    author: 'dorothy',
    resolved: false,
  };

  test('keeps resolved: false, which is the unresolve', () => {
    expect(parseThreadResolve(valid)).toEqual(valid);
  });

  test('refuses a missing resolved flag rather than guessing a direction', () => {
    const { resolved: _resolved, ...rest } = valid;
    expect(parseThreadResolve(rest)).toBeNull();
  });
});

describe('replyToThread', () => {
  test('sends discussions:reply with the repo identity, then summarizes the refreshed discussions', async () => {
    const daemon = fakeDaemon({
      ok: true,
      discussions: [
        {
          id: 'abc123',
          resolvable: true,
          resolved: false,
          notes: [glanceNote(1, 'reviewer'), glanceNote(2, 'dorothy')],
        },
      ],
    });
    const res = await replyToThread(
      daemon.send,
      REPO,
      {
        repo: 'ignored-client-label',
        iid: 7,
        discussionId: 'abc123',
        author: 'dorothy',
        body: 'done',
      },
      []
    );
    expect(daemon.calls).toEqual([
      [
        'discussions:reply',
        { repoName: REPO, iid: 7, discussionId: 'abc123', body: 'done' },
      ],
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.threads.map(t => [t.discussionId, t.status])).toEqual([
      ['abc123', 'replied'],
    ]);
  });

  test("passes the daemon's error through", async () => {
    const daemon = fakeDaemon({ ok: false, error: '403 Forbidden' });
    const res = await replyToThread(
      daemon.send,
      REPO,
      {
        repo: REPO,
        iid: 7,
        discussionId: 'abc123',
        author: null,
        body: 'done',
      },
      []
    );
    expect(res).toEqual({ ok: false, error: '403 Forbidden' });
  });
});

describe('resolveThread', () => {
  test('sends the resolved flag as given, so unresolve reaches the daemon as false', async () => {
    const daemon = fakeDaemon({
      ok: true,
      discussions: [
        {
          id: 'abc123',
          resolvable: true,
          resolved: false,
          notes: [glanceNote(1, 'reviewer', false)],
        },
      ],
    });
    const res = await resolveThread(
      daemon.send,
      REPO,
      {
        repo: REPO,
        iid: 7,
        discussionId: 'abc123',
        author: 'dorothy',
        resolved: false,
      },
      []
    );
    expect(daemon.calls).toEqual([
      [
        'discussions:resolve',
        { repoName: REPO, iid: 7, discussionId: 'abc123', resolved: false },
      ],
    ]);
    expect(res.ok && res.threads[0]!.status).toBe('awaiting');
  });
});
