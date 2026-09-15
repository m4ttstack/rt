/**
 * Discussion IPC handlers — thread/note reads and mutations for the MR
 * status sub-view. Like `mr:action`, every call routes through the daemon so
 * it owns the single authoritative GitLabProvider per repo.
 *
 *   discussions:read     — return cached discussions, lazy-fetch on miss/stale
 *   discussions:refresh  — force re-fetch from GitLab
 *   discussions:resolve  — toggle resolved state on a thread
 *   discussions:reply    — post a note into an existing thread
 *   mr:comment-inline    - post a new positioned (line-anchored) discussion
 *
 * All handlers take `{ repoName, iid }` and look up the cache entry whose
 * `mr.iid` matches. Writes go through `refreshDiscussions` in
 * `discussions-store.ts`, which also emits new-comment notifications.
 *
 * `repoName` is opaque here — it flows straight into `grants()`, the
 * discussions table, and `getRepoContext`. It becomes the serialized repo
 * identity once every caller sends one; this module makes no assumption
 * about its shape.
 */

import { NoteMutator, type TextPosition, type CreatedDiscussion } from "@mattstack/glance";
import { decodeRepo } from "../identity-decoder.ts";
import { getRepoContext, providerRequestHook } from "../freshness.ts";
import { loadSecrets } from "../../linear.ts";
import { refreshDiscussions, type BroadcastFn } from "../discussions-store.ts";
import { getDiscussionsFileStore } from "../discussions-file-store.ts";
import { grants, loadRepoTracking } from "../../repo-tracking.ts";
import { lazyChildLogger } from "../../daemon-logger.ts";
import type { HandlerContext, HandlerMap, CommandResult } from "./types.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";

const log = lazyChildLogger("discussions");

/** The subset of NoteMutator the inline-comment repair flow needs; test seam. */
export type CommentInlineMutator = Pick<NoteMutator, "fetchDiffRefs" | "createPositionedDiscussion" | "deleteNote">;

/**
 * Injectable plumbing for `mr:comment-inline`. Every field defaults to the
 * real daemon plumbing (same as `discussions:reply` uses inline); tests
 * override only what a case needs. Not used by any other handler in this
 * file.
 */
export interface DiscussionHandlerSeams {
  repoContext?: (repoName: string, repoPath?: string) => Promise<{ provider: { baseURL: string }; projectPath: string; projectId: number }>;
  gitlabToken?: () => Promise<string | undefined>;
  mutator?: (baseURL: string, token: string) => CommentInlineMutator;
  refresh?: (repoName: string, iid: number) => Promise<unknown>;
}

function buildTextPosition(
  payload: { path: string; line: number; oldPath?: string; oldLine?: number },
  diffRefs: { base_sha: string; start_sha: string; head_sha: string },
): TextPosition {
  const position: TextPosition = {
    ...diffRefs,
    position_type: "text",
    new_path: payload.path,
    new_line: payload.line,
  };
  if (typeof payload.oldLine === "number") {
    position.old_line = payload.oldLine;
    position.old_path = payload.oldPath ?? payload.path;
  } else if (typeof payload.oldPath === "string") {
    position.old_path = payload.oldPath;
  }
  return position;
}

/** Discussions are stable per push; 2min TTL keeps reads fast without going stale. */
const DISCUSSIONS_TTL_MS = 2 * 60 * 1000;

/** GitLab's page size for this endpoint; a full page means there may be more. */
const DIFFS_PAGE_SIZE = 100;
const DIFFS_FETCH_TIMEOUT_MS = 30_000;

/**
 * Every other outbound fetch in the daemon carries a bound (linear.ts,
 * notifier.ts, park.ts); this one previously had none, so a stalled GitLab
 * connection left the promise (and the sops-decrypted token in its closure)
 * pending indefinitely. `reqSignal` is the client's own request signal
 * (handlers/types.ts's Handler(payload, signal?)) so a client giving up
 * actually cancels the in-flight GitLab request instead of orphaning it.
 * `truncated` reports a full page rather than silently dropping files past it.
 */
export async function fetchMrDiffs(
  baseURL: string,
  projectPath: string,
  iid: number,
  token: string,
  opts: { reqSignal?: AbortSignal; fetchFn?: typeof fetch } = {},
): Promise<{ diffs: Array<{ newPath: string; diff: string }>; truncated: boolean }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const encoded = encodeURIComponent(projectPath);
  const url = `${baseURL}/api/v4/projects/${encoded}/merge_requests/${iid}/diffs?per_page=${DIFFS_PAGE_SIZE}`;
  const timeout = AbortSignal.timeout(DIFFS_FETCH_TIMEOUT_MS);
  const signal = opts.reqSignal ? AbortSignal.any([timeout, opts.reqSignal]) : timeout;
  const res = await fetchFn(url, { headers: { "PRIVATE-TOKEN": token }, signal });
  if (!res.ok) throw new Error(`GitLab diffs API: ${res.status}`);
  const raw = (await res.json()) as Array<{ new_path: string; diff: string }>;
  return {
    diffs: raw.map((d) => ({ newPath: d.new_path, diff: d.diff })),
    truncated: raw.length >= DIFFS_PAGE_SIZE,
  };
}

export function createDiscussionHandlers(
  ctx: Pick<HandlerContext, "cache" | "repoIndex">,
  broadcast: BroadcastFn,
  seams: DiscussionHandlerSeams = {},
): { "discussions:read": (payload: unknown) => Promise<{ ok: true; data: Commands["discussions:read"]["data"] } | { ok: false; error: string }> }
  & { "discussions:refresh": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"discussions:refresh">> }
  & { "discussions:resolve": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"discussions:resolve">> }
  & { "discussions:diffs": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"discussions:diffs">> }
  & { "discussions:reply": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"discussions:reply">> }
  & { "mr:comment-inline": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:comment-inline">> }
  & HandlerMap {
  const deps = { ctx, broadcast };
  const repoContextFn = seams.repoContext ?? getRepoContext;
  const gitlabTokenFn = seams.gitlabToken ?? (async () => (await loadSecrets()).gitlabToken);
  const mutatorFn = seams.mutator ?? ((baseURL: string, token: string) => new NoteMutator(baseURL, token, providerRequestHook()));
  const refreshFn = seams.refresh ?? ((repoName: string, iid: number) => refreshDiscussions(deps, repoName, iid));

  return {
    // `force` is a legacy daemon-client-only escape hatch (lib/daemon-client.ts),
    // not part of the typed rt-client catalog -- extended onto the base
    // payload type rather than added to Commands so the public contract
    // stays what rt-client actually sends.
    "discussions:read": async (
      rawPayload: unknown,
    ): Promise<{ ok: true; data: Commands["discussions:read"]["data"] } | { ok: false; error: string }> => {
      const payload = rawPayload as (Commands["discussions:read"]["payload"] & { force?: boolean }) | undefined;
      const iid   = payload?.iid;
      const force = payload?.force === true;
      if (!payload?.repoName || typeof iid !== "number") {
        return { ok: false, error: "missing repoName/iid" };
      }
      // Hard cutover: the discussions table is identity-keyed now;
      // a bare legacy name resolves nothing rather than reading a row that
      // no longer exists under that key.
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: true, data: { discussions: [], fetchedAt: 0, stale: true } };
      }
      const repoName = decoded.repo;

      const granted = grants(loadRepoTracking(), repoName).caches.has("discussions");
      const cached = getDiscussionsFileStore().read(repoName, iid);

      // Granted repos: events + sweep own freshness, a hit never refetches.
      // Ungranted repos: the 2-min TTL keeps on-demand reads honest.
      const fresh = !force && cached !== undefined &&
        (granted || Date.now() - cached.fetchedAt < DISCUSSIONS_TTL_MS);

      if (fresh) {
        return { ok: true, data: { discussions: cached.discussions, fetchedAt: cached.fetchedAt, stale: false } };
      }
      try {
        const res = await refreshDiscussions(deps, repoName, iid);
        return { ok: true, data: { discussions: res.discussions, fetchedAt: res.fetchedAt, stale: false } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "discussions:refresh": async (payload) => {
      const p = payload as { repoName?: string; iid?: number } | undefined;
      const iid = p?.iid;
      if (!p?.repoName || typeof iid !== "number") {
        return { ok: false, error: "missing repoName/iid" };
      }
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;
      try {
        const res = await refreshDiscussions(deps, repoName, iid);
        return { ok: true, data: { discussions: res.discussions, fetchedAt: res.fetchedAt } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "discussions:resolve": async (payload) => {
      const p = payload as { repoName?: string; iid?: number; discussionId?: string; resolved?: boolean } | undefined;
      const iid          = p?.iid;
      const discussionId = p?.discussionId;
      const resolved     = p?.resolved !== false; // default: mark resolved

      if (!p?.repoName || typeof iid !== "number" || !discussionId) {
        return { ok: false, error: "missing repoName/iid/discussionId" };
      }
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;

      const repoPath = ctx.repoIndex()[repoName];
      try {
        const repoCtx = await getRepoContext(repoName, repoPath);
        if (resolved) {
          await repoCtx.provider.resolveDiscussion(repoCtx.projectPath, iid, discussionId);
        } else {
          await repoCtx.provider.unresolveDiscussion(repoCtx.projectPath, iid, discussionId);
        }
        const res = await refreshDiscussions(deps, repoName, iid);
        return { ok: true, data: { discussions: res.discussions, fetchedAt: res.fetchedAt } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "discussions:diffs": async (payload, signal) => {
      const p = payload as { repoName?: string; iid?: number } | undefined;
      const iid = p?.iid;
      if (!p?.repoName || typeof iid !== "number") {
        return { ok: false, error: "missing repoName/iid" };
      }
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;

      const repoPath = ctx.repoIndex()[repoName];
      try {
        const repoCtx = await getRepoContext(repoName, repoPath);
        const secrets = await loadSecrets();
        if (!secrets.gitlabToken) return { ok: false, error: "no gitlabToken in secrets" };

        const { diffs, truncated } = await fetchMrDiffs(
          repoCtx.provider.baseURL,
          repoCtx.projectPath,
          iid,
          secrets.gitlabToken,
          { reqSignal: signal },
        );
        return { ok: true, data: { diffs, truncated } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "discussions:reply": async (payload) => {
      const p = payload as { repoName?: string; iid?: number; discussionId?: string; body?: string } | undefined;
      const iid          = p?.iid;
      const discussionId = p?.discussionId;
      const body         = p?.body;

      if (!p?.repoName || typeof iid !== "number" || !discussionId || typeof body !== "string" || !body.trim()) {
        return { ok: false, error: "missing repoName/iid/discussionId/body" };
      }
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;

      const repoPath = ctx.repoIndex()[repoName];
      try {
        const repoCtx = await getRepoContext(repoName, repoPath);
        const secrets = await loadSecrets();
        if (!secrets.gitlabToken) return { ok: false, error: "no gitlabToken in secrets" };
        const mutator = new NoteMutator(repoCtx.provider.baseURL, secrets.gitlabToken, providerRequestHook());
        await mutator.createNote(repoCtx.projectId, iid, body, discussionId);
        const res = await refreshDiscussions(deps, repoName, iid);
        return { ok: true, data: { discussions: res.discussions, fetchedAt: res.fetchedAt } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "mr:comment-inline": async (payload) => {
      const p = payload as {
        repoName?: string; iid?: number; body?: string; path?: string; line?: number;
        oldPath?: string; oldLine?: number;
      } | undefined;
      const iid  = p?.iid;
      const body = p?.body;
      const path = p?.path;
      const line = p?.line;

      if (!p?.repoName || typeof iid !== "number" || typeof body !== "string" || !body.trim() ||
          typeof path !== "string" || !path ||
          typeof line !== "number" || !Number.isInteger(line) || line <= 0) {
        return { ok: false, error: "missing repoName/iid/body/path/line" };
      }
      const oldLineOk = p?.oldLine === undefined || (Number.isInteger(p.oldLine) && p.oldLine > 0);
      const oldPathOk = p?.oldPath === undefined || (typeof p.oldPath === "string" && p.oldPath.length > 0);
      if (!oldLineOk || !oldPathOk) {
        return { ok: false, error: "invalid oldPath/oldLine" };
      }
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;
      const position = { path, line, oldPath: p?.oldPath, oldLine: p?.oldLine };

      const repoPath = ctx.repoIndex()[repoName];
      try {
        const repoCtx = await repoContextFn(repoName, repoPath);
        const token = await gitlabTokenFn();
        if (!token) return { ok: false, error: "no gitlabToken in secrets" };
        const mutator = mutatorFn(repoCtx.provider.baseURL, token);

        const postOnce = async () => {
          const diffRefs = await mutator.fetchDiffRefs(repoCtx.projectId, iid);
          return mutator.createPositionedDiscussion(repoCtx.projectId, iid, body, buildTextPosition(position, diffRefs));
        };

        // Awaited (not fire-and-forget): a caller reading discussions right
        // after this resolves must see its own just-posted comment. A refresh
        // throw is swallowed here so it can never turn a verified post into
        // ok:false, which would make a caller retry and duplicate the comment.
        const succeed = async (discussionId: string, noteId: number): Promise<CommandResult<"mr:comment-inline">> => {
          await refreshFn(repoName, iid).catch((err) =>
            log.warn({ err, repoName, iid }, "mr:comment-inline: post-comment discussions refresh failed"));
          return { ok: true, data: { discussionId, noteId, verified: true } };
        };

        const first = await postOnce();
        const firstNote = first.notes[0];
        if (!firstNote) return { ok: false, error: "GitLab created a discussion with no notes" };

        if (firstNote.type === "DiffNote") {
          return succeed(first.id, firstNote.id);
        }

        // The first note landed as a general note (GitLab silently dropped the
        // position). It must be deleted before the retry: leaving it would
        // strand a duplicate, unpositioned copy of the comment on the MR.
        try {
          await mutator.deleteNote(repoCtx.projectId, iid, firstNote.id);
        } catch (err) {
          return { ok: false, error: `could not delete stray note ${firstNote.id}: ${String(err)}` };
        }

        let second: CreatedDiscussion;
        try {
          second = await postOnce();
        } catch (err) {
          return {
            ok: false,
            error: `first attempt degraded (note ${firstNote.id} type ${firstNote.type}, deleted); `
              + `retry failed: ${String(err)}`,
          };
        }
        const secondNote = second.notes[0];
        if (!secondNote) return { ok: false, error: "GitLab created a retry discussion with no notes" };

        if (secondNote.type === "DiffNote") {
          return succeed(second.id, secondNote.id);
        }

        try {
          await mutator.deleteNote(repoCtx.projectId, iid, secondNote.id);
        } catch (err) {
          return { ok: false, error: `could not delete stray note ${secondNote.id}: ${String(err)}` };
        }

        return {
          ok: false,
          error: `GitLab dropped the position twice (note ${firstNote.id} type ${firstNote.type}, `
            + `note ${secondNote.id} type ${secondNote.type}); both general notes were deleted`,
        };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  };
}
