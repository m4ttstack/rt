/**
 * mr:upload: one multipart POST to GitLab's project uploads endpoint, behind
 * the path guard in ../upload-guard.ts. glance has no multipart support, so
 * the request is built here with the same token and base URL getRepoContext
 * gives every other GitLab verb, and it reports through providerRequestHook
 * like a provider call. The allowed roots are assembled per call: the target
 * repo's index path and worktree registry, the Claude Code temp root for this
 * uid, and rt.mcp.uploadRoots read through the resolver at call time.
 */
import { isAbsolute } from "path";
import { decodeRepo } from "../identity-decoder.ts";
import { getRepoContext, providerRequestHook } from "../freshness.ts";
import { loadSecrets } from "../../linear.ts";
import { getSetting } from "../../settings/resolve.ts";
import { loadRegistry } from "../../worktree/registry.ts";
import { checkUploadPath, claudeTempRoots } from "../upload-guard.ts";
import type { CommandResult, HandlerContext, HandlerMap } from "./types.ts";

/** Inside the client's 120s so the daemon, not the socket, reports a stalled GitLab. */
const UPLOAD_FETCH_TIMEOUT_MS = 100_000;

export interface MrUploadSeams {
  repoContext?: (repoName: string, repoPath?: string) => Promise<{ provider: { baseURL: string }; projectPath: string; projectId: number }>;
  gitlabToken?: () => Promise<string | undefined>;
  worktreePaths?: (repoName: string) => string[];
  uploadRoots?: () => string[];
  tempRoots?: () => string[];
  fetchFn?: typeof fetch;
  requestHook?: () => ReturnType<typeof providerRequestHook>;
}

export function createMrUploadHandlers(
  ctx: Pick<HandlerContext, "repoIndex" | "log">,
  seams: MrUploadSeams = {},
): { "mr:upload": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:upload">> } & HandlerMap {
  const repoContextFn = seams.repoContext ?? getRepoContext;
  const gitlabTokenFn = seams.gitlabToken ?? (async () => (await loadSecrets()).gitlabToken);
  const worktreePathsFn = seams.worktreePaths ?? ((repoName: string) => loadRegistry(repoName).map((t) => t.path));
  const tempRootsFn = seams.tempRoots ?? (() => claudeTempRoots(typeof process.getuid === "function" ? process.getuid() : null));
  const fetchFn = seams.fetchFn ?? fetch;
  const hookFn = seams.requestHook ?? providerRequestHook;
  const uploadRootsFn = seams.uploadRoots ?? (() => {
    let entries: unknown;
    try {
      entries = getSetting<string[]>("rt.mcp.uploadRoots").value;
    } catch (err) {
      ctx.log.warn({ err }, "rt.mcp.uploadRoots: unreadable, treating as empty");
      return [];
    }
    if (!Array.isArray(entries)) return [];
    const roots: string[] = [];
    for (const entry of entries) {
      if (typeof entry === "string" && isAbsolute(entry)) roots.push(entry);
      else ctx.log.warn({ entry }, "rt.mcp.uploadRoots: ignoring non-absolute entry");
    }
    return roots;
  });

  return {
    "mr:upload": async (payload, signal) => {
      const p = payload as { repoName?: unknown; path?: unknown } | undefined;
      const path = p?.path;
      if (typeof path !== "string" || !path.trim()) return { ok: false, error: "missing repoName/path" };
      const decoded = decodeRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      const repoName = decoded.repo;
      const repoPath = ctx.repoIndex()[repoName];
      if (!repoPath) return { ok: false, error: "repo-unknown" };

      const roots = [repoPath, ...worktreePathsFn(repoName), ...tempRootsFn(), ...uploadRootsFn()];
      const checked = checkUploadPath(path.trim(), roots);
      if (!checked.ok) return { ok: false, error: checked.error };

      try {
        const repoCtx = await repoContextFn(repoName, repoPath);
        const token = await gitlabTokenFn();
        if (!token) return { ok: false, error: "no gitlabToken in secrets" };

        const apiPath = `/projects/${repoCtx.projectId}/uploads`;
        const form = new FormData();
        form.append("file", new Blob([checked.bytes], { type: checked.mime }), checked.filename);
        const timeout = AbortSignal.timeout(UPLOAD_FETCH_TIMEOUT_MS);
        const started = performance.now();
        const res = await fetchFn(`${repoCtx.provider.baseURL}/api/v4${apiPath}`, {
          method: "POST",
          headers: { "PRIVATE-TOKEN": token },
          body: form,
          signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        });
        hookFn().onRequest({ op: "mr:upload", transport: "rest", method: "POST", path: apiPath, durationMs: performance.now() - started, status: res.status });
        if (!res.ok) {
          const detail = (await res.text().catch(() => "")).slice(0, 200);
          return { ok: false, error: `GitLab upload returned ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}` };
        }
        const body = (await res.json()) as { url?: unknown; full_path?: unknown; markdown?: unknown };
        if (typeof body.markdown !== "string" || typeof body.url !== "string") {
          return { ok: false, error: "GitLab upload reply carried no url/markdown" };
        }
        const url = typeof body.full_path === "string"
          ? `${repoCtx.provider.baseURL}${body.full_path}`
          : `${repoCtx.provider.baseURL}/${repoCtx.projectPath}${body.url}`;
        return { ok: true, data: { url, markdown: body.markdown } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  };
}
