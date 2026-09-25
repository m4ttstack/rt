/**
 * mr:upload: the guard's roots come from the target repo's index path and
 * worktree registry, the Claude Code temp root, and rt.mcp.uploadRoots read
 * at call time; a passing file goes up as one multipart POST with the same
 * token and base URL the other GitLab verbs use.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setSetting } from "../../settings/write.ts";
import { closeStateDb } from "../../state/index.ts";
import { saveRegistry, type TreeRecord } from "../../worktree/registry.ts";
import { createMrUploadHandlers, type MrUploadSeams } from "../handlers/mr-upload.ts";

const REPO = "remote:gitlab.example.com%2Facme%2Fapp";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const REPLY = { url: "/uploads/abc123/shot.png", full_path: "/-/project/99/uploads/abc123/shot.png", markdown: "![shot](/uploads/abc123/shot.png)" };

type Captured = { url: string; method: string | undefined; token: string | undefined; file: File | null };

function harness(overrides: Partial<MrUploadSeams> & { reply?: () => Promise<Response>; repoPath: string; warns?: unknown[] }) {
  const calls: Captured[] = [];
  const hooks: Array<{ op: string; method: string; path: string; status: number }> = [];
  const warns = overrides.warns ?? [];
  const seams: MrUploadSeams = {
    repoContext: async () => ({ provider: { baseURL: "https://gitlab.example.com" }, projectPath: "acme/app", projectId: 99 }),
    gitlabToken: async () => "tok",
    worktreePaths: () => [],
    uploadRoots: () => [],
    tempRoots: () => [],
    requestHook: () => ({ onRequest: (info) => hooks.push({ op: info.op, method: info.method, path: info.path, status: info.status }) }),
    fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as FormData;
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url: String(url), method: init?.method, token: headers?.["PRIVATE-TOKEN"], file: body ? (body.get("file") as File) : null });
      return overrides.reply ? overrides.reply() : new Response(JSON.stringify(REPLY), { status: 201 });
    }) as typeof fetch,
    ...overrides,
  };
  const ctx = {
    repoIndex: () => ({ [REPO]: overrides.repoPath }),
    log: { warn: (...a: unknown[]) => { warns.push(a); }, info() {}, debug() {}, error() {} } as any,
  };
  return { handlers: createMrUploadHandlers(ctx, seams), calls, hooks, warns };
}

describe("mr:upload", () => {
  const origHome = process.env.HOME;
  let home: string;
  let repoPath: string;
  let elsewhere: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-upload-home-")));
    process.env.HOME = home;
    closeStateDb();
    repoPath = realpathSync(mkdtempSync(join(tmpdir(), "rt-upload-repo-")));
    elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "rt-upload-else-")));
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    for (const d of [home, repoPath, elsewhere]) rmSync(d, { recursive: true, force: true });
  });

  function png(dir: string, name = "shot.png"): string {
    const p = join(dir, name);
    writeFileSync(p, PNG);
    return p;
  }

  test("a png under the repo's index path uploads as one multipart POST and returns url and markdown", async () => {
    const h = harness({ repoPath });
    const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) });
    expect(res).toEqual({ ok: true, data: { url: "https://gitlab.example.com/-/project/99/uploads/abc123/shot.png", markdown: REPLY.markdown } });
    expect(h.calls.length).toBe(1);
    expect(h.calls[0]).toMatchObject({ url: "https://gitlab.example.com/api/v4/projects/99/uploads", method: "POST", token: "tok" });
    expect(h.calls[0]!.file?.name).toBe("shot.png");
    expect(h.calls[0]!.file?.type).toBe("image/png");
    expect(h.calls[0]!.file?.size).toBe(PNG.length);
    expect(h.hooks).toEqual([{ op: "mr:upload", method: "POST", path: "/projects/99/uploads", status: 201 }]);
  });

  test("a file under a registered worktree of the target repo is allowed through the default registry seam", async () => {
    const tree: TreeRecord = { name: "wt1", path: elsewhere, kind: "ephemeral", state: "claimed", branch: "feat", createdAt: new Date().toISOString() };
    saveRegistry(REPO, [tree]);
    const h = harness({ repoPath, worktreePaths: undefined });
    const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(elsewhere) });
    expect(res.ok).toBe(true);
  });

  test("a file under a Claude temp root is allowed", async () => {
    const h = harness({ repoPath, tempRoots: () => [elsewhere] });
    expect((await h.handlers["mr:upload"]({ repoName: REPO, path: png(elsewhere) })).ok).toBe(true);
  });

  test("rt.mcp.uploadRoots is read at call time through the resolver", async () => {
    const h = harness({ repoPath, uploadRoots: undefined });
    const p = png(elsewhere);
    expect((await h.handlers["mr:upload"]({ repoName: REPO, path: p })).ok).toBe(false);
    setSetting("rt.mcp.uploadRoots", [elsewhere], "machine");
    expect((await h.handlers["mr:upload"]({ repoName: REPO, path: p })).ok).toBe(true);
    setSetting("rt.mcp.uploadRoots", [], "machine");
    expect((await h.handlers["mr:upload"]({ repoName: REPO, path: p })).ok).toBe(false);
    expect(h.calls.length).toBe(1);
  });

  test("a non-absolute rt.mcp.uploadRoots entry is ignored with a warning", async () => {
    const h = harness({ repoPath, uploadRoots: undefined });
    setSetting("rt.mcp.uploadRoots", ["relative/dir", elsewhere], "machine");
    expect((await h.handlers["mr:upload"]({ repoName: REPO, path: png(elsewhere) })).ok).toBe(true);
    expect(JSON.stringify(h.warns)).toContain("relative/dir");
  });

  test("a file outside every root is refused with no network call", async () => {
    const h = harness({ repoPath });
    const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(elsewhere) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("outside the allowed upload roots");
    expect(h.calls).toEqual([]);
  });

  test("a missing path, a non-identity repo and an unindexed repo are refused", async () => {
    const h = harness({ repoPath });
    expect(await h.handlers["mr:upload"]({ repoName: REPO })).toEqual({ ok: false, error: "missing repoName/path" });
    expect(await h.handlers["mr:upload"]({ repoName: REPO, path: "  " })).toEqual({ ok: false, error: "missing repoName/path" });
    expect(await h.handlers["mr:upload"]({ repoName: "not-an-identity", path: "/x.png" })).toEqual({ ok: false, error: "repo-unknown" });
    expect(await h.handlers["mr:upload"]({ repoName: "remote:gitlab.example.com%2Facme%2Fother", path: "/x.png" })).toEqual({ ok: false, error: "repo-unknown" });
    expect(h.calls).toEqual([]);
  });

  test("a missing token is refused after the guard passes", async () => {
    const h = harness({ repoPath, gitlabToken: async () => undefined });
    expect(await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) })).toEqual({ ok: false, error: "no gitlabToken in secrets" });
    expect(h.calls).toEqual([]);
  });

  test("a non-2xx reply is ok:false naming the status; a fetch throw is ok:false with its message", async () => {
    const denied = harness({ repoPath, reply: async () => new Response("forbidden", { status: 403, statusText: "Forbidden" }) });
    const res = await denied.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("403");
    expect(denied.hooks[0]?.status).toBe(403);

    const threw = harness({ repoPath, reply: async () => { throw new Error("socket hang up"); } });
    const res2 = await threw.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) });
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.error).toContain("socket hang up");
  });

  test("a reply without full_path falls back to the project-relative url", async () => {
    const h = harness({ repoPath, reply: async () => new Response(JSON.stringify({ url: "/uploads/abc/shot.png", markdown: "m" }), { status: 201 }) });
    const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) });
    expect(res).toEqual({ ok: true, data: { url: "https://gitlab.example.com/acme/app/uploads/abc/shot.png", markdown: "m" } });
  });

  test("a reply with no markdown is ok:false, never a half result", async () => {
    const h = harness({ repoPath, reply: async () => new Response(JSON.stringify({ url: "/uploads/abc/shot.png" }), { status: 201 }) });
    const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("markdown");
  });
});
