/**
 * Framework-neutral settings routes over @mattstack/rt-client.
 *
 * Hosts call `settingsHandler(req)` early in their fetch handler; `null`
 * means "not a settings route, fall through". Works identically under a
 * hand-rolled `Bun.serve` switch and a Hono `app.all` catch-all, so one
 * implementation serves every mattstack app.
 *
 * Settings run through rt-client IN PROCESS — no daemon, no spawned rt.
 * `setSetting` throws its refusals as `rt: …` errors; those are "rt said no"
 * conditions the client should read, so they answer 400 here rather than
 * bubbling as a host 500.
 */

import {
  allDefs,
  explainSetting,
  getDef,
  isMigrated,
  setSetting,
  unsetSetting,
  validateValue,
  type ExplainRow,
  type SettingDef,
  type SettingScope,
} from "@mattstack/rt-client";
import { overlay } from "./overlay.ts";
import { matchesShape, SHAPES } from "./shapes.ts";

export interface SettingDefWire {
  key: string;
  type: SettingDef["type"];
  scopes: SettingDef["scopes"];
  merge: SettingDef["merge"];
  secret: boolean;
  teamLocked: boolean;
  repoScoped: boolean;
  /** Computed once, server-side: migrated AND not secret AND (not composite,
      or composite writes admitted by `allowComposite`). Every client edit
      affordance keys off this instead of re-deriving it. */
  writable: boolean;
  description: string;
  hasDefault: boolean;
  defaultValue: unknown;
  effective: EffectiveWire;
}

export type ExplainRowWire = Pick<
  ExplainRow,
  "scope" | "file" | "present" | "shadowed" | "invalid"
> & { value?: unknown };

/** The winning layer, precomputed server-side so a list view renders and
    patches rows without a per-key explain round trip. `scope` is the winning
    layer's scope, "default" when the registry default wins, null when
    nothing is set and there is no default. `value` is the winning layer's
    value, except for a `merge: "deep"` object key, where it is the merged
    value (registry default, then each live valid layer overlaid in order).
    `value` is absent for secrets, for an invalid winning layer, and when
    scope is null. A leaf edit of a deep-merged key must start from the
    target layer's own authored value (its explain row), never from this
    `value`, or it bakes the default and weaker layers into that store. */
export interface EffectiveWire {
  scope: string | null;
  value?: unknown;
  /** For a `merge: "deep"` object key, the overlay of every present, valid,
      non-default layer, weakest to strongest (arrays replace). Omitted when
      no store layer sets the key; never set for secrets. */
  authored?: unknown;
  file: string | null;
  invalid?: string;
}

/** The slice of rt-client the handler consumes — injectable so tests fake it
    without `mock.module`, which mutates the shared module registry and
    poisons every later test importing rt-client in the same process. */
export interface RtSettingsApi {
  allDefs: typeof allDefs;
  getDef: typeof getDef;
  isMigrated: typeof isMigrated;
  explainSetting: typeof explainSetting;
  validateValue: typeof validateValue;
  setSetting: typeof setSetting;
  unsetSetting: typeof unsetSetting;
}

export interface SettingsHandlerOptions {
  /** Route prefix the handler answers under. Default "/api/settings". */
  basePath?: string;
  /** Admit composite (object/array) keys to the write path. `true` admits
      every composite as a whole-JSON replacement. `"shaped"` admits only a
      key SHAPES declares (never `external`), and only a value matching it. */
  allowComposite?: boolean | "shaped";
  /** Override the rt-client functions (tests, instrumentation). */
  rt?: Partial<RtSettingsApi>;
  /**
   * Write gate. The default admits only requests whose Host is loopback or a
   * deck-local TLD (localhost, 127.0.0.1, [::1], *.localhost, *.mattstack) —
   * a Host-header check, because a standard `Request` carries no peer
   * address. A host app that knows the real peer (e.g. Bun's
   * `server.requestIP`) should pass its own stricter predicate; an app with
   * any non-local exposure (relay, peer sync) MUST.
   */
  allowWrite?: (req: Request) => boolean;
}

const COMPOSITE_COPY = "composite value — edit the file";

function isComposite(def: SettingDef): boolean {
  return def.type === "object" || def.type === "array";
}

type CompositeMode = boolean | "shaped";

function compositeAllowed(def: SettingDef, mode: CompositeMode): boolean {
  if (!isComposite(def) || mode === true) return true;
  if (mode !== "shaped") return false;
  const shape = SHAPES[def.key];
  return shape !== undefined && shape.kind !== "external";
}

function isWritable(def: SettingDef, migrated: (def: SettingDef) => boolean = isMigrated, mode: CompositeMode = false): boolean {
  return migrated(def) && def.secret !== true && compositeAllowed(def, mode);
}

function isJsonBody(req: Request): boolean {
  const type = req.headers.get("content-type");
  return type !== null && type.split(";", 1)[0]!.trim().toLowerCase() === "application/json";
}

export function defToWire(def: SettingDef, migrated: ((def: SettingDef) => boolean) | undefined, effective: EffectiveWire, composites: CompositeMode = false): SettingDefWire {
  return {
    key: def.key,
    type: def.type,
    scopes: def.scopes,
    merge: def.merge,
    secret: def.secret === true,
    teamLocked: def.teamLocked === true,
    repoScoped: def.repoScoped === true,
    writable: isWritable(def, migrated, composites),
    description: def.description,
    hasDefault: "default" in def,
    defaultValue: def.default ?? null,
    effective,
  };
}

/**
 * Secret values must never reach the wire — presence and file only. This is
 * the ONLY place explain rows are serialized, so stripping here is the whole
 * guarantee; a second serialization path would reopen the leak.
 */
export function sanitizeRows(def: SettingDef, rows: ExplainRow[]): ExplainRowWire[] {
  return rows.map((row) => {
    const wire: ExplainRowWire = {
      scope: row.scope,
      file: row.file,
      present: row.present,
    };
    if (row.shadowed) wire.shadowed = row.shadowed;
    if (row.invalid) wire.invalid = row.invalid;
    if (def.secret !== true && "value" in row) wire.value = row.value;
    return wire;
  });
}


/** Winning layer from explain rows, which arrive weakest-first: the last
    present, un-shadowed row wins. A deep-merged object reports the merged
    value, not the winning layer's slice. Secrets omit the value. */
export function effectiveFromRows(def: SettingDef, rows: ExplainRow[]): EffectiveWire {
  const live = rows.filter((r) => r.present && !r.shadowed);
  const top = live.at(-1);
  if (!top) {
    if ("default" in def) {
      const wire: EffectiveWire = { scope: "default", file: null };
      if (def.secret !== true) wire.value = def.default;
      return wire;
    }
    return { scope: null, file: null };
  }
  const wire: EffectiveWire = { scope: top.scope, file: top.file };
  if (top.invalid) wire.invalid = top.invalid;
  if (def.secret === true) return wire;
  if (def.merge === "deep" && def.type === "object") {
    let merged: unknown = undefined;
    let authored: unknown = undefined;
    for (const r of live) {
      if (r.invalid || !("value" in r)) continue;
      merged = merged === undefined ? r.value : overlay(merged, r.value);
      if (r.scope !== "default") authored = authored === undefined ? r.value : overlay(authored, r.value);
    }
    if (!top.invalid) wire.value = merged;
    if (authored !== undefined) wire.authored = authored;
  } else if (!top.invalid && "value" in top) {
    wire.value = top.value;
  }
  return wire;
}

function defaultAllowWrite(req: Request): boolean {
  let host: string;
  try {
    host = new URL(req.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    host.endsWith(".mattstack")
  );
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * Answers:
 *   GET  {base}/defs[?prefix=board.]  → { defs: SettingDefWire[] }
 *   GET  {base}/explain/{key}         → { def, rows }
 *   POST {base}/set                   → { rows, effective } | { error }
 *   POST {base}/unset                 → { rows, effective } | { error }
 * Returns null for anything else so the host's routing continues.
 */
export async function settingsHandler(
  req: Request,
  opts: SettingsHandlerOptions = {},
): Promise<Response | null> {
  const base = (opts.basePath ?? "/api/settings").replace(/\/+$/, "");
  const rt: RtSettingsApi = { allDefs, getDef, isMigrated, explainSetting, validateValue, setSetting, unsetSetting, ...opts.rt };
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return null;
  }
  const path = url.pathname;
  if (path !== `${base}/defs` && !path.startsWith(`${base}/explain/`) && path !== `${base}/set` && path !== `${base}/unset`) {
    return null;
  }

  if (path === `${base}/defs` && req.method === "GET") {
    const prefix = url.searchParams.get("prefix") ?? "";
    const defs = rt.allDefs()
      .filter((d) => d.key.startsWith(prefix))
      .map((d) => defToWire(d, rt.isMigrated, effectiveFromRows(d, rt.explainSetting(d.key)), opts.allowComposite ?? false));
    return json({ defs });
  }

  if (path.startsWith(`${base}/explain/`) && req.method === "GET") {
    const key = decodeURIComponent(path.slice(`${base}/explain/`.length));
    const def = rt.getDef(key);
    if (!def) return json({ error: `unknown setting "${key}"` }, 404);
    const rows = rt.explainSetting(key);
    return json({
      def: defToWire(def, rt.isMigrated, effectiveFromRows(def, rows), opts.allowComposite ?? false),
      rows: sanitizeRows(def, rows),
    });
  }

  if (path === `${base}/set` && req.method === "POST") {
    const allow = opts.allowWrite ?? defaultAllowWrite;
    if (!allow(req)) return json({ error: "settings writes are local-only" }, 403);
    if (!isJsonBody(req)) return json({ error: "expected application/json" }, 415);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const key = typeof body?.key === "string" ? body.key : "";
    const scope = (typeof body?.scope === "string" ? body.scope : "") as SettingScope;
    const team = typeof body?.team === "string" ? body.team : undefined;
    const value = body?.value;

    const def = rt.getDef(key);
    if (!def) return json({ error: `unknown setting "${key}"` }, 404);
    if (def.secret === true) return json({ error: "secret keys are not writable here" }, 400);
    const mode = opts.allowComposite ?? false;
    if (!compositeAllowed(def, mode)) {
      return json({ error: mode === "shaped" ? `"${key}" has no editable shape` : COMPOSITE_COPY }, 400);
    }
    if (!def.scopes.includes(scope)) {
      return json(
        { error: `"${key}" cannot be set in the ${scope} store (allowed: ${def.scopes.join(", ")})` },
        400,
      );
    }
    if (!isWritable(def, rt.isMigrated, mode)) {
      return json({ error: `"${key}" is not writable through the resolver yet` }, 400);
    }
    const check = rt.validateValue(def, value);
    if (!check.ok) return json({ error: check.reason }, 400);
    const shape = SHAPES[key];
    if (mode === "shaped" && isComposite(def) && shape && !matchesShape(shape, value)) {
      return json({ error: `value does not match ${key}'s shape` }, 400);
    }

    try {
      rt.setSetting(key, value, scope, team ? { team } : {});
    } catch (err) {
      return json({ error: (err as Error).message }, 400);
    }
    const after = rt.explainSetting(key);
    return json({ rows: sanitizeRows(def, after), effective: effectiveFromRows(def, after) });
  }

  if (path === `${base}/unset` && req.method === "POST") {
    const allow = opts.allowWrite ?? defaultAllowWrite;
    if (!allow(req)) return json({ error: "settings writes are local-only" }, 403);
    if (!isJsonBody(req)) return json({ error: "expected application/json" }, 415);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const key = typeof body?.key === "string" ? body.key : "";
    const scope = (typeof body?.scope === "string" ? body.scope : "") as SettingScope;
    const team = typeof body?.team === "string" ? body.team : undefined;

    // Same ladder as set, minus the value check — removal has no value. The
    // writable/composite gates stay: a row the UI renders read-only must not
    // be clearable through the API either.
    const def = rt.getDef(key);
    if (!def) return json({ error: `unknown setting "${key}"` }, 404);
    if (def.secret === true) return json({ error: "secret keys are not writable here" }, 400);
    const mode = opts.allowComposite ?? false;
    if (!compositeAllowed(def, mode)) {
      return json({ error: mode === "shaped" ? `"${key}" has no editable shape` : COMPOSITE_COPY }, 400);
    }
    if (!def.scopes.includes(scope)) {
      return json(
        { error: `"${key}" cannot be unset in the ${scope} store (allowed: ${def.scopes.join(", ")})` },
        400,
      );
    }
    if (!isWritable(def, rt.isMigrated, mode)) {
      return json({ error: `"${key}" is not writable through the resolver yet` }, 400);
    }

    try {
      rt.unsetSetting(key, scope, team ? { team } : {});
    } catch (err) {
      return json({ error: (err as Error).message }, 400);
    }
    const after = rt.explainSetting(key);
    return json({ rows: sanitizeRows(def, after), effective: effectiveFromRows(def, after) });
  }

  return json({ error: "method not allowed" }, 405);
}
