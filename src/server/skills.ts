import { Hono } from 'hono';
import { validator } from 'hono/validator';

import { runRt as liveRunRt, RtNotFoundError, type RunRt } from './rt-bin';

interface SkillsPackRow {
  name: string;
  dir: string;
  layout: 'flat' | 'grouped';
}
interface SkillsPacksResponse {
  packs: SkillsPackRow[];
}

interface SkillsCompositionSlot {
  name: string;
  contract: string;
  required: boolean;
  boundTo: string | null;
  fillSourcePath: string | null;
  fillVersion: string | null;
  registered: boolean | null;
  inlined: boolean | null;
  resolveError?: string;
}
interface SkillsCompositionVerb {
  name: string;
  engine: string;
  engineRef: string | null;
  plugin: string | null;
  description: string;
  public: boolean;
  sourcePath: string | null;
  artifactPath: string;
  slots: SkillsCompositionSlot[];
  engineError?: string;
}
interface SkillsCompositionBinder {
  ref: string;
  verb: string | null;
  kind: 'verb' | 'stage' | 'skill' | 'external';
  slots: { name: string; boundTo: string }[];
}
interface SkillsCompositionFill {
  binding: string;
  provides: string;
  sourcePath: string;
  registered: boolean;
}
interface SkillsCompositionResponse {
  pack: string;
  packDir: string;
  verbs: SkillsCompositionVerb[];
  fills: SkillsCompositionFill[];
  binders: SkillsCompositionBinder[];
  /** Work type -> its ordered stage refs. The payload's only record of
      execution order: `binders[].kind` says a ref IS a stage, never where it
      runs. Optional because an rt older than the field answers without it,
      and the client has to be able to tell that apart from a pack with no
      pipelines. */
  pipelines?: Record<string, string[]>;
}

interface SkillsCheckVerbRow {
  name: string;
  status: 'in-sync' | 'stale' | 'never-compiled' | 'internal-unchecked';
  staleFiles: string[];
  orphanFiles: string[];
}
interface SkillsCheckResponse {
  pack: string;
  packDir: string;
  verbs: SkillsCheckVerbRow[];
}

interface SkillsSurfaceRow {
  name: string;
  kind: 'compiled' | 'hand-authored' | 'missing';
  status: 'public' | 'internal';
}
interface SkillsSurfaceResponse {
  pack: string;
  packDir: string;
  rows: SkillsSurfaceRow[];
}

interface SkillsCompilePreviewResponse {
  content: string;
}

type RtRunResult = { code: number; stdout: string; stderr: string };

/**
 * `rt skills check`/`compile` set exit 1 for the NORMAL case this surface
 * exists to show (drift, lint errors) as well as for every usage error --
 * the exit code alone can't tell those apart. A parseable JSON payload on
 * stdout is what actually distinguishes "rt answered" from "rt refused."
 */
function parseJsonPayload(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

const packQuery = validator('query', (value): { pack?: string } => {
  const v = value as { pack?: unknown };
  return { pack: typeof v?.pack === 'string' ? v.pack : undefined };
});

const compileQuery = validator(
  'query',
  (value): { pack?: string; verb?: string } => {
    const v = value as { pack?: unknown; verb?: unknown };
    return {
      pack: typeof v?.pack === 'string' ? v.pack : undefined,
      verb: typeof v?.verb === 'string' ? v.verb : undefined,
    };
  }
);

/** A Wiring page load fetches four routes for one pack at once -- four
    `claude` subprocesses inside four `rt` subprocesses. Scoped inside
    `mountSkills` so every mounted app gets its own cache lifetime rather
    than sharing one across unrelated app instances (tests included). */
const CACHE_TTL_MS = 5_000;

/**
 * `runRt` defaults to the real, Bun-backed spawner; tests inject a fake with
 * no `Bun` global involved. The return type is left inferred -- annotating
 * it `Hono` erases the chained route types and `AppType` loses this surface.
 */
export function mountSkills(app: Hono, runRt: RunRt = liveRunRt) {
  const cache = new Map<string, { at: number; result: RtRunResult }>();

  async function cachedRun(argv: string[]): Promise<RtRunResult> {
    const key = JSON.stringify(argv);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;
    const result = await runRt(argv);
    cache.set(key, { at: Date.now(), result });
    return result;
  }

  return app
    .get('/api/skills/packs', async c => {
      try {
        const { stdout, stderr } = await cachedRun([
          'skills',
          'packs',
          '--json',
        ]);
        const payload = parseJsonPayload(stdout);
        if (payload === undefined) {
          return c.json(
            { error: stderr.trim() || 'rt produced no output' },
            502
          );
        }
        return c.json(payload as SkillsPacksResponse, 200);
      } catch (err) {
        if (err instanceof RtNotFoundError) {
          return c.json({ error: err.message }, 503);
        }
        return c.json({ error: (err as Error).message }, 502);
      }
    })
    .get('/api/skills/composition', packQuery, async c => {
      const { pack } = c.req.valid('query');
      if (!pack) return c.json({ error: 'pack is required' }, 400);
      try {
        const { stdout, stderr } = await cachedRun([
          'skills',
          'composition',
          '--pack',
          pack,
          '--json',
        ]);
        const payload = parseJsonPayload(stdout);
        if (payload === undefined) {
          return c.json(
            { error: stderr.trim() || 'rt produced no output' },
            502
          );
        }
        return c.json(payload as SkillsCompositionResponse, 200);
      } catch (err) {
        if (err instanceof RtNotFoundError) {
          return c.json({ error: err.message }, 503);
        }
        return c.json({ error: (err as Error).message }, 502);
      }
    })
    .get('/api/skills/check', packQuery, async c => {
      const { pack } = c.req.valid('query');
      if (!pack) return c.json({ error: 'pack is required' }, 400);
      try {
        const { stdout, stderr } = await cachedRun([
          'skills',
          'check',
          '--pack',
          pack,
          '--json',
        ]);
        const payload = parseJsonPayload(stdout);
        if (payload === undefined) {
          return c.json(
            { error: stderr.trim() || 'rt produced no output' },
            502
          );
        }
        return c.json(payload as SkillsCheckResponse, 200);
      } catch (err) {
        if (err instanceof RtNotFoundError) {
          return c.json({ error: err.message }, 503);
        }
        return c.json({ error: (err as Error).message }, 502);
      }
    })
    .get('/api/skills/surface', packQuery, async c => {
      const { pack } = c.req.valid('query');
      if (!pack) return c.json({ error: 'pack is required' }, 400);
      try {
        const { stdout, stderr } = await cachedRun([
          'skills',
          'surface',
          'list',
          '--pack',
          pack,
          '--json',
        ]);
        const payload = parseJsonPayload(stdout);
        if (payload === undefined) {
          return c.json(
            { error: stderr.trim() || 'rt produced no output' },
            502
          );
        }
        return c.json(payload as SkillsSurfaceResponse, 200);
      } catch (err) {
        if (err instanceof RtNotFoundError) {
          return c.json({ error: err.message }, 503);
        }
        return c.json({ error: (err as Error).message }, 502);
      }
    })
    .get('/api/skills/compile', compileQuery, async c => {
      const { pack, verb } = c.req.valid('query');
      if (!pack) return c.json({ error: 'pack is required' }, 400);
      if (!verb) return c.json({ error: 'verb is required' }, 400);
      try {
        // `--preview`'s contract is stdout-is-the-body -- unlike the other
        // routes here, a successful result is the raw compiled SKILL.md
        // text, not JSON, so it's wrapped rather than parsed.
        const { stdout, stderr } = await cachedRun([
          'skills',
          'compile',
          '--pack',
          pack,
          '--verb',
          verb,
          '--preview',
        ]);
        if (!stdout.trim()) {
          return c.json(
            { error: stderr.trim() || 'rt produced no output' },
            502
          );
        }
        return c.json({ content: stdout } as SkillsCompilePreviewResponse, 200);
      } catch (err) {
        if (err instanceof RtNotFoundError) {
          return c.json({ error: err.message }, 503);
        }
        return c.json({ error: (err as Error).message }, 502);
      }
    });
}
