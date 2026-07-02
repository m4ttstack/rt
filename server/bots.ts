import { readdir, readFile } from "node:fs/promises";
import { compileBotPatterns } from "./metrics/stats.js";
import { BUILTIN_BOT_PATTERNS } from "../shared/bots.js";
import type { NormMr } from "./pipeline/model.js";
import type { UserIdentity } from "./metrics/trend.js";
import type { SuspectedBot } from "../shared/types.js";

interface CacheEnvelope {
  data: {
    mrs: NormMr[];
    identities: Record<string, UserIdentity>;
  };
}

export type { SuspectedBot };

/**
 * Scan the most recent cache file for usernames that match built-in or extra bot
 * patterns, excluding usernames that appear in the configured users list or are
 * already resolved as human identities.
 */
export async function scanSuspectedBots(
  extraPatterns: string[],
): Promise<SuspectedBot[]> {
  const allPatterns = [
    ...BUILTIN_BOT_PATTERNS.map((p) => new RegExp(p.source, "i")),
    ...compileBotPatterns(extraPatterns),
  ];

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

  const check = (u: string | null) => {
    if (!u || seen.has(u) || knownUsers.has(u)) return;
    seen.add(u);
    const pat = allPatterns.find((p) => p.test(u));
    if (pat) matches.push({ username: u, matchedPattern: String(pat) });
  };

  for (const mr of mrs) {
    for (const note of mr.notes) check(note.authorUsername);
    for (const a of mr.approvedByUsernames) check(a);
  }

  return matches;
}
