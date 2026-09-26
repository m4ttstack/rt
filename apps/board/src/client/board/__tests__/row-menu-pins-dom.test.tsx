/** Pins of the one-row menu as it stands before the shared action model:
    what each MR state shows and what each click does. These must pass
    unchanged while RowMenu moves onto ActionMenu. */
import { expect, test } from 'bun:test';

import {
  busyEnv,
  failedEnv,
  failedLanes,
  ownBusy,
  ownEnv,
  ownIdle,
  teammateReviewed,
} from './menu-fixtures.ts';
import {
  clickEach,
  clickItem,
  flush,
  harness,
  itemTexts,
  menuLines,
  openMenu,
  typeNote,
  useMenuHarness,
} from './row-menu-harness.tsx';

useMenuHarness();

test('own idle MR, local, slack thread not found, gitlab buttons up', async () => {
  await openMenu(ownIdle, ownEnv);
  expect(menuLines()).toMatchInlineSnapshot(`
    [
      "# !1418",
      "# agent actions",
      "review",
      "respond",
      "rebase locally",
      "auto-doctor: ignore this MR",
      "request review from…",
      "---",
      "# gitlab",
      "merge",
      "rebase on target",
      "set auto-merge",
      "mark as draft",
      "open in gitlab",
      "---",
      "# slack",
      "no thread, find it again",
      "post to slack",
      "copy for slack",
      "add a note",
    ]
  `);
  expect(await clickEach(ownIdle, ownEnv)).toMatchInlineSnapshot(`
    [
      "review → launch:review",
      "respond → launch:respond",
      "rebase locally → launch:rebase-local",
      "auto-doctor: ignore this MR → stand-down:true",
      "request review from… → ask:review:kim",
      "merge → mr:merge",
      "rebase on target → mr:rebase",
      "set auto-merge → mr:setAutoMerge",
      "mark as draft → draft:true",
      "open in gitlab → open:https://gitlab.example.com/acme/webapp/-/merge_requests/1418",
      "no thread, find it again → find-thread",
      "post to slack → post-slack",
      "copy for slack → copy",
      "add a note → note",
    ]
  `);
});

test("teammate's MR after my commented review, slack thread found", async () => {
  await openMenu(teammateReviewed, ownEnv);
  expect(menuLines()).toMatchInlineSnapshot(`
    [
      "# !1419",
      "# agent actions",
      "re-review",
      "resume review",
      "view agent review",
      "ask kim's agent to respond",
      "---",
      "# gitlab",
      "open in gitlab",
      "---",
      "# slack",
      "👀mark as looking",
      "💬mark as commented",
      "✅unmark approved✓",
      "open MR post in slack",
      "copy for slack",
      "add a note",
    ]
  `);
  expect(await clickEach(teammateReviewed, ownEnv)).toMatchInlineSnapshot(`
    [
      "re-review → launch:re-review",
      "resume review → launch:resume-review",
      "view agent review → view-report:review",
      "ask kim's agent to respond → ask:respond:kim",
      "open in gitlab → open:https://gitlab.example.com/acme/webapp/-/merge_requests/1419",
      "👀mark as looking → react:eyes:false (stays open)",
      "💬mark as commented → react:speech_balloon:false (stays open)",
      "✅unmark approved✓ → react:white_check_mark:true (stays open)",
      "open MR post in slack → open:https://slack.example.com/archives/C1/p1",
      "copy for slack → copy",
      "add a note → note",
    ]
  `);
});

test('own MR with lanes running, a broken pipeline, a draft and a stack above it', async () => {
  await openMenu(ownBusy, busyEnv);
  expect(menuLines()).toMatchInlineSnapshot(`
    [
      "# !1420",
      "# agent actions",
      "focus review",
      "resume review",
      "relaunch response",
      "resume response",
      "call doctor",
      "auto-doctor: ignore this stack",
      "request review from…",
      "---",
      "# gitlab",
      "mark ready",
      "open in gitlab",
      "---",
      "# slack",
      "copy for slack",
      "edit note",
    ]
  `);
  expect(await clickEach(ownBusy, busyEnv)).toMatchInlineSnapshot(`
    [
      "focus review → launch:review:focus",
      "resume review → launch:resume-review",
      "relaunch response → launch:respond:focus",
      "resume response → launch:resume-respond",
      "call doctor → launch:doctor",
      "auto-doctor: ignore this stack → stand-down:true",
      "request review from… → ask:review:kim",
      "mark ready → draft:false",
      "open in gitlab → open:https://gitlab.example.com/acme/webapp/-/merge_requests/1420",
      "copy for slack → copy",
      "edit note → note",
    ]
  `);
});

test('failed lanes, finished respond, conflicts and a peer review with comments', async () => {
  await openMenu(failedLanes, failedEnv);
  expect(menuLines()).toMatchInlineSnapshot(`
    [
      "# !1422",
      "# agent actions",
      "review",
      "restart response",
      "resume response",
      "call doctor",
      "rebase locally",
      "dismiss review line",
      "dismiss doctor line",
      "re-enable auto-doctor",
      "ask kim's agent to re-review",
      "request review from…",
      "---",
      "# gitlab",
      "mark as draft",
      "open in gitlab",
      "---",
      "# slack",
      "find slack thread",
      "post to slack",
      "copy for slack",
      "add a note",
    ]
  `);
  expect(await clickEach(failedLanes, failedEnv)).toMatchInlineSnapshot(`
    [
      "review → launch:review",
      "restart response → launch:respond",
      "resume response → launch:resume-respond",
      "call doctor → launch:doctor",
      "rebase locally → launch:rebase-local",
      "dismiss review line → dismiss:review",
      "dismiss doctor line → dismiss:doctor",
      "re-enable auto-doctor → stand-down:false",
      "ask kim's agent to re-review → ask:re-review:kim",
      "request review from… → ask:review:jo",
      "mark as draft → draft:true",
      "open in gitlab → open:https://gitlab.example.com/acme/webapp/-/merge_requests/1422",
      "find slack thread → find-thread",
      "post to slack → post-slack",
      "copy for slack → copy",
      "add a note → note",
    ]
  `);
});

test('a remote board keeps only what needs no local server', async () => {
  const env = { ...ownEnv, local: false };
  await openMenu(ownIdle, env);
  expect(menuLines()).toMatchInlineSnapshot(`
    [
      "# !1418",
      "# agent actions",
      "auto-doctor: ignore this MR",
      "---",
      "# gitlab",
      "open in gitlab",
      "---",
      "# slack",
      "copy for slack",
      "add a note",
    ]
  `);
  expect(await clickEach(ownIdle, env)).toMatchInlineSnapshot(`
    [
      "auto-doctor: ignore this MR → stand-down:true",
      "open in gitlab → open:https://gitlab.example.com/acme/webapp/-/merge_requests/1418",
      "copy for slack → copy",
      "add a note → note",
    ]
  `);
});

test('merge takes two clicks: the first arms it, the second merges', async () => {
  await openMenu(ownIdle, ownEnv);
  await clickItem('merge');
  expect(harness.effects).toEqual([]);
  expect(harness.closed).toBe(false);
  expect(itemTexts()).toContain('really merge?');
  await clickItem('really merge?');
  expect(harness.effects).toEqual([{ effect: 'mr:merge', iid: 1418 }]);
  expect(harness.closed).toBe(true);
});

test('alt-click on a launch opens the note box and Enter launches with the note', async () => {
  await openMenu(ownIdle, ownEnv);
  await clickItem('review', { altKey: true });
  expect(harness.effects).toEqual([]);
  expect(menuLines()).toMatchInlineSnapshot(`
    [
      "# note for review !1418",
      "[note box]",
      "↵ launch with note · ⇧↵ newline · esc back",
    ]
  `);
  await typeNote('focus on the migration');
  expect(harness.effects).toEqual([
    { effect: 'launch:review', iid: 1418, note: 'focus on the migration' },
  ]);
  expect(harness.closed).toBe(true);
});

test('a slack mark keeps the menu open and shows its check once the reply lands', async () => {
  await openMenu(teammateReviewed, ownEnv, {
    reactionsReply: ['eyes', 'white_check_mark'],
  });
  await clickItem('mark as looking');
  await flush();
  expect(harness.effects).toEqual([{ effect: 'react:eyes:false', iid: 1419 }]);
  expect(harness.closed).toBe(false);
  expect(
    itemTexts().some(t => t.includes('unmark looking') && t.endsWith('✓'))
  ).toBe(true);
});
