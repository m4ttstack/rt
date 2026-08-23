import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type SeenMap = Record<string, number>;

/** Resolved per call, never hoisted to a module constant: tests repoint HOME,
    and a captured path would write into the real home directory. */
export function seenPath(): string {
  return join(
    process.env.HOME ?? homedir(),
    '.mattstack',
    'console',
    'seen.json'
  );
}

export function readSeen(): SeenMap {
  try {
    const parsed: unknown = JSON.parse(readFileSync(seenPath(), 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    return parsed as SeenMap;
  } catch {
    // Missing or corrupt: an unreadable annotation file must never take the
    // server down, and the worst case is a row re-surfacing once.
    return {};
  }
}

export function markSeen(runId: string): SeenMap {
  const next = { ...readSeen(), [runId]: Date.now() };
  const path = seenPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
