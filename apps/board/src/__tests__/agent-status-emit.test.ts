import { describe, expect, test } from 'bun:test';

import { emitAgentStatus, type EmitIo } from '../agent-status/emit.ts';

const SIGNAL = {
  mrUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/4821',
  iid: 4821,
  kind: 'review' as const,
  status: 'done',
  outcome: 'comment',
};

function fakeIo(
  emit: EmitIo['emit']
): EmitIo & { lines: string[]; calls: { topic: string; payload: unknown }[] } {
  const lines: string[] = [];
  const calls: { topic: string; payload: unknown }[] = [];
  return {
    emit: (topic, payload) => {
      calls.push({ topic, payload });
      return emit(topic, payload);
    },
    appRoot: '/Users/dev/board',
    log: line => lines.push(line),
    lines,
    calls,
  };
}

const accepted = async () => ({ ok: true });

describe('emitAgentStatus', () => {
  test('emits on the kind topic with the signal plus this board root', async () => {
    const io = fakeIo(accepted);
    await emitAgentStatus(SIGNAL, io);
    expect(io.calls).toEqual([
      {
        topic: 'board/agent-status/review',
        payload: { ...SIGNAL, appRoot: '/Users/dev/board' },
      },
    ]);
    expect(io.lines).toEqual([]);
  });

  test('respond and doctor land on their own topics', async () => {
    const io = fakeIo(accepted);
    await emitAgentStatus({ ...SIGNAL, kind: 'respond' }, io);
    await emitAgentStatus(
      { ...SIGNAL, kind: 'doctor', outcome: undefined },
      io
    );
    expect(io.calls.map(c => c.topic)).toEqual([
      'board/agent-status/respond',
      'board/agent-status/doctor',
    ]);
  });

  test('skips the emit entirely when there is no mrUrl to act on', async () => {
    const io = fakeIo(accepted);
    await emitAgentStatus({ ...SIGNAL, mrUrl: '' }, io);
    expect(io.calls).toEqual([]);
  });

  test('a refused emit resolves and logs one line', async () => {
    const io = fakeIo(async () => ({ ok: false, error: 'daemon unreachable' }));
    await expect(emitAgentStatus(SIGNAL, io)).resolves.toBeUndefined();
    expect(io.lines).toEqual(['agent-status emit refused: daemon unreachable']);
  });

  test('a throwing emit resolves and logs one line', async () => {
    const io = fakeIo(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(emitAgentStatus(SIGNAL, io)).resolves.toBeUndefined();
    expect(io.lines).toEqual(['agent-status emit failed: ECONNREFUSED']);
  });
});
