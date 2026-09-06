import { realpathSync } from 'node:fs';
import {
  gateAnswer,
  gateList,
  paneFocus,
  paneList,
  type GateAnswer,
  type GateRow,
} from '@mattstack/rt-client';
import { Hono } from 'hono';
import { validator } from 'hono/validator';

/** Read fresh per call, not cached at module scope -- this is the shared
    test seam across every rt-client call site in this file (panes.ts uses
    the same pattern), and a cached snapshot would miss a test that sets it
    after import. */
function rtClientOptions(): { sockPath: string | undefined } {
  return { sockPath: process.env.RT_SOCK_PATH };
}

/** The daemon's cursor is a resume position, not a done-signal -- it stays
    non-zero on the last page too, so a falsy check would loop forever.
    A short page (fewer rows than the limit) or a repeated cursor (no
    forward progress) are the only reliable stop conditions. */
const GATE_LIST_PAGE_LIMIT = 200;

async function listAllRunGates(): Promise<
  { ok: true; gates: GateRow[] } | { ok: false; error: string }
> {
  const gates: GateRow[] = [];
  let cursor: number | undefined;
  for (;;) {
    const res = await gateList(
      {
        subjectPrefix: 'run:',
        limit: GATE_LIST_PAGE_LIMIT,
        cursor,
      },
      rtClientOptions()
    );
    if (!res.ok || !res.data) {
      return {
        ok: false,
        error: res.error ?? 'gate:list failed with no error detail',
      };
    }
    gates.push(...res.data.gates);
    if (
      res.data.gates.length < GATE_LIST_PAGE_LIMIT ||
      res.data.cursor === cursor
    )
      break;
    cursor = res.data.cursor;
  }
  return { ok: true, gates };
}

/** Exact equality, not a substring/regex test: a strict-membership rejection
    can legitimately echo an option value like "closed"
    (e.g. an invalid answer naming a "closed" option), which a substring
    match would misroute to 404. */
function isMissingGateError(message: string): boolean {
  return message === 'not-found' || message === 'closed';
}

/** The rt-client transport's own error-shape prefix (rtCommand's catch) for
    a failed socket connection -- distinct from a daemon-issued validation
    rejection, which never carries this text. */
const UNREACHABLE_PREFIX = 'rt daemon unreachable';

function isUnreachableError(message: string): boolean {
  return message.startsWith(UNREACHABLE_PREFIX);
}

/** Collapses cosmetic divergence between what an opener stamped as
    origin.worktree and what herdr reports as a live pane's cwd -- a
    trailing slash, or a macOS /tmp -> /private/tmp symlink -- that would
    otherwise silently fail an exact-string match. Falls back to the
    trimmed input when the path no longer resolves on disk (a stale
    worktree is still worth comparing verbatim rather than throwing). */
function normalizeCwd(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  try {
    return realpathSync(trimmed);
  } catch {
    return trimmed;
  }
}

/** Same resolution rule as the board's origin-focus resolver: a direct
    paneId wins outright (no pane list round trip needed), a worktree falls
    back to matching a live pane's cwd, and anything else is unresolvable.
    `panesUnavailable` distinguishes "the pane list itself could not be
    fetched" from "the pane list came back but nothing in it matches" --
    both degrade to the same panes:[] shape, but they are different failure
    reasons for whoever reads the 400. */
export function resolveOriginFocus(
  origin: GateRow['origin'] | undefined,
  panes: Array<{ paneId: string; cwd?: string }>,
  opts: { panesUnavailable?: boolean } = {}
): { ok: true; paneId: string } | { ok: false; reason: string } {
  if (origin?.paneId) return { ok: true, paneId: origin.paneId };
  if (origin?.worktree) {
    if (opts.panesUnavailable) {
      return { ok: false, reason: 'could not list live panes' };
    }
    const target = normalizeCwd(origin.worktree);
    const match = panes.find(
      p => p.cwd !== undefined && normalizeCwd(p.cwd) === target
    );
    return match
      ? { ok: true, paneId: match.paneId }
      : { ok: false, reason: 'no live pane matches the origin worktree' };
  }
  return { ok: false, reason: 'no origin on this gate' };
}

export const gates = new Hono()
  .get('/api/gates', async c => {
    const res = await listAllRunGates();
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json({ gates: res.gates }, 200);
  })
  .post(
    '/api/gates/:id/answer',
    validator('json', (value): { answers: unknown } => {
      const v = value as { answers?: unknown };
      return { answers: v?.answers };
    }),
    async c => {
      const { id } = c.req.param();
      const { answers } = c.req.valid('json');
      if (!answers || typeof answers !== 'object') {
        return c.json({ error: 'answers is required' }, 400);
      }

      let res: Awaited<ReturnType<typeof gateAnswer>>;
      try {
        res = await gateAnswer(
          {
            id,
            answers: answers as GateAnswer['answers'],
            by: 'console',
          },
          rtClientOptions()
        );
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : String(err) },
          502
        );
      }

      if (!res.ok || !res.data) {
        const message = res.error ?? 'gate:answer failed with no error detail';
        if (isMissingGateError(message)) return c.json({ error: message }, 404);
        if (isUnreachableError(message)) return c.json({ error: message }, 502);
        return c.json({ error: message }, 400);
      }

      if (res.data.conflict) return c.json({ row: res.data.row }, 409);
      return c.json({ row: res.data.row }, 200);
    }
  )
  .post('/api/gates/:id/focus', async c => {
    const { id } = c.req.param();
    const all = await listAllRunGates();
    if (!all.ok) return c.json({ error: all.error }, 502);
    const row = all.gates.find(g => g.id === id);
    if (!row) return c.json({ error: 'not-found' }, 404);
    let panes: Array<{ paneId: string; cwd?: string }> = [];
    let panesUnavailable = false;
    if (!row.origin?.paneId && row.origin?.worktree) {
      const panesRes = await paneList(rtClientOptions());
      if (panesRes.ok && panesRes.data) {
        panes = panesRes.data.panes;
      } else {
        panesUnavailable = true;
      }
    }
    const resolved = resolveOriginFocus(row.origin ?? undefined, panes, {
      panesUnavailable,
    });
    if (!resolved.ok) return c.json({ error: resolved.reason }, 400);
    const focusRes = await paneFocus(
      { paneId: resolved.paneId },
      rtClientOptions()
    );
    if (!focusRes.ok) return c.json({ error: focusRes.error }, 502);
    return c.json({ focused: true }, 200);
  });
