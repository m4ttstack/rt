import { readFileSync } from "fs";
import { join } from "path";

export interface DeckManifest {
  name: string;
  displayName?: string;
  description?: string;
  icon?: string;
  port?: number;
  /** Shell strings. `start` (when present) is the supervised service; every other key is an action command. */
  commands: Record<string, string>;
  /** Environment for the supervised `start` service (specFor layers PORT on top). Overlays may not override it. */
  env?: Record<string, string>;
  /** Normalized overlays: each may carry only `port` and/or `start`. */
  altConfigs?: Record<string, { port?: number; start?: string }>;
}

export type ParseResult =
  | { ok: true; manifest: DeckManifest }
  | { ok: false; error: string }
  | null;

const NAME_RE = /^[a-z0-9][a-z0-9.-]*$/;
const COMMAND_KEY_RE = /^[a-z0-9-]+$/;

function err(error: string): ParseResult {
  return { ok: false, error };
}

export function readDeckManifest(dir: string): ParseResult {
  let raw: string;
  try {
    raw = readFileSync(join(dir, "mattstack.deck.json"), "utf8");
  } catch {
    return null; // absent is not an error: callers fall back to mattstack.json for identity
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err("mattstack.deck.json is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) return err("mattstack.deck.json must be an object");
  const m = parsed as Record<string, unknown>;

  if (typeof m.name !== "string" || !NAME_RE.test(m.name)) {
    return err(`name must match ${NAME_RE}`);
  }

  const commands: Record<string, string> = {};
  if (m.commands !== undefined) {
    if (typeof m.commands !== "object" || m.commands === null) return err("commands must be an object");
    for (const [key, val] of Object.entries(m.commands as Record<string, unknown>)) {
      // Every non-start key becomes a board button routed at /commands/:key; the route
      // regex only accepts [a-z0-9-], so anything else is a silent 404, not a dead click.
      if (!COMMAND_KEY_RE.test(key)) return err(`command key ${key} must match ${COMMAND_KEY_RE}`);
      if (typeof val !== "string" || val.length === 0) return err(`command ${key} must be a non-empty string`);
      commands[key] = val;
    }
  }

  const out: DeckManifest = { name: m.name, commands };
  if (typeof m.displayName === "string") out.displayName = m.displayName;
  if (typeof m.description === "string") out.description = m.description;
  if (typeof m.icon === "string") out.icon = m.icon;
  if (m.port !== undefined) {
    if (!Number.isInteger(m.port) || (m.port as number) < 1 || (m.port as number) > 65535) return err("port must be 1-65535");
    out.port = m.port as number;
  }

  if (m.env !== undefined) {
    if (typeof m.env !== "object" || m.env === null || Array.isArray(m.env)) return err("env must be an object");
    const env: Record<string, string> = {};
    for (const [key, val] of Object.entries(m.env as Record<string, unknown>)) {
      if (key.length === 0) return err("env keys must be non-empty");
      if (typeof val !== "string") return err(`env ${key} must be a string`);
      env[key] = val;
    }
    out.env = env;
  }

  if (m.altConfigs !== undefined) {
    if (typeof m.altConfigs !== "object" || m.altConfigs === null) return err("altConfigs must be an object");
    const alts: Record<string, { port?: number; start?: string }> = {};
    for (const [altName, rawOverlay] of Object.entries(m.altConfigs as Record<string, unknown>)) {
      if (typeof rawOverlay !== "object" || rawOverlay === null) return err(`overlay ${altName} must be an object`);
      const overlay = rawOverlay as Record<string, unknown>;
      const entry: { port?: number; start?: string } = {};
      for (const key of Object.keys(overlay)) {
        // The loud rejection the spec requires: an overlay is the serve shape only.
        if (key !== "port" && key !== "commands") {
          return err(`overlay ${altName} may only override port and commands.start (saw ${key})`);
        }
      }
      if (overlay.port !== undefined) {
        if (!Number.isInteger(overlay.port) || (overlay.port as number) < 1 || (overlay.port as number) > 65535) {
          return err(`overlay ${altName} port must be 1-65535`);
        }
        entry.port = overlay.port as number;
      }
      if (overlay.commands !== undefined) {
        if (typeof overlay.commands !== "object" || overlay.commands === null) return err(`overlay ${altName} commands must be an object`);
        for (const key of Object.keys(overlay.commands as Record<string, unknown>)) {
          if (key !== "start") return err(`overlay ${altName} may only override commands.start (saw commands.${key})`);
        }
        const start = (overlay.commands as Record<string, unknown>).start;
        if (start !== undefined) {
          if (typeof start !== "string" || start.length === 0) return err(`overlay ${altName} commands.start must be a non-empty string`);
          entry.start = start;
        }
      }
      alts[altName] = entry;
    }
    out.altConfigs = alts;
  }

  return { ok: true, manifest: out };
}

export function resolveServeShape(
  manifest: DeckManifest,
  altName?: string,
): { port?: number; command?: string[] } {
  // Object.prototype.hasOwnProperty, not `in` or a bare index: altConfigs is a
  // plain object, so an inherited name (toString, constructor, ...) would
  // otherwise resolve to a real member and silently fall through as "known".
  const hasOverlay = altName !== undefined
    && Object.prototype.hasOwnProperty.call(manifest.altConfigs ?? {}, altName);
  if (altName !== undefined && !hasOverlay) {
    throw new Error(`unknown alt config: ${altName}`);
  }
  const overlay = hasOverlay ? manifest.altConfigs![altName!] : undefined;
  const port = overlay?.port ?? manifest.port;
  const start = overlay?.start ?? manifest.commands.start;
  return { port, command: start === undefined ? undefined : ["sh", "-c", start] };
}
