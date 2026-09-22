import { expect, test } from 'bun:test';

import { postAction } from '../client/api.ts';
import { runLaunchFlow } from '../client/board/launch-flow.ts';

test('postAction returns typed non-ok without throwing', async () => {
  const r = await postAction(
    '/x',
    {},
    (async () =>
      new Response('nope', { status: 502 })) as unknown as typeof fetch
  );
  expect(r).toMatchObject({ ok: false, status: 502, text: 'nope' });
});
test('postAction swallows network errors as status 0', async () => {
  const r = await postAction('/x', {}, (async () => {
    throw new Error('down');
  }) as unknown as typeof fetch);
  expect(r).toMatchObject({ ok: false, status: 0, body: null });
});
test('launch flow: ok path toasts launch then focused, reloads, no rollback', async () => {
  const events: string[] = [];
  await runLaunchFlow(
    {
      post: async () => ({
        ok: true,
        status: 200,
        body: { focused: true },
        text: '',
      }),
      setQueued: () => events.push('queued'),
      rollback: () => events.push('rollback'),
      addToast: t => events.push(`toast:${t}`),
      reload: () => events.push('reload'),
      verbing: 'launching review',
      noun: 'review',
    },
    { webUrl: 'u', iid: 7 } as never,
    {}
  );
  expect(events).toEqual([
    'queued',
    'toast:launching review for !7…',
    'toast:review already running for !7 — focused its tab',
    'reload',
  ]);
});
test('launch flow: non-ok rolls back and toasts the status', async () => {
  const events: string[] = [];
  await runLaunchFlow(
    {
      post: async () => ({ ok: false, status: 502, body: null, text: '' }),
      setQueued: () => events.push('queued'),
      rollback: () => events.push('rollback'),
      addToast: t => events.push(`toast:${t}`),
      reload: () => events.push('reload'),
      verbing: 'launching review',
      noun: 'review',
    },
    { webUrl: 'u', iid: 7 } as never,
    {}
  );
  expect(events).toEqual([
    'queued',
    'toast:launching review for !7…',
    'rollback',
    "toast:couldn't launch review for !7 (502)",
  ]);
});
test('launch flow: failureMessage override replaces the default failure toast', async () => {
  const events: string[] = [];
  await runLaunchFlow(
    {
      post: async () => ({
        ok: false,
        status: 400,
        body: null,
        text: 'no session id on file',
      }),
      setQueued: () => events.push('queued'),
      rollback: () => events.push('rollback'),
      addToast: t => events.push(`toast:${t}`),
      reload: () => events.push('reload'),
      verbing: 'resuming review',
      noun: 'review',
      failureMessage: (result, mr) =>
        `resume review failed for !${mr.iid} (${result.status}): ${result.text}`,
    },
    { webUrl: 'u', iid: 7 } as never,
    {}
  );
  expect(events).toEqual([
    'queued',
    'toast:resuming review for !7…',
    'rollback',
    'toast:resume review failed for !7 (400): no session id on file',
  ]);
});
test('launch flow: focus intent skips queued and launch toast, toasts the focus', async () => {
  const events: string[] = [];
  await runLaunchFlow(
    {
      post: async () => ({
        ok: true,
        status: 200,
        body: { focused: true },
        text: '',
      }),
      setQueued: () => events.push('queued'),
      rollback: () => events.push('rollback'),
      addToast: t => events.push(`toast:${t}`),
      reload: () => events.push('reload'),
      verbing: 'calling doctor',
      noun: 'doctor',
    },
    { webUrl: 'u', iid: 7 } as never,
    {},
    'focus'
  );
  expect(events).toEqual(['toast:focused doctor tab for !7', 'reload']);
});
test('launch flow: focus intent posts focus:true, and a refusal toasts the server text and reloads', async () => {
  const events: string[] = [];
  let posted: Record<string, unknown> | undefined;
  await runLaunchFlow(
    {
      post: async payload => {
        posted = payload;
        return { ok: false, status: 409, body: null, text: 'pane is gone' };
      },
      setQueued: () => events.push('queued'),
      rollback: () => events.push('rollback'),
      addToast: t => events.push(`toast:${t}`),
      reload: () => events.push('reload'),
      verbing: 'calling doctor',
      noun: 'doctor',
    },
    { webUrl: 'u', iid: 7 } as never,
    {},
    'focus'
  );
  expect(posted).toEqual({ mrUrl: 'u', iid: 7, focus: true });
  expect(events).toEqual([
    "toast:couldn't focus doctor pane for !7: pane is gone",
    'reload',
  ]);
});
test('launch flow: a launch never sends focus:true', async () => {
  let posted: Record<string, unknown> | undefined;
  await runLaunchFlow(
    {
      post: async payload => {
        posted = payload;
        return { ok: true, status: 200, body: {}, text: '' };
      },
      setQueued: () => {},
      rollback: () => {},
      addToast: () => {},
      reload: () => {},
      verbing: 'calling doctor',
      noun: 'doctor',
    },
    { webUrl: 'u', iid: 7 } as never,
    { mode: 'rebase' }
  );
  expect(posted).toEqual({ mrUrl: 'u', iid: 7, mode: 'rebase' });
});
test('launch flow returns the server result', async () => {
  const reply = { ok: true, status: 200, body: null, text: '' };
  const result = await runLaunchFlow(
    {
      post: async () => reply,
      setQueued: () => {},
      rollback: () => {},
      addToast: () => {},
      reload: () => {},
      verbing: 'launching review',
      noun: 'review',
    },
    { webUrl: 'u', iid: 7 } as never,
    {}
  );
  expect(result).toBe(reply);
});
