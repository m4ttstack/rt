#!/usr/bin/env bun
/**
 * Live validator for GitLabProvider.watchEvents against the harness repo.
 * Gated: set GLANCE_LIVE=1 to run. Exits 0 silently otherwise.
 *
 * Sequence (mirrors the validated 2026-07-23 spike):
 *   1. Start watcher cold; wait for the cursor to establish.
 *   2. luke opens an MR      -> expect mr:<iid>
 *   3. han comments          -> expect notes:<iid>
 *   4. han approves          -> expect mr:<iid> again
 *   5. dispose; restart from the persisted cursor
 *   6. luke closes the MR    -> expect mr:<iid> after restart
 *   7. cleanup: delete branch
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Gitlab } from '@gitbeaker/rest';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import type { EventCursor, InvalidationBatch } from '../src/types.ts';

async function main(): Promise<void> {
  const HOST = 'https://gitlab.com';
  const REPO = 'm4tthew-dev/glance-test-repo';
  const creds = JSON.parse(
    readFileSync(`${homedir()}/Documents/GitHub/Glance/harness_credentials.json`, 'utf8'),
  );
  const tok = (u: string) => creds.users.find((x: any) => x.username === u)!.token;

  const provider = new GitLabProvider(HOST, tok('goodwin.matthew.eric'));
  const luke = new Gitlab({ host: HOST, token: tok('luke.skycoder') });
  const han = new Gitlab({ host: HOST, token: tok('han.solocoder') });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let passed = 0;
  let failed = 0;
  const seen: string[] = [];
  let savedCursor: EventCursor | null = null;
  // Hoisted so the outer `finally` can clean up even if a mid-sequence
  // assertion or API call throws after the branch was created.
  let branch: string | null = null;

  function collect(b: InvalidationBatch): void {
    for (const k of b.invalidations) {
      const key = `${k.kind}:${k.ref}`;
      if (!seen.includes(key)) seen.push(key);
    }
  }

  async function waitFor(key: string, label: string, timeoutMs = 25_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (seen.includes(key)) {
        console.log(`  PASS ${label} (${key} in ${Date.now() - start}ms)`);
        passed++;
        return;
      }
      await sleep(250);
    }
    console.log(`  FAIL ${label}: wanted ${key}, saw [${seen.join(', ')}]`);
    failed++;
  }

  function startWatcher(cursor?: EventCursor): () => void {
    return provider.watchEvents!(
      REPO,
      {
        intervalMs: 3000,
        ...(cursor ? { cursor } : {}),
        onCursor: (c) => { savedCursor = c; },
        onStatus: (s) => console.log(`  status: ${s.state}${s.cause ? ` (${s.cause})` : ''}`),
      },
      collect,
    );
  }

  // 1. Cold start
  let dispose: (() => void) | null = startWatcher();
  try {
    await sleep(6000); // one cold tick establishes the cursor
    console.log(`cold cursor: ${JSON.stringify(savedCursor)}`);

    // 2-4. Drive events
    const proj = await luke.Projects.show(REPO);
    branch = `live-events-${Date.now()}`;
    await luke.Branches.create(REPO, branch, proj.default_branch as string);
    await luke.Commits.create(REPO, branch, 'live-events: touch', [
      { action: 'create', filePath: `live-events-${Date.now()}.txt`, content: 'x\n' },
    ]);
    const mr = await luke.MergeRequests.create(REPO, branch, proj.default_branch as string, `Live events ${branch}`);
    console.log(`opened !${mr.iid}`);
    await waitFor(`mr:${mr.iid}`, 'MR opened -> mr invalidation');

    await han.MergeRequestNotes.create(REPO, mr.iid, `live-events ping ${new Date().toISOString()}`);
    await waitFor(`notes:${mr.iid}`, 'note -> notes invalidation');

    seen.length = 0; // reset so the approval re-fire is observable
    await han.MergeRequestApprovals.approve(REPO, mr.iid);
    await waitFor(`mr:${mr.iid}`, 'approval -> mr invalidation (re-fire)');

    // 5-6. Restart from cursor
    dispose();
    dispose = null;
    seen.length = 0;
    console.log(`restarting from cursor: ${JSON.stringify(savedCursor)}`);
    await luke.MergeRequests.edit(REPO, mr.iid, { stateEvent: 'close' });
    dispose = startWatcher(savedCursor!);
    await waitFor(`mr:${mr.iid}`, 'after restart: MR closed -> mr invalidation');
  } finally {
    // 7. Cleanup: always dispose the watcher and delete the branch, even if
    // an assertion or API call above threw mid-sequence.
    dispose?.();
    if (branch) {
      try { await luke.Branches.remove(REPO, branch); } catch {}
    }
  }

  console.log(`\n${passed}/${passed + failed} live assertions passed`);
  process.exit(failed === 0 ? 0 : 1);
}

if (!process.env.GLANCE_LIVE) {
  console.log('live-events: skipped (set GLANCE_LIVE=1 to run)');
} else {
  await main();
}
