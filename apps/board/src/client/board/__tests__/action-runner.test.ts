import { expect, test } from 'bun:test';

import type { BoardMR } from '../../../data.ts';
import type { ActionResult } from '../../api.ts';
import {
  dispatchRowAction,
  mapLimit,
  runBulk,
  runMany,
  runOne,
  type RowHandlers,
  type RunnerDeps,
} from '../action-runner.ts';

const ok = (body: ActionResult['body'] = null): ActionResult => ({
  ok: true,
  status: 200,
  body,
  text: '',
});
const fail = (status: number, text = ''): ActionResult => ({
  ok: false,
  status,
  body: null,
  text,
});
const mr = (iid: number) =>
  ({
    iid,
    webUrl: `https://gitlab.example.com/acme/webapp/-/merge_requests/${iid}`,
  }) as BoardMR;

function fakeDeps(
  reply: (payload: Record<string, unknown>) => ActionResult = () => ok()
) {
  const events: string[] = [];
  const deps: RunnerDeps = {
    post: async (path, payload) => {
      events.push(`post ${path} ${JSON.stringify(payload)}`);
      return reply(payload);
    },
    launch: async (flow, m, opts) => {
      events.push(`launch ${flow} !${m.iid} ${JSON.stringify(opts)}`);
      return ok();
    },
    addToast: t => events.push(`toast ${t}`),
    reload: fresh => events.push(`reload ${fresh}`),
  };
  return { deps, events };
}

test('runOne merge: pending, post, done, fresh reload', async () => {
  const { deps, events } = fakeDeps();
  await runOne({ kind: 'mr', action: 'merge' }, mr(7), deps);
  expect(events).toEqual([
    'toast merging !7…',
    `post /mr/action {"mrUrl":"${mr(7).webUrl}","iid":7,"action":"merge"}`,
    'toast merge accepted !7',
    'reload true',
  ]);
});

test('runOne failure toasts the status and does not reload', async () => {
  const { deps, events } = fakeDeps(() => fail(409));
  await runOne({ kind: 'mr', action: 'setAutoMerge' }, mr(7), deps);
  expect(events.at(-1)).toBe("toast couldn't setAutoMerge !7 (409)");
  expect(events.some(e => e.startsWith('reload'))).toBe(false);
});

test('runOne draft words both directions', async () => {
  const a = fakeDeps();
  await runOne({ kind: 'draft', draft: false }, mr(7), a.deps);
  expect(a.events).toContain('toast marking !7 ready…');
  expect(a.events).toContain('toast !7 is ready for review');
  const b = fakeDeps();
  await runOne({ kind: 'draft', draft: true }, mr(7), b.deps);
  expect(b.events).toContain('toast !7 is back to draft');
});

test('runOne react has no pending toast and returns the reactions', async () => {
  const { deps, events } = fakeDeps(() => ok({ reactions: ['eyes'] }));
  const result = await runOne(
    { kind: 'react', emoji: 'eyes', glyph: '👀', remove: false },
    mr(7),
    deps
  );
  expect(events).toEqual([
    `post /slack/react {"mrUrl":"${mr(7).webUrl}","emoji":"eyes","remove":false}`,
    'toast marked 👀 on !7',
    'reload false',
  ]);
  expect(result?.body?.reactions).toEqual(['eyes']);
});

test('runOne find-thread says whether it found one', async () => {
  const a = fakeDeps(() => ok({ status: 'found' }));
  await runOne({ kind: 'find-thread' }, mr(7), a.deps);
  expect(a.events).toContain('toast found slack thread for !7');
  const b = fakeDeps(() => ok({ status: 'notfound' }));
  await runOne({ kind: 'find-thread' }, mr(7), b.deps);
  expect(b.events).toContain('toast no slack thread found for !7');
});

test("runOne ask prefers the server's refusal text, and says when it queued", async () => {
  const a = fakeDeps(() => fail(409, 'kim has no board on the switchboard'));
  await runOne({ kind: 'ask', ask: 'review', reviewer: 'kim' }, mr(7), a.deps);
  expect(a.events).toEqual([
    'toast requesting review of !7 from kim…',
    `post /nudge {"mrUrl":"${mr(7).webUrl}","iid":7,"reviewer":"kim","kind":"review"}`,
    'toast kim has no board on the switchboard',
  ]);
  const b = fakeDeps(() => ok({ queued: true }));
  await runOne({ kind: 'ask', ask: 'review', reviewer: 'kim' }, mr(7), b.deps);
  expect(b.events).toContain(
    'toast switchboard unreachable... queued the ask to kim'
  );
});

test('runOne launch hands off to the launch flow with the note and intent', async () => {
  const { deps, events } = fakeDeps();
  await runOne(
    { kind: 'launch', flow: 'review', intent: 'focus' },
    mr(7),
    deps,
    'look at the api'
  );
  expect(events).toEqual([
    'launch review !7 {"note":"look at the api","intent":"focus"}',
  ]);
});

test('runOne without a url does nothing', async () => {
  const { deps, events } = fakeDeps();
  const result = await runOne(
    { kind: 'find-thread' },
    { iid: 7, webUrl: null } as unknown as BoardMR,
    deps
  );
  expect(result).toBeUndefined();
  expect(events).toEqual([]);
});

test('runMany speaks once: what it did, what failed, then what it skipped', async () => {
  const { deps, events } = fakeDeps(p => (p.iid === 3 ? fail(409) : ok()));
  await runMany(
    { kind: 'mr', action: 'rebase' },
    [mr(1), mr(2), mr(3)],
    deps,
    1
  );
  expect(events.filter(e => e.startsWith('toast'))).toEqual([
    "toast rebase started on !1, !2 · couldn't rebase !3 (409) · 1 didn't need it",
  ]);
  expect(events.at(-1)).toBe('reload true');
});

test('runMany names the first four and counts the rest', async () => {
  const { deps, events } = fakeDeps();
  await runMany(
    { kind: 'mr', action: 'rebase' },
    [1, 2, 3, 4, 5, 6].map(mr),
    deps
  );
  expect(events).toContain('toast rebase started on !1, !2, !3, !4 +2 more');
});

test('runMany with zero targets does nothing: no toast, no reload', async () => {
  const { deps, events } = fakeDeps();
  await runMany({ kind: 'mr', action: 'rebase' }, [], deps);
  expect(events).toEqual([]);
});

test('runMany with every one failing lists them without a status', async () => {
  const { deps, events } = fakeDeps(() => fail(500));
  await runMany({ kind: 'mr', action: 'merge' }, [mr(1), mr(2)], deps);
  expect(events).toContain("toast couldn't merge !1, !2");
});

test('runMany launches quietly and reloads once', async () => {
  const { deps, events } = fakeDeps();
  await runMany({ kind: 'launch', flow: 'review' }, [mr(1), mr(2)], deps);
  expect(events).toEqual([
    'launch review !1 {"quiet":true}',
    'launch review !2 {"quiet":true}',
    'toast review started on !1, !2',
    'reload false',
  ]);
});

test('runMany keeps at most four requests in flight', async () => {
  let live = 0;
  let peak = 0;
  const deps: RunnerDeps = {
    post: async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise(resolve => setTimeout(resolve, 1));
      live--;
      return ok();
    },
    launch: async () => ok(),
    addToast: () => {},
    reload: () => {},
  };
  await runMany(
    { kind: 'mr', action: 'rebase' },
    [1, 2, 3, 4, 5, 6].map(mr),
    deps
  );
  expect(peak).toBe(4);
});

test('runMany find-thread says where it found a thread and where it did not', async () => {
  const { deps, events } = fakeDeps(p =>
    p.iid === 1 ? ok({ status: 'found' }) : ok({ status: 'notfound' })
  );
  await runMany({ kind: 'find-thread' }, [mr(1), mr(2)], deps);
  expect(events).toContain('toast slack thread found on !1 · no thread on !2');
});

test('mapLimit never runs more than the limit at once', async () => {
  let live = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async n => {
    live++;
    peak = Math.max(peak, live);
    await new Promise(resolve => setTimeout(resolve, 1));
    live--;
    return n * 2;
  });
  expect(peak).toBe(4);
  expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
});

test('runBulk asks the picked person only on the MRs they can take', async () => {
  const { deps, events } = fakeDeps();
  await runBulk(
    {
      request: { kind: 'ask', ask: 'review' },
      targets: [mr(1), mr(2), mr(3)],
      selected: 3,
      pickTargets: new Map([['kim', [mr(1), mr(3)]]]),
    },
    { pick: 'kim' },
    deps
  );
  expect(events.filter(e => e.startsWith('post'))).toEqual([
    `post /nudge {"mrUrl":"${mr(1).webUrl}","iid":1,"reviewer":"kim","kind":"review"}`,
    `post /nudge {"mrUrl":"${mr(3).webUrl}","iid":3,"reviewer":"kim","kind":"review"}`,
  ]);
  expect(events).toContain("toast asked kim on !1, !3 · 1 didn't need it");
});

test('runBulk says how many checked MRs did not need the action', async () => {
  const { deps, events } = fakeDeps();
  await runBulk(
    {
      request: { kind: 'launch', flow: 'doctor' },
      targets: [mr(7)],
      selected: 4,
    },
    {},
    deps
  );
  expect(events).toContain("toast doctor called on !7 · 3 didn't need it");
});

test('runBulk does nothing for an ask without a pick or a one-row request', () => {
  const { deps } = fakeDeps();
  expect(
    runBulk(
      { request: { kind: 'ask', ask: 'review' }, targets: [mr(1)] },
      {},
      deps
    )
  ).toBeUndefined();
  expect(
    runBulk({ request: { kind: 'copy' }, targets: [mr(1)] }, {}, deps)
  ).toBeUndefined();
});

test('dispatchRowAction routes one-row requests to their handlers', async () => {
  const calls: string[] = [];
  const h: RowHandlers = {
    copy: m => calls.push(`copy !${m.iid}`),
    note: m => calls.push(`note !${m.iid}`),
    open: url => calls.push(`open ${url}`),
    viewReport: (m, lane) => calls.push(`view ${lane} !${m.iid}`),
    dismiss: (m, lane) => calls.push(`dismiss ${lane} !${m.iid}`),
    standDown: (m, on) => calls.push(`stand-down ${on} !${m.iid}`),
    postSlack: m => calls.push(`post !${m.iid}`),
  };
  const { deps, events } = fakeDeps();
  dispatchRowAction({ kind: 'copy' }, mr(7), {}, deps, h);
  dispatchRowAction({ kind: 'open', url: '' }, mr(7), {}, deps, h);
  dispatchRowAction(
    { kind: 'open', url: 'https://x.example' },
    mr(7),
    {},
    deps,
    h
  );
  dispatchRowAction(
    { kind: 'view-report', lane: 'respond' },
    mr(7),
    {},
    deps,
    h
  );
  dispatchRowAction({ kind: 'stand-down', on: true }, mr(7), {}, deps, h);
  await dispatchRowAction(
    { kind: 'ask', ask: 'review' },
    mr(7),
    { pick: 'jo' },
    deps,
    h
  );
  expect(calls).toEqual([
    'copy !7',
    'open https://x.example',
    'view respond !7',
    'stand-down true !7',
  ]);
  expect(events).toContain(
    `post /nudge {"mrUrl":"${mr(7).webUrl}","iid":7,"reviewer":"jo","kind":"review"}`
  );
});
