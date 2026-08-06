#!/usr/bin/env bun
/**
 * Live probe for GitHub's repository events feed.
 *
 * An instrument, not a test: it drives a known sequence of activity against
 * the conformance fixture, polls `/repos/{owner}/{repo}/events` while that
 * activity is in flight, and records everything it saw so the numbers behind
 * "can glance poll this feed?" come from measurement rather than from the
 * docs. The claims it is measuring against come from the Task 6 research at
 * `.local-dev/derisk/github-events-research.md`.
 *
 * Run:
 *   bun tests/live/probe/githubEventsProbe.ts --minutes 30 --out <dir>
 *   bun tests/live/probe/githubEventsProbe.ts --minutes 1 --drive false   # poll only
 *
 * Writes three JSONL files into `--out` (actions.jsonl, events.jsonl,
 * polls.jsonl), flushed after every row so a killed run keeps its data, and
 * prints a summary built from `analysis.ts`.
 *
 * It mutates exactly one repository: the `github` entry in
 * harness_credentials.json, which is the conformance fixture. Branch and file
 * names carry a `probe-<epoch>` suffix, so reruns never collide with each
 * other and cleanup is not needed between runs. A drive phase that fails part
 * way through deliberately leaves its branch and pull request behind: the
 * branch deletion is itself one of the measured actions, so tearing down on
 * the failure path would emit a `DeleteEvent` attributable to no action and
 * corrupt the very feed being measured. The failure message names what was
 * left so an operator can remove it by hand.
 */

import { mkdir } from 'node:fs/promises';
import type { FileSink } from 'bun';
import {
  githubApproverUsername,
  githubRepo,
  loadCredentials,
  parseGitHubSlug,
  resolveGitHubToken
} from '../credentials.ts';
import {
  etagSummary,
  latencies,
  orderingViolations,
  type DrivenAction,
  type ObservedEvent,
  type PollSample
} from './analysis.ts';

const REPO_ROOT = new URL('../../../../../', import.meta.url).pathname;

/**
 * Skew allowance when matching a driven action to an event. `performedAt` is
 * this machine's clock at the moment the mutating call returned; `created_at`
 * is GitHub's clock at the moment the activity was recorded, which is
 * necessarily a little earlier than the response. A minute is generous enough
 * to absorb both that head start and ordinary clock drift without being wide
 * enough to let one action claim an unrelated earlier event.
 */
const SKEW_MARGIN_MS = 60_000;

/**
 * GitHub's REST best-practices page asks for at least a second between
 * mutative requests to stay clear of secondary rate limits. The drive phase
 * is a handful of calls, so paying this on each one costs nothing and keeps
 * the probe from being the reason a run fails.
 */
const MUTATION_SPACING_MS = 1_000;

/** How long to keep retrying a merge that GitHub says is not yet mergeable. */
const MERGE_TIMEOUT_MS = 6 * 60_000;
const MERGE_RETRY_MS = 10_000;

interface Options {
  minutes: number;
  interval: number;
  out: string;
  drive: boolean;
}

const DEFAULTS = { minutes: 30, interval: 10, drive: true } as const;

function defaultOutDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${REPO_ROOT}.local-dev/derisk/probe-runs/${stamp}`;
}

/**
 * Hand-rolled rather than pulling in a flag library, and strict about what it
 * accepts: an unrecognised or malformed flag aborts instead of falling back to
 * a default. A silently-ignored `--drive fasle` would drive real mutations
 * against the fixture during what the operator believed was a read-only run,
 * and a silently-ignored `--minutes` would burn half an hour before anyone
 * noticed.
 */
function parseArgs(argv: string[]): Options {
  const known = new Set(['minutes', 'interval', 'out', 'drive']);
  const raw = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (!arg.startsWith('--')) {
      throw new Error(`unexpected argument "${arg}"; flags are --minutes, --interval, --out, --drive`);
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    if (!known.has(key)) {
      throw new Error(`unknown flag "--${key}"; flags are --minutes, --interval, --out, --drive`);
    }
    let value: string | undefined;
    if (eq === -1) {
      value = argv[++i];
    } else {
      value = body.slice(eq + 1);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`flag "--${key}" needs a value`);
    }
    raw.set(key, value);
  }

  const positive = (key: 'minutes' | 'interval', fallback: number): number => {
    const value = raw.get(key);
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--${key} must be a positive number, got "${value}"`);
    }
    return parsed;
  };

  const driveRaw = raw.get('drive');
  if (driveRaw !== undefined && driveRaw !== 'true' && driveRaw !== 'false') {
    throw new Error(`--drive must be "true" or "false", got "${driveRaw}"`);
  }

  return {
    minutes: positive('minutes', DEFAULTS.minutes),
    interval: positive('interval', DEFAULTS.interval),
    out: raw.get('out') ?? defaultOutDir(),
    drive: driveRaw === undefined ? DEFAULTS.drive : driveRaw === 'true'
  };
}

/** One JSONL file, flushed per row so an interrupted run keeps what it saw. */
class JsonlWriter {
  private readonly sink: FileSink;

  constructor(path: string) {
    this.sink = Bun.file(path).writer();
  }

  async write(row: unknown): Promise<void> {
    this.sink.write(`${JSON.stringify(row)}\n`);
    await this.sink.flush();
  }

  async close(): Promise<void> {
    await this.sink.end();
  }
}

function ghFetch(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...extraHeaders
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

/** A bare status code is not enough to diagnose a 4xx here; the body carries
 *  GitHub's own explanation of which field it rejected. */
async function fail(res: Response, label: string): Promise<never> {
  const text = await res.text().catch(() => '');
  throw new Error(`${label} failed: HTTP ${res.status}${text ? `: ${text.slice(0, 400)}` : ''}`);
}

interface DriveContext {
  token: string;
  approverToken: string | null;
  slug: string;
  defaultBranch: string;
  actions: DrivenAction[];
  actionsFile: JsonlWriter;
}

/**
 * The expected event type for each driven action, from the Task 6 research's
 * event-type table (`.local-dev/derisk/github-events-research.md` section 5).
 * Kept as a named table rather than inlined so the probe's assumption about
 * what GitHub *should* emit is legible in one place and can be corrected
 * against what it actually emits.
 *
 * Two shapes are worth noting. Creating a branch and pushing to it are
 * recorded as separate actions because the docs give them separate types
 * (`CreateEvent`, `PushEvent`); folding them into one action with both types
 * would let either event satisfy it and hide which one arrived. Merging is
 * recorded as two actions sharing one timestamp because a single merge
 * produces two events (the pull request closing and the resulting push to the
 * default branch), and each row of the latency table matches exactly one
 * event.
 */
const EXPECTED_TYPES = {
  createBranch: ['CreateEvent'],
  push: ['PushEvent'],
  pullRequest: ['PullRequestEvent'],
  comment: ['IssueCommentEvent'],
  review: ['PullRequestReviewEvent'],
  deleteBranch: ['DeleteEvent']
} as const;

async function drive(ctx: DriveContext): Promise<void> {
  const runId = `probe-${Date.now()}`;
  const branch = runId;
  let prNumber: number | null = null;

  const record = async (label: string, expectedTypes: readonly string[]): Promise<void> => {
    const action: DrivenAction = {
      label,
      performedAt: new Date().toISOString(),
      expectedTypes: [...expectedTypes]
    };
    ctx.actions.push(action);
    await ctx.actionsFile.write(action);
    console.log(`  drove ${label} at ${action.performedAt}`);
  };

  /** Wrap each mutating step so a failure names what was left behind. */
  const leftBehind = (): string =>
    prNumber === null
      ? `branch ${branch}`
      : `branch ${branch} and PR #${prNumber}`;

  try {
    const refRes = await ghFetch(
      ctx.token,
      'GET',
      `/repos/${ctx.slug}/git/ref/heads/${ctx.defaultBranch}`
    );
    if (!refRes.ok) await fail(refRes, 'read default ref');
    const { object } = (await refRes.json()) as { object: { sha: string } };

    const branchRes = await ghFetch(ctx.token, 'POST', `/repos/${ctx.slug}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: object.sha
    });
    if (!branchRes.ok) await fail(branchRes, 'create branch');
    await record('create-branch', EXPECTED_TYPES.createBranch);
    await Bun.sleep(MUTATION_SPACING_MS);

    await commitFile(ctx, branch, `${runId}-1.md`, `# ${runId} first commit\n`);
    await record('push-commit-1', EXPECTED_TYPES.push);
    await Bun.sleep(MUTATION_SPACING_MS);

    const prRes = await ghFetch(ctx.token, 'POST', `/repos/${ctx.slug}/pulls`, {
      title: `probe: ${runId}`,
      body: 'Opened by the glance events probe to measure feed latency. Safe to close.',
      head: branch,
      base: ctx.defaultBranch
    });
    if (!prRes.ok) await fail(prRes, 'open pull request');
    prNumber = ((await prRes.json()) as { number: number }).number;
    await record('open-pr', EXPECTED_TYPES.pullRequest);
    await Bun.sleep(MUTATION_SPACING_MS);

    const commentRes = await ghFetch(
      ctx.token,
      'POST',
      `/repos/${ctx.slug}/issues/${prNumber}/comments`,
      { body: `probe ${runId}: comment to time an IssueCommentEvent` }
    );
    if (!commentRes.ok) await fail(commentRes, 'comment on pull request');
    await record('comment', EXPECTED_TYPES.comment);
    await Bun.sleep(MUTATION_SPACING_MS);

    // GitHub rejects a review from the pull request's own author, so this one
    // step runs as the second identity. Without it configured the probe still
    // runs, but the PullRequestReviewEvent row is simply absent rather than
    // being reported as an event that never arrived.
    if (ctx.approverToken) {
      const reviewRes = await ghFetch(
        ctx.approverToken,
        'POST',
        `/repos/${ctx.slug}/pulls/${prNumber}/reviews`,
        { event: 'APPROVE', body: `probe ${runId}: approval to time a PullRequestReviewEvent` }
      );
      if (!reviewRes.ok) await fail(reviewRes, 'submit review as approver');
      await record('approve-review', EXPECTED_TYPES.review);
      await Bun.sleep(MUTATION_SPACING_MS);
    } else {
      console.warn(
        '  skipped approve-review: no second identity. Set GLANCE_HARNESS_GITHUB_APPROVER ' +
          'and `gh auth login` that account to measure PullRequestReviewEvent.'
      );
    }

    await commitFile(ctx, branch, `${runId}-2.md`, `# ${runId} second commit\n`);
    await record('push-commit-2', EXPECTED_TYPES.push);
    await Bun.sleep(MUTATION_SPACING_MS);

    await mergeWithRetry(ctx, prNumber);
    // One merge, two events: record both against the same instant so each gets
    // its own latency row.
    await record('merge-pr', EXPECTED_TYPES.pullRequest);
    await record('merge-push-main', EXPECTED_TYPES.push);
    await Bun.sleep(MUTATION_SPACING_MS);

    const deleteRes = await ghFetch(
      ctx.token,
      'DELETE',
      `/repos/${ctx.slug}/git/refs/heads/${branch}`
    );
    if (!deleteRes.ok) await fail(deleteRes, 'delete branch');
    await record('delete-branch', EXPECTED_TYPES.deleteBranch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}\n  left behind on ${ctx.slug}: ${leftBehind()}`);
  }
}

async function commitFile(
  ctx: DriveContext,
  branch: string,
  path: string,
  content: string
): Promise<void> {
  const res = await ghFetch(ctx.token, 'PUT', `/repos/${ctx.slug}/contents/${path}`, {
    message: `probe: add ${path}`,
    content: Buffer.from(content).toString('base64'),
    branch
  });
  if (!res.ok) await fail(res, `commit ${path}`);
}

/**
 * The fixture's default branch requires a status check, so the first merge
 * attempt reliably answers 405 "not mergeable" while CI is still running.
 * Retrying the merge itself, rather than polling `mergeable_state` until it
 * looks right, keeps the thing being waited on and the thing being asked for
 * identical. The last 405 body is carried into the timeout message so a merge
 * that is genuinely blocked (rather than merely slow) says why.
 */
async function mergeWithRetry(ctx: DriveContext, prNumber: number): Promise<void> {
  const deadline = Date.now() + MERGE_TIMEOUT_MS;
  let lastBlock = '(never attempted)';

  for (;;) {
    const res = await ghFetch(ctx.token, 'PUT', `/repos/${ctx.slug}/pulls/${prNumber}/merge`, {
      merge_method: 'merge'
    });
    if (res.ok) return;
    if (res.status !== 405 && res.status !== 409) await fail(res, 'merge pull request');
    lastBlock = `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`;
    if (Date.now() >= deadline) {
      throw new Error(
        `merge pull request never became mergeable within ${MERGE_TIMEOUT_MS / 1000}s. Last: ${lastBlock}`
      );
    }
    await Bun.sleep(MERGE_RETRY_MS);
  }
}

function intHeader(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

interface RawEvent {
  id: string;
  type: string | null;
  created_at: string | null;
  actor: { login: string } | null;
  payload?: { action?: string };
}

interface PollContext {
  token: string;
  slug: string;
  intervalMs: number;
  deadline: number;
  events: ObservedEvent[];
  polls: PollSample[];
  eventsFile: JsonlWriter;
  pollsFile: JsonlWriter;
}

/**
 * Polls deliberately faster than the `X-Poll-Interval: 60` the feed serves.
 * The point is to measure what actually happens when a client polls at the
 * cadence a CLI would want, including whether conditional requests really are
 * free, rather than to model a well-behaved client.
 */
async function pollLoop(ctx: PollContext): Promise<void> {
  let etag: string | null = null;
  const seen = new Map<string, ObservedEvent>();
  let warnedMissingRateLimit = false;

  while (Date.now() < ctx.deadline) {
    // Everything that talks to the network sits inside this try, not just the
    // status handling below it. A DNS blip, connection reset, or TLS error
    // rejects the fetch rather than answering with a status, so the non-2xx
    // branch never sees it; unguarded, one such failure would propagate out of
    // this loop and end polling for the remainder of the window, silently
    // truncating the observation the run exists to make. Reading the response
    // body is inside too, for the same reason: a truncated body throws where
    // an error status would not.
    try {
      const res = await ghFetch(
        ctx.token,
        'GET',
        `/repos/${ctx.slug}/events?per_page=100`,
        undefined,
        etag === null ? {} : { 'If-None-Match': etag }
      );
      const at = new Date().toISOString();

      const remaining = intHeader(res, 'x-ratelimit-remaining');
      if (remaining === null && !warnedMissingRateLimit) {
        warnedMissingRateLimit = true;
        console.warn('  no x-ratelimit-remaining header; recording -1 for those samples');
      }
      const sample: PollSample = {
        at,
        status: res.status,
        etagSent: etag !== null,
        // -1 rather than 0: a real zero would mean the rate limit is exhausted,
        // and the two must not read the same in the recorded data.
        rateLimitRemaining: remaining ?? -1,
        xPollInterval: intHeader(res, 'x-poll-interval')
      };
      ctx.polls.push(sample);
      await ctx.pollsFile.write(sample);

      if (res.status === 200) {
        etag = res.headers.get('etag') ?? etag;
        const body = (await res.json()) as RawEvent[];
        let fresh = 0;
        for (const raw of body) {
          // Skipped rather than merged: an event is immutable once GitHub has
          // recorded it, and the only field a repeat sighting could change is
          // `firstObservedAt`, whose whole meaning is the first poll that saw
          // it. There is nothing to upsert, so a second sighting is a no-op.
          if (seen.has(raw.id)) continue;
          const observed: ObservedEvent = {
            id: raw.id,
            type: raw.type ?? 'unknown',
            ...(raw.payload?.action === undefined ? {} : { action: raw.payload.action }),
            actorLogin: raw.actor?.login ?? 'unknown',
            createdAt: raw.created_at ?? at,
            firstObservedAt: at
          };
          seen.set(observed.id, observed);
          ctx.events.push(observed);
          await ctx.eventsFile.write(observed);
          fresh++;
        }
        console.log(`  poll ${at} 200 (+${fresh} new, ${seen.size} total)`);
      } else if (res.status !== 304) {
        // Not fatal: a 403/502 mid-run is itself an observation, and ending the
        // run would throw away every measurement still in flight.
        const text = await res.text().catch(() => '');
        console.error(`  poll ${at} HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      // Recorded, not merely logged: an attempt that vanished from polls.jsonl
      // would under-report how often the probe actually asked, which is the
      // same silent truncation at row granularity. Status 0 is not a real HTTP
      // status, so it cannot be mistaken for one, and it correctly breaks any
      // run of consecutive 304s in the rate-limit accounting.
      const at = new Date().toISOString();
      const sample: PollSample = {
        at,
        status: 0,
        etagSent: etag !== null,
        rateLimitRemaining: -1,
        xPollInterval: null
      };
      ctx.polls.push(sample);
      await ctx.pollsFile.write(sample);
      console.error(`  poll ${at} transport failure: ${err instanceof Error ? err.message : String(err)}`);
    }

    const remainingMs = ctx.deadline - Date.now();
    if (remainingMs <= 0) break;
    await Bun.sleep(Math.min(ctx.intervalMs, remainingMs));
  }
}

function formatLatency(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

interface ReportInput {
  actions: DrivenAction[];
  events: ObservedEvent[];
  polls: PollSample[];
  minutes: number;
}

function renderReport(input: ReportInput): string {
  const { actions, events, polls, minutes } = input;
  const lines: string[] = [];
  const window = `${minutes} minute observation window`;

  lines.push('', '=== latency: driven action -> first poll that saw its event ===');
  if (actions.length === 0) {
    lines.push('  (no actions driven)');
  } else {
    const rows = latencies(actions, events, SKEW_MARGIN_MS);
    const width = Math.max(...rows.map(r => r.label.length));
    for (const row of rows) {
      const label = row.label.padEnd(width);
      if (row.matchedEventId === null || row.latencyMs === null) {
        lines.push(`  ${label}  not observed within the ${window}`);
      } else {
        lines.push(`  ${label}  ${formatLatency(row.latencyMs)}  (event ${row.matchedEventId})`);
      }
    }
    if (rows.some(r => r.matchedEventId === null)) {
      lines.push(
        '',
        '  "not observed" means exactly that. GitHub documents delivery latency for',
        '  this feed as anywhere from 30s to 6h, so an action missing here has not',
        '  been shown to be missing from the feed, only to be slower than this run.'
      );
    }
  }

  lines.push('', '=== ordering: id order vs created_at order ===');
  const violations = orderingViolations(events);
  lines.push(`  ${violations.length} violating pair(s) across ${events.length} observed event(s)`);
  for (const violation of violations.slice(0, 3)) {
    lines.push(`    id ${violation.laterId} is larger but created earlier than ${violation.earlierId}`);
  }

  lines.push('', '=== conditional requests ===');
  const etags = etagSummary(polls);
  const withEtag = polls.filter(p => p.etagSent).length;
  const transportFailures = polls.filter(p => p.status === 0).length;
  lines.push(
    `  ${etags.samples} poll(s), ${withEtag} sent If-None-Match, ${etags.hits304} answered 304`,
    `  rate-limit points consumed across consecutive 304s: ${etags.remainingDropAcross304s} (docs claim 0)`,
    // Stated even when zero: the poll count above includes attempts that never
    // got a response, so a reader needs this number to interpret it.
    `  attempts that got no HTTP response at all: ${transportFailures}`
  );
  // Broken out by status rather than listed as a flat set of values: the
  // research's claim is that X-Poll-Interval is served on 200 *and* 304, and a
  // combined list of "60, absent" cannot say which status lacked the header.
  const intervalsByStatus = new Map<number, Set<string>>();
  for (const poll of polls) {
    const seen = intervalsByStatus.get(poll.status) ?? new Set<string>();
    seen.add(poll.xPollInterval === null ? 'absent' : String(poll.xPollInterval));
    intervalsByStatus.set(poll.status, seen);
  }
  lines.push('  X-Poll-Interval by response status:');
  for (const [status, seen] of [...intervalsByStatus].sort((a, b) => a[0] - b[0])) {
    lines.push(`    ${status}: ${[...seen].sort().join(', ')}`);
  }

  // A 200 whose body held nothing new means the ETag moved without the feed
  // gaining an event this probe had not already recorded, which bears directly
  // on whether conditional polling is as cheap in practice as in the docs.
  const observedAt = new Set(events.map(e => e.firstObservedAt));
  const emptyOk = polls.filter(p => p.status === 200 && !observedAt.has(p.at)).length;
  lines.push(`  200s that carried no event this probe had not already seen: ${emptyOk}`);

  lines.push('', '=== expected event types never seen ===');
  const expected = [...new Set(actions.flatMap(a => a.expectedTypes))].sort();
  const observedTypes = new Set(events.map(e => e.type));
  const missing = expected.filter(type => !observedTypes.has(type));
  if (expected.length === 0) {
    lines.push('  (no actions driven, so nothing was expected)');
  } else if (missing.length === 0) {
    lines.push('  none: every expected type appeared');
  } else {
    lines.push(
      `  ${missing.join(', ')}: absent within the ${window}, not shown to be absent from the feed`
    );
  }
  lines.push(`  types actually observed: ${[...observedTypes].sort().join(', ') || 'none'}`);
  lines.push(
    '',
    '  Structurally absent, not merely late: the documented Events API type set',
    '  contains no CI type at all (no CheckRun, CheckSuite, WorkflowRun,',
    '  WorkflowJob, Status or Deployment). The CI runs this probe triggers on the',
    '  fixture can never appear here, however long the window. See the Task 6',
    '  research, section 5.'
  );

  return lines.join('\n');
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  // A malformed file, a missing `github` entry, and an unparseable web_url all
  // throw, and all three mean the same thing to an operator: the credentials
  // do not name a usable GitHub repo. Reported in the one-line style the
  // file-missing case already uses rather than as a stack trace, since a
  // stack trace here says nothing the message does not.
  let slug: string;
  try {
    const creds = await loadCredentials();
    if (!creds) {
      console.error('No harness_credentials.json. Copy harness_credentials.example.json and fill it in.');
      return 1;
    }
    const { owner, repo } = parseGitHubSlug(githubRepo(creds).web_url);
    slug = `${owner}/${repo}`;
  } catch (err) {
    console.error(
      `Could not read a GitHub repo from harness_credentials.json: ${err instanceof Error ? err.message : String(err)}`
    );
    return 1;
  }

  const token = await resolveGitHubToken();
  if (!token) {
    console.error('No GitHub token. Run `gh auth login`.');
    return 1;
  }

  // Resolved up front rather than at the moment of use: a run that will not be
  // able to submit its review should say so before it spends half an hour
  // polling, not after.
  const approverUsername = githubApproverUsername();
  let approverToken: string | null = null;
  if (options.drive && approverUsername) {
    approverToken = await resolveGitHubToken({
      command: ['gh', 'auth', 'token', '--user', approverUsername]
    });
    if (!approverToken) {
      console.error(
        `GLANCE_HARNESS_GITHUB_APPROVER names "${approverUsername}" but ` +
          `\`gh auth token --user ${approverUsername}\` produced nothing. ` +
          'Run `gh auth login` for that account, or unset the variable.'
      );
      return 1;
    }
  }

  await mkdir(options.out, { recursive: true });
  const actionsFile = new JsonlWriter(`${options.out}/actions.jsonl`);
  const eventsFile = new JsonlWriter(`${options.out}/events.jsonl`);
  const pollsFile = new JsonlWriter(`${options.out}/polls.jsonl`);

  const actions: DrivenAction[] = [];
  const events: ObservedEvent[] = [];
  const polls: PollSample[] = [];

  console.log(
    `probing ${slug}: ${options.minutes}m at ${options.interval}s intervals, ` +
      `drive=${options.drive}${approverToken ? ` (approver ${approverUsername})` : ''}`
  );
  console.log(`out: ${options.out}`);

  const deadline = Date.now() + options.minutes * 60_000;

  // The poll loop starts before the drive phase and runs alongside it. Driving
  // to completion first would fold the drive phase's own duration into the
  // first action's measured latency: an event that landed 30s after the push
  // would be stamped as first observed only once the merge finished, minutes
  // later. Overlapping them keeps `firstObservedAt` honest.
  let pollError: unknown = null;
  const polling = pollLoop({
    token,
    slug,
    intervalMs: options.interval * 1000,
    deadline,
    events,
    polls,
    eventsFile,
    pollsFile
  }).catch(err => {
    pollError = err;
  });

  let driveError: unknown = null;
  if (options.drive) {
    try {
      await drive({
        token,
        approverToken,
        slug,
        defaultBranch: 'main',
        actions,
        actionsFile
      });
    } catch (err) {
      driveError = err;
      console.error(`drive phase failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error('continuing to poll: events from the actions that did land are still worth measuring.');
    }
  }

  await polling;
  await Promise.all([actionsFile.close(), eventsFile.close(), pollsFile.close()]);

  console.log(renderReport({ actions, events, polls, minutes: options.minutes }));

  // A run whose drive or poll phase broke still prints everything it gathered,
  // but must not exit 0: the summary above is then a partial measurement, and
  // a caller reading only the exit code would take it for a complete one.
  if (driveError || pollError) {
    if (pollError) {
      console.error(`poll phase failed: ${pollError instanceof Error ? pollError.message : String(pollError)}`);
    }
    return 1;
  }
  return 0;
}

if (import.meta.main) process.exit(await main());
