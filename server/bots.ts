import { readdir, readFile } from "node:fs/promises";
import type { NormMr } from "./pipeline/model.js";
import type { UserIdentity } from "./metrics/trend.js";

interface CacheEnvelope {
  data: {
    mrs: NormMr[];
    identities: Record<string, UserIdentity>;
  };
}

export interface SuspectedBot {
  username: string;
  matchedPattern: string;
}

const BUILTIN_PATTERNS = [
  /^(project|group)_\d+_bot/i,
  /_bot_/i,
  /_bot$/i,
  /^ghost$/i,
];

/**
 * Scan the most recent cache file for usernames that match built-in or extra bot
 * patterns, excluding usernames that appear in the configured users list or are
 * already resolved as human identities.
 */
export async function scanSuspectedBots(
  extraPatterns: string[],
): Promise<SuspectedBot[]> {
  // Compile extra patterns (best-effort; skip bad regexes).
  const extra: RegExp[] = [];
  for (const p of extraPatterns) {
    try {
      extra.push(new RegExp(p, "i"));
    } catch { /* skip */ }
  }
  const allPatterns = [...BUILTIN_PATTERNS, ...extra];

  // Find the most recent cache file.
  let files: string[];
  try {
    files = (await readdir(".cache")).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  if (files.length === 0) return [];

  // Sort by mtime descending; read the newest valid one.
  files.sort().reverse();
  let envelope: CacheEnvelope | null = null;
  for (const f of files.slice(0, 10)) {
    try {
      const raw = await readFile(`.cache/${f}`, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed.data?.mrs) {
        envelope = parsed;
        break;
      }
    } catch { /* try next */ }
  }
  if (!envelope) return [];

  const { mrs, identities } = envelope.data;

  // Gather all usernames from MR notes + approvals, excluding known human users.
  const knownUsers = new Set(Object.keys(identities ?? {}));
  const seen = new Set<string>();
  const matches: SuspectedBot[] = [];

  for (const mr of mrs) {
    for (const note of mr.notes) {
      const u = note.authorUsername;
      if (!u || seen.has(u) || knownUsers.has(u)) continue;
      seen.add(u);
      for (const pat of allPatterns) {
        if (pat.test(u)) {
          matches.push({ username: u, matchedPattern: String(pat) });
          break;
        }
      }
    }
    for (const a of mr.approvedByUsernames) {
      if (seen.has(a) || knownUsers.has(a)) continue;
      seen.add(a);
      for (const pat of allPatterns) {
        if (pat.test(a)) {
          matches.push({ username: a, matchedPattern: String(pat) });
          break;
        }
      }
    }
  }

  return matches;
}
