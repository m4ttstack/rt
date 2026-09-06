import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { makeFetchHandler } from '../server.ts';
import { SwitchboardStore } from '../store.ts';
import { TeamInviteStore } from '../team-invites.ts';

const ADMIN = 'admin-secret';
const ID = '0123456789abcdef0123456789abcdef';
const HOUR = 60 * 60_000;

/** The handler's clock is mutable so a test can walk past an expiry without
    sleeping; every route reads it through the same `now()`. */
function setup(startAt = 1_000_000) {
  let clock = startAt;
  const db = new Database(':memory:');
  const store = new SwitchboardStore(db);
  const teamStore = new TeamInviteStore(db);
  const handler = makeFetchHandler(store, ADMIN, () => clock, teamStore);
  const call = (
    path: string,
    opts: { method?: string; token?: string; body?: unknown; ip?: string } = {}
  ) =>
    handler(
      new Request(`http://x${path}`, {
        method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          'x-forwarded-for': opts.ip ?? '203.0.113.7',
          'content-type': 'application/json',
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      })
    );
  return {
    db,
    store,
    teamStore,
    call,
    tick: (ms: number) => {
      clock += ms;
    },
    at: () => clock,
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

async function mint(
  call: ReturnType<typeof setup>['call'],
  overrides: {
    id?: string;
    ciphertext?: string;
    expiresAt?: string;
    ip?: string;
  } = {}
) {
  const res = await call('/v1/invites', {
    ip: overrides.ip,
    body: {
      id: overrides.id ?? ID,
      ciphertext: overrides.ciphertext ?? 'sealed-team-pointer',
      expiresAt: overrides.expiresAt ?? iso(1_000_000 + 24 * HOUR),
    },
  });
  return {
    res,
    body:
      res.status === 201
        ? ((await res.json()) as { id: string; creatorSecret: string })
        : null,
  };
}

describe("the relay's storage tells an operator nothing", () => {
  /** MAT-379 ruling 4: a full dump yields opaque ids, ciphertext, a secret hash,
      and timestamps. This list is the invariant's only mechanical enforcement —
      a later column holding a remote, slug, or handle fails here rather than
      slipping through review. */
  test('team_invites has exactly the columns the spec allows', () => {
    const { db } = setup();
    const columns = db
      .query<{ name: string }, []>(`PRAGMA table_info(team_invites)`)
      .all()
      .map(c => c.name);
    expect(columns).toEqual([
      'id',
      'ciphertext',
      'creator_secret_hash',
      'expires_at',
      'created_at',
      'redeemed_at',
      'reply_blob',
      'reply_at',
    ]);
  });

  test('the creator secret is stored only as a hash', async () => {
    const { db, call } = setup();
    const { creatorSecret } = (await mint(call)).body!;
    const stored = db
      .query<{ creator_secret_hash: string }, []>(
        `SELECT creator_secret_hash FROM team_invites`
      )
      .all();
    expect(stored[0]!.creator_secret_hash).not.toBe(creatorSecret);
    expect(stored[0]!.creator_secret_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('expiry and pruning', () => {
  test('an expired invite is reaped on the hourly pass, after which it reads 404', async () => {
    const { call, teamStore, tick, at } = setup();
    await mint(call, { expiresAt: iso(1_000_000 + HOUR) });
    tick(HOUR + 1);
    expect((await call(`/v1/invites/${ID}`)).status).toBe(410);
    expect(teamStore.prune(at())).toBe(1);
    expect((await call(`/v1/invites/${ID}`)).status).toBe(404);
  });

  test('a live invite survives the reaper', async () => {
    const { call, teamStore, at } = setup();
    await mint(call);
    expect(teamStore.prune(at())).toBe(0);
    expect((await call(`/v1/invites/${ID}`)).status).toBe(200);
  });
});

describe('rate limits on the unauthenticated surface', () => {
  const idAt = (n: number) => n.toString(16).padStart(32, '0');

  test('an eleventh mint in a minute from one address is 429', async () => {
    const { call } = setup();
    for (let i = 0; i < 10; i++) {
      expect((await mint(call, { id: idAt(i) })).res.status).toBe(201);
    }
    expect((await mint(call, { id: idAt(10) })).res.status).toBe(429);
  });

  test('the limit is per source address and lifts with time', async () => {
    const { call, tick } = setup();
    for (let i = 0; i < 10; i++) await mint(call, { id: idAt(i) });
    expect(
      (await mint(call, { id: idAt(20), ip: '198.51.100.4' })).res.status
    ).toBe(201);
    tick(60_001);
    expect(
      (
        await mint(call, {
          id: idAt(30),
          expiresAt: iso(1_000_000 + 48 * HOUR),
        })
      ).res.status
    ).toBe(201);
  });

  test('guessing a creator secret is throttled per invite', async () => {
    const { call } = setup();
    await mint(call);
    for (let i = 0; i < 10; i++) {
      expect(
        (
          await call(`/v1/invites/${ID}/reply`, {
            token: `guess-${i}`,
            method: 'GET',
          })
        ).status
      ).toBe(401);
    }
    expect(
      (
        await call(`/v1/invites/${ID}/reply`, {
          token: 'guess-11',
          method: 'GET',
        })
      ).status
    ).toBe(429);
    expect(
      (await call(`/v1/invites/${ID}`, { token: 'guess-11', method: 'DELETE' }))
        .status
    ).toBe(429);
  });

  /** Throttling only *failed* attempts is what keeps this from becoming a DoS:
      anyone who learns an invite id could otherwise burn ten guesses and stall
      the creator's own polling for the reply. */
  test('a throttled invite still serves its real creator', async () => {
    const { call } = setup();
    const { creatorSecret } = (await mint(call)).body!;
    await call(`/v1/invites/${ID}/reply`, { body: { blob: 'sealed-age-key' } });
    for (let i = 0; i < 12; i++)
      await call(`/v1/invites/${ID}/reply`, {
        token: `guess-${i}`,
        method: 'GET',
      });
    const read = await call(`/v1/invites/${ID}/reply`, {
      token: creatorSecret,
      method: 'GET',
    });
    expect(read.status).toBe(200);
    expect(((await read.json()) as { blob: string }).blob).toBe(
      'sealed-age-key'
    );
  });
});

describe('POST /v1/invites', () => {
  test("stores the sealed blob under the client's id and returns the creator secret once", async () => {
    const { call } = setup();
    const { res, body } = await mint(call);
    expect(res.status).toBe(201);
    expect(body!.id).toBe(ID);
    expect(body!.creatorSecret.length).toBeGreaterThanOrEqual(43);
  });

  test('a second post to a live id is 409 and leaves the original record untouched', async () => {
    const { call } = setup();
    const first = (await mint(call)).body!;
    const clash = await mint(call, { ciphertext: 'attacker-blob' });
    expect(clash.res.status).toBe(409);

    const read = await call(`/v1/invites/${ID}`);
    expect(((await read.json()) as { ciphertext: string }).ciphertext).toBe(
      'sealed-team-pointer'
    );
    const reply = await call(`/v1/invites/${ID}/reply`, {
      token: first.creatorSecret,
      method: 'GET',
    });
    expect(reply.status).toBe(404);
  });

  test('rejects an id that is not 32 lowercase hex', async () => {
    const { call } = setup();
    for (const bad of [
      'short',
      ID.toUpperCase(),
      `${ID}f`,
      'zzzz56789abcdef0123456789abcdef0',
    ]) {
      expect((await mint(call, { id: bad })).res.status).toBe(400);
    }
  });

  test('rejects a missing ciphertext and a missing, unparseable, or past expiry', async () => {
    const { call } = setup();
    const bad = async (body: unknown) =>
      (await call('/v1/invites', { body })).status;
    expect(await bad({ id: ID, expiresAt: iso(1_000_000 + HOUR) })).toBe(400);
    expect(
      await bad({ id: ID, ciphertext: 7, expiresAt: iso(1_000_000 + HOUR) })
    ).toBe(400);
    expect(await bad({ id: ID, ciphertext: 'c' })).toBe(400);
    expect(
      await bad({ id: ID, ciphertext: 'c', expiresAt: 'not-a-date' })
    ).toBe(400);
    expect(
      await bad({ id: ID, ciphertext: 'c', expiresAt: iso(1_000_000 - HOUR) })
    ).toBe(400);
  });

  test('a ciphertext over the 64 KB cap is 413', async () => {
    const { call } = setup();
    const { res } = await mint(call, { ciphertext: 'x'.repeat(64 * 1024 + 1) });
    expect(res.status).toBe(413);
  });
});

describe('GET /v1/invites/:id', () => {
  test('returns only the ciphertext for a live invite', async () => {
    const { call } = setup();
    await mint(call);
    const res = await call(`/v1/invites/${ID}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ciphertext: 'sealed-team-pointer' });
  });

  test('an unknown id is 404', async () => {
    const { call } = setup();
    expect((await call(`/v1/invites/${ID}`)).status).toBe(404);
  });

  test('an expired invite is 410', async () => {
    const { call, tick } = setup();
    await mint(call, { expiresAt: iso(1_000_000 + HOUR) });
    tick(HOUR + 1);
    expect((await call(`/v1/invites/${ID}`)).status).toBe(410);
  });

  test('a redeemed invite is 410', async () => {
    const { call } = setup();
    await mint(call);
    expect(
      (await call(`/v1/invites/${ID}/redeem`, { method: 'POST' })).status
    ).toBe(200);
    expect((await call(`/v1/invites/${ID}`)).status).toBe(410);
  });
});

describe('POST /v1/invites/:id/redeem', () => {
  /** Driven genuinely in parallel: the handler awaits between entry and the
      write, so a read-then-write implementation would interleave here and hand
      both callers a 200. A sequential version of this test cannot fail. */
  test('two concurrent redeems of one invite: exactly one 200, one 409', async () => {
    const { call } = setup();
    await mint(call);
    const results = await Promise.all([
      call(`/v1/invites/${ID}/redeem`, { method: 'POST' }),
      call(`/v1/invites/${ID}/redeem`, { method: 'POST' }),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  });

  test('eight concurrent redeems still yield exactly one winner', async () => {
    const { call } = setup();
    await mint(call);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        call(`/v1/invites/${ID}/redeem`, { method: 'POST' })
      )
    );
    expect(results.filter(r => r.status === 200).length).toBe(1);
    expect(results.filter(r => r.status === 409).length).toBe(7);
  });

  test('unknown is 404 and expired is 410', async () => {
    const { call, tick } = setup();
    expect(
      (await call(`/v1/invites/${ID}/redeem`, { method: 'POST' })).status
    ).toBe(404);
    await mint(call, { expiresAt: iso(1_000_000 + HOUR) });
    tick(HOUR + 1);
    expect(
      (await call(`/v1/invites/${ID}/redeem`, { method: 'POST' })).status
    ).toBe(410);
  });
});

describe('POST /v1/invites/:id/reply', () => {
  test('the joiner posts a sealed key without holding any credential', async () => {
    const { call } = setup();
    const { creatorSecret } = (await mint(call)).body!;
    expect(
      (
        await call(`/v1/invites/${ID}/reply`, {
          body: { blob: 'sealed-age-key' },
        })
      ).status
    ).toBe(200);
    const read = await call(`/v1/invites/${ID}/reply`, {
      token: creatorSecret,
      method: 'GET',
    });
    expect(await read.json()).toEqual({ blob: 'sealed-age-key' });
  });

  test('a second reply is 409 and the first blob survives', async () => {
    const { call } = setup();
    const { creatorSecret } = (await mint(call)).body!;
    await call(`/v1/invites/${ID}/reply`, { body: { blob: 'real-joiner' } });
    expect(
      (await call(`/v1/invites/${ID}/reply`, { body: { blob: 'impostor' } }))
        .status
    ).toBe(409);
    const read = await call(`/v1/invites/${ID}/reply`, {
      token: creatorSecret,
      method: 'GET',
    });
    expect(((await read.json()) as { blob: string }).blob).toBe('real-joiner');
  });

  test('unknown is 404, expired is 410, oversize is 413, missing blob is 400', async () => {
    const { call, tick } = setup();
    expect(
      (await call(`/v1/invites/${ID}/reply`, { body: { blob: 'b' } })).status
    ).toBe(404);
    await mint(call, { expiresAt: iso(1_000_000 + 2 * HOUR) });
    expect((await call(`/v1/invites/${ID}/reply`, { body: {} })).status).toBe(
      400
    );
    expect(
      (
        await call(`/v1/invites/${ID}/reply`, {
          body: { blob: 'x'.repeat(64 * 1024 + 1) },
        })
      ).status
    ).toBe(413);
    tick(2 * HOUR + 1);
    expect(
      (await call(`/v1/invites/${ID}/reply`, { body: { blob: 'b' } })).status
    ).toBe(410);
  });
});

describe('GET /v1/invites/:id/reply', () => {
  test('no reply yet is 404, which rt polls on', async () => {
    const { call } = setup();
    const { creatorSecret } = (await mint(call)).body!;
    expect(
      (
        await call(`/v1/invites/${ID}/reply`, {
          token: creatorSecret,
          method: 'GET',
        })
      ).status
    ).toBe(404);
  });

  test('a wrong or missing creator secret cannot read the reply', async () => {
    const { call } = setup();
    await mint(call);
    await call(`/v1/invites/${ID}/reply`, { body: { blob: 'sealed-age-key' } });
    expect(
      (await call(`/v1/invites/${ID}/reply`, { method: 'GET' })).status
    ).toBe(401);
    expect(
      (await call(`/v1/invites/${ID}/reply`, { token: 'wrong', method: 'GET' }))
        .status
    ).toBe(401);
  });
});

describe('DELETE /v1/invites/:id', () => {
  test('the creator revokes and the invite is gone for everyone', async () => {
    const { call } = setup();
    const { creatorSecret } = (await mint(call)).body!;
    expect(
      (
        await call(`/v1/invites/${ID}`, {
          token: creatorSecret,
          method: 'DELETE',
        })
      ).status
    ).toBe(204);
    expect((await call(`/v1/invites/${ID}`)).status).toBe(410);
    expect(
      (await call(`/v1/invites/${ID}/redeem`, { method: 'POST' })).status
    ).toBe(410);
  });

  test('a wrong secret is 401 and the invite survives', async () => {
    const { call } = setup();
    await mint(call);
    expect((await call(`/v1/invites/${ID}`, { method: 'DELETE' })).status).toBe(
      401
    );
    expect(
      (await call(`/v1/invites/${ID}`, { token: 'wrong', method: 'DELETE' }))
        .status
    ).toBe(401);
    expect((await call(`/v1/invites/${ID}`)).status).toBe(200);
  });

  test('an invite already gone is 404, which rt treats as success', async () => {
    const { call } = setup();
    const { creatorSecret } = (await mint(call)).body!;
    await call(`/v1/invites/${ID}`, { token: creatorSecret, method: 'DELETE' });
    expect(
      (
        await call(`/v1/invites/${ID}`, {
          token: creatorSecret,
          method: 'DELETE',
        })
      ).status
    ).toBe(404);
    const unknown = 'ffffffffffffffffffffffffffffffff';
    expect(
      (
        await call(`/v1/invites/${unknown}`, {
          token: creatorSecret,
          method: 'DELETE',
        })
      ).status
    ).toBe(404);
  });
});
