import {
  allDefs,
  explainSetting,
  getDef,
  getSetting,
  isMigrated,
  setSetting,
  validateValue,
  type ExplainRow,
  type SettingDef,
  type SettingScope,
} from '@mattstack/rt-client';
import { Hono } from 'hono';
import { validator } from 'hono/validator';

export interface SettingDefWire {
  key: string;
  type: SettingDef['type'];
  scopes: SettingDef['scopes'];
  merge: SettingDef['merge'];
  secret: boolean;
  teamLocked: boolean;
  repoScoped: boolean;
  /** Computed here, once: migrated AND not secret AND not composite. Every
      client edit affordance keys off this instead of re-deriving it. */
  writable: boolean;
  description: string;
  hasDefault: boolean;
  defaultValue: unknown;
}

export type ExplainRowWire = Pick<
  ExplainRow,
  'scope' | 'file' | 'present' | 'shadowed' | 'invalid'
> & { value?: unknown };

const COMPOSITE_COPY = 'composite value — edit the file';

function isComposite(def: SettingDef): boolean {
  return def.type === 'object' || def.type === 'array';
}

export function defToWire(def: SettingDef): SettingDefWire {
  return {
    key: def.key,
    type: def.type,
    scopes: def.scopes,
    merge: def.merge,
    secret: def.secret === true,
    teamLocked: def.teamLocked === true,
    repoScoped: def.repoScoped === true,
    writable: isMigrated(def) && def.secret !== true && !isComposite(def),
    description: def.description,
    hasDefault: 'default' in def,
    defaultValue: def.default ?? null,
  };
}

/**
 * Secret values must never reach the wire — presence and file only. This is
 * the ONLY place explain rows are serialized, so stripping here is the whole
 * guarantee; a second serialization path would reopen the leak.
 */
export function sanitizeRows(def: SettingDef, rows: ExplainRow[]): ExplainRowWire[] {
  return rows.map(row => {
    const wire: ExplainRowWire = {
      scope: row.scope,
      file: row.file,
      present: row.present,
    };
    if (row.shadowed) wire.shadowed = row.shadowed;
    if (row.invalid) wire.invalid = row.invalid;
    if (def.secret !== true && 'value' in row) wire.value = row.value;
    return wire;
  });
}

/**
 * Settings run through rt-client IN PROCESS (as mr-board and gitq do) — no
 * daemon, no spawned rt. `setSetting` throws its refusals as `rt: …` errors;
 * those are upstream "rt said no" conditions the client should read, so they
 * answer 400 here rather than falling to `app.onError` as a 500.
 */
export const settings = new Hono()
  .get('/api/settings/runs-prune-days', c => {
    const { value } = getSetting<number>('rt.runsPruneDays');
    return c.json({ days: value }, 200);
  })
  .get('/api/settings/defs', c =>
    c.json({ defs: allDefs().map(defToWire) }, 200)
  )
  .get('/api/settings/explain/:key', c => {
    const key = c.req.param('key');
    const def = getDef(key);
    if (!def) return c.json({ error: `unknown setting "${key}"` }, 404);
    return c.json(
      { def: defToWire(def), rows: sanitizeRows(def, explainSetting(key)) },
      200
    );
  })
  .post(
    '/api/settings/set',
    validator(
      'json',
      (
        value
      ): { key: string; value: unknown; scope: SettingScope; team?: string } => {
        const v = value as Record<string, unknown>;
        return {
          key: typeof v?.key === 'string' ? v.key : '',
          value: v?.value,
          scope: (typeof v?.scope === 'string' ? v.scope : '') as SettingScope,
          team: typeof v?.team === 'string' ? v.team : undefined,
        };
      }
    ),
    c => {
      const { key, value, scope, team } = c.req.valid('json');
      const def = getDef(key);
      if (!def) return c.json({ error: `unknown setting "${key}"` }, 404);
      if (def.secret === true)
        return c.json(
          { error: 'secret keys are not writable from the console' },
          400
        );
      if (isComposite(def)) return c.json({ error: COMPOSITE_COPY }, 400);
      if (!def.scopes.includes(scope))
        return c.json(
          {
            error: `"${key}" cannot be set in the ${scope} store (allowed: ${def.scopes.join(', ')})`,
          },
          400
        );
      const check = validateValue(def, value);
      if (!check.ok) return c.json({ error: check.reason }, 400);

      try {
        setSetting(key, value, scope, team ? { team } : {});
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
      }
      return c.json({ rows: sanitizeRows(def, explainSetting(key)) }, 200);
    }
  );
