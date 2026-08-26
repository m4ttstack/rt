import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  chatRooms: vi.fn(),
  chatWho: vi.fn(),
  chatMessages: vi.fn(),
  chatMark: vi.fn(),
  chatBuddies: vi.fn(),
  chatJoin: vi.fn(),
  chatPost: vi.fn(),
  chatDm: vi.fn(),
  daemonHealth: vi.fn(),
  getSetting: vi.fn(() => ({ value: 'matt' })),
}));
const rt = await import('@mattstack/rt-client');
const { app } = await import('./app');

beforeEach(() => vi.resetAllMocks());

test("rooms returns the daemon's payload, DM rows included", async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        { room: 'build', memberCount: 3, unread: 0, mentions: 0 },
        {
          room: 'dm-9f3a2b1c0d4e',
          memberCount: 3,
          unread: 1,
          mentions: 1,
          kind: 'dm',
          participants: { a: 'deck-main', b: 'rt-chat-wt' },
        },
      ],
    },
  });
  const res = await app.request('/api/chat/rooms?handle=matt');
  expect(res.status).toBe(200);
  expect((await res.json()).rooms[1]).toMatchObject({
    kind: 'dm',
    participants: { a: 'deck-main', b: 'rt-chat-wt' },
  });
});

test('an ok:false from the daemon becomes a 502, not a crash', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({ ok: false, error: 'nope' });
  expect((await app.request('/api/chat/rooms?handle=matt')).status).toBe(502);
});

test('daemon-unreachable ALSO arrives as ok:false, never a throw', async () => {
  // rt-client cannot throw: rtCommand catches everything and returns
  // ok:false with an "rt daemon unreachable at <sock>" prefix.
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: false,
    error: 'rt daemon unreachable at /x/rt.sock: ECONNREFUSED',
  });
  expect((await app.request('/api/chat/rooms?handle=matt')).status).toBe(502);
});

test("who passes the daemon's status through and never spawns git", async () => {
  vi.mocked(rt.chatWho).mockResolvedValueOnce({
    ok: true,
    data: {
      members: [
        {
          room: 'build',
          handle: 'a',
          joinedAt: 1,
          lastReadId: 0,
          wakeOn: 'mention',
          cwd: '/w/a',
          status: 'deaf',
        },
      ],
    },
  });
  const res = await app.request('/api/chat/who/build');
  // One read. A Response body is a stream, so a second res.json() throws
  // "Body is unusable" rather than returning the same payload again.
  const body = await res.json();
  expect(body.members[0]).toMatchObject({ status: 'deaf' });
  expect(body.members[0].branch).toBeUndefined();
});

test("buddies carries each buddy's rooms as tags, with DMs collapsed to `dm`", async () => {
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: [
        {
          sessionId: 's1',
          handle: 'a',
          baseHandle: 'a',
          signedInAt: 1,
          lastSeenAt: 1,
          branch: 'fix-auth',
          status: 'live',
        },
      ],
    },
  });
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        { room: 'build', memberCount: 2, unread: 0, mentions: 0 },
        {
          room: 'dm-9f3a2b1c0d4e',
          memberCount: 3,
          unread: 0,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'a', b: 'b' },
        },
      ],
    },
  });
  vi.mocked(rt.chatWho)
    .mockResolvedValueOnce({
      ok: true,
      data: {
        members: [
          {
            room: 'build',
            handle: 'a',
            joinedAt: 1,
            lastReadId: 0,
            wakeOn: 'mention',
            status: 'live',
          },
        ],
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: {
        members: [
          {
            room: 'dm-9f3a2b1c0d4e',
            handle: 'a',
            joinedAt: 1,
            lastReadId: 0,
            wakeOn: 'all',
            status: 'live',
          },
        ],
      },
    });
  const res = await app.request('/api/chat/buddies');
  expect((await res.json()).buddies[0]).toMatchObject({
    handle: 'a',
    status: 'live',
    branch: 'fix-auth',
    rooms: ['build', 'dm'],
  });
});

test('a dropped write surfaces as an error, never a silent success', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: { rooms: [{ room: 'r', memberCount: 1, unread: 0, mentions: 0 }] },
  });
  vi.mocked(rt.chatJoin).mockResolvedValueOnce({
    ok: true,
    data: { handle: 'matt', memberCount: 2, unread: 0 },
  });
  vi.mocked(rt.chatPost).mockResolvedValueOnce({
    ok: false,
    error: 'write dropped',
  });
  expect(
    (
      await app.request('/api/chat/post', {
        method: 'POST',
        body: JSON.stringify({ room: 'r', body: 'x' }),
      })
    ).status
  ).toBe(502);
});

test('posting into a room the human has not joined joins first, then posts', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: { rooms: [] },
  });
  vi.mocked(rt.chatJoin).mockResolvedValueOnce({
    ok: true,
    data: { handle: 'matt', memberCount: 2, unread: 0 },
  });
  vi.mocked(rt.chatPost).mockResolvedValueOnce({
    ok: true,
    data: { id: 1, recipients: [] },
  });
  const res = await app.request('/api/chat/post', {
    method: 'POST',
    body: JSON.stringify({ room: 'release', body: 'hello' }),
  });
  expect(res.status).toBe(200);
  expect(rt.chatJoin).toHaveBeenCalledWith(
    expect.objectContaining({ room: 'release', handle: 'matt' }),
    expect.anything()
  );
  expect(vi.mocked(rt.chatJoin).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(rt.chatPost).mock.invocationCallOrder[0]
  );
});

test('posting into a DM never joins: the human is already its silent member and join refuses DM rooms', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        {
          room: 'dm-9f3a2b1c0d4e',
          memberCount: 3,
          unread: 0,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'deck-main', b: 'rt-chat-wt' },
        },
      ],
    },
  });
  vi.mocked(rt.chatPost).mockResolvedValueOnce({
    ok: true,
    data: { id: 2, recipients: ['deck-main', 'rt-chat-wt'] },
  });
  const res = await app.request('/api/chat/post', {
    method: 'POST',
    body: JSON.stringify({
      room: 'dm-9f3a2b1c0d4e',
      body: 'seen — fine by me',
    }),
  });
  expect(res.status).toBe(200);
  expect(rt.chatJoin).not.toHaveBeenCalled();
});

test("dm opens or reuses the pair's room and posts as the human", async () => {
  vi.mocked(rt.chatDm).mockResolvedValueOnce({
    ok: true,
    data: { room: 'dm-1a2b3c4d5e6f', id: 3, recipients: ['rt-chat-wt'] },
  });
  const res = await app.request('/api/chat/dm', {
    method: 'POST',
    body: JSON.stringify({ to: 'rt-chat-wt', body: 'ping' }),
  });
  expect(await res.json()).toMatchObject({ room: 'dm-1a2b3c4d5e6f', id: 3 });
  expect(rt.chatDm).toHaveBeenCalledWith(
    expect.objectContaining({ from: 'matt', to: 'rt-chat-wt', body: 'ping' }),
    expect.anything()
  );
});

test('rooms includes rooms the FLEET is in that the human has not joined', async () => {
  // `chat:rooms` is listRooms(handle), so asking as the human returns only
  // his memberships. Two agents signed into #forge-leaderboard were visible
  // in the roster while the rail showed nothing -- the room he most needed
  // to read was the one room he could not see.
  // Memberships come from chat:rooms per handle: the human's own call, then
  // one per buddy. `a` is also in a room joined by name that no repo
  // derives, which is the case a repo-based union could never show.
  const roomsByHandle: Record<string, string[]> = {
    matt: ['build'],
    a: ['forge-leaderboard', 'mantine-tokyo', 'dm-a1b2'],
    b: ['forge-leaderboard'],
    c: ['build'],
  };
  vi.mocked(rt.chatRooms).mockImplementation(async ({ handle }) => ({
    ok: true,
    data: {
      rooms: (roomsByHandle[handle] ?? []).map(room => ({
        room,
        memberCount: 2,
        unread: handle === 'matt' ? 1 : 0,
        mentions: 0,
        ...(room.startsWith('dm-')
          ? { kind: 'dm' as const, participants: { a: 'a', b: 'b' } }
          : {}),
      })),
    },
  }));
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: (['a', 'b', 'c'] as const).map((handle, i) => ({
        sessionId: `s${i + 1}`,
        handle,
        baseHandle: handle,
        signedInAt: 1,
        lastSeenAt: 1,
        status: 'live' as const,
        repo: handle === 'c' ? 'build' : 'forge-leaderboard',
      })),
    },
  });
  const member = (room: string, handle: string) => ({
    room,
    handle,
    joinedAt: 1,
    lastReadId: 0,
    wakeOn: 'mention' as const,
    status: 'live' as const,
  });
  vi.mocked(rt.chatWho).mockImplementation(async ({ room }) => ({
    ok: true,
    data: {
      members:
        room === 'forge-leaderboard'
          ? [member(room, 'a'), member(room, 'b')]
          : [member(room, 'a')],
    },
  }));

  const body = await (await app.request('/api/chat/rooms?handle=matt')).json();

  // `build` is already the human's, so it is not duplicated from presence.
  expect(body.rooms.map((r: { room: string }) => r.room)).toEqual([
    'build',
    'forge-leaderboard',
    'mantine-tokyo',
    'dm-a1b2',
  ]);
  // An agent-to-agent DM is the human's to read by design; the rail names
  // it by its pair, so the pair travels with it.
  expect(body.rooms[3]).toMatchObject({
    room: 'dm-a1b2',
    kind: 'dm',
    participants: { a: 'a', b: 'b' },
    joined: false,
  });
  expect(body.rooms[2]).toMatchObject({
    room: 'mantine-tokyo',
    memberCount: 1,
    joined: false,
  });
  expect(body.rooms[0]).toMatchObject({ room: 'build', unread: 1 });
  expect(body.rooms[1]).toMatchObject({
    room: 'forge-leaderboard',
    memberCount: 2,
    joined: false,
    // No read cursor in a room he never joined, so no honest unread count.
    unread: 0,
  });
});

test('a failed presence lookup degrades to the human rooms, not an error', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }],
    },
  });
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({ ok: false, error: 'nope' });

  const res = await app.request('/api/chat/rooms?handle=matt');
  expect(res.status).toBe(200);
  expect((await res.json()).rooms).toHaveLength(1);
});
