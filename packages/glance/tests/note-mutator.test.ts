#!/usr/bin/env bun
/**
 * NoteMutator's discussion and upload endpoints. Both are REST-only and both
 * differ from createNote in a way that matters to callers: POST /discussions
 * yields a RESOLVABLE thread (POST /notes does not), and POST /uploads is
 * multipart rather than JSON.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { NoteMutator } from '../src/NoteMutator.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stub(status: number, payload: unknown): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body,
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return calls;
}

describe('createDiscussion', () => {
  test('posts to /discussions and returns the thread id', async () => {
    const calls = stub(201, {
      id: 'abc123',
      notes: [{ id: 7, body: 'hi', resolvable: true, resolved: false }],
    });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const created = await m.createDiscussion(42, 9, 'hi');

    expect(created.id).toBe('abc123');
    expect(created.notes[0]!.id).toBe(7);
    expect(calls[0]!.url).toBe(
      'https://gitlab.example.com/api/v4/projects/42/merge_requests/9/discussions',
    );
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['PRIVATE-TOKEN']).toBe('tok');
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ body: 'hi' });
  });

  test('throws with status and response text on failure', async () => {
    stub(403, { message: 'forbidden' });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    await expect(m.createDiscussion(42, 9, 'hi')).rejects.toThrow(/403/);
  });
});

describe('uploadFile', () => {
  test('posts multipart to /uploads and returns the markdown path', async () => {
    const calls = stub(201, {
      alt: 'latch',
      url: '/uploads/ab12cd34/latch.png',
      full_path: '/acme/web/uploads/ab12cd34/latch.png',
      markdown: '![latch](/uploads/ab12cd34/latch.png)',
    });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const up = await m.uploadFile(42, 'latch.png', new Uint8Array([1, 2, 3]), 'image/png');

    expect(up.url).toBe('/uploads/ab12cd34/latch.png');
    expect(up.markdown).toBe('![latch](/uploads/ab12cd34/latch.png)');
    expect(calls[0]!.url).toBe('https://gitlab.example.com/api/v4/projects/42/uploads');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['PRIVATE-TOKEN']).toBe('tok');
    // Multipart: the body is FormData and Content-Type must NOT be set by hand,
    // or the boundary is lost.
    expect(calls[0]!.body).toBeInstanceOf(FormData);
    expect(calls[0]!.headers['Content-Type']).toBeUndefined();
  });

  test('throws with status on failure', async () => {
    stub(413, { message: 'too big' });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    await expect(
      m.uploadFile(42, 'latch.png', new Uint8Array([1]), 'image/png'),
    ).rejects.toThrow(/413/);
  });
});
