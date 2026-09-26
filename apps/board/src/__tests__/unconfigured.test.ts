import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import type { getSetting } from '@mattstack/rt-client';
import { boardConfiguredAt } from '../config.ts';
import { serveUnconfigured, unconfiguredResponse } from '../unconfigured.ts';

type GetSettingFn = typeof getSetting;

function fakeResolve(values: Record<string, unknown>): GetSettingFn {
  return (<T>(key: string) => ({
    value: values[key] as T,
    provenance: [],
  })) as GetSettingFn;
}

const throwingResolve = (() => {
  throw new Error('store unreadable');
}) as unknown as GetSettingFn;

const STORE_OWNED = {
  'board.gitlabHost': 'https://gitlab.com',
  'board.projects': ['group/project'],
  'board.members': [{ username: 'someone' }],
};

describe('boardConfiguredAt', () => {
  test('a readable config file counts as configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-cfg-'));
    const path = join(dir, 'config.json');
    writeFileSync(path, '{}');
    expect(boardConfiguredAt(path, fakeResolve({}))).toBe(true);
  });

  test('no file and a store owning every required field counts as configured', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'board-cfg-')), 'config.json');
    expect(boardConfiguredAt(path, fakeResolve(STORE_OWNED))).toBe(true);
  });

  test('no file and an empty store is not configured', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'board-cfg-')), 'config.json');
    expect(boardConfiguredAt(path, fakeResolve({}))).toBe(false);
  });

  test('no file and a store missing the roster is not configured', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'board-cfg-')), 'config.json');
    const { 'board.members': _, ...partial } = STORE_OWNED;
    expect(boardConfiguredAt(path, fakeResolve(partial))).toBe(false);
  });

  test('no file and an empty roster in the store is not configured', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'board-cfg-')), 'config.json');
    expect(
      boardConfiguredAt(
        path,
        fakeResolve({ ...STORE_OWNED, 'board.members': [] })
      )
    ).toBe(false);
  });

  test('no file and an unreadable store is not configured', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'board-cfg-')), 'config.json');
    expect(boardConfiguredAt(path, throwingResolve)).toBe(false);
  });
});

describe('unconfiguredResponse', () => {
  test('healthz answers ok so deck reads the app as serving', async () => {
    const res = unconfiguredResponse(new Request('http://127.0.0.1/healthz'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: false });
  });

  test('the root page explains how to set board up', async () => {
    const res = unconfiguredResponse(new Request('http://127.0.0.1/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain("Board isn't set up yet");
    expect(body).toContain('board.members');
    expect(body).toContain("fetch('/healthz'");
    expect(body).toContain('location.reload()');
  });

  test('api routes answer 503 rather than an HTML page', async () => {
    const res = unconfiguredResponse(new Request('http://127.0.0.1/api/badge'));
    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toEqual({
      error: 'board is not set up yet',
    });
  });
});

describe('serveUnconfigured', () => {
  test('serves until configured, then stops and exits 0 so launchd restarts the real board', async () => {
    let configured = false;
    const exits: number[] = [];
    const handle = serveUnconfigured({
      port: 0,
      pollMs: 20,
      isConfigured: () => configured,
      exit: code => exits.push(code),
    });
    const res = await fetch(`http://127.0.0.1:${handle.port}/healthz`);
    expect(res.status).toBe(200);
    expect(exits).toEqual([]);

    configured = true;
    await Bun.sleep(120);
    expect(exits).toEqual([0]);
    await expect(
      fetch(`http://127.0.0.1:${handle.port}/healthz`)
    ).rejects.toThrow();
  });

  test('a throwing configured check keeps serving instead of crashing', async () => {
    const exits: number[] = [];
    const handle = serveUnconfigured({
      port: 0,
      pollMs: 20,
      isConfigured: () => {
        throw new Error('boom');
      },
      exit: code => exits.push(code),
    });
    await Bun.sleep(80);
    expect(exits).toEqual([]);
    const res = await fetch(`http://127.0.0.1:${handle.port}/healthz`);
    expect(res.status).toBe(200);
    handle.stop();
  });
});
