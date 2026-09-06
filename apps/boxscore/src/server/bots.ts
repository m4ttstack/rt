import { BUILTIN_BOT_PATTERNS } from '../shared/bots.js';
import type { SuspectedBot } from '../shared/types.js';
import { readSettings } from './config/index.js';
import { compileBotPatterns } from './metrics/stats.js';
import { getStore, mrKey } from './store/index.js';

export type { SuspectedBot };

/**
 * Scan every stored MR (index authors + metrics note authors/approvers) for usernames
 * that match built-in or extra bot patterns, excluding usernames already known as roster
 * members (visible or hidden).
 */
export async function scanSuspectedBots(
  extraPatterns: string[]
): Promise<SuspectedBot[]> {
  const allPatterns = [
    ...BUILTIN_BOT_PATTERNS.map(p => new RegExp(p.source, 'i')),
    ...compileBotPatterns(extraPatterns),
  ];

  const store = getStore();
  const indexRows = store.allIndexRows();
  const keys = indexRows.map(r => mrKey(r.projectPath, r.iid));
  const metricsRows = store.metricsByKeys(keys);

  const knownUsers = new Set(readSettings().roster.map(r => r.username));
  const seen = new Set<string>();
  const matches: SuspectedBot[] = [];

  const check = (u: string | null) => {
    if (!u || seen.has(u) || knownUsers.has(u)) return;
    seen.add(u);
    const pat = allPatterns.find(p => p.test(u));
    if (pat) matches.push({ username: u, matchedPattern: String(pat) });
  };

  for (const row of indexRows) check(row.authorUsername);
  for (const m of metricsRows) {
    for (const note of m.notes) check(note.authorUsername);
    for (const a of m.approvedByUsernames) check(a);
  }

  return matches;
}
