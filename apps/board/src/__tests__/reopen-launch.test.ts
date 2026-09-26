import { describe, expect, test } from 'bun:test';

import type { AgentLaunchResult } from '../agent-launch.ts';
import {
  launchReopen,
  type ReopenCtx,
  type ReopenIo,
  type ReopenStatePatch,
} from '../reopen-launch.ts';

const MR_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

function baseCtx(overrides: Partial<ReopenCtx> = {}): ReopenCtx {
  return {
    mrUrl: MR_URL,
    iid: 4821,
    cwd: '/tmp/reviews',
    repo: 'gh-acme-webapp',
    workspaceLabel: 'reviews',
    workspaceKind: 'review',
    statePath: '/tmp/state/review-4821.json',
    prompt: 'welcome back',
    author: 'alice',
    tabLabel: '!4821 alice ↺',
    claudeCommand: undefined,
    ...overrides,
  };
}

function paneResult(
  overrides: Partial<AgentLaunchResult> = {}
): AgentLaunchResult {
  return {
    agentId: 'agent-2',
    sessionId: 'sess-2',
    paneId: 'pane-3',
    tabId: 'tab-9',
    workspaceId: 'ws-1',
    focusedExisting: false,
    ...overrides,
  };
}

function makeIo(overrides: Partial<ReopenIo> = {}) {
  const writes: Array<{ path: string; patch: ReopenStatePatch; now?: number }> =
    [];
  const errors: string[] = [];
  const legacyCalls: Array<Record<string, unknown>> = [];
  const io: ReopenIo = {
    resumeAgentPane: async () => paneResult(),
    launchLegacyResume: async opts => {
      legacyCalls.push(opts as unknown as Record<string, unknown>);
      return { tabId: 'tab-9', workspaceId: 'ws-1' };
    },
    writeState: (path, patch, now) => {
      writes.push({ path, patch, now });
    },
    logError: message => {
      errors.push(message);
    },
    ...overrides,
  };
  return { io, writes, errors, legacyCalls };
}

describe('launchReopen', () => {
  test('an agentId on file resumes through the agent daemon and stamps reopenedAt with the write clock', async () => {
    const { io, writes } = makeIo();
    const result = await launchReopen(
      { status: 'done', agentId: 'agent-1' },
      baseCtx(),
      io
    );
    expect(result).toEqual({ kind: 'resumed' });
    expect(writes).toHaveLength(1);
    const write = writes[0]!;
    expect(write.path).toBe('/tmp/state/review-4821.json');
    expect(write.patch.status).toBe('done');
    expect(write.patch.tabId).toBe('tab-9');
    expect(write.patch.workspaceId).toBe('ws-1');
    expect(write.patch.agentId).toBe('agent-2');
    expect(write.patch.paneId).toBe('pane-3');
    expect(write.patch.reopenedAt).toBeDefined();
    expect(write.now).toBe(write.patch.reopenedAt!);
  });

  test('the write preserves the existing status rather than forcing done', async () => {
    const { io, writes } = makeIo();
    await launchReopen({ status: 'error', agentId: 'agent-1' }, baseCtx(), io);
    expect(writes[0]!.patch.status).toBe('error');
  });

  test('a focused existing pane writes nothing', async () => {
    const { io, writes } = makeIo({
      resumeAgentPane: async () => paneResult({ focusedExisting: true }),
    });
    const result = await launchReopen(
      { status: 'done', agentId: 'agent-1' },
      baseCtx(),
      io
    );
    expect(result).toEqual({ kind: 'resumed' });
    expect(writes).toEqual([]);
  });

  test('a bare sessionId resumes the legacy way and stamps reopenedAt with the write clock', async () => {
    const { io, writes, legacyCalls } = makeIo();
    const result = await launchReopen(
      { status: 'done', sessionId: 'sess-1' },
      baseCtx({ workspaceKind: 'respond', claudeCommand: 'claude-next' }),
      io
    );
    expect(result).toEqual({ kind: 'resumed' });
    expect(legacyCalls).toHaveLength(1);
    expect(legacyCalls[0]).toMatchObject({
      mrUrl: MR_URL,
      sessionId: 'sess-1',
      workspaceKind: 'respond',
      prompt: 'welcome back',
      claudeCommand: 'claude-next',
    });
    const write = writes[0]!;
    expect(write.patch.status).toBe('done');
    expect(write.patch.tabId).toBe('tab-9');
    expect(write.patch.workspaceId).toBe('ws-1');
    expect(write.patch.reopenedAt).toBeDefined();
    expect(write.now).toBe(write.patch.reopenedAt!);
  });

  test('neither agentId nor sessionId is no-session, with no launch and no write', async () => {
    const { io, writes, legacyCalls } = makeIo();
    const result = await launchReopen({ status: 'done' }, baseCtx(), io);
    expect(result).toEqual({ kind: 'no-session' });
    expect(writes).toEqual([]);
    expect(legacyCalls).toEqual([]);
  });

  test('a failing agent resume logs and leaves state untouched', async () => {
    const { io, writes, errors } = makeIo({
      resumeAgentPane: async () => {
        throw new Error('daemon down');
      },
    });
    const result = await launchReopen(
      { status: 'done', agentId: 'agent-1' },
      baseCtx(),
      io
    );
    expect(result).toEqual({ kind: 'error', message: 'daemon down' });
    expect(errors).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  test('a failing legacy resume logs and leaves state untouched', async () => {
    const { io, writes, errors } = makeIo({
      launchLegacyResume: async () => {
        throw new Error('herdr gone');
      },
    });
    const result = await launchReopen(
      { status: 'done', sessionId: 'sess-1' },
      baseCtx(),
      io
    );
    expect(result).toEqual({ kind: 'error', message: 'herdr gone' });
    expect(errors).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  test('an agentId wins over a sessionId when both are on file', async () => {
    const { io, legacyCalls, writes } = makeIo();
    await launchReopen(
      { status: 'done', agentId: 'agent-1', sessionId: 'sess-1' },
      baseCtx(),
      io
    );
    expect(legacyCalls).toEqual([]);
    expect(writes).toHaveLength(1);
  });
});
