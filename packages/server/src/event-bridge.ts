import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** One entry in the daemon's `rt.notify.eventBridges` setting. `{field}`
    placeholders in `title`/`message`/`url` interpolate from the triggering
    event's payload. */
export interface EventBridgeRule {
  pattern: string;
  category: string;
  title: string;
  message: string;
  subjectPrefix?: string;
  url?: string;
}

/**
 * Merge-not-clobber upsert into whatever `read()` returns. Identity is
 * `(pattern, subjectPrefix)`, not `pattern` alone: board and console both
 * install a `gate/opened/*` rule, distinguished only by their
 * `mr:`/`run:` subjectPrefix, and each must own its own entry rather than
 * clobbering the other's. `opts.replacePatterns` names patterns left by a
 * prior app version that this upsert should remove outright (matched by
 * pattern alone, since a legacy entry may predate the subjectPrefix
 * field). `write` runs only when the resulting list actually differs from
 * what `read()` returned.
 */
export function ensureEventBridgeRule(
  read: () => EventBridgeRule[],
  write: (next: EventBridgeRule[]) => void,
  rule: EventBridgeRule,
  opts?: { replacePatterns?: string[] }
): void {
  const legacy = new Set(opts?.replacePatterns ?? []);
  const current = read();
  const withoutLegacy = current.filter(r => !legacy.has(r.pattern));
  const idx = withoutLegacy.findIndex(
    r => r.pattern === rule.pattern && r.subjectPrefix === rule.subjectPrefix
  );
  const next =
    idx === -1
      ? [...withoutLegacy, rule]
      : withoutLegacy.map((r, i) => (i === idx ? rule : r));
  if (JSON.stringify(current) !== JSON.stringify(next)) write(next);
}

/** Where deck's serve boot writes `api.json` (`apps/deck/src/api/state.ts`
    `stateDir()`). Duplicated rather than imported: packages never depend
    on an app. */
function defaultDeckStateDir(): string {
  return (
    process.env.LOCAL_STATE_DIR ??
    join(process.env.HOME ?? homedir(), '.mattstack', 'deck')
  );
}

interface DeckStatusRow {
  name: string;
  url: string | null;
}

/**
 * Looks up an app's local url through deck's `/api/status`, the way the
 * board itself renders app links. Uses `url` (deck's local
 * `https://<name>.<tld>` form), never `publicUrl` (the tunnel address,
 * meaningless for a notification click handled on this machine). Any
 * failure -- deck not running, no `api.json`, a bad port, a non-200
 * response, or a missing/null row -- returns `fallback` rather than
 * throwing, since this only ever runs at app boot.
 */
export async function deckAppUrl(
  name: string,
  fallback: string,
  opts?: { stateDir?: string; fetch?: typeof fetch }
): Promise<string> {
  const fetchImpl = opts?.fetch ?? fetch;
  try {
    const raw = await readFile(
      join(opts?.stateDir ?? defaultDeckStateDir(), 'api.json'),
      'utf8'
    );
    const info = JSON.parse(raw) as { port?: unknown };
    if (!Number.isInteger(info.port)) return fallback;
    const res = await fetchImpl(`http://127.0.0.1:${info.port}/api/status`);
    if (!res.ok) return fallback;
    const body = (await res.json()) as { apps?: DeckStatusRow[] };
    const row = (body.apps ?? []).find(a => a.name === name);
    return typeof row?.url === 'string' ? row.url : fallback;
  } catch {
    return fallback;
  }
}
