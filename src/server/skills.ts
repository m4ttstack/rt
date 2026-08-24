import { Hono } from 'hono';
import { validator } from 'hono/validator';

import { runGit as liveRunGit, type RunGit } from './git-bin';
import { GIT_LOG_FORMAT, parseGitLog, type GitCommit } from './gitLog';
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

interface SkillsHistoryResponse {
  pack: string;
  packDir: string;
  /** The pack is a SUBDIRECTORY of its repo, not the repo -- for the live
      demo pack, `packDir` sits three levels under this root. Reported
      so a reader can see what the history was actually taken over. */
  repoRoot: string;
  /** The pathspec the log was scoped to, relative to `packDir`. */
  scope: string;
  verb: string | null;
  /** The bound actually applied, which is the requested one clamped. */
  limit: number;
  /** True when the repo holds more history than `limit` returned. */
  truncated: boolean;
  commits: GitCommit[];
}

const historyQuery = validator(
  'query',
  (value): { pack?: string; verb?: string; limit?: string } => {
    const v = value as { pack?: unknown; verb?: unknown; limit?: unknown };
    return {
      pack: typeof v?.pack === 'string' ? v.pack : undefined,
      verb: typeof v?.verb === 'string' ? v.verb : undefined,
      limit: typeof v?.limit === 'string' ? v.limit : undefined,
    };
  }
);

/** The verb reaches git as a pathspec, so it is checked against the shape rt
    gives a verb rather than escaped: this rejects `../`, an absolute path,
    and a leading `:` (which would make it one of git's magic pathspecs). */
const VERB_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

/** An unbounded `git log` is a hot endpoint waiting to happen, so there is no
    way to ask for one: an absent, unparseable or oversized limit lands on a
    bound rather than an error, and the payload reports what was applied. */
function clampLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_HISTORY_LIMIT;
  return Math.min(Math.floor(parsed), MAX_HISTORY_LIMIT);
}

function findPackDir(payload: unknown, pack: string): string | null {
  const packs = (payload as SkillsPacksResponse | undefined)?.packs;
  if (!Array.isArray(packs)) return null;
  const row = packs.find(p => p?.name === pack);
  return typeof row?.dir === 'string' && row.dir.length > 0 ? row.dir : null;
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
export function mountSkills(
  app: Hono,
  runRt: RunRt = liveRunRt,
  runGit: RunGit = liveRunGit
) {
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
    })
    .get('/api/skills/history', historyQuery, async c => {
      const { pack, verb, limit: rawLimit } = c.req.valid('query');
      if (!pack) return c.json({ error: 'pack is required' }, 400);
      if (verb !== undefined && !VERB_NAME.test(verb)) {
        return c.json({ error: `invalid verb name: ${verb}` }, 400);
      }
      const limit = clampLimit(rawLimit);

      try {
        // The pack DIRECTORY comes from rt, never from the request: git is
        // handed a path this server resolved, so no query string reaches the
        // filesystem as a directory.
        const packs = await cachedRun(['skills', 'packs', '--json']);
        const payload = parseJsonPayload(packs.stdout);
        if (payload === undefined) {
          return c.json(
            { error: packs.stderr.trim() || 'rt produced no output' },
            502
          );
        }
        const packDir = findPackDir(payload, pack);
        if (packDir === null) {
          return c.json({ error: `no pack named "${pack}"` }, 404);
        }

        const root = await runGit([
          '-C',
          packDir,
          'rev-parse',
          '--show-toplevel',
        ]);
        if (root.code !== 0 || !root.stdout.trim()) {
          return c.json(
            { error: root.stderr.trim() || `${packDir} is not in a git repo` },
            502
          );
        }

        const scope = verb ? `skills/${verb}` : '.';
        // One over the bound, so "there is more history" is observed rather
        // than inferred from a full page.
        const log = await runGit([
          '-C',
          packDir,
          'log',
          `--max-count=${limit + 1}`,
          '--no-color',
          '--name-only',
          `--format=${GIT_LOG_FORMAT}`,
          '--',
          scope,
        ]);
        if (log.code !== 0) {
          return c.json({ error: log.stderr.trim() || 'git log failed' }, 502);
        }

        const commits = parseGitLog(log.stdout);
        const response: SkillsHistoryResponse = {
          pack,
          packDir,
          repoRoot: root.stdout.trim(),
          scope,
          verb: verb ?? null,
          limit,
          truncated: commits.length > limit,
          commits: commits.slice(0, limit),
        };
        return c.json(response, 200);
      } catch (err) {
        if (err instanceof RtNotFoundError) {
          return c.json({ error: err.message }, 503);
        }
        return c.json({ error: (err as Error).message }, 502);
      }
    });
}
