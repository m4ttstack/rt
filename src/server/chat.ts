import {
  chatArchive,
  chatBuddies,
  chatDmOpen,
  chatInvite,
  chatJoin,
  chatMark,
  chatMessages,
  chatPost,
  chatRooms,
  chatWho,
  getSetting,
  paneList,
  type ChatMessage,
  type InviteResult,
  type RoomSummary,
  type RtClientOptions,
} from '@mattstack/rt-client';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { validator } from 'hono/validator';

import {
  fixtureBuddies,
  fixtureInbox,
  fixtureInvite,
  fixtureMark,
  fixtureMembers,
  fixtureMessages,
  fixtureRooms,
  fixturesEnabled,
} from './fixtures';
import { buildInbox } from './inbox';

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

const CHAT_NAME = /^[a-z0-9._-]+$/;

/**
 * sessionId -> the herdr pane title Claude Code maintains for that session.
 * Degrades to an empty map on any failure, herdr being down included: the
 * buddy roster is the important half of `/api/chat/buddies` and must never
 * 502 because the pane list could not be read.
 */
async function paneTitleBySessionId(): Promise<Map<string, string>> {
  try {
    const res = await paneList(rtOpts());
    if (!res?.ok || !res.data) return new Map();
    const map = new Map<string, string>();
    for (const pane of res.data.panes) {
      if (pane.sessionId && pane.title) map.set(pane.sessionId, pane.title);
    }
    return map;
  } catch {
    return new Map();
  }
}

/** The daemon's own defaults for `chat:messages`, so fixtures page the
    same way: the newest `limit` (1..500, 50 unasked), oldest first, and
    `before` walking older by id. */
const FIXTURE_PAGE_DEFAULT = 50;
const FIXTURE_PAGE_MAX = 500;

function pageFixtureMessages(
  all: ChatMessage[],
  before: number | undefined,
  limit: number | undefined
): ChatMessage[] {
  const size = Math.min(
    Math.max(limit ?? FIXTURE_PAGE_DEFAULT, 1),
    FIXTURE_PAGE_MAX
  );
  const older = before === undefined ? all : all.filter(m => m.id < before);
  return older.slice(-size);
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

interface DmLastMessage {
  handle: string;
  body: string;
}

/** A one-line preview, so the whole body of a long post never crosses the
    wire for text the sidebar truncates anyway. */
const DM_PREVIEW_CAP = 120;

/**
 * The newest message per DM room, for the fleet tree's DM second line.
 * That line prefers what the two ends are doing; this is the fallback for a
 * pair whose panes report no title, and only DM rooms carry it -- a channel
 * row has badges to say what changed.
 *
 * One `chatMessages` per DM room, in parallel and non-fatal: a room whose
 * tail fails to read renders the pair form instead of failing the listing.
 */
async function withDmLastMessage(
  rooms: RoomSummary[]
): Promise<(RoomSummary & { lastMessage?: DmLastMessage })[]> {
  const dms = rooms.filter(r => r.kind === 'dm');
  if (dms.length === 0) return rooms;
  const tails = await Promise.all(
    dms.map(r =>
      chatMessages({ room: r.room, limit: 1 }, rtOpts()).catch(() => null)
    )
  );
  const byRoom = new Map<string, DmLastMessage>();
  dms.forEach((room, i) => {
    const tail = tails[i];
    const message = tail?.ok ? tail.data?.messages.at(-1) : undefined;
    if (!message) return;
    byRoom.set(room.room, {
      handle: message.handle,
      // Collapsed, not just cut: a body's newlines and fences would otherwise
      // reach the client as a "one-line" preview that is nothing of the sort.
      body: message.body.replace(/\s+/g, ' ').trim().slice(0, DM_PREVIEW_CAP),
    });
  });
  return rooms.map(room => {
    const lastMessage = byRoom.get(room.room);
    return lastMessage ? { ...room, lastMessage } : room;
  });
}

export const chat = new Hono()
  .get('/api/chat/rooms', async c => {
    if (fixturesEnabled()) return c.json({ rooms: fixtureRooms() }, 200);
    const res = await chatRooms(
      { handle: humanHandle(c), includeArchived: true },
      rtOpts()
    );
    if (!res.ok) return c.json({ error: res.error }, 502);

    const joined = res.data?.rooms ?? [];
    const extra = await unjoinedFleetRooms(joined);
    const rooms = await withDmLastMessage([...joined, ...extra]);
    return c.json({ rooms }, 200);
  })
  // `RoomSummary.unread` is a count, not a cursor id -- the daemon keeps
  // the actual read position internally and never exposes it. The newest
  // `min(unread, 50)` messages in a room stand in for "after the cursor",
  // fetched with the existing paging (no `before`, so `chatMessages`
  // returns the newest page). A room whose message fetch fails still
  // contributes its unread/mentions counts to `elsewhere` via `buildInbox`.
  .get('/api/chat/inbox', async c => {
    const handle = humanHandle(c);
    if (fixturesEnabled()) return c.json(fixtureInbox(handle), 200);

    const roomsRes = await chatRooms({ handle }, rtOpts());
    if (!roomsRes.ok || !roomsRes.data) {
      return c.json({ error: roomsRes.error ?? 'rooms: no data' }, 502);
    }
    const unreadRooms = roomsRes.data.rooms.filter(r => r.unread > 0);

    const pages = await Promise.all(
      unreadRooms.map(r =>
        chatMessages(
          { room: r.room, limit: Math.min(r.unread, 50) },
          rtOpts()
        ).catch(() => null)
      )
    );
    const pagesByRoom = new Map<string, ChatMessage[]>();
    unreadRooms.forEach((r, i) => {
      const res = pages[i];
      if (res?.ok && res.data) pagesByRoom.set(r.room, res.data.messages);
    });

    return c.json(buildInbox(unreadRooms, pagesByRoom, handle), 200);
  })
  .get('/api/chat/who/:room', async c => {
    const room = c.req.param('room');
    if (fixturesEnabled())
      return c.json({ members: fixtureMembers(room) }, 200);
    const res = await chatWho({ room }, rtOpts());
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data, 200);
  })
  // Buddies composition (2 + rooms daemon calls, deliberately uncached):
  // chatBuddies() gives the roster; the human's own chatRooms() gives the
  // set of rooms worth asking about; one chatWho() per room inverts
  // room -> members into handle -> rooms. Never re-derives a daemon-owned
  // status and never spawns git for `branch` -- both come straight off
  // chatBuddies()'s PresenceRow. The pane list rides alongside the rooms
  // wave as one more call, joined onto each buddy by sessionId.
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
    const [perBuddy, paneTitles] = await Promise.all([
      Promise.all(
        buddiesRes.data.buddies.map(b =>
          chatRooms({ handle: b.handle }, rtOpts()).catch(() => null)
        )
      ),
      paneTitleBySessionId(),
    ]);
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

    const buddies = buddiesRes.data.buddies.map(buddy => {
      const paneTitle = paneTitles.get(buddy.sessionId);
      return {
        ...buddy,
        rooms: roomsByHandle.get(buddy.handle) ?? [],
        ...(paneTitle !== undefined ? { paneTitle } : {}),
      };
    });
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
        return c.json(
          {
            messages: pageFixtureMessages(fixtureMessages(room), before, limit),
          },
          200
        );
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
      if (fixturesEnabled()) {
        fixtureMark(room);
        return c.json({ ok: true }, 200);
      }
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
  // Close is the one write that needs the human IN the room first: a closed
  // room only stays listed for members, and most channels are join-created
  // by agents. Joining first (never for a DM, which already holds him) is
  // the same move the post route makes. A name that neither his listing nor
  // the fleet union knows is refused before that join, so a typo can never
  // create-and-close a room. The daemon verb is archive; the viewer never
  // reopens, since any post revives the room.
  .post('/api/chat/close', async c => {
    let raw: { room?: unknown };
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON in request body' }, 400);
    }
    const room = typeof raw?.room === 'string' ? raw.room : undefined;
    if (!room) return c.json({ error: 'room is required' }, 400);
    const handle = humanHandle(c);

    const roomsRes = await chatRooms(
      { handle, includeArchived: true },
      rtOpts()
    );
    if (!roomsRes.ok || !roomsRes.data) {
      return c.json({ error: roomsRes.error ?? 'rooms: no data' }, 502);
    }
    const mine = roomsRes.data.rooms.find(r => r.room === room);
    if (!mine) {
      const fleet = (await unjoinedFleetRooms(roomsRes.data.rooms)).find(
        r => r.room === room
      );
      if (!fleet) return c.json({ error: `unknown room "${room}"` }, 400);
      if (fleet.kind !== 'dm') {
        const joinRes = await chatJoin({ room, handle }, rtOpts());
        if (!joinRes.ok) return c.json({ error: joinRes.error }, 502);
      }
    }

    const res = await chatArchive({ room, handle, archived: true }, rtOpts());
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(
      { room: res.data?.room ?? room, closedAt: res.data?.archivedAt ?? null },
      200
    );
  })
  // Opens or reuses the pair's room with no first message: the client
  // navigates to it and the composer there is the DM. Parsed by hand for
  // the same reason as `/api/chat/post`.
  .post('/api/chat/dm/open', async c => {
    let raw: { to?: unknown };
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON in request body' }, 400);
    }
    const to = typeof raw?.to === 'string' ? raw.to : undefined;
    if (!to) return c.json({ error: 'to is required' }, 400);
    if (!CHAT_NAME.test(to))
      return c.json({ error: `invalid handle "${to}"` }, 400);
    const from = humanHandle(c);
    if (to === from) return c.json({ error: "can't DM yourself" }, 400);
    const res = await chatDmOpen({ from, to }, rtOpts());
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data, 200);
  })
  // Join-creates, so "create a room" is the human joining it; the seed is
  // the first post. A room whose seed fails still exists, so the error
  // carries the room name and the client keeps the draft.
  .post('/api/chat/rooms', async c => {
    let raw: { room?: unknown; seed?: unknown; wakeOn?: unknown };
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON in request body' }, 400);
    }
    const room = typeof raw?.room === 'string' ? raw.room : '';
    if (!CHAT_NAME.test(room))
      return c.json({ error: 'room must match ^[a-z0-9._-]+$' }, 400);
    const seed =
      typeof raw?.seed === 'string' && raw.seed.trim() ? raw.seed : undefined;
    if (fixturesEnabled())
      return c.json(seed ? { room, seedId: 1 } : { room }, 200);
    const wakeOn =
      raw?.wakeOn === 'all' ||
      raw?.wakeOn === 'mention' ||
      raw?.wakeOn === 'none'
        ? raw.wakeOn
        : undefined;
    const handle = humanHandle(c);
    const joinRes = await chatJoin(
      wakeOn ? { room, handle, wakeOn } : { room, handle },
      rtOpts()
    );
    if (!joinRes.ok) return c.json({ error: joinRes.error }, 502);
    if (!seed) return c.json({ room }, 200);
    const postRes = await chatPost({ room, handle, body: seed }, rtOpts());
    if (!postRes.ok) return c.json({ error: postRes.error, room }, 502);
    return c.json({ room, seedId: postRes.data?.id }, 200);
  })
  // Sequential on purpose: each invite types into a live terminal.
  .post('/api/chat/invite', async c => {
    let raw: { room?: unknown; panes?: unknown };
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON in request body' }, 400);
    }
    const room = typeof raw?.room === 'string' ? raw.room : '';
    if (!CHAT_NAME.test(room))
      return c.json({ error: 'room must match ^[a-z0-9._-]+$' }, 400);
    const panes = Array.isArray(raw?.panes)
      ? raw.panes.flatMap((p): { paneId: string; note?: string }[] =>
          p &&
          typeof p === 'object' &&
          typeof (p as { paneId?: unknown }).paneId === 'string'
            ? [
                {
                  paneId: (p as { paneId: string }).paneId,
                  ...(typeof (p as { note?: unknown }).note === 'string' &&
                  (p as { note: string }).note.trim()
                    ? { note: (p as { note: string }).note }
                    : {}),
                },
              ]
            : []
        )
      : [];
    if (panes.length === 0)
      return c.json({ error: 'panes must name at least one pane' }, 400);
    if (fixturesEnabled())
      return c.json({ results: panes.map(p => fixtureInvite(p.paneId)) }, 200);
    const from = humanHandle(c);
    const results: InviteResult[] = [];
    for (const p of panes) {
      const res = await chatInvite(
        { paneId: p.paneId, room, from, ...(p.note ? { note: p.note } : {}) },
        rtOpts()
      );
      results.push(
        res.ok && res.data
          ? res.data
          : {
              paneId: p.paneId,
              delivered: 'refused',
              reason: res.error ?? 'invite failed',
            }
      );
    }
    return c.json({ results }, 200);
  });
