import { expect, test } from 'bun:test';

import { bulkActions, rowActions } from '../row-actions.ts';
import {
  actionEnvOf,
  busyEnv,
  failedEnv,
  failedLanes,
  mrx,
  ownBusy,
  ownEnv,
  ownIdle,
  teammateReviewed,
} from './menu-fixtures.ts';

const keys = (mr: typeof ownIdle, env: typeof ownEnv) =>
  rowActions(mr, actionEnvOf(env, mr)).map(a => a.key);

test('an idle own MR offers these actions, in menu order', () => {
  expect(keys(ownIdle, ownEnv)).toEqual([
    'review',
    'respond',
    'rebase-local',
    'stand-down',
    'request-review',
    'merge',
    'rebase',
    'setAutoMerge',
    'mark-draft',
    'open-gitlab',
    'find-thread',
    'post-slack',
    'copy',
    'note',
  ]);
});

test("a teammate's reviewed MR with a found thread", () => {
  expect(keys(teammateReviewed, ownEnv)).toEqual([
    're-review',
    'resume-review',
    'view-review',
    'ask-respond',
    'open-gitlab',
    'react-eyes',
    'react-speech_balloon',
    'unreact-white_check_mark',
    'open-slack-post',
    'copy',
    'note',
  ]);
});

test('a remote board keeps the stand-down toggle and the local-free items', () => {
  expect(keys(ownIdle, { ...ownEnv, local: false })).toEqual([
    'stand-down',
    'open-gitlab',
    'copy',
    'note',
  ]);
});

test('only the bulk-capable actions carry a bulk label', () => {
  const bulk = Object.fromEntries(
    rowActions(ownIdle, actionEnvOf(ownEnv, ownIdle))
      .filter(a => a.bulk)
      .map(a => [a.key, a.bulk])
  );
  expect(bulk).toEqual({
    review: 'review',
    'request-review': 'request review from…',
    merge: 'merge',
    rebase: 'rebase on target',
    setAutoMerge: 'set auto-merge',
    'mark-draft': 'mark as draft',
    'find-thread': 'find slack threads',
  });
});

test('running lanes focus their pane and carry no note or bulk', () => {
  const actions = rowActions(ownBusy, actionEnvOf(busyEnv, ownBusy));
  const focusReview = actions.find(a => a.key === 'focus-review');
  expect(focusReview?.request).toEqual({
    kind: 'launch',
    flow: 'review',
    intent: 'focus',
  });
  expect(focusReview?.notable).toBeUndefined();
  expect(focusReview?.bulk).toBeUndefined();
  expect(actions.find(a => a.key === 'focus-respond')?.label).toBe(
    'relaunch response'
  );
  expect(actions.find(a => a.key === 'doctor')).toMatchObject({
    label: 'call doctor',
    lane: 'doctor',
    notable: true,
    bulk: 'call doctor',
    request: { kind: 'launch', flow: 'doctor' },
  });
  expect(actions.find(a => a.key === 'stand-down')?.label).toBe(
    'auto-doctor: ignore this stack'
  );
});

test('merge arms before it fires; a slack mark stays open and knows its state', () => {
  const idle = rowActions(ownIdle, actionEnvOf(ownEnv, ownIdle));
  expect(idle.find(a => a.key === 'merge')?.confirm).toBe('really merge?');
  const mates = rowActions(
    teammateReviewed,
    actionEnvOf(ownEnv, teammateReviewed)
  );
  expect(mates.find(a => a.key === 'unreact-white_check_mark')).toMatchObject({
    label: 'unmark approved',
    marked: true,
    keepOpen: true,
    glyph: { kind: 'emoji', glyph: '✅' },
    request: {
      kind: 'react',
      emoji: 'white_check_mark',
      glyph: '✅',
      remove: true,
    },
  });
});

test('request review from… carries its picker; asks name their reviewer', () => {
  const actions = rowActions(failedLanes, actionEnvOf(failedEnv, failedLanes));
  expect(actions.find(a => a.key === 'request-review')).toMatchObject({
    request: { kind: 'ask', ask: 'review' },
    pick: {
      title: 'request review from',
      aria: 'request review',
      options: [{ value: 'jo' }],
    },
  });
  expect(actions.find(a => a.key === 'nudge-kim')?.request).toEqual({
    kind: 'ask',
    ask: 're-review',
    reviewer: 'kim',
  });
  expect(
    actions.filter(a => a.key.startsWith('dismiss-')).map(a => a.key)
  ).toEqual(['dismiss-review', 'dismiss-doctor']);
});

const visible = { visible: true, disabled: false, loading: false };
const env3 = (allMrs: ReturnType<typeof mrx>[]) => ({
  local: true,
  slackEnabled: true,
  self: 'pat',
  roster: ['pat', 'kim', 'jo'],
  allMrs,
});
const a = mrx(201, { mergeButton: visible, behindTarget: 2 });
const b = mrx(202, { mergeButton: visible, isDraft: true });
const c = mrx(203, {
  author: { username: 'kim', name: 'Kim' },
  blockers: { any: true, pipelineFailing: true },
});

test('bulk shows only what fits every checked MR, in the mock order, with no counts', () => {
  const entries = bulkActions([a, b, c], env3([a, b, c]));
  expect(entries.map(e => `${e.key} | ${e.label}`)).toEqual([
    'review | review',
    'doctor | call doctor',
    'rebase | rebase on target',
    'find-thread | find slack threads',
  ]);
  expect(entries.every(e => e.hint === undefined)).toBe(true);
});

test('an action acts on the MRs that need it and skips the ones already there', () => {
  const entries = bulkActions([a, b, c], env3([a, b, c]));
  const byKey = Object.fromEntries(
    entries.map(e => [e.key, e.targets.map(t => t.iid)])
  );
  expect(byKey.review).toEqual([201, 202, 203]);
  expect(byKey.doctor).toEqual([203]);
  expect(byKey.rebase).toEqual([201]);
  expect(entries.every(e => e.selected === 3)).toBe(true);
});

test('one checked MR that cannot take an action hides it', () => {
  const keys = bulkActions([a, b, c], env3([a, b, c])).map(e => e.key);
  for (const k of ['merge', 'request-review', 'mark-ready', 'mark-draft'])
    expect(keys).not.toContain(k);
});

test('merge always confirms; launches confirm only past three', () => {
  const m1 = mrx(211, { mergeButton: visible });
  const m2 = mrx(212, { mergeButton: visible });
  const four = [a, b, m1, m2];
  const entries = bulkActions(four, env3(four));
  expect(entries.find(e => e.key === 'merge')?.confirm).toBe('really merge 4?');
  expect(entries.find(e => e.key === 'review')?.confirm).toBe(
    'really start 4 reviews?'
  );
  const three = bulkActions([a, b, m1], env3([a, b, m1]));
  expect(three.find(e => e.key === 'review')?.confirm).toBeUndefined();
});

test('nothing fits when no checked MR needs any bulk action', () => {
  const running = (iid: number) =>
    mrx(iid, {
      author: { username: 'kim', name: 'Kim' },
      review: { status: 'reviewing' },
    });
  const r1 = running(214);
  const r2 = running(215);
  const env = { ...env3([r1, r2]), slackEnabled: false };
  expect(bulkActions([r1, r2], env)).toEqual([]);
});

test('a remote board has no bulk actions', () => {
  expect(bulkActions([a, b], { ...env3([a, b]), local: false })).toEqual([]);
});

test('a checked MR stacked on an open MR blocks merge for the selection', () => {
  const child = mrx(205, {
    isStacked: true,
    targetBranch: 'f-201',
    mergeButton: visible,
  });
  const all = [a, b, c, child];
  const blocked = bulkActions([b, child], env3(all)).find(
    e => e.key === 'merge'
  );
  expect(blocked?.blocked).toBe('!205 sits on !201, which is still open');
  const parentGone = bulkActions([b, child], env3([b, c, child])).find(
    e => e.key === 'merge'
  );
  expect(parentGone?.blocked).toBeUndefined();
});

test('mark wins over unmark until every checked thread has the mark', () => {
  const found = (iid: number, reactions: string[]) =>
    mrx(iid, { slack: { status: 'found', reactions, posted: true } });
  const e = found(206, ['eyes']);
  const f = found(207, []);
  const mixed = bulkActions([e, f], env3([e, f])).map(x => x.key);
  expect(mixed).toContain('react-eyes');
  expect(mixed).not.toContain('unreact-eyes');
  expect(
    bulkActions([e, f], env3([e, f]))
      .find(x => x.key === 'react-eyes')
      ?.targets.map(t => t.iid)
  ).toEqual([207]);
  const g = found(208, ['eyes']);
  const both = bulkActions([e, g], env3([e, g]));
  expect(both.find(x => x.key === 'unreact-eyes')?.label).toBe(
    'unmark looking'
  );
  expect(both.map(x => x.key)).not.toContain('react-eyes');
});

test('a checked MR with no slack thread hides the marks but not the lookup', () => {
  const found = mrx(216, {
    slack: { status: 'found', reactions: [], posted: true },
  });
  const missing = mrx(217, {
    slack: { status: 'notfound', reactions: [], posted: false },
  });
  const entries = bulkActions([found, missing], env3([found, missing]));
  expect(entries.filter(x => x.key.includes('react-'))).toEqual([]);
  expect(
    entries.find(x => x.key === 'find-thread')?.targets.map(t => t.iid)
  ).toEqual([217]);
});

test('bulk slack marks follow the ladder, not first-seen order', () => {
  const found = (iid: number, reactions: string[]) =>
    mrx(iid, { slack: { status: 'found', reactions, posted: true } });
  const h = found(209, ['eyes']);
  const i = found(210, []);
  const slackKeys = bulkActions([h, i], env3([h, i]))
    .filter(e => e.section === 'slack')
    .map(e => e.key);
  expect(slackKeys).toEqual([
    'react-eyes',
    'react-speech_balloon',
    'react-white_check_mark',
  ]);
});

test('request review from… lists each person once, asked only where they are not already on it', () => {
  const entry = bulkActions([a, b], env3([a, b])).find(
    e => e.key === 'request-review'
  );
  expect(entry?.pick?.options).toEqual([{ value: 'kim' }, { value: 'jo' }]);
  expect(entry?.pickTargets?.get('kim')?.map(t => t.iid)).toEqual([201, 202]);
  const kimOn = mrx(213, {
    peerReviews: [
      {
        mrUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/213',
        iid: 213,
        reviewer: 'kim',
        status: 'reviewing',
        updatedAt: 1,
      },
    ],
  });
  const mixed = bulkActions([a, kimOn], env3([a, kimOn])).find(
    e => e.key === 'request-review'
  );
  expect(mixed?.pickTargets?.get('kim')?.map(t => t.iid)).toEqual([201]);
  expect(mixed?.pickTargets?.get('jo')?.map(t => t.iid)).toEqual([201, 213]);
});

test('one-row-only actions never reach the bulk menu', () => {
  const keys = bulkActions([a, b, c], env3([a, b, c])).map(e => e.key);
  for (const k of [
    'respond',
    'rebase-local',
    'stand-down',
    'open-gitlab',
    'post-slack',
    'copy',
    'note',
  ])
    expect(keys).not.toContain(k);
});
