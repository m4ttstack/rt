import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, test } from 'bun:test';

import {
  boardMrLink,
  doctorStuckNotice,
  escalationBody,
  notifyEscalation,
} from '../triage/notify.ts';

describe('escalationBody', () => {
  test('keeps a short first sentence and nothing after it', () => {
    expect(
      escalationBody(
        'typecheck failed on src/foo.ts. Ran tsc twice.\nMore detail here.'
      )
    ).toBe('typecheck failed on src/foo.ts.');
  });

  test('uses the whole first line when there is no sentence terminator', () => {
    expect(escalationBody('rebase blocked by conflict in bun.lock')).toBe(
      'rebase blocked by conflict in bun.lock'
    );
  });

  test('a long multi-sentence diagnosis truncates the first sentence at 120 chars with an ellipsis', () => {
    const firstSentence =
      'The pipeline failed because the typecheck job found forty-one errors across nine files after the rebase picked up the new strict compiler flags from master.';
    const body = escalationBody(
      `${firstSentence} Second sentence with remediation detail. Third sentence.`
    );
    expect(body).toBe(`${firstSentence.slice(0, 120).trimEnd()}...`);
    expect(body).not.toContain('Second sentence');
    expect(body.split('\n')).toHaveLength(1);
  });
});

describe('notifyEscalation', () => {
  const sock = join(mkdtempSync(join(tmpdir(), 'tray-')), 'tray.sock');
  const received: any[] = [];
  const server = Bun.serve({
    unix: sock,
    async fetch(req) {
      received.push({
        path: new URL(req.url).pathname,
        body: await req.json(),
      });
      return new Response('ok');
    },
  });
  afterAll(() => server.stop(true));

  test('rt mode POSTs the tray notify contract to the unix socket', async () => {
    await notifyEscalation(
      'Auto-fix stuck on !12',
      escalationBody('typecheck failed; diagnosis attached.'),
      'rt',
      { traySock: sock }
    );
    expect(received).toHaveLength(1);
    expect(received[0].path).toBe('/notify');
    expect(received[0].body.title).toBe('Auto-fix stuck on !12');
    expect(received[0].body.message).toBe(
      'typecheck failed; diagnosis attached.'
    );
    expect(received[0].body.category).toBe('mr-doctor');
    expect(typeof received[0].body.id).toBe('string');
    expect(typeof received[0].body.timestamp).toBe('number');
    expect('url' in received[0].body).toBe(false);
  });

  test('badge-only mode is a no-op', async () => {
    await notifyEscalation('t', 'm', 'badge-only', { traySock: sock });
    expect(received).toHaveLength(1); // unchanged
  });

  test('a url rides on the event as its click target', async () => {
    const url = boardMrLink(
      'https://board.mattstack',
      'https://gitlab.example.com/acme/webapp/-/merge_requests/45'
    );
    await notifyEscalation('t', 'm', 'rt', { url, traySock: sock });
    expect(received).toHaveLength(2);
    expect(received[1].body.url).toBe(url);
  });

  test('a null url leaves the field off the event', async () => {
    await notifyEscalation('t', 'm', 'rt', { url: null, traySock: sock });
    expect(received).toHaveLength(3);
    expect('url' in received[2].body).toBe(false);
  });
});

describe('boardMrLink', () => {
  test('points at the board root with the MR url encoded into ?mr=', () => {
    expect(
      boardMrLink(
        'https://board.mattstack',
        'https://gitlab.example.com/acme/webapp/-/merge_requests/45'
      )
    ).toBe(
      'https://board.mattstack/?mr=https%3A%2F%2Fgitlab.example.com%2Facme%2Fwebapp%2F-%2Fmerge_requests%2F45'
    );
  });
});

describe('doctorStuckNotice', () => {
  const MR = 'https://gitlab.example.com/acme/webapp/-/merge_requests/45';

  test('titles the MR, shows the diagnosis snippet and links its board row', () => {
    expect(
      doctorStuckNotice(
        {
          iid: 45,
          mrUrl: MR,
          message: 'rebase blocked by conflict in bun.lock. Tried twice.',
        },
        'https://board.mattstack'
      )
    ).toEqual({
      title: 'Auto-fix stuck on !45',
      message: 'rebase blocked by conflict in bun.lock.',
      url: boardMrLink('https://board.mattstack', MR),
    });
  });

  test('no board url from deck means no click target', () => {
    expect(
      doctorStuckNotice({ iid: 45, mrUrl: MR, message: 'ci red.' }, null).url
    ).toBeNull();
  });

  test('a doctor that stopped without a message still reads plainly', () => {
    expect(doctorStuckNotice({ iid: 45, mrUrl: MR }, null).message).toBe(
      'No reason given, over to you'
    );
    expect(
      doctorStuckNotice({ iid: 45, mrUrl: MR, message: '  ' }, null).message
    ).toBe('No reason given, over to you');
  });
});
