import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { makeFetchHandler } from '../server.ts';
import { SwitchboardStore } from '../store.ts';
import { TeamInviteStore } from '../team-invites.ts';

const ADMIN = 'admin-secret';

function setup() {
  const db = new Database(':memory:');
  const store = new SwitchboardStore(db);
  const handler = makeFetchHandler(
    store,
    ADMIN,
    () => 1000,
    new TeamInviteStore(db)
  );
  const call = (
    path: string,
    opts: { method?: string; token?: string; body?: unknown } = {}
  ) =>
    handler(
      new Request(`http://x${path}`, {
        method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          'content-type': 'application/json',
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      })
    );
  return { store, call };
}

const draft = (id: string, to: string) => ({
  id,
  to,
  type: 'review-state',
  sentAt: 1,
  payload: {},
});

describe('switchboard http', () => {
  test('healthz is open', async () => {
    const { call } = setup();
    expect((await call('/healthz')).status).toBe(200);
  });
  test('board registration needs the admin token', async () => {
    const { call } = setup();
    expect(
      (await call('/boards', { token: 'nope', body: { username: 'ada' } }))
        .status
    ).toBe(401);
    const res = await call('/boards', {
      token: ADMIN,
      body: { username: 'Ada' },
    });
    expect(res.status).toBe(201);
    const { username, token } = (await res.json()) as {
      username: string;
      token: string;
    };
    expect(username).toBe('ada');
    expect(token.length).toBeGreaterThan(20);
  });
  test('peers listing: any board token, usernames only, no tokens leaked', async () => {
    const { call } = setup();
    const ada = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'ada' } })
      ).json()) as { token: string }
    ).token;
    await call('/boards', { token: ADMIN, body: { username: 'grace' } });
    expect((await call('/peers')).status).toBe(401);
    expect((await call('/peers', { token: 'nope' })).status).toBe(401);
    const res = await call('/peers', { token: ada });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { peers: string[] };
    expect(body.peers.sort()).toEqual(['ada', 'grace']);
    expect(JSON.stringify(body)).not.toContain(ada);
  });

  test('board delete: admin-only, revokes the token, drops peers row and pending envelopes', async () => {
    const { call } = setup();
    const ada = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'ada' } })
      ).json()) as { token: string }
    ).token;
    const grace = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'grace' } })
      ).json()) as { token: string }
    ).token;
    await call('/envelopes', { token: ada, body: draft('e1', 'grace') });

    expect((await call('/boards/grace', { method: 'DELETE' })).status).toBe(
      401
    );
    expect(
      (await call('/boards/grace', { method: 'DELETE', token: 'nope' })).status
    ).toBe(401);
    expect(
      (await call('/boards/nobody', { method: 'DELETE', token: ADMIN })).status
    ).toBe(404);

    const res = await call('/boards/grace', { method: 'DELETE', token: ADMIN });
    expect(res.status).toBe(200);
    // Token dead immediately.
    expect((await call('/inbox', { token: grace })).status).toBe(401);
    // Gone from the enrollment listing.
    const peers = (await (await call('/peers', { token: ada })).json()) as {
      peers: string[];
    };
    expect(peers.peers).toEqual(['ada']);
    // Pending envelopes for the deleted board are dropped: re-register and
    // the inbox starts empty.
    const grace2 = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'grace' } })
      ).json()) as { token: string }
    ).token;
    const inbox = (await (await call('/inbox', { token: grace2 })).json()) as {
      envelopes: unknown[];
    };
    expect(inbox.envelopes).toEqual([]);
  });

  test('board delete with malformed percent-encoding answers 400, not a crash', async () => {
    const { call } = setup();
    const res = await call('/boards/%E0%A4', {
      method: 'DELETE',
      token: ADMIN,
    });
    expect(res.status).toBe(400);
  });

  test('publish → inbox → ack round trip', async () => {
    const { call } = setup();
    const ada = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'ada' } })
      ).json()) as { token: string }
    ).token;
    const grace = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'grace' } })
      ).json()) as { token: string }
    ).token;
    const pub = await call('/envelopes', {
      token: ada,
      body: draft('e1', 'grace'),
    });
    expect(pub.status).toBe(201);
    const inbox = (await (await call('/inbox', { token: grace })).json()) as {
      envelopes: Array<{ id: string; from: string; receivedAt: number }>;
    };
    expect(inbox.envelopes.map(e => e.id)).toEqual(['e1']);
    expect(inbox.envelopes[0]!.from).toBe('ada');
    expect(inbox.envelopes[0]!.receivedAt).toBe(1000);
    const ack = await call('/inbox/ack', {
      token: grace,
      body: { ids: ['e1'] },
    });
    expect(((await ack.json()) as { acked: number }).acked).toBe(1);
    expect(
      (
        (await (await call('/inbox', { token: grace })).json()) as {
          envelopes: unknown[];
        }
      ).envelopes.length
    ).toBe(0);
  });
  test('unknown recipient → 422', async () => {
    const { call } = setup();
    const ada = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'ada' } })
      ).json()) as { token: string }
    ).token;
    const res = await call('/envelopes', {
      token: ada,
      body: draft('e1', 'nobody'),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(
      'unknown-recipient'
    );
  });
  test('board endpoints reject a missing/bad token', async () => {
    const { call } = setup();
    expect((await call('/inbox')).status).toBe(401);
    expect(
      (await call('/envelopes', { token: 'bad', body: draft('e', 'x') })).status
    ).toBe(401);
  });
  test('bad publish body → 400', async () => {
    const { call } = setup();
    const ada = (
      (await (
        await call('/boards', { token: ADMIN, body: { username: 'ada' } })
      ).json()) as { token: string }
    ).token;
    expect(
      (await call('/envelopes', { token: ada, body: { nope: 1 } })).status
    ).toBe(400);
  });
});
