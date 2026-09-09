import { existsSync, mkdirSync, mkdtempSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import { draftBinPath, statusBinPath } from '../herdr.ts';
import {
  dbPathForRoot,
  insertAgentState,
  mintHandle,
  openStateDb,
  readByHandle,
  type Lane,
} from '../state/index.ts';

/** The board hands this path to an agent launched in the *target repo's* cwd,
    which then executes it. Both halves have to hold: the path has to exist, and
    it has to be runnable as a program. A compiled board has no source tree, so
    a path into `bin/*.ts` satisfies neither. */
/** The writer notifies a running board after writing. Pointed at a dead port so
    a developer's live board never receives a status from the test suite. */
const NO_LIVE_BOARD = { ...process.env, MR_BOARD_PORT: '1' };

/** Seeds the row a launch would already have written, at a handle placed at
    the mintHandle depth (`<root>/state/<lane>s/<slug>.json`) the CLI's own db
    derivation (`dbPathForRoot(boardRootFromStatePath(handle))`) expects --
    a shallower path would resolve to the wrong root and find no row. */
function seedRow(
  root: string,
  lane: Lane,
  mrUrl: string,
  iid: number,
  state: object = { status: 'queued' }
): string {
  const db = openStateDb(dbPathForRoot(root), 'cli');
  const handle = mintHandle(lane, mrUrl, root);
  insertAgentState(lane, mrUrl, iid, state, handle, db);
  return handle;
}

describe('the status writer the board hands out', () => {
  test('is a file that exists and is executable', () => {
    for (const path of [statusBinPath(), draftBinPath()]) {
      expect(statSync(path).isFile()).toBe(true);
      expect(statSync(path).mode & 0o111).toBeGreaterThan(0);
    }
  });

  test('writes review status when run as a subcommand, the way a launched skill runs it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'board-statusbin-'));
    const handle = seedRow(root, 'review', 'https://x/mr/7', 7);

    const proc = Bun.spawn(
      [statusBinPath(), 'review-status', handle, 'reviewing'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        env: NO_LIVE_BOARD,
      }
    );
    expect(await proc.exited).toBe(0);

    const db = openStateDb(dbPathForRoot(root), 'cli');
    const written = readByHandle(handle, db) as { status: string; iid: number };
    expect(written.status).toBe('reviewing');
    expect(written.iid).toBe(7);
  });

  test('carries the message and outcome flags through the subcommand', async () => {
    const root = mkdtempSync(join(tmpdir(), 'board-statusbin-'));
    const handle = seedRow(root, 'review', 'https://x/mr/8', 8, {
      status: 'reviewing',
    });

    const proc = Bun.spawn(
      [
        statusBinPath(),
        'review-status',
        handle,
        'done',
        'looks good',
        '--outcome',
        'approve',
      ],
      { stdout: 'pipe', stderr: 'pipe', env: NO_LIVE_BOARD }
    );
    expect(await proc.exited).toBe(0);

    const db = openStateDb(dbPathForRoot(root), 'cli');
    const written = readByHandle(handle, db) as {
      status: string;
      message: string;
      outcome: string;
    };
    expect(written).toMatchObject({
      status: 'done',
      message: 'looks good',
      outcome: 'approve',
    });
  });

  test('review-status writes the db row by handle and ingests the report on done', async () => {
    const root = mkdtempSync(join(tmpdir(), 'board-statusbin-'));
    const handle = seedRow(root, 'review', 'https://x/mr/70', 70, {
      status: 'queued',
    });
    mkdirSync(join(root, 'state', 'reviews'), { recursive: true });
    await Bun.write(handle.replace(/\.json$/, '') + '.md', '# report');

    const proc = Bun.spawn(
      [
        statusBinPath(),
        'review-status',
        handle,
        'done',
        'reviewed',
        '--outcome',
        'comment',
      ],
      { stdout: 'pipe', stderr: 'pipe', env: NO_LIVE_BOARD }
    );
    expect(await proc.exited).toBe(0);

    const db = openStateDb(dbPathForRoot(root), 'cli');
    const written = readByHandle(handle, db) as {
      status: string;
      outcome: string;
      reportReady: boolean;
    };
    expect(written.status).toBe('done');
    expect(written.outcome).toBe('comment');
    expect(written.reportReady).toBe(true);
  });

  test('review-status exits 1 loudly on an unknown handle in an existing db', async () => {
    const root = mkdtempSync(join(tmpdir(), 'board-statusbin-'));
    openStateDb(dbPathForRoot(root), 'cli'); // db exists; no row for this handle
    const handle = mintHandle('review', 'https://x/mr/71', root);

    const proc = Bun.spawn(
      [statusBinPath(), 'review-status', handle, 'reviewing'],
      { stdout: 'pipe', stderr: 'pipe', env: NO_LIVE_BOARD }
    );
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain(
      'no state row for'
    );
  });

  test('review-status exits 1 loudly on a handle whose root has no db at all', async () => {
    const root = mkdtempSync(join(tmpdir(), 'board-statusbin-nodb-'));
    const handle = mintHandle('review', 'https://x/mr/72', root);

    const proc = Bun.spawn(
      [statusBinPath(), 'review-status', handle, 'reviewing'],
      { stdout: 'pipe', stderr: 'pipe', env: NO_LIVE_BOARD }
    );
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain(
      'stale pre-upgrade handle?'
    );
  });

  /** Domain skills ship in version-pinned plugin caches (acme 0.4.11 has
      `bun run <status-bin> <state> fixing`), so they reach a board newer than
      themselves and pass the pre-subcommand argv. Dropping that shape would
      break the doctor lane exactly the way this whole fix exists to prevent. */
  describe('the pre-subcommand argv older plugin-cached skills still send', () => {
    test.each([
      ['review', 'reviewing'],
      ['respond', 'triaging'],
      ['doctor', 'diagnosing'],
    ] as const)(
      'infers the writer from a %s state path',
      async (lane, status) => {
        const root = mkdtempSync(join(tmpdir(), 'board-legacy-'));
        const handle = seedRow(root, lane, 'https://x/mr/9', 9);

        const proc = Bun.spawn([statusBinPath(), handle, status], {
          stdout: 'pipe',
          stderr: 'pipe',
          env: NO_LIVE_BOARD,
        });
        expect(await proc.exited).toBe(0);
        const db = openStateDb(dbPathForRoot(root), 'cli');
        const written = readByHandle(handle, db) as { status: string };
        expect(written.status).toBe(status);
      }
    );

    test("routes the draft writer's mrUrl-first argv to doctor-draft", async () => {
      const root = mkdtempSync(join(tmpdir(), 'board-legacy-draft-'));
      const proc = Bun.spawn(
        [
          statusBinPath(),
          'https://gitlab.com/g/p/-/merge_requests/5',
          '5',
          'inherited-note',
          'job x fails on main',
        ],
        {
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            ...NO_LIVE_BOARD,
            BOARD_APP_ROOT: root,
            BOARD_STATE_DB: dbPathForRoot(root),
          },
        }
      );
      expect(await proc.exited).toBe(0);
      const db = openStateDb(dbPathForRoot(root), 'cli');
      const rows = db.query('SELECT draft FROM drafts').all() as {
        draft: string;
      }[];
      expect(rows.length).toBe(1);
      expect(rows[0]!.draft).toContain('job x fails on main');
    });
  });

  test('doctor-draft with --state derives its db from the handle, not the ambient default', async () => {
    const root = mkdtempSync(join(tmpdir(), 'board-statusbin-draft-'));
    const otherHome = mkdtempSync(
      join(tmpdir(), 'board-statusbin-draft-home-')
    );
    const handle = mintHandle('doctor', 'https://x/mr/11', root);

    const proc = Bun.spawn(
      [
        statusBinPath(),
        'doctor-draft',
        'https://x/mr/11',
        '11',
        'inherited-note',
        'job fails on main',
        '--state',
        handle,
      ],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...NO_LIVE_BOARD, HOME: otherHome },
      }
    );
    expect(await proc.exited).toBe(0);

    const db = openStateDb(dbPathForRoot(root), 'cli');
    const rows = db.query('SELECT draft FROM drafts').all() as {
      draft: string;
    }[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.draft).toContain('job fails on main');
    expect(existsSync(join(otherHome, '.mattstack', 'board', 'state.db'))).toBe(
      false
    );
  });

  test('rejects an unknown subcommand rather than silently doing nothing', async () => {
    const proc = Bun.spawn([statusBinPath(), 'not-a-verb', '/tmp/x', 'done'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const code = await proc.exited;
    expect(code).not.toBe(0);
    expect(await new Response(proc.stderr).text()).toContain('not-a-verb');
  });
});
