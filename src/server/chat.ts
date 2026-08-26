import {
  chatBuddies,
  chatDm,
  chatJoin,
  chatMark,
  chatMessages,
  chatPost,
  chatRooms,
  chatWho,
  getSetting,
  type RoomSummary,
  type RtClientOptions,
} from '@mattstack/rt-client';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { validator } from 'hono/validator';

import {
  fixtureBuddies,
  fixtureMembers,
  fixtureMessages,
  fixtureRooms,
  fixturesEnabled,
} from './fixtures';

/**
 * Resolved at CALL time (mirrors rt-client's own `defaultSock()` convention):
 * an env override read fresh per request, undefined otherwise so rt-client's
 * built-in default sock path still applies.
 */
function rtOpts(): RtClientOptions {
  return { sockPath: process.env.RT_SOCK_PATH };
}

/** The human operating this viewer, not the buddy/room being looked at.
    Query string wins; `chat.humanHandle` is the fallback everywhere a
    request doesn't name one explicitly. */
function humanHandle(c: Context): string {
  return c.req.query('handle') ?? getSetting<string>('chat.humanHandle').value;
}

/**
 * `before` is a message id and `limit` is a count, so both are non-negative
 * integers. `Number.isFinite` let `before=1.5` and `limit=-5` through to the
 * daemon, which is a worse place to find out.
 */
function parseIntParam(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

/**
 * A DM room's name is a hashed pair-key -- an internal lookup, not something
 * a UI shows. Every buddy-facing surface collapses it to the literal tag
 * `"dm"`; only `who`/`rooms` (talking to one room the caller already named)
 * ever see the real name.
 */
function roomTag(room: { room: string; kind?: 'dm' }): string {
  return room.kind === 'dm' ? 'dm' : room.room;
}

/**
 * The rooms the FLEET is in that the human has not joined.
 *
 * `chat:rooms` is `listRooms(handle)`, so asking as the human returns only
 * his own memberships. That is correct for a chat client and wrong for this
 * viewer: two agents can be signed into a room, visible in the roster, and
 * the rail would show nothing. The room is exactly what he needs to read.
 *
 * There is still no all-rooms verb in the daemon. Presence is the next best
 * source and a sufficient one here: `PresenceRow.repo` is the room sign-in
 * derives from a cwd, so "rooms with at least one signed-in agent" is the
 * set this viewer cares about. A room nobody is signed into is not a room
 * whose silence needs explaining.
 *
 * Rows come back `joined: false` so the rail can mark them, per the
 * artboard's `not joined` badge. Posting into one still works: the server
 * joins before it posts.
 */
async function unjoinedFleetRooms(
  joined: RoomSummary[]
): Promise<RoomSummary[]> {
  // Deliberately non-fatal: the human's own rooms are the important half of
  // this list, so a failed presence lookup degrades to "no extra rooms"
  // rather than failing the whole rail.
  const buddiesRes = await chatBuddies(rtOpts());
  if (!buddiesRes?.ok || !buddiesRes.data) return [];

  // Memberships, not repos: a presence row names the repo a buddy works in,
  // but a buddy can be in a room joined by name (`--room mantine-tokyo`)
  // that no repo derives, and `chat:rooms` is listRooms(handle) for any
  // handle, the same call the human's own half of this list comes from.
  const known = new Set(joined.map(r => r.room));
  const perBuddy = await Promise.all(
    buddiesRes.data.buddies.map(b =>
      chatRooms({ handle: b.handle }, rtOpts()).catch(() => null)
    )
  );
  // A DM room is listed too: the human is the silent third party in every
  // agent-to-agent DM by design (the rail's DIRECT section). Its summary
  // keeps `kind` and `participants` so the rail names the pair, never the
  // hashed room.
  const byRoom = new Map<string, RoomSummary>();
  for (const r of perBuddy) {
    if (!r?.ok || !r.data) continue;
    for (const summary of r.data.rooms) {
      if (!known.has(summary.room) && !byRoom.has(summary.room)) {
        byRoom.set(summary.room, summary);
      }
    }
  }
  const candidates = [...byRoom.keys()];

  const whos = await Promise.all(
    candidates.map(room => chatWho({ room }, rtOpts()))
  );

  return candidates.flatMap((room, i) => {
    const who = whos[i];
    if (!who?.ok || !who.data) return [];
    const summary = byRoom.get(room)!;
    return [
      {
        room,
        kind: summary.kind,
        participants: summary.participants,
        memberCount: who.data.members.length,
        // The human has no read cursor in a room he never joined, so there
        // is no honest unread count to report. Zero, not a guess.
        unread: 0,
        mentions: 0,
        joined: false,
      },
    ];
  });
}

export const chat = new Hono()
  .get('/api/chat/rooms', async c => {
    if (fixturesEnabled()) return c.json({ rooms: fixtureRooms() }, 200);
    const res = await chatRooms({ handle: humanHandle(c) }, rtOpts());
    if (!res.ok) return c.json({ error: res.error }, 502);

    const joined = res.data?.rooms ?? [];
    const extra = await unjoinedFleetRooms(joined);
    return c.json({ rooms: [...joined, ...extra] }, 200);
  })
  .get('/api/chat/who/:room', async c => {
    const room = c.req.param('room');
    if (fixturesEnabled())
      return c.json({ members: fixtureMembers(room) }, 200);
    const res = await chatWho({ room }, rtOpts());
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data, 200);
  })
  // Buddies composition (1 + rooms daemon calls, deliberately uncached):
  // chatBuddies() gives the roster; the human's own chatRooms() gives the
  // set of rooms worth asking about; one chatWho() per room inverts
  // room -> members into handle -> rooms. Never re-derives a daemon-owned
  // status and never spawns git for `branch` -- both come straight off
  // chatBuddies()'s PresenceRow.
  .get('/api/chat/buddies', async c => {
    if (fixturesEnabled()) return c.json({ buddies: fixtureBuddies() }, 200);
    const buddiesRes = await chatBuddies(rtOpts());
    if (!buddiesRes.ok || !buddiesRes.data) {
      return c.json({ error: buddiesRes.error ?? 'buddies: no data' }, 502);
    }

    // Each buddy's rooms come from its own memberships (`chat:rooms` is
    // listRooms(handle) for any handle), not from inverting `who` over the
    // human's rooms: the human is in no room he never joined, which was
    // every fleet room, so every buddy read as being nowhere. One wave of
    // calls, in buddy order, so a failure is that buddy's alone.
    const perBuddy = await Promise.all(
      buddiesRes.data.buddies.map(b =>
        chatRooms({ handle: b.handle }, rtOpts()).catch(() => null)
      )
    );
    const roomsByHandle = new Map<string, string[]>();
    buddiesRes.data.buddies.forEach((b, i) => {
      const r = perBuddy[i];
      if (!r?.ok || !r.data) return;
      const tags: string[] = [];
      for (const room of r.data.rooms) {
        const tag = roomTag(room);
        if (!tags.includes(tag)) tags.push(tag);
      }
      roomsByHandle.set(b.handle, tags);
    });

    const buddies = buddiesRes.data.buddies.map(buddy => ({
      ...buddy,
      rooms: roomsByHandle.get(buddy.handle) ?? [],
    }));
    return c.json({ buddies }, 200);
  })
  .get(
    '/api/chat/messages/:room',
    validator('query', (value): { before?: number; limit?: number } => {
      const v = value as { before?: unknown; limit?: unknown };
      return {
        before: parseIntParam(
          typeof v?.before === 'string' ? v.before : undefined
        ),
        limit: parseIntParam(
          typeof v?.limit === 'string' ? v.limit : undefined
        ),
      };
    }),
    async c => {
      const room = c.req.param('room');
      const { before, limit } = c.req.valid('query');
      if (fixturesEnabled()) {
        return c.json({ messages: fixtureMessages(room) }, 200);
      }
      const res = await chatMessages({ room, before, limit }, rtOpts());
      if (!res.ok) return c.json({ error: res.error }, 502);
      return c.json(res.data, 200);
    }
  )
  // Mirrors runs.ts's abandon route: an absent body lands `room` as
  // undefined and the handler still runs; a malformed body raises before
  // the handler and reaches `app.onError` as JSON.
  .post(
    '/api/chat/mark',
    validator('json', (value): { room?: string } => {
      const v = value as { room?: unknown } | undefined;
      return { room: typeof v?.room === 'string' ? v.room : undefined };
    }),
    async c => {
      const { room } = c.req.valid('json');
      const res = await chatMark({ handle: humanHandle(c), room }, rtOpts());
      if (!res.ok) return c.json({ error: res.error }, 502);
      return c.json(res.data, 200);
    }
  )
  // The browser never touches rt-client directly -- this route owns the
  // join. A DM row is posted into directly (the human is a member of every
  // DM by construction, and `chat:join` REFUSES dm rooms, so joining one
  // would error); any other room is joined unconditionally right before the
  // post (idempotent for an existing member) so a first message into a room
  // the human never joined still lands.
  //
  // Parsed by hand rather than through `validator('json', ...)`: that
  // middleware only calls `c.req.json()` when the request carries a
  // `Content-Type: application/json` header, and silently hands the
  // validator function `{}` otherwise -- the composer's own `fetch` call
  // (like this route's tests) never sets one, so the validator form would
  // read every field as missing on every real request.
  .post('/api/chat/post', async c => {
    let raw: { room?: unknown; body?: unknown; mentions?: unknown };
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON in request body' }, 400);
    }
    const room = typeof raw?.room === 'string' ? raw.room : undefined;
    const body = typeof raw?.body === 'string' ? raw.body : undefined;
    const mentions = Array.isArray(raw?.mentions)
      ? raw.mentions.filter((m): m is string => typeof m === 'string')
      : undefined;
    if (!room || body === undefined) {
      return c.json({ error: 'room and body are required' }, 400);
    }
    const handle = humanHandle(c);

    const roomsRes = await chatRooms({ handle }, rtOpts());
    if (!roomsRes.ok || !roomsRes.data) {
      return c.json({ error: roomsRes.error ?? 'rooms: no data' }, 502);
    }
    const target = roomsRes.data.rooms.find(r => r.room === room);

    if (target?.kind !== 'dm') {
      const joinRes = await chatJoin({ room, handle }, rtOpts());
      if (!joinRes.ok) return c.json({ error: joinRes.error }, 502);
    }

    const postRes = await chatPost({ room, handle, body, mentions }, rtOpts());
    if (!postRes.ok) return c.json({ error: postRes.error }, 502);
    return c.json(postRes.data, 200);
  })
  // Opens or reuses the pair's room and posts the first message as the
  // human -- the client navigates to the returned room afterward, which is
  // what makes it appear in the rail's direct section. Parsed by hand for
  // the same reason as `/api/chat/post` above.
  .post('/api/chat/dm', async c => {
    let raw: { to?: unknown; body?: unknown };
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON in request body' }, 400);
    }
    const to = typeof raw?.to === 'string' ? raw.to : undefined;
    const body = typeof raw?.body === 'string' ? raw.body : undefined;
    if (!to || body === undefined) {
      return c.json({ error: 'to and body are required' }, 400);
    }
    const res = await chatDm({ from: humanHandle(c), to, body }, rtOpts());
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data, 200);
  });
