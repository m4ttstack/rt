import { boardRootFromStatePath } from '../src/agent-status/emit.ts';
import { writeDraft } from '../src/draft-state.ts';
import { dbPathForRoot, getStateDb, openStateDb } from '../src/state/index.ts';

/** Same shape as the status CLIs: everything but the optional `--state` flag
    stays positional, so a pre-existing plugin-cached skill's argv (no flag at
    all) still parses. */
function parseArgs(argv: string[]): { rest: string[]; state?: string } {
  let state: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--state') state = argv[++i];
    else if (a.startsWith('--state=')) state = a.slice('--state='.length);
    else rest.push(a);
  }
  return { rest, state };
}

const { rest, state } = parseArgs(process.argv.slice(2));
const [mrUrl, iidRaw, kind, ...bodyParts] = rest;
const iid = Number(iidRaw);
const body = bodyParts.join(' ').trim();

if (!mrUrl || !Number.isFinite(iid) || !kind || !body) {
  console.error(
    'usage: doctor-draft <mrUrl> <iid> <kind> <body...> [--state <path>]'
  );
  process.exit(1);
}

// A caller with no --state predates this flag (a version-pinned plugin
// cache) and falls back to the ambient default db, same as before this fix --
// a caller that has it (the current doctor SKILL.md template) stays inside
// whichever board root launched the pane, matching the status CLIs.
const db = state
  ? openStateDb(dbPathForRoot(boardRootFromStatePath(state)), 'cli')
  : getStateDb();

writeDraft(mrUrl, kind, { mrUrl, iid, kind, body, status: 'held' }, Date.now(), db);
console.log(`${mrUrl} ${kind}`);
