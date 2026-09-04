import {
  gateAnswer,
  gateList,
  type GateAnswer,
  type GateRow,
} from '@mattstack/rt-client';
import { Hono } from 'hono';
import { validator } from 'hono/validator';

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
    const res = await gateList({
      subjectPrefix: 'run:',
      limit: GATE_LIST_PAGE_LIMIT,
      cursor,
    });
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
        res = await gateAnswer({
          id,
          answers: answers as GateAnswer['answers'],
          by: 'console',
        });
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
  );
