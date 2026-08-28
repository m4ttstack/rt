import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  chatRooms: vi.fn(),
  chatWho: vi.fn(),
  chatMessages: vi.fn(),
  chatMark: vi.fn(),
  chatBuddies: vi.fn(),
  chatJoin: vi.fn(),
  chatPost: vi.fn(),
  chatArchive: vi.fn(),
  chatDmOpen: vi.fn(),
  daemonHealth: vi.fn(),
  getSetting: vi.fn(() => ({ value: 'matt' })),
}));
const rt = await import('@mattstack/rt-client');
const { routes } = await import('./routes');

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
  const res = await routes.request('/api/chat/rooms?handle=matt');
  expect(res.status).toBe(200);
  expect((await res.json()).rooms[1]).toMatchObject({
    kind: 'dm',
    participants: { a: 'deck-main', b: 'rt-chat-wt' },
  });
});

test('an ok:false from the daemon becomes a 502, not a crash', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({ ok: false, error: 'nope' });
  expect((await routes.request('/api/chat/rooms?handle=matt')).status).toBe(
    502
  );
});

test('daemon-unreachable ALSO arrives as ok:false, never a throw', async () => {
  // rt-client cannot throw: rtCommand catches everything and returns
  // ok:false with an "rt daemon unreachable at <sock>" prefix.
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: false,
    error: 'rt daemon unreachable at /x/rt.sock: ECONNREFUSED',
  });
  expect((await routes.request('/api/chat/rooms?handle=matt')).status).toBe(
    502
  );
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
  const res = await routes.request('/api/chat/who/build');
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
  const res = await routes.request('/api/chat/buddies');
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
      await routes.request('/api/chat/post', {
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
  const res = await routes.request('/api/chat/post', {
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
  const res = await routes.request('/api/chat/post', {
    method: 'POST',
    body: JSON.stringify({
      room: 'dm-9f3a2b1c0d4e',
      body: 'seen — fine by me',
    }),
  });
  expect(res.status).toBe(200);
  expect(rt.chatJoin).not.toHaveBeenCalled();
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

  const body = await (
    await routes.request('/api/chat/rooms?handle=matt')
  ).json();

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

  const res = await routes.request('/api/chat/rooms?handle=matt');
  expect(res.status).toBe(200);
  expect((await res.json()).rooms).toHaveLength(1);
});

test('rooms asks for the human’s archived rooms too and passes archivedAt through', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        { room: 'build', memberCount: 3, unread: 0, mentions: 0 },
        {
          room: 'retro',
          memberCount: 2,
          unread: 0,
          mentions: 0,
          archivedAt: 1700000000000,
        },
      ],
    },
  });
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: { buddies: [] },
  });
  const res = await routes.request('/api/chat/rooms?handle=matt');
  expect(res.status).toBe(200);
  expect(rt.chatRooms).toHaveBeenCalledWith(
    { handle: 'matt', includeArchived: true },
    expect.anything()
  );
  const { rooms } = await res.json();
  expect(rooms[1]).toMatchObject({ room: 'retro', archivedAt: 1700000000000 });
});

test('archiving a channel the human never joined joins him first, then archives', async () => {
  // The human's own listing (no #build), then the fleet union's per-buddy listings.
  vi.mocked(rt.chatRooms)
    .mockResolvedValueOnce({ ok: true, data: { rooms: [] } })
    .mockResolvedValueOnce({
      ok: true,
      data: {
        rooms: [{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }],
      },
    });
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: [
        {
          handle: 'fred',
          sessionId: 's',
          baseHandle: 'fred',
          signedInAt: 1,
          lastSeenAt: 1,
          status: 'live',
        },
      ],
    },
  });
  vi.mocked(rt.chatWho).mockResolvedValueOnce({
    ok: true,
    data: { members: [] },
  });
  vi.mocked(rt.chatJoin).mockResolvedValueOnce({
    ok: true,
    data: { handle: 'matt', memberCount: 3, unread: 0 },
  });
  vi.mocked(rt.chatArchive).mockResolvedValueOnce({
    ok: true,
    data: { room: 'build', archivedAt: 5 },
  });

  const res = await routes.request('/api/chat/archive?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'build', archived: true }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ room: 'build', archivedAt: 5 });
  expect(rt.chatJoin).toHaveBeenCalledWith(
    { room: 'build', handle: 'matt' },
    expect.anything()
  );
  expect(rt.chatArchive).toHaveBeenCalledWith(
    { room: 'build', handle: 'matt', archived: true },
    expect.anything()
  );
});

test('archiving a room already in the human’s listing never joins; a DM never joins either', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        { room: 'build', memberCount: 3, unread: 0, mentions: 0 },
        {
          room: 'dm-1',
          memberCount: 2,
          unread: 0,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'fred', b: 'matt' },
        },
      ],
    },
  });
  vi.mocked(rt.chatArchive).mockResolvedValue({
    ok: true,
    data: { room: 'build', archivedAt: 5 },
  });
  await routes.request('/api/chat/archive?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'build', archived: true }),
  });
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        {
          room: 'dm-1',
          memberCount: 2,
          unread: 0,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'fred', b: 'matt' },
        },
      ],
    },
  });
  await routes.request('/api/chat/archive?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'dm-1', archived: true }),
  });
  expect(rt.chatJoin).not.toHaveBeenCalled();
});

test('archive 400s on a bad body and on a room nobody lists, and never join-creates', async () => {
  const bad = await routes.request('/api/chat/archive?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'build' }),
  });
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toBe('archived must be true or false');
  const noRoom = await routes.request('/api/chat/archive?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ archived: true }),
  });
  expect(noRoom.status).toBe(400);
  expect((await noRoom.json()).error).toBe('room is required');

  vi.mocked(rt.chatRooms).mockResolvedValue({ ok: true, data: { rooms: [] } });
  vi.mocked(rt.chatBuddies).mockResolvedValue({
    ok: true,
    data: { buddies: [] },
  });
  const ghost = await routes.request('/api/chat/archive?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'ghost', archived: true }),
  });
  expect(ghost.status).toBe(400);
  expect((await ghost.json()).error).toContain('unknown room');
  expect(rt.chatJoin).not.toHaveBeenCalled();
  expect(rt.chatArchive).not.toHaveBeenCalled();
});

test('archiving a DM known only through the fleet union never joins', async () => {
  // The human's own listing has no `dm-1`; the fleet union has to find it
  // through a buddy's own chat:rooms call, never through `mine`.
  vi.mocked(rt.chatRooms)
    .mockResolvedValueOnce({ ok: true, data: { rooms: [] } })
    .mockResolvedValueOnce({
      ok: true,
      data: {
        rooms: [
          {
            room: 'dm-1',
            memberCount: 2,
            unread: 0,
            mentions: 0,
            kind: 'dm',
            participants: { a: 'fred', b: 'matt' },
          },
        ],
      },
    });
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: [
        {
          handle: 'fred',
          sessionId: 's',
          baseHandle: 'fred',
          signedInAt: 1,
          lastSeenAt: 1,
          status: 'live',
        },
      ],
    },
  });
  vi.mocked(rt.chatWho).mockResolvedValueOnce({
    ok: true,
    data: {
      members: [
        {
          room: 'dm-1',
          handle: 'fred',
          joinedAt: 1,
          lastReadId: 0,
          wakeOn: 'all',
          status: 'live',
        },
        {
          room: 'dm-1',
          handle: 'matt',
          joinedAt: 1,
          lastReadId: 0,
          wakeOn: 'all',
          status: 'live',
        },
      ],
    },
  });
  vi.mocked(rt.chatArchive).mockResolvedValueOnce({
    ok: true,
    data: { room: 'dm-1', archivedAt: 5 },
  });

  const res = await routes.request('/api/chat/archive?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'dm-1', archived: true }),
  });
  expect(res.status).toBe(200);
  expect(rt.chatJoin).not.toHaveBeenCalled();
  expect(rt.chatArchive).toHaveBeenCalledWith(
    { room: 'dm-1', handle: 'matt', archived: true },
    expect.anything()
  );
});

test('archive surfaces a dropped write as a 502 with the daemon message', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }],
    },
  });
  vi.mocked(rt.chatArchive).mockResolvedValueOnce({
    ok: false,
    error: 'archive dropped',
  });
  const res = await routes.request('/api/chat/archive?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'build', archived: true }),
  });
  expect(res.status).toBe(502);
  expect((await res.json()).error).toBe('archive dropped');
});

test('reopen posts archived:false for a room in the human’s listing', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        {
          room: 'retro',
          memberCount: 2,
          unread: 0,
          mentions: 0,
          archivedAt: 7,
        },
      ],
    },
  });
  vi.mocked(rt.chatArchive).mockResolvedValueOnce({
    ok: true,
    data: { room: 'retro', archivedAt: null },
  });
  const res = await routes.request('/api/chat/archive?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'retro', archived: false }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ room: 'retro', archivedAt: null });
  expect(rt.chatArchive).toHaveBeenCalledWith(
    { room: 'retro', handle: 'matt', archived: false },
    expect.anything()
  );
});

test('dm/open opens or reuses the pair’s room as the human without posting', async () => {
  vi.mocked(rt.chatDmOpen).mockResolvedValueOnce({
    ok: true,
    data: { room: 'dm-1a2b3c4d5e6f', created: true },
  });
  const res = await routes.request('/api/chat/dm/open?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ to: 'fred' }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ room: 'dm-1a2b3c4d5e6f', created: true });
  expect(rt.chatDmOpen).toHaveBeenCalledWith(
    { from: 'matt', to: 'fred' },
    expect.anything()
  );
  expect(rt.chatPost).not.toHaveBeenCalled();
});

test('dm/open surfaces a dropped write as a 502 with the daemon message', async () => {
  vi.mocked(rt.chatDmOpen).mockResolvedValueOnce({
    ok: false,
    error: 'dm-open dropped',
  });
  const res = await routes.request('/api/chat/dm/open?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ to: 'fred' }),
  });
  expect(res.status).toBe(502);
  expect((await res.json()).error).toBe('dm-open dropped');
});

test('dm/open 400s on a missing, invalid, or own handle before touching the daemon', async () => {
  const cases: Array<[unknown, string]> = [
    [{}, 'to is required'],
    [{ to: 'Has@Sigil' }, 'invalid handle "Has@Sigil"'],
    [{ to: 'matt' }, "can't DM yourself"],
  ];
  for (const [body, message] of cases) {
    const res = await routes.request('/api/chat/dm/open?handle=matt', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(message);
  }
  expect(rt.chatDmOpen).not.toHaveBeenCalled();
});

test('POST /api/chat/dm is gone', async () => {
  // The JSON-vs-SPA-shell 404 shape is @mattstack/app-server's createApp
  // concern now (covered there); this only guards the route stays retired.
  const res = await routes.request('/api/chat/dm', {
    method: 'POST',
    body: JSON.stringify({ to: 'fred', body: 'hi' }),
  });
  expect(res.status).toBe(404);
});
