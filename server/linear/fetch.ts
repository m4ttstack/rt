import { linearRequest } from "./client.js";
import { mapIssue } from "./map.js";
import { mrTicketHaystack } from "./ticket.js";
import { mapLimit } from "../util/concurrency.js";
import { getStore } from "../store/index.js";
import type { RawIssue } from "./raw-types.js";
import type { NormMr, NormLinearIssue } from "../store/model.js";
import type { LeaderboardWarning, RefreshProgress } from "../../shared/types.js";

/** Extract Linear identifiers from a string, e.g. "ACME-123", "ENG-456", "HUB:299". */
const LINEAR_ID_RE = /\b([A-Z]+[-:]\d+)\b/gi;

/**
 * Reject single-character "team keys" like "Z-10" that the regex picks up from MR text
 * (e.g. "Phase Z-10"). Real Linear team keys are at least 2 uppercase letters.
 * Other false-positives (LOCALHOST-4000, PHASE-2) are handled by batching: if one
 * chunk errors, only that chunk is lost rather than the entire result.
 */
const VALID_LINEAR_ID_RE = /^[A-Z]{2,}-\d+$/;

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

/** A verify pass: resolved lookups plus the identifiers whose lookup errored (unknown, not invalid). */
interface VerifyOutcome {
  result: VerifyResult;
  failed: string[];
}

const CHUNK_SIZE = 100;

const LINEAR_CONCURRENCY = 6;

/**
 * Verify a chunk of identifiers against Linear. On a batch error (one bad identifier
 * poisoning the query, or a transient failure like a rate limit), falls back to
 * concurrent individual lookups so the rest of the chunk is still recovered.
 */
async function verifyChunk(
  apiKey: string,
  chunk: readonly string[],
  signal?: AbortSignal,
): Promise<VerifyOutcome> {
  const query = buildVerifyQuery(chunk);
  try {
    return { result: await linearRequest<VerifyResult>(apiKey, query, {}, signal), failed: [] };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return verifyIndividually(apiKey, chunk, signal);
  }
}

/**
 * Look up each identifier concurrently. Lookups that error are reported in `failed`
 * rather than silently dropped: an errored lookup says nothing about validity.
 * Keyed identically to the batch result (_0, _1, ...) so callers don't care.
 */
async function verifyIndividually(
  apiKey: string,
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<VerifyOutcome> {
  const result: VerifyResult = {};
  const failed: string[] = [];
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
        // "Entity not found" IS a definitive answer (Linear errors on nonexistent ids
        // rather than returning null): leave the alias unset so it's cached as invalid.
        // Anything else (rate limit, transport) says nothing about validity.
        if (!/entity not found/i.test((err as Error).message)) failed.push(id);
      }
    },
  );
  return { result, failed };
}

/**
 * Which MRs feed Linear ticket discovery: shipped (merged) plus in-flight (opened,
 * or locked while mid-merge), but NOT abandoned (closed). Open MRs matter because a
 * ticket sits in states like "In Review" precisely while its MR is still open — scan
 * only merged MRs and those tickets never enter the dataset, so `doneStates` can never
 * count them.
 */
export function eligibleForLinearDiscovery(m: NormMr): boolean {
  return m.state !== "closed";
}

/**
 * Scan the given MRs for Linear ticket identifiers, batch-verify them against the Linear
 * API via `issue(id:)` lookups, and return verified tickets attributed to each MR's author.
 *
 * Resilient: batched in chunks of 100, with automatic per-identifier fallback when a
 * chunk fails (one bad identifier can't zero out the result).
 */
export async function resolveLinearTickets(
  apiKey: string | undefined,
  sourceMrs: readonly NormMr[],
  warnings: LeaderboardWarning[],
  signal?: AbortSignal,
  onProgress?: (p: Omit<RefreshProgress, "window">) => void,
): Promise<NormLinearIssue[]> {
  if (!apiKey || sourceMrs.length === 0) return [];

  interface TicketRef {
    authors: Set<string>;
    mrs: { iid: number; projectPath: string }[];
  }
  const ticketMap = new Map<string, TicketRef>();
  for (const mr of sourceMrs) {
    const ids = extractLinearIds(mrTicketHaystack(mr));
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
  const store = getStore();
  const knownValid: string[] = [];
  const unknown: string[] = [];
  for (const id of candidates) {
    const cached = store.isValidLinearId(id);
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

  const allFailed: string[] = [];

  // Phase 1: batch-query known-valid identifiers. A chunk can still fail transiently
  // (rate limits during a big refresh); silently dropping it removes ~100 tickets from
  // the envelope, so fall back to individual lookups exactly like the unknown path.
  const validChunks = Math.ceil(knownValid.length / CHUNK_SIZE);
  for (let ci = 0; ci < validChunks; ci++) {
    signal?.throwIfAborted();
    const chunk = knownValid.slice(ci * CHUNK_SIZE, (ci + 1) * CHUNK_SIZE);
    onProgress?.({ phase: "linear", label: `Fetching ${knownValid.length} cached tickets`, done: ci, total: validChunks });
    const { result, failed } = await verifyChunk(apiKey, chunk, signal);
    collectResults(result, chunk);
    allFailed.push(...failed);
  }

  // Phase 2: verify unknown identifiers (with fallback for bad ones).
  if (unknown.length > 0) {
    const unknownChunks = Math.ceil(unknown.length / CHUNK_SIZE);
    for (let ci = 0; ci < unknownChunks; ci++) {
      signal?.throwIfAborted();
      const chunk = unknown.slice(ci * CHUNK_SIZE, (ci + 1) * CHUNK_SIZE);
      onProgress?.({ phase: "linear", label: `Verifying ${unknown.length} new identifiers (${ci + 1}/${unknownChunks})`, done: ci, total: unknownChunks });
      const { result, failed } = await verifyChunk(apiKey, chunk, signal);
      collectResults(result, chunk);
      allFailed.push(...failed);

      // Record validity for next time -- but only definitive answers. An errored lookup
      // says nothing; caching valid:false for it would permanently hide a real ticket.
      const failedSet = new Set(failed);
      const entries = chunk
        .filter((id) => !failedSet.has(id))
        .map((id) => ({ id, valid: !!result[`_${chunk.indexOf(id)}`] }));
      store.putLinearIds(entries);
    }
  }

  if (allFailed.length > 0) {
    warnings.push({
      code: "linear_partial",
      message: `Linear lookup failed for ${allFailed.length} tickets (e.g. ${allFailed[0]}); they are missing from this refresh.`,
    });
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
