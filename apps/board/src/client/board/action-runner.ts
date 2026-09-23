/** Performs the row menu's actions: one MR with today's toasts, or many with
    one summary toast and one reload. Each request's endpoint and wording is
    described once here; launches keep their own flow (launch-flow.ts) and
    are reached through deps.launch. DOM-free, like launch-flow.ts. */
import type { BoardMR } from '../../data.ts';
import type { MrAction } from '../../mr-action.ts';
import type { ActionResult } from '../api.ts';
import type {
  ActionRequest,
  Lane,
  LaunchFlow,
  RunOpts,
} from './row-actions.ts';

export interface LaunchOpts {
  note?: string;
  intent?: 'launch' | 'focus';
  quiet?: boolean;
}

export interface RunnerDeps {
  post: (
    path: string,
    payload: Record<string, unknown>
  ) => Promise<ActionResult>;
  launch: (
    flow: LaunchFlow,
    mr: BoardMR,
    opts: LaunchOpts
  ) => Promise<ActionResult | undefined>;
  addToast: (text: string) => void;
  reload: (fresh: boolean) => void;
  /** A fired merge holds its row at "merging…" until the MR leaves the
      board; only a refusal lets go, so merge never reappears mid-flight. */
  merging: { start: (url: string) => void; fail: (url: string) => void };
}

export type RunnableRequest = Extract<
  ActionRequest,
  { kind: 'launch' | 'mr' | 'draft' | 'react' | 'find-thread' | 'ask' }
>;
type PostRequest = Exclude<RunnableRequest, { kind: 'launch' }>;

const RUNNABLE = new Set<ActionRequest['kind']>([
  'launch',
  'mr',
  'draft',
  'react',
  'find-thread',
  'ask',
]);

export function isRunnable(req: ActionRequest): req is RunnableRequest {
  return RUNNABLE.has(req.kind);
}

interface Done {
  mr: BoardMR;
  result: ActionResult;
}

interface Wording {
  fresh: boolean;
  manyDone: (done: Done[]) => string;
  manyFail: (list: string) => string;
}

const NAMED = 4;

/** A toast's MR list: the first few by number, the rest as a count. */
function iids(mrs: readonly BoardMR[]): string {
  const named = mrs
    .slice(0, NAMED)
    .map(m => `!${m.iid}`)
    .join(', ');
  return mrs.length > NAMED ? `${named} +${mrs.length - NAMED} more` : named;
}

const on = (done: Done[]) => iids(done.map(d => d.mr));

interface PostSpec extends Wording {
  path: string;
  payload: (mr: BoardMR, url: string) => Record<string, unknown>;
  pending?: (mr: BoardMR) => string;
  done?: (mr: BoardMR, r: ActionResult) => string | undefined;
  fail: (mr: BoardMR, r: ActionResult) => string;
}

const MR_WORDING: Record<
  MrAction,
  { pending: string; done: string; manyDone: string; manyVerb: string }
> = {
  merge: {
    pending: 'merging',
    done: 'merge accepted',
    manyDone: 'merge accepted on',
    manyVerb: 'merge',
  },
  rebase: {
    pending: 'rebasing',
    done: 'rebase started',
    manyDone: 'rebase started on',
    manyVerb: 'rebase',
  },
  setAutoMerge: {
    pending: 'arming auto-merge on',
    done: 'auto-merge armed for',
    manyDone: 'auto-merge armed on',
    manyVerb: 'arm auto-merge on',
  },
  cancelAutoMerge: {
    pending: 'canceling auto-merge on',
    done: 'auto-merge canceled for',
    manyDone: 'auto-merge canceled on',
    manyVerb: 'cancel auto-merge on',
  },
};

const LAUNCH_WORDING: Record<LaunchFlow, { done: string; noun: string }> = {
  review: { done: 'review started on', noun: 'review' },
  're-review': { done: 're-review started on', noun: 're-review' },
  'resume-review': { done: 'review resumed on', noun: 'review' },
  respond: { done: 'response started on', noun: 'response' },
  'resume-respond': { done: 'response resumed on', noun: 'response' },
  doctor: { done: 'doctor called on', noun: 'doctor' },
  'rebase-local': { done: 'local rebase started on', noun: 'local rebase' },
};

async function post(
  req: PostRequest,
  spec: PostSpec,
  mr: BoardMR,
  url: string,
  deps: RunnerDeps
): Promise<ActionResult> {
  const merge = req.kind === 'mr' && req.action === 'merge';
  if (merge) deps.merging.start(url);
  const result = await deps.post(spec.path, spec.payload(mr, url));
  if (merge && !result.ok) deps.merging.fail(url);
  return result;
}

function postSpec(req: PostRequest): PostSpec {
  switch (req.kind) {
    case 'mr': {
      const w = MR_WORDING[req.action];
      return {
        path: '/mr/action',
        payload: (mr, url) => ({ mrUrl: url, iid: mr.iid, action: req.action }),
        pending: mr => `${w.pending} !${mr.iid}…`,
        done: mr => `${w.done} !${mr.iid}`,
        fail: (mr, r) => `couldn't ${req.action} !${mr.iid} (${r.status})`,
        fresh: true,
        manyDone: done => `${w.manyDone} ${on(done)}`,
        manyFail: list => `couldn't ${w.manyVerb} ${list}`,
      };
    }
    case 'draft': {
      const verb = req.draft ? 'draft' : 'ready';
      return {
        path: '/draft',
        payload: (mr, url) => ({ mrUrl: url, iid: mr.iid, draft: req.draft }),
        pending: mr => `marking !${mr.iid} ${verb}…`,
        done: mr =>
          req.draft
            ? `!${mr.iid} is back to draft`
            : `!${mr.iid} is ready for review`,
        fail: (mr, r) => `couldn't mark !${mr.iid} ${verb} (${r.status})`,
        fresh: true,
        manyDone: done => `marked ${verb} on ${on(done)}`,
        manyFail: list => `couldn't mark ${list} ${verb}`,
      };
    }
    case 'react': {
      const done = req.remove ? 'unmarked' : 'marked';
      const verb = req.remove ? 'unmark' : 'add';
      return {
        path: '/slack/react',
        payload: (_mr, url) => ({
          mrUrl: url,
          emoji: req.emoji,
          remove: req.remove,
        }),
        done: mr => `${done} ${req.glyph} on !${mr.iid}`,
        fail: (mr, r) =>
          `couldn't ${verb} ${req.glyph} for !${mr.iid} (${r.status})`,
        fresh: false,
        manyDone: ok => `${done} ${req.glyph} on ${on(ok)}`,
        manyFail: list => `couldn't ${verb} ${req.glyph} for ${list}`,
      };
    }
    case 'find-thread':
      return {
        path: '/slack/resolve',
        payload: (mr, url) => ({ mrUrl: url, iid: mr.iid }),
        pending: mr => `finding slack thread for !${mr.iid}…`,
        done: (mr, r) =>
          r.body?.status === 'found'
            ? `found slack thread for !${mr.iid}`
            : `no slack thread found for !${mr.iid}`,
        fail: (mr, r) => `slack lookup failed for !${mr.iid} (${r.status})`,
        fresh: false,
        manyDone: done => {
          const found = done.filter(d => d.result.body?.status === 'found');
          const none = done.filter(d => d.result.body?.status !== 'found');
          return [
            found.length ? `slack thread found on ${on(found)}` : '',
            none.length ? `no thread on ${on(none)}` : '',
          ]
            .filter(Boolean)
            .join(' · ');
        },
        manyFail: list => `slack lookup failed for ${list}`,
      };
    case 'ask': {
      const reviewer = req.reviewer ?? '';
      return {
        path: '/nudge',
        payload: (mr, url) => ({
          mrUrl: url,
          iid: mr.iid,
          reviewer,
          kind: req.ask,
        }),
        pending: mr => `requesting ${req.ask} of !${mr.iid} from ${reviewer}…`,
        done: (_mr, r) =>
          r.body?.queued
            ? `switchboard unreachable... queued the ask to ${reviewer}`
            : undefined,
        // A 409 carries the relay's own reason in plain text; that is the
        // whole point of the failure, so it wins over the status.
        fail: (mr, r) =>
          r.text.trim() ||
          `couldn't request ${req.ask} for !${mr.iid} (${r.status})`,
        fresh: false,
        manyDone: done => `asked ${reviewer} on ${on(done)}`,
        manyFail: list => `couldn't ask ${reviewer} on ${list}`,
      };
    }
  }
}

export async function runOne(
  req: RunnableRequest,
  mr: BoardMR,
  deps: RunnerDeps,
  note?: string
): Promise<ActionResult | undefined> {
  if (req.kind === 'launch')
    return deps.launch(req.flow, mr, { note, intent: req.intent });
  const url = mr.webUrl;
  if (!url) return undefined;
  const spec = postSpec(req);
  const pending = spec.pending?.(mr);
  if (pending) deps.addToast(pending);
  const result = await post(req, spec, mr, url, deps);
  if (!result.ok) {
    deps.addToast(spec.fail(mr, result));
    return result;
  }
  const done = spec.done?.(mr, result);
  if (done) deps.addToast(done);
  deps.reload(spec.fresh);
  return result;
}

export const BULK_CONCURRENCY = 4;

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return out;
}

function bulkPlan(req: RunnableRequest): Wording & {
  run: (mr: BoardMR, deps: RunnerDeps) => Promise<ActionResult | undefined>;
} {
  if (req.kind === 'launch') {
    const w = LAUNCH_WORDING[req.flow];
    return {
      run: (mr, deps) => deps.launch(req.flow, mr, { quiet: true }),
      fresh: false,
      manyDone: done => `${w.done} ${on(done)}`,
      manyFail: list => `couldn't launch ${w.noun} for ${list}`,
    };
  }
  const spec = postSpec(req);
  return {
    run: (mr, deps) =>
      mr.webUrl
        ? post(req, spec, mr, mr.webUrl, deps)
        : Promise.resolve(undefined),
    fresh: spec.fresh,
    manyDone: spec.manyDone,
    manyFail: spec.manyFail,
  };
}

export async function runMany(
  req: RunnableRequest,
  targets: readonly BoardMR[],
  deps: RunnerDeps,
  skipped = 0
): Promise<void> {
  // A stale picker snapshot (runBulk's pickTargets.get(pick) ?? []) can reach
  // here empty; an empty run has nothing to toast or reload.
  if (targets.length === 0) return;
  const plan = bulkPlan(req);
  const results = await mapLimit(targets, BULK_CONCURRENCY, mr =>
    plan.run(mr, deps)
  );
  const done: Done[] = [];
  const failed: Array<{ mr: BoardMR; result: ActionResult | undefined }> = [];
  targets.forEach((mr, i) => {
    const result = results[i];
    if (result?.ok) done.push({ mr, result });
    else failed.push({ mr, result });
  });
  const parts: string[] = [];
  if (done.length) parts.push(plan.manyDone(done));
  if (failed.length) {
    const only = failed.length === 1 ? failed[0]?.result : undefined;
    parts.push(
      plan.manyFail(iids(failed.map(f => f.mr))) +
        (only ? ` (${only.status})` : '')
    );
  }
  if (skipped > 0) parts.push(`${skipped} didn't need it`);
  deps.addToast(parts.join(' · '));
  deps.reload(plan.fresh);
}

export function runBulk(
  entry: {
    request: ActionRequest;
    targets: readonly BoardMR[];
    /** How many MRs are checked; the ones not targeted were skipped. */
    selected?: number;
    pickTargets?: ReadonlyMap<string, readonly BoardMR[]>;
  },
  opts: RunOpts,
  deps: RunnerDeps
): Promise<void> | undefined {
  const req = entry.request;
  if (!isRunnable(req)) return undefined;
  const skipped = (targets: readonly BoardMR[]) =>
    Math.max(0, (entry.selected ?? targets.length) - targets.length);
  if (req.kind === 'ask') {
    if (!opts.pick) return undefined;
    const targets = entry.pickTargets?.get(opts.pick) ?? [];
    return runMany(
      { ...req, reviewer: opts.pick },
      targets,
      deps,
      skipped(targets)
    );
  }
  return runMany(req, entry.targets, deps, skipped(entry.targets));
}

/** The one-row menu's own effects that are not requests to run. */
export interface RowHandlers {
  copy: (mr: BoardMR) => void;
  note: (mr: BoardMR) => void;
  open: (url: string) => void;
  viewReport: (mr: BoardMR, lane: 'review' | 'respond') => void;
  dismiss: (mr: BoardMR, lane: Lane) => void;
  standDown: (mr: BoardMR, on: boolean) => void;
  postSlack: (mr: BoardMR) => void;
}

export function dispatchRowAction(
  req: ActionRequest,
  mr: BoardMR,
  opts: RunOpts,
  deps: RunnerDeps,
  h: RowHandlers
): Promise<ActionResult | undefined> | undefined {
  switch (req.kind) {
    case 'copy':
      h.copy(mr);
      return undefined;
    case 'note':
      h.note(mr);
      return undefined;
    case 'open':
      if (req.url) h.open(req.url);
      return undefined;
    case 'view-report':
      h.viewReport(mr, req.lane);
      return undefined;
    case 'dismiss':
      h.dismiss(mr, req.lane);
      return undefined;
    case 'stand-down':
      h.standDown(mr, req.on);
      return undefined;
    case 'post-slack':
      h.postSlack(mr);
      return undefined;
    case 'ask':
      return runOne({ ...req, reviewer: opts.pick ?? req.reviewer }, mr, deps);
    default:
      return runOne(req, mr, deps, opts.note);
  }
}
