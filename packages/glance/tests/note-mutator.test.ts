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

describe('createNote', () => {
  test('normalizes a missing type field to null', async () => {
    stub(201, { id: 5, body: 'hi', resolvable: null, resolved: null });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const created = await m.createNote(42, 9, 'hi');
    expect(created.type).toBeNull();
  });
});

describe('fetchDiffRefs', () => {
  test('gets the MR and returns diff_refs', async () => {
    const calls = stub(200, {
      diff_refs: { base_sha: 'b', start_sha: 's', head_sha: 'h' },
    });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const refs = await m.fetchDiffRefs(42, 9);

    expect(refs).toEqual({ base_sha: 'b', start_sha: 's', head_sha: 'h' });
    expect(calls[0]!.url).toBe(
      'https://gitlab.example.com/api/v4/projects/42/merge_requests/9',
    );
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers['PRIVATE-TOKEN']).toBe('tok');
  });

  test('throws a descriptive error when diff_refs is missing', async () => {
    stub(200, { diff_refs: null });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    await expect(m.fetchDiffRefs(42, 9)).rejects.toThrow(
      /merge request !9 in project 42 has no diff_refs/,
    );
  });

  test('throws with status on failure', async () => {
    stub(404, { message: 'not found' });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    await expect(m.fetchDiffRefs(42, 9)).rejects.toThrow(/404/);
  });
});

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

  test('normalizes a note missing type to null', async () => {
    stub(201, {
      id: 'abc123',
      notes: [{ id: 7, body: 'hi', resolvable: true, resolved: false }],
    });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const created = await m.createDiscussion(42, 9, 'hi');
    expect(created.notes[0]!.type).toBeNull();
  });
});

describe('createPositionedDiscussion', () => {
  test('posts body and position as nested JSON', async () => {
    const calls = stub(201, {
      id: 'disc1',
      notes: [{ id: 11, body: 'nice catch', resolvable: true, resolved: false }],
    });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const position = {
      position_type: 'text' as const,
      new_path: 'src/foo.ts',
      new_line: 42,
      old_path: 'src/foo.ts',
      old_line: 40,
      base_sha: 'b',
      start_sha: 's',
      head_sha: 'h',
    };
    const created = await m.createPositionedDiscussion(42, 9, 'nice catch', position);

    expect(created.id).toBe('disc1');
    expect(calls[0]!.url).toBe(
      'https://gitlab.example.com/api/v4/projects/42/merge_requests/9/discussions',
    );
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['Content-Type']).toBe('application/json');
    expect(calls[0]!.headers['PRIVATE-TOKEN']).toBe('tok');
    expect(JSON.parse(String(calls[0]!.body))).toEqual({
      body: 'nice catch',
      position,
    });
  });

  test('posts a removed-line position with old_line and no new_line', async () => {
    const calls = stub(201, {
      id: 'disc1',
      notes: [{ id: 11, body: 'stale comment', resolvable: true, resolved: false }],
    });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const position = {
      position_type: 'text' as const,
      new_path: 'src/foo.ts',
      old_path: 'src/foo.ts',
      old_line: 40,
      base_sha: 'b',
      start_sha: 's',
      head_sha: 'h',
    };
    const created = await m.createPositionedDiscussion(42, 9, 'stale comment', position);

    expect(created.id).toBe('disc1');
    expect(JSON.parse(String(calls[0]!.body))).toEqual({
      body: 'stale comment',
      position,
    });
  });

  test('throws with status on failure', async () => {
    stub(422, { message: 'position out of range' });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const position = {
      position_type: 'text' as const,
      new_path: 'src/foo.ts',
      new_line: 42,
      old_path: 'src/foo.ts',
      base_sha: 'b',
      start_sha: 's',
      head_sha: 'h',
    };
    await expect(
      m.createPositionedDiscussion(42, 9, 'nice catch', position),
    ).rejects.toThrow(/422/);
  });

  const notePosition = {
    position_type: 'text' as const,
    new_path: 'src/foo.ts',
    new_line: 42,
    old_path: 'src/foo.ts',
    base_sha: 'b',
    start_sha: 's',
    head_sha: 'h',
  };

  test('surfaces type "DiffNote" as-is, the caller\'s signal a position landed', async () => {
    stub(201, {
      id: 'disc1',
      notes: [{ id: 11, body: 'nice catch', resolvable: true, resolved: false, type: 'DiffNote' }],
    });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const created = await m.createPositionedDiscussion(42, 9, 'nice catch', notePosition);
    expect(created.notes[0]!.type).toBe('DiffNote');
  });

  test('keeps an explicit null type as null', async () => {
    stub(201, {
      id: 'disc2',
      notes: [{ id: 12, body: 'nice catch', resolvable: true, resolved: false, type: null }],
    });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const created = await m.createPositionedDiscussion(42, 9, 'nice catch', notePosition);
    expect(created.notes[0]!.type).toBeNull();
  });

  test('normalizes a missing type field to null, never undefined', async () => {
    stub(201, {
      id: 'disc3',
      notes: [{ id: 13, body: 'nice catch', resolvable: true, resolved: false }],
    });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const created = await m.createPositionedDiscussion(42, 9, 'nice catch', notePosition);
    expect(created.notes[0]!.type).toBeNull();
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
