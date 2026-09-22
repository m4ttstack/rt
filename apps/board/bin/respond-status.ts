import { existsSync } from 'fs';

import {
  boardRootFromStatePath,
  emitAgentStatus,
} from '../src/agent-status/emit.ts';
import { respondOutcome } from '../src/respond-outcome.ts';
import type { RespondState, RespondStatus } from '../src/respond-state.ts';
import {
  dbPathForRoot,
  ingestReport,
  openStateDb,
  updateByHandle,
} from '../src/state/index.ts';

const VALID: RespondStatus[] = [
  'queued',
  'triaging',
  'implementing',
  'drafting',
  'done',
  'error',
];

interface Parsed {
  path?: string;
  status?: string;
  message: string;
  session?: string;
  posted?: string;
  threads?: string;
  held?: string;
  /** A recognized flag that arrived with no operand; a trailing `--held`
      must fail loudly rather than silently dropping the count. */
  missingOperand?: string;
}

/** Same shape as review-status: positional <path> <status> [message] plus
    optional flags in either `--flag value` or `--flag=value` form. Backward
    compatible with existing invocations. */
function parseArgs(argv: string[]): Parsed {
  const NAMES = ['session', 'posted', 'threads', 'held'];
  const flags: Record<string, string | undefined> = {};
  const rest: string[] = [];
  let missingOperand: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const name = NAMES.find(n => a === `--${n}` || a.startsWith(`--${n}=`));
    if (!name) {
      rest.push(a);
      continue;
    }
    if (a === `--${name}` && argv[i + 1] === undefined) {
      missingOperand = name;
      continue;
    }
    flags[name] = a === `--${name}` ? argv[++i] : a.slice(name.length + 3);
  }
  const [path, status, ...msg] = rest;
  return {
    path,
    status,
    message: msg.join(' ').trim(),
    session: flags.session,
    posted: flags.posted,
    threads: flags.threads,
    held: flags.held,
    missingOperand,
  };
}

/** undefined when the flag was absent, null when it was present but unusable,
    so a typo fails loudly instead of silently degrading the badge. */
function parseCount(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

const parsed = parseArgs(process.argv.slice(2));
if (
  !parsed.path ||
  !parsed.status ||
  !VALID.includes(parsed.status as RespondStatus)
) {
  console.error(
    `usage: respond-status <statePath> <${VALID.join('|')}> [message] [--posted <n>] [--threads <n>] [--held <n>] [--session <id>]`
  );
  process.exit(1);
}

if (parsed.missingOperand !== undefined) {
  console.error(`--${parsed.missingOperand} requires a value`);
  process.exit(1);
}

const posted = parseCount(parsed.posted);
const threads = parseCount(parsed.threads);
const held = parseCount(parsed.held);
if (posted === null || threads === null || held === null) {
  console.error('--posted, --threads and --held must be non-negative integers');
  process.exit(1);
}
// A numerator with no denominator is uninterpretable, so it fails rather than
// deriving to "unknown" and quietly losing the count the run bothered to report.
if (posted !== undefined && threads === undefined) {
  console.error('--posted requires --threads');
  process.exit(1);
}
if (held !== undefined && threads === undefined) {
  console.error('--held requires --threads');
  process.exit(1);
}

const sessionId =
  parsed.session ?? process.env.CLAUDE_CODE_SESSION_ID ?? undefined;

const dbPath = dbPathForRoot(boardRootFromStatePath(parsed.path));
if (!existsSync(dbPath)) {
  console.error(`no board db at ${dbPath}; stale pre-upgrade handle?`);
  process.exit(1);
}
const db = openStateDb(dbPath, 'cli');
const merged = updateByHandle(
  parsed.path,
  {
    status: parsed.status as RespondStatus,
    ...(parsed.message ? { message: parsed.message } : {}),
    ...(posted !== undefined ? { posted } : {}),
    ...(threads !== undefined ? { threads } : {}),
    ...(held !== undefined ? { held } : {}),
    ...(sessionId ? { sessionId } : {}),
  },
  Date.now(),
  db
) as (RespondState & { mrUrl: string; iid: number }) | null;
if (!merged) {
  console.error(
    `no state row for ${parsed.path}; was this pane launched by a board on this machine?`
  );
  process.exit(1);
}

ingestReport(parsed.path, db);

await emitAgentStatus(
  {
    mrUrl: merged.mrUrl,
    iid: merged.iid,
    kind: 'respond',
    status: parsed.status,
    outcome: respondOutcome(merged.posted, merged.threads, merged.held),
  },
  boardRootFromStatePath(parsed.path)
);
