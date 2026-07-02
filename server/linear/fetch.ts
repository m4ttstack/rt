import { linearRequest } from "./client.js";
import { mapIssue } from "./map.js";
import { mapLimit } from "../util/concurrency.js";
import { isValidLinearId, putLinearIds } from "../cache/mr-store.js";
import type { RawIssue, RawWorkflowState, RawWorkflowStateConnection } from "./raw-types.js";
import type { NormMr, NormLinearIssue } from "../pipeline/model.js";
import type { LeaderboardWarning, LinearStateInfo, RefreshProgress } from "../../shared/types.js";

/** Extract Linear identifiers from a string, e.g. "ACME-123", "ENG-456", "HUB:299". */
const LINEAR_ID_RE = /\b([A-Z]+[-:]\d+)\b/gi;

/**
 * Reject single-character "team keys" like "Z-10" that the regex picks up from MR text
 * (e.g. "Phase Z-10"). Real Linear team keys are at least 2 uppercase letters.
 * Other false-positives (LOCALHOST-4000, PHASE-2) are handled by batching: if one
 * chunk errors, only that chunk is lost rather than the entire result.
 */
const VALID_LINEAR_ID_RE = /^[A-Z]{2,}-\d+$/;

/** Build a regex that matches a Linear ticket ID for a specific team, e.g. "HUB-123" or "HUB:123". */
export function teamTicketRegex(team: string): RegExp | null {
  if (!team) return null;
  return new RegExp(`\\b${escapeRegex(team)}[-:]\\d+\\b`, "i");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a dynamic GraphQL query that looks up each identifier with an alias:
 *   query VerifyIssues {
 *     _0: issue(id: "HUB-123") { id identifier title url }
 *     _1: issue(id: "HUB-456") { id identifier title url }
 *   }
 * Each alias is `_N` so we can match results back to identifiers.
 */
function buildVerifyQuery(identifiers: readonly string[]): string {
  const fields = "id identifier title url state { type name }";
  const aliases = identifiers
    .map((id, i) => `_${i}: issue(id: ${JSON.stringify(id)}) { ${fields} }`)
    .join("\n");
  return `query VerifyIssues {\n${aliases}\n}`;
}

type VerifyResult = Record<string, RawIssue | null>;

const CHUNK_SIZE = 100;

const LINEAR_CONCURRENCY = 6;

/**
 * Verify a chunk of identifiers against Linear. On a batch error (e.g. one bad
 * identifier poisons the whole query), falls back to concurrent individual lookups
 * so valid tickets in the same chunk are still recovered.
 */
async function verifyChunk(
  apiKey: string,
  chunk: readonly string[],
  signal?: AbortSignal,
): Promise<VerifyResult> {
  const query = buildVerifyQuery(chunk);
  try {
    return await linearRequest<VerifyResult>(apiKey, query, {}, signal);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return verifyIndividually(apiKey, chunk, signal);
  }
}

/**
 * Look up each identifier concurrently, silently skipping any that error.
 * Keyed identically to the batch result (_0, _1, ...) so callers don't care.
 */
async function verifyIndividually(
  apiKey: string,
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<VerifyResult> {
  const result: VerifyResult = {};
  await mapLimit(
    [...ids.entries()],
    LINEAR_CONCURRENCY,
    async ([i, id]) => {
      signal?.throwIfAborted();
      const query = buildVerifyQuery([id]);
      try {
        const data = await linearRequest<VerifyResult>(apiKey, query, {}, signal);
        const raw = data["_0"];
        if (raw) result[`_${i}`] = raw;
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
      }
    },
  );
  return result;
}

/**
 * Scan merged MRs for Linear ticket identifiers, batch-verify them against the Linear
 * API via `issue(id:)` lookups, and return verified tickets attributed to each MR's author.
 *
 * Resilient: batched in chunks of 100, with automatic per-identifier fallback when a
 * chunk fails (one bad identifier can't zero out the result).
 */
export async function resolveLinearTickets(
  apiKey: string | undefined,
  mergedMrs: readonly NormMr[],
  warnings: LeaderboardWarning[],
  signal?: AbortSignal,
  onProgress?: (p: Omit<RefreshProgress, "window">) => void,
): Promise<NormLinearIssue[]> {
  if (!apiKey || mergedMrs.length === 0) return [];

  interface TicketRef {
    authors: Set<string>;
    mrs: { iid: number; projectPath: string }[];
  }
  const ticketMap = new Map<string, TicketRef>();
  for (const mr of mergedMrs) {
    const haystack = [mr.title, mr.sourceBranch, mr.description].filter(Boolean).join(" ");
    const ids = extractLinearIds(haystack);
    for (const id of ids) {
      const normalized = id.toUpperCase().replace(":", "-");
      if (!mr.authorUsername) continue;
      const ref = ticketMap.get(normalized) ?? { authors: new Set(), mrs: [] };
      ref.authors.add(mr.authorUsername);
      if (!ref.mrs.some((m) => m.iid === mr.iid && m.projectPath === mr.projectPath)) {
        ref.mrs.push({ iid: mr.iid, projectPath: mr.projectPath });
      }
      ticketMap.set(normalized, ref);
    }
  }

  if (ticketMap.size === 0) return [];

  const candidates = [...ticketMap.keys()].filter((id) => VALID_LINEAR_ID_RE.test(id));
  if (candidates.length === 0) return [];

  // Partition by cached validity: known-valid go straight to batch query,
  // known-invalid are skipped, unknown go through the full verify flow.
  const knownValid: string[] = [];
  const unknown: string[] = [];
  for (const id of candidates) {
    const cached = isValidLinearId(id);
    if (cached === true) knownValid.push(id);
    else if (cached === null) unknown.push(id);
    // cached === false: skip entirely
  }

  const issues: NormLinearIssue[] = [];

  const collectResults = (data: VerifyResult, chunk: readonly string[]) => {
    for (const [alias, raw] of Object.entries(data)) {
      if (!raw) continue;
      const idx = parseInt(alias.slice(1), 10);
      const identifier = chunk[idx];
      if (!identifier) continue;
      const ref = ticketMap.get(identifier);
      const author = ref?.authors.values().next().value ?? null;
      const linkedMrs = ref?.mrs ?? [];
      issues.push(mapIssue(raw, author, linkedMrs));
    }
  };

  // Phase 1: batch-query known-valid identifiers (no fallback needed, they're clean).
  const validChunks = Math.ceil(knownValid.length / CHUNK_SIZE);
  for (let ci = 0; ci < validChunks; ci++) {
    signal?.throwIfAborted();
    const chunk = knownValid.slice(ci * CHUNK_SIZE, (ci + 1) * CHUNK_SIZE);
    onProgress?.({ phase: "linear", label: `Fetching ${knownValid.length} cached tickets`, done: ci, total: validChunks });
    const query = buildVerifyQuery(chunk);
    try {
      const data = await linearRequest<VerifyResult>(apiKey, query, {}, signal);
      collectResults(data, chunk);
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
    }
  }

  // Phase 2: verify unknown identifiers (with fallback for bad ones).
  if (unknown.length > 0) {
    const unknownChunks = Math.ceil(unknown.length / CHUNK_SIZE);
    for (let ci = 0; ci < unknownChunks; ci++) {
      signal?.throwIfAborted();
      const chunk = unknown.slice(ci * CHUNK_SIZE, (ci + 1) * CHUNK_SIZE);
      onProgress?.({ phase: "linear", label: `Verifying ${unknown.length} new identifiers (${ci + 1}/${unknownChunks})`, done: ci, total: unknownChunks });
      const data = await verifyChunk(apiKey, chunk, signal);
      collectResults(data, chunk);

      // Record validity for next time.
      const entries = chunk.map((id, i) => ({ id, valid: !!data[`_${i}`] }));
      putLinearIds(entries);
    }
  }

  onProgress?.({ phase: "linear", label: "Verifying Linear tickets", done: 1, total: 1 });
  return issues;
}

function extractLinearIds(text: string): string[] {
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  LINEAR_ID_RE.lastIndex = 0;
  while ((m = LINEAR_ID_RE.exec(text)) !== null) {
    ids.add(m[1]!);
  }
  return [...ids];
}

/** Fetch all workflow states by paginating (Linear caps `first` at 250). */
export async function fetchWorkflowStates(apiKey: string, teamKey?: string): Promise<LinearStateInfo[]> {
  try {
    const filterClause = teamKey
      ? `filter: { team: { key: { eq: ${JSON.stringify(teamKey)} } } }`
      : "";
    const all: LinearStateInfo[] = [];
    let after = "";
    for (let page = 0; page < 20; page++) {
      const afterArg = after ? `after: ${JSON.stringify(after)}` : "";
      const query = `query { workflowStates(first: 250, ${filterClause} ${afterArg}) { nodes { name type team { key name } } pageInfo { hasNextPage endCursor } } }`;
      const data = await linearRequest<{ workflowStates: RawWorkflowStateConnection }>(
        apiKey,
        query,
        {},
      );
      for (const s of data.workflowStates.nodes) {
        all.push({ name: s.name, type: s.type, teamKey: s.team?.key ?? "", teamName: s.team?.name ?? "" });
      }
      if (!data.workflowStates.pageInfo.hasNextPage || !data.workflowStates.pageInfo.endCursor) break;
      after = data.workflowStates.pageInfo.endCursor;
    }
    return all;
  } catch (err) {
    console.error("[linear] failed to fetch workflow states:", (err as Error).message);
    return [];
  }
}
