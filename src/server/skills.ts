import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  /** The `{{include:<name>}}` attachments the compiler inlines, in source
      order. Optional because an rt older than the field answers without it. */
  includes?: string[];
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
  /** The manifest's absolute path on disk, or `null` for a rosterless pack.
      Optional because an rt older than this field answers without it --
      absent and null both mean "no path to show," and neither is a path a
      caller may fabricate. */
  manifestPath?: string | null;
}

interface SkillsCheckVerbRow {
  name: string;
  status: 'in-sync' | 'stale' | 'never-compiled';
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

/** One `rt skills surface set <name...> --public|--internal` invocation and
    what it did. `ok: false` on the direction that failed; a direction never
    attempted (the sequence stopped before it) has no entry at all. */
interface SkillsSurfaceApplyStep {
  direction: 'public' | 'internal';
  names: string[];
  ok: boolean;
  error?: string;
}

interface SkillsSurfaceApplyResponse {
  pack: string;
  /** In attempt order -- at most two entries, since a delta is bounded to
      one `--public` call and one `--internal` call. */
  steps: SkillsSurfaceApplyStep[];
  /** Re-read from disk after the attempt, whatever it landed at -- the
      honest partial-failure answer. Null ONLY when that re-read itself
      could not be parsed: never backfilled with the pre-write roster this
      route validated against, which would dress stale data as current
      truth. `reReadError` carries why when this is null. */
  rows: SkillsSurfaceRow[] | null;
  reReadError?: string;
}

/** One `rt skills bind <verb> <slot> <fill> --pack <pack>` invocation and
    what it did. `ok: false` carries rt's own stderr as `error` -- the same
    honest-failure shape `SkillsSurfaceApplyStep` uses. */
interface SkillsBindResponse {
  pack: string;
  verb: string;
  slot: string;
  fill: string;
  ok: boolean;
  error?: string;
}

interface SkillsCompilePreviewResponse {
  content: string;
}

/**
 * What is true of this machine right now, as opposed to what the log says.
 * `null` for a fact this request failed to measure -- unmeasured and clean
 * are different answers, and collapsing them would report a dirty tree as a
 * clean one whenever `git status` fell over.
 */
interface SkillsRuntimeFacts {
  /** Paths `git status` reported as changed within `scope`, relative to the
      REPOSITORY ROOT (the same frame `--name-only` uses), capped. Null when
      status did not answer. */
  dirtyFiles: string[] | null;
  /** True when `dirtyFiles` was cut to the cap. */
  moreDirtyFiles: boolean;
  /** The version the pack's own `.claude-plugin/plugin.json` declares --
      what an install of this pack registers. Null when the pack carries no
      such manifest, or it does not parse. */
  packVersion: string | null;
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
  /** Deliberately a SEPARATE object rather than extra rows in `commits`:
      these are momentary and true only of this machine, and the surface
      renders them as their own region for that reason. */
  runtime: SkillsRuntimeFacts;
}

interface SkillsDiffResponse {
  pack: string;
  packDir: string;
  repoRoot: string;
  /** The pathspec the diff was taken over, relative to `packDir`. Whole-pack:
      a verb's slot fills live under `attachments/`, outside its own
      `skills/<verb>/`, so scoping to the verb would drop exactly the hunks a
      seam can attribute. */
  scope: string;
  from: string;
  to: string;
  /** True when the diff was cut at the byte bound. */
  truncated: boolean;
  /** Unified diff text, verbatim, with paths relative to `packDir`. */
  diff: string;
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

const diffQuery = validator(
  'query',
  (value): { pack?: string; from?: string; to?: string } => {
    const v = value as { pack?: unknown; from?: unknown; to?: unknown };
    return {
      pack: typeof v?.pack === 'string' ? v.pack : undefined,
      from: typeof v?.from === 'string' ? v.from : undefined,
      to: typeof v?.to === 'string' ? v.to : undefined,
    };
  }
);

/** The verb reaches git as a pathspec, so it is checked against the shape rt
    gives a verb rather than escaped: this rejects `../`, an absolute path,
    and a leading `:` (which would make it one of git's magic pathspecs). */
const VERB_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A commit reaches git as a revision, where a branch name, `HEAD@{1}` and
    `..` all mean something. Only an object name gets through, so the only
    revisions this route can name are ones the history route listed. */
const COMMIT_SHA = /^[0-9a-f]{7,40}$/;

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

/** A restamp of a large pack rewrites every compiled verb at once, so a diff
    across two of them is genuinely big; past this it is cut and says so
    rather than streaming megabytes into a drawer. */
const MAX_DIFF_BYTES = 400_000;

/** The dirty list is a signal, not an inventory -- past this the count is
    what matters and the surface says there are more. */
const MAX_DIRTY_FILES = 20;

const PLUGIN_MANIFEST = '.claude-plugin/plugin.json';

/** An unbounded `git log` is a hot endpoint waiting to happen, so there is no
    way to ask for one: an absent, unparseable or oversized limit lands on a
    bound rather than an error, and the payload reports what was applied. */
function clampLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_HISTORY_LIMIT;
  return Math.min(Math.floor(parsed), MAX_HISTORY_LIMIT);
}

/**
 * `git status --porcelain` C-quotes a path that carries a space, a quote or a
 * non-ASCII byte, and leaves every other path bare. Unquoted here so the list
 * holds the same names `--name-only` prints; left quoted, such a path could
 * never match anything a reader is looking at.
 */
function unquoteStatusPath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw;
  const body = raw.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\') {
      out += body[i];
      continue;
    }
    const next = body[i + 1];
    // Octal is how git writes a non-ASCII byte; it emits three digits, and
    // the bytes of one UTF-8 character arrive as consecutive escapes, so
    // decoding them one at a time and letting them concatenate is correct
    // only because the result is re-read as UTF-8 below.
    if (next >= '0' && next <= '7') {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
      continue;
    }
    const simple: Record<string, string> = {
      n: '\n',
      t: '\t',
      r: '\r',
      '"': '"',
      '\\': '\\',
    };
    out += simple[next] ?? next;
    i += 1;
  }
  // The octal escapes above produced raw BYTES as char codes; this is what
  // turns a multi-byte sequence back into the character it spells.
  return new TextDecoder().decode(Uint8Array.from(out, c => c.charCodeAt(0)));
}

/**
 * Paths out of `git status --porcelain`, which prints `XY <path>` and, for a
 * rename, `XY <orig> -> <new>`. The new name is the one that matches a
 * `--name-only` path and a seam's source, so a rename reports as its
 * destination.
 */
function parseGitStatus(stdout: string): string[] {
  const paths: string[] = [];
  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue;
    const entry = line.slice(3);
    // Only a rename or a copy carries the arrow. Splitting on it regardless
    // would truncate a file whose own name contains ` -> `, which git quotes
    // but does not escape.
    const renamed = line[0] === 'R' || line[0] === 'C';
    const arrow = renamed ? entry.lastIndexOf(' -> ') : -1;
    paths.push(
      unquoteStatusPath(arrow === -1 ? entry : entry.slice(arrow + 4))
    );
  }
  return paths;
}

/** Cut at a line boundary, so the tail of a truncated diff is never half a
    hunk header that a parser would then read as a real one. */
function boundDiff(stdout: string): { diff: string; truncated: boolean } {
  if (stdout.length <= MAX_DIFF_BYTES)
    return { diff: stdout, truncated: false };
  const cut = stdout.lastIndexOf('\n', MAX_DIFF_BYTES);
  return {
    diff: stdout.slice(0, cut === -1 ? MAX_DIFF_BYTES : cut + 1),
    truncated: true,
  };
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

/** The one filesystem read on this surface, injected the same way `runRt`
    and `runGit` are so the routes stay testable without touching a real
    pack. Only ever handed a path built from a server-resolved `packDir`. */
export type ReadPackFile = (path: string) => Promise<string>;

const liveReadPackFile: ReadPackFile = path => readFile(path, 'utf8');

const packQuery = validator('query', (value): { pack?: string } => {
  const v = value as { pack?: unknown };
  return { pack: typeof v?.pack === 'string' ? v.pack : undefined };
});

/** A malformed `toPublic`/`toInternal` (missing, or not an array of
    strings) comes back `undefined` rather than coerced -- the route treats
    that as a 400, never as an empty delta that would silently no-op. */
function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(v => typeof v === 'string')
    ? (value as string[])
    : undefined;
}

const surfaceApplyBody = validator(
  'json',
  (value): { pack?: string; toPublic?: string[]; toInternal?: string[] } => {
    const v = value as {
      pack?: unknown;
      toPublic?: unknown;
      toInternal?: unknown;
    };
    return {
      pack: typeof v?.pack === 'string' ? v.pack : undefined,
      toPublic: stringArray(v?.toPublic),
      toInternal: stringArray(v?.toInternal),
    };
  }
);

const bindBody = validator(
  'json',
  (value): { pack?: string; verb?: string; slot?: string; fill?: string } => {
    const v = value as {
      pack?: unknown;
      verb?: unknown;
      slot?: unknown;
      fill?: unknown;
    };
    return {
      pack: typeof v?.pack === 'string' ? v.pack : undefined,
      verb: typeof v?.verb === 'string' ? v.verb : undefined,
      slot: typeof v?.slot === 'string' ? v.slot : undefined,
      fill: typeof v?.fill === 'string' ? v.fill : undefined,
    };
  }
);

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
  runGit: RunGit = liveRunGit,
  readPackFile: ReadPackFile = liveReadPackFile
) {
  const cache = new Map<string, { at: number; result: RtRunResult }>();

  /** The pack's registered version, or null. Never throws: a pack with no
      plugin manifest is a pack whose version nothing states, which the
      surface renders as such -- it is not a reason to fail the timeline. */
  async function packVersionOf(packDir: string): Promise<string | null> {
    try {
      const raw = await readPackFile(join(packDir, PLUGIN_MANIFEST));
      const version = (JSON.parse(raw) as { version?: unknown }).version;
      return typeof version === 'string' && version.length > 0 ? version : null;
    } catch {
      return null;
    }
  }

  /** Null when status did not answer -- see `SkillsRuntimeFacts.dirtyFiles`. */
  async function dirtyFilesIn(
    packDir: string,
    scope: string
  ): Promise<string[] | null> {
    const status = await runGit([
      '-C',
      packDir,
      'status',
      '--porcelain',
      '--',
      scope,
    ]);
    return status.code === 0 ? parseGitStatus(status.stdout) : null;
  }

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
    .post('/api/skills/surface/apply', surfaceApplyBody, async c => {
      const { pack, toPublic, toInternal } = c.req.valid('json');
      if (!pack) return c.json({ error: 'pack is required' }, 400);
      if (toPublic === undefined || toInternal === undefined) {
        return c.json(
          { error: 'toPublic and toInternal must be arrays of strings' },
          400
        );
      }
      if (toPublic.length === 0 && toInternal.length === 0) {
        return c.json({ error: 'delta is empty' }, 400);
      }

      const allNames = [...toPublic, ...toInternal];
      for (const name of allNames) {
        if (!VERB_NAME.test(name)) {
          return c.json({ error: `invalid name: ${name}` }, 400);
        }
      }
      const publicSet = new Set(toPublic);
      const bothDirections = toInternal.find(name => publicSet.has(name));
      if (bothDirections) {
        return c.json(
          { error: `"${bothDirections}" is staged in both directions` },
          400
        );
      }

      try {
        // Never `cachedRun` here: this is about to write, so the roster it
        // validates against -- and the roster it reports back -- must be
        // what is really on disk right now, not up to CACHE_TTL_MS stale.
        const before = await runRt([
          'skills',
          'surface',
          'list',
          '--pack',
          pack,
          '--json',
        ]);
        const beforePayload = parseJsonPayload(before.stdout);
        if (beforePayload === undefined) {
          return c.json(
            { error: before.stderr.trim() || 'rt produced no output' },
            502
          );
        }
        const roster = beforePayload as SkillsSurfaceResponse;
        const known = new Set(roster.rows.map(row => row.name));
        // Checked against the roster BEFORE any name reaches an argv -- an
        // unknown name is rejected here, never handed to a spawn.
        const unknown = allNames.find(name => !known.has(name));
        if (unknown) {
          return c.json(
            { error: `"${unknown}" is not in ${pack}'s surface roster` },
            400
          );
        }

        const plan: { direction: 'public' | 'internal'; names: string[] }[] =
          [];
        if (toPublic.length > 0)
          plan.push({ direction: 'public', names: toPublic });
        if (toInternal.length > 0)
          plan.push({ direction: 'internal', names: toInternal });

        // Sequential, never concurrent: both directions write surface.jsonc
        // and run git in the same pack directory. Stops at the first
        // failure so a partial result is reported honestly rather than
        // papered over by a second write racing the first.
        //
        // REQUIRES an rt whose `skills surface set` accepts more than one
        // name in a single call -- feat/skills-json `7c4b02c` or later. On
        // an older rt (single-name `set` only), a step with >1 name exits
        // non-zero with a usage error; `ok` below goes false and that step's
        // `error` carries rt's own message. It never partially applies and
        // never reports success against an rt that cannot do this.
        const steps: SkillsSurfaceApplyStep[] = [];
        for (const step of plan) {
          const run = await runRt([
            'skills',
            'surface',
            'set',
            ...step.names,
            `--${step.direction}`,
            '--pack',
            pack,
          ]);
          const ok = run.code === 0;
          steps.push({
            direction: step.direction,
            names: step.names,
            ok,
            error: ok ? undefined : run.stderr.trim() || 'rt exited nonzero',
          });
          if (!ok) break;
        }

        // `surface set` runs a full pack recompile, so it changes far more than
        // the roster: composition (a verb's public flag), check (drift), and
        // compile all read the pack too, and every one of them is cached in
        // this same map under an argv that names the pack. Dropping only the
        // `surface list` key would leave those answering pre-write for the rest
        // of the TTL. Invalidate every entry whose argv carries this pack.
        for (const key of cache.keys()) {
          let argv: unknown;
          try {
            argv = JSON.parse(key);
          } catch {
            continue;
          }
          if (Array.isArray(argv) && argv.includes(pack)) cache.delete(key);
        }

        const after = await runRt([
          'skills',
          'surface',
          'list',
          '--pack',
          pack,
          '--json',
        ]);
        const afterPayload = parseJsonPayload(after.stdout);
        // Never the pre-write `roster.rows` here: an apply that landed and
        // then hit an unparseable re-read must say "could not re-read", not
        // silently show the caller what disk looked like before the write.
        const rows =
          afterPayload !== undefined
            ? (afterPayload as SkillsSurfaceResponse).rows
            : null;
        const reReadError =
          afterPayload !== undefined
            ? undefined
            : after.stderr.trim() || 'rt produced no output';

        const allOk = steps.every(step => step.ok);
        const response: SkillsSurfaceApplyResponse = {
          pack,
          steps,
          rows,
          reReadError,
        };
        return c.json(response, allOk ? 200 : 502);
      } catch (err) {
        if (err instanceof RtNotFoundError) {
          return c.json({ error: err.message }, 503);
        }
        return c.json({ error: (err as Error).message }, 502);
      }
    })
    .post('/api/skills/bind', bindBody, async c => {
      const { pack, verb, slot, fill } = c.req.valid('json');
      if (!pack) return c.json({ error: 'pack is required' }, 400);
      if (!verb) return c.json({ error: 'verb is required' }, 400);
      if (!slot) return c.json({ error: 'slot is required' }, 400);
      if (!fill) return c.json({ error: 'fill is required' }, 400);

      try {
        // Never `cachedRun` here: this is about to write, so `verb`/`slot`/
        // `fill` are checked against the roster and fills as they really are
        // right now, not up to CACHE_TTL_MS stale -- the same rule the
        // surface-apply route follows before its own write.
        const compositionRun = await runRt([
          'skills',
          'composition',
          '--pack',
          pack,
          '--json',
        ]);
        const compositionPayload = parseJsonPayload(compositionRun.stdout);
        if (compositionPayload === undefined) {
          return c.json(
            {
              error: compositionRun.stderr.trim() || 'rt produced no output',
            },
            502
          );
        }
        const composition = compositionPayload as SkillsCompositionResponse;

        // Checked against the roster/composition BEFORE any of the three
        // names reaches an argv -- a name that is not really this pack's is
        // rejected here, never handed to a spawn.
        const verbEntry = composition.verbs.find(v => v.name === verb);
        if (!verbEntry) {
          return c.json({ error: `"${verb}" is not in ${pack}'s roster` }, 400);
        }
        const slotEntry = verbEntry.slots.find(s => s.name === slot);
        if (!slotEntry) {
          return c.json({ error: `"${slot}" is not a slot on "${verb}"` }, 400);
        }
        const fillEntry = composition.fills.find(f => f.binding === fill);
        if (!fillEntry) {
          return c.json(
            { error: `"${fill}" is not a known fill in ${pack}` },
            400
          );
        }
        if (fillEntry.provides !== slotEntry.contract) {
          return c.json(
            {
              error: `"${fill}" provides "${fillEntry.provides}", not "${slotEntry.contract}" required by ${verb}'s "${slot}" slot`,
            },
            400
          );
        }

        const run = await runRt([
          'skills',
          'bind',
          verb,
          slot,
          fill,
          '--pack',
          pack,
        ]);
        const ok = run.code === 0;

        if (ok) {
          // `bind` recompiles the verb, so composition/check/compile all go
          // stale too -- the same per-pack cache sweep the surface-apply
          // route runs after `e8f4163`. Never a narrower invalidation: a
          // written binding changes what every one of those routes answers.
          for (const key of cache.keys()) {
            let argv: unknown;
            try {
              argv = JSON.parse(key);
            } catch {
              continue;
            }
            if (Array.isArray(argv) && argv.includes(pack)) cache.delete(key);
          }
        }

        const response: SkillsBindResponse = {
          pack,
          verb,
          slot,
          fill,
          ok,
          error: ok ? undefined : run.stderr.trim() || 'rt exited nonzero',
        };
        return c.json(response, ok ? 200 : 502);
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

        const [dirtyFiles, packVersion] = await Promise.all([
          dirtyFilesIn(packDir, scope),
          packVersionOf(packDir),
        ]);

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
          runtime: {
            dirtyFiles: dirtyFiles && dirtyFiles.slice(0, MAX_DIRTY_FILES),
            moreDirtyFiles: (dirtyFiles?.length ?? 0) > MAX_DIRTY_FILES,
            packVersion,
          },
        };
        return c.json(response, 200);
      } catch (err) {
        if (err instanceof RtNotFoundError) {
          return c.json({ error: err.message }, 503);
        }
        return c.json({ error: (err as Error).message }, 502);
      }
    })
    .get('/api/skills/diff', diffQuery, async c => {
      const { pack, from, to } = c.req.valid('query');
      if (!pack) return c.json({ error: 'pack is required' }, 400);
      if (!from || !to) {
        return c.json({ error: 'from and to are required' }, 400);
      }
      // Both are checked BEFORE a pack dir is even resolved, so a revision
      // that is not an object name never reaches git in any form.
      for (const sha of [from, to]) {
        if (!COMMIT_SHA.test(sha)) {
          return c.json({ error: `invalid commit: ${sha}` }, 400);
        }
      }

      try {
        // Same rule as the history route: the directory comes from rt, never
        // from the request.
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

        // `--relative` is what makes attribution possible at all: without it
        // git prints repo-root paths, and a seam's `path` is relative to its
        // own plugin root -- for this pack's fills, the same
        // `attachments/<fill>/SKILL.md` the pack dir holds.
        const diff = await runGit([
          '-C',
          packDir,
          'diff',
          '--no-color',
          '--relative',
          `${from}..${to}`,
          '--',
          '.',
        ]);
        if (diff.code !== 0) {
          return c.json(
            { error: diff.stderr.trim() || 'git diff failed' },
            502
          );
        }

        const bounded = boundDiff(diff.stdout);
        const response: SkillsDiffResponse = {
          pack,
          packDir,
          repoRoot: root.stdout.trim(),
          scope: '.',
          from,
          to,
          truncated: bounded.truncated,
          diff: bounded.diff,
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
