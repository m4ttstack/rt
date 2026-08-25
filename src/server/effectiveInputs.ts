import { getDef, getRun, getSetting } from '@mattstack/rt-client';
import { Hono } from 'hono';
import { validator } from 'hono/validator';

import { runGit as liveRunGit, type RunGit } from './git-bin';
import { runRt as liveRunRt, type RunRt } from './rt-bin';

export interface PackVersionRow {
  pack: string;
  recordedSha: string;
  /** Null when the pack could not be resolved to a directory here. */
  currentSha: string | null;
  /** Null exactly when currentSha is null — unknowable, not "no". */
  drifted: boolean | null;
}
export interface ConfigDepRow {
  key: string;
  value: unknown;
  provenance: { scope: string; file: string | null }[];
}
export interface EffectiveInputsPayload {
  pipeline: string;
  workType: string;
  /** Null on a pre-v2 run — version not recorded. */
  packVersions: PackVersionRow[] | null;
  packDirty: boolean;
  /** Stage names in first-run order, deduped across attempts. */
  stages: string[];
  /** CURRENT values — runs do not record the config they read. */
  config: ConfigDepRow[];
}

/** Curated: the keys pipeline behavior reads at provision/run time today.
    Extend deliberately; the panel labels the values as current-not-as-run
    either way. */
const CONFIG_DEPS = [
  'rt.worktrees',
  'rt.branchNaming',
  'rt.presets',
  'rt.variations',
  'rt.runaway',
  'rt.runsPruneDays',
] as const;

const STAGE_NAME = /^[A-Za-z0-9_-]+$/;

const NO_DOC = { error: 'no compiled doc recorded at this version' } as const;

interface PackRow {
  name: string;
  dir: string;
}
interface PacksResponse {
  packs: PackRow[];
}

function parseJsonPayload(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function parsePackCommits(
  s: string | null
): { pack: string; sha: string }[] {
  if (!s) return [];
  const rows: { pack: string; sha: string }[] = [];
  for (const token of s.split(/[\s,]+/)) {
    if (!token) continue;
    const match = /^([^=]+)=([0-9a-f]+)$/i.exec(token);
    if (match) rows.push({ pack: match[1], sha: match[2] });
  }
  return rows;
}

function dedupeStageNames(stages: { name: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const stage of stages) {
    if (seen.has(stage.name)) continue;
    seen.add(stage.name);
    out.push(stage.name);
  }
  return out;
}

const stageDocQuery = validator('query', (value): { stage?: string } => {
  const v = value as { stage?: unknown };
  return { stage: typeof v?.stage === 'string' ? v.stage : undefined };
});

/**
 * `runRt`/`runGit` default to the real, Bun-backed spawners; tests inject
 * fakes with no `Bun` global involved. Follows `mountSkills`' factory shape
 * (`src/server/skills.ts`).
 */
export function mountEffectiveInputs(
  app: Hono,
  runRt: RunRt = liveRunRt,
  runGit: RunGit = liveRunGit
) {
  /** Never throws: an unresolvable pack (rt down, unknown name, bad JSON) is
      reported as null everywhere a caller of this reads it, not a 500. */
  async function resolvePackDir(pack: string): Promise<string | null> {
    try {
      const { stdout } = await runRt(['skills', 'packs', '--json']);
      const payload = parseJsonPayload(stdout);
      const packs = (payload as PacksResponse | undefined)?.packs;
      if (!Array.isArray(packs)) return null;
      const row = packs.find(p => p?.name === pack);
      return typeof row?.dir === 'string' && row.dir.length > 0
        ? row.dir
        : null;
    } catch {
      return null;
    }
  }

  async function packVersionRow(commit: {
    pack: string;
    sha: string;
  }): Promise<PackVersionRow> {
    let currentSha: string | null = null;
    try {
      const packDir = await resolvePackDir(commit.pack);
      if (packDir) {
        const head = await runGit(['-C', packDir, 'rev-parse', 'HEAD']);
        if (head.code === 0 && head.stdout.trim()) {
          currentSha = head.stdout.trim();
        }
      }
    } catch {
      currentSha = null;
    }
    const drifted =
      currentSha === null
        ? null
        : !currentSha.startsWith(commit.sha) &&
          !commit.sha.startsWith(currentSha);
    return {
      pack: commit.pack,
      recordedSha: commit.sha,
      currentSha,
      drifted,
    };
  }

  return app
    .get('/api/runs/:repo/:runId/effective-inputs', async c => {
      const { repo, runId } = c.req.param();
      const res = await getRun(runId, repo);
      if (!res.ok || !res.data) {
        // Mirrors src/server/runs.ts: this literal is the daemon's exact
        // string for a missing run id, never a caught-exception message.
        const status: 404 | 502 = res.error === 'run not found' ? 404 : 502;
        return c.json({ error: res.error ?? 'no data' }, status);
      }
      const { run, stages } = res.data;

      const commits = parsePackCommits(run.pack_commits);
      const packVersions =
        run.pack_commits === null
          ? null
          : await Promise.all(commits.map(packVersionRow));

      const config: ConfigDepRow[] = [];
      for (const key of CONFIG_DEPS) {
        // CONFIG_DEPS is otherwise the only guard on this path, and it serializes full values onto the wire -- a secret def must never reach config.push.
        if (getDef(key)?.secret) continue;
        try {
          const { value, provenance } = getSetting(key);
          config.push({ key, value, provenance });
        } catch {
          // A throwing resolver skips the key rather than 500ing the panel.
        }
      }

      const payload: EffectiveInputsPayload = {
        pipeline: run.pipeline,
        workType: run.work_type,
        packVersions,
        packDirty: run.pack_dirty !== 0,
        stages: dedupeStageNames(stages),
        config,
      };
      return c.json(payload, 200);
    })
    .get('/api/runs/:repo/:runId/stage-doc', stageDocQuery, async c => {
      const { repo, runId } = c.req.param();
      const { stage } = c.req.valid('query');
      if (!stage || !STAGE_NAME.test(stage)) {
        return c.json({ error: `invalid stage name: ${stage ?? ''}` }, 400);
      }

      const res = await getRun(runId, repo);
      if (!res.ok || !res.data) {
        const status: 404 | 502 = res.error === 'run not found' ? 404 : 502;
        return c.json({ error: res.error ?? 'no data' }, status);
      }

      const first = parsePackCommits(res.data.run.pack_commits)[0];
      if (!first) return c.json(NO_DOC, 404);

      const packDir = await resolvePackDir(first.pack);
      if (!packDir) return c.json(NO_DOC, 404);

      const show = await runGit([
        '-C',
        packDir,
        'show',
        `${first.sha}:attachments/stage-${stage}/SKILL.md`,
      ]);
      if (show.code !== 0) return c.json(NO_DOC, 404);

      return c.json({ text: show.stdout }, 200);
    });
}
