# MCP MR Write Tools (phase 1b, GitLab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every MR write a team flow makes on GitLab has an rt MCP tool (adds `mr_update` and `mr_upload`, extends `mr_create` with labels and squash), and every MR write tool accepts the target the agent already holds: an MR URL, a checkout or worktree path, or a repo label.

**Architecture:** Target resolution is a client-side concern in a new `lib/mcp/mr-target.ts` (over `tryResolveRepoArg` and `identityFromRemote`, with a fallback that matches an MR URL against the registered checkouts' origin remotes); the daemon verbs keep taking the serialized identity only. `mr:create` and the new `mr:update` live in `lib/daemon/handlers/mr.ts` and reach squash and add/remove-labels through glance's raw `restRequest` door. `mr:upload` is its own handler module over a pure, network-free path guard (`lib/daemon/upload-guard.ts`) and a daemon-side multipart POST, gated by the new machine-scoped `rt.mcp.uploadRoots` setting.

**Tech Stack:** Bun + TypeScript, `bun:test`, `@mattstack/glance` (`GitLabProvider.createPullRequest`, `updatePullRequest`, `restRequest`), rt-client command catalog and settings registry, Docusaurus docs.

**Spec:** `docs/superpowers/specs/2026-09-25-mcp-mr-write-tools-phase-1b-design.md` (approved; extends `docs/superpowers/specs/2026-09-25-mcp-mr-write-tools-design.md`). Phase 1 shipped at `f499c3b58` (rt#472); this plan is rt only, on branch `rt-315-mr-tools-1b` in the worktree `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/saruman`.

## Global Constraints

- Daemon verbs keep taking the serialized identity only (`remote:gitlab.com%2Facme%2Facme-dev`). Resolution of `repoName` (identity, absolute path, or label matching exactly one registered repo) and `mrUrl` happens in `lib/mcp`, never in a handler. `mr_map` is unchanged.
- Every MR write tool uses `MR_WRITE_TIMEOUT_MS` (30_000) except `mr_upload`, which uses 120_000. No tool or verb retries on its own.
- A write that landed is never reported `ok: false`: a create whose squash write fails is `ok` with `squashApplied: false` and `squashError`; a partial `mr:update` names what landed and what did not.
- No tool or verb for merge. Tool descriptions say "GitLab only".
- `mr_upload` reads only regular files whose `realpath` sits under an allowed root (a worktree of the target repo, `/private/tmp/claude-<uid>/` or its `/tmp` alias, or an entry of `rt.mcp.uploadRoots`), with an extension in png, jpg, jpeg, gif, webp, mp4, mov, webm, whose leading bytes match that type, at most 50 MB.
- `rt.mcp.uploadRoots` is a string array, machine scope only, default `[]`; non-absolute entries are ignored with a warning; read at call time through `getSetting`, never cached.
- `mrUrl` resolves first through `identityFromRemote` on its https form; when that identity is not registered, it falls back to the registered checkouts' own origin remotes (read with `getRemoteUrl`, normalized to lowercase host plus path without `.git`, matched against the URL's host and path): exactly one match resolves, none refuses as unregistered, more than one refuses as ambiguous naming the identities. Never guessed.
- An empty label array (`labels: []` on `mr:create`, `addLabels: []` or `removeLabels: []` on `mr:update`) is a no-op that sends nothing for that field, never an error; `mr:update` still refuses with `nothing to update` when no field would change anything.
- No em dashes or en dashes anywhere (code, comments, commits, docs). Use "...", parens, or rephrase.
- Comments only state constraints the code cannot show. No narration, no ticket or review citations in source.
- rt is a PUBLIC repo: no employer names, repos, ticket ids or hosts in code, tests, fixtures, docs, commits or PR text. Fixtures use neutral names (acme, gitlab.example.com). Run `bash scripts/repo-purity.sh` after `git add` and before every push.
- After touching `packages/rt-client/src/commands.ts` or `packages/rt-client/src/settings/registry-defs.ts`, run `bun run --cwd packages/rt-client build` (`packages/rt-client/test/dist-freshness.test.ts` guards it).
- Never run a built binary or a second daemon against the real `~/.mattstack`. Smoke tests call handlers directly under a scratch HOME.
- Never touch an employer GitLab project; smoke uses the harness project only (`m4tthew-dev/glance-test-repo`, project id 79691134, credentials in `/Users/matt/Documents/GitHub/glance/harness_credentials.json`, never printed).
- Commits and PR bodies end with the attribution lines the executing session's own harness names (the model differs per executor, so never copy another session's trailer).
- Worktree Bash guard: plans' shell commands must avoid `&&` chains, `git -C`, shell variables, heredocs and `env X=` prefixes (one plain command per step; multi-line commit messages via `git commit -F <file>`).
- `bunx tsc --noEmit` includes tests; CI also runs `test:e2e` and `test:pty` (`bun run test:all` runs all three).
- This plan adds no state.db schema; `SCHEMA_VERSION` is untouched.

## Review Focus

1. **A symlink inside an allowed root pointing outside it.** `realpath` resolves it first, so the upload is refused as outside the roots; the guard never reads the target. (Task 4, `upload-guard.test.ts`)
2. **A file renamed to `.png` whose bytes are not a PNG.** Refused as an extension/signature mismatch before any network call. (Task 4, `upload-guard.test.ts`)
3. **An `mrUrl` whose https form names no registered identity.** A repo pinned by an override keyed on its ssh remote still resolves, through the registered checkouts' origin remotes; a URL matching two checkouts is refused as ambiguous naming both; a URL matching none is refused with the identity it would have used and the `rt repos register` hint. Never guessed, never sent to the daemon. (Task 1, `mr-target.test.ts` and the wiring block in `tools.test.ts`)
4. **The squash write failing after a landed create.** The result is `ok` with the created `iid`, `squashApplied: false` and `squashError`, so the caller uses `mr_update` instead of creating again; the read-back-failure path still attempts the squash write with the iid it has. (Task 2, `mr-create.test.ts`)
5. **`repoName` and `mrUrl` that disagree** (different repos, or `iid` that differs from the URL's). Refused naming both, with no daemon call. (Task 1, `mr-target.test.ts` and `tools.test.ts`)

## File structure

- `lib/mcp/mr-target.ts` (new): `parseMrUrl`, `resolveRepoTarget`, `resolveMrTarget`. The only place `{repoName, iid, mrUrl}` becomes `{identity, iid}`.
- `lib/mcp/tools.ts`: every `mr_*` write tool takes target props and resolves through `mr-target.ts`; `mr_create` gains `labels`/`squash`; new `mr_update` and `mr_upload`.
- `lib/daemon/handlers/mr.ts`: `mr:create` extended (labels, squash), new `mr:update`, shared `labelsError`/`putMergeRequest` helpers.
- `lib/daemon/upload-guard.ts` (new): pure path/type/size/signature guard, no network, no settings read.
- `lib/daemon/handlers/mr-upload.ts` (new): `mr:upload` verb with seams (repo context, token, roots, fetch, request hook).
- `lib/daemon/command-router.ts`: spreads the new upload handler map.
- `packages/rt-client/src/commands.ts`: `mr:create` payload/data widened; `mr:update` and `mr:upload` entries and names.
- `packages/rt-client/src/settings/registry-defs.ts`: `rt.mcp.uploadRoots` row.
- `e2e/tests/mcp-serve.test.ts`: roster gains `mr_update`, `mr_upload`.
- `website/docs/guides/mcp.mdx`, `AGENTS.md`: docs.

---

### Task 1: Target resolution (`lib/mcp/mr-target.ts`) wired into every MR write tool

**Files:**
- Create: `lib/mcp/mr-target.ts`
- Create: `lib/mcp/__tests__/mr-target.test.ts`
- Modify: `lib/mcp/tools.ts` (imports at lines 9-23; `REPO_NAME_RULE` at line 102; `MR_TARGET_FIELDS`/`runMrAction` at lines 111-127; the nine mr tools at lines 417-648)
- Modify: `lib/mcp/__tests__/tools.test.ts` (imports; the three schema tests at lines 284-292, 342-346, 395-399; a new `mr target resolution wiring` block)

**Interfaces:**
- Consumes: `tryResolveRepoArg(arg): Promise<RepoArgResolution>` (`lib/repo-arg.ts`), `identityFromRemote(remote): RepoIdentity | null`, `normalizeRemote(remote): string | null` and `serializeIdentity` (`lib/settings/identity.ts`), `isRepoRegistered(identity): boolean` and `loadRepoIndex(): RepoIndex` (`lib/repo-index.ts`), `getRemoteUrl(repoPath): Promise<string | undefined>` (`lib/pickers.ts`, the exported origin-remote read; `lib/endpoint/shim.ts` and `lib/repo.ts` carry private copies, and pickers.ts is already on this graph through `repo-arg.ts` -> `repo.ts`).
- Produces (used by Tasks 2, 3, 4):
  - `export function parseMrUrl(url: string): { host: string; projectPath: string; iid: number } | null`
  - `export async function resolveRepoTarget(input: TargetInput): Promise<{ ok: true; identity: string; iid: number | undefined } | { ok: false; error: string }>`
  - `export async function resolveMrTarget(input: TargetInput): Promise<{ ok: true; identity: string; iid: number } | { ok: false; error: string }>`
  - In `tools.ts` (module-private): `REPO_NAME_RULE`, `MR_TARGET_PROPS`, `REPO_TARGET_PROPS`, `runMrAction(target: { identity: string; iid: number }, action, args, body)`.

Note on the existing comment in `tools.ts` above `resolveRepoIdentity` (it says the module deliberately avoids importing `lib/repo-arg.ts`): that was a choice for `mr_map`, which already pays a daemon round trip. The spec names `tryResolveRepoArg` as the one resolver, and `lib/__tests__/no-eager-tui.test.ts` bans `repo-arg.ts` only from the graph under `lib/daemon.ts`, which never reaches `lib/mcp`. `mr_map` keeps its own path unchanged.

- [ ] **Step 1: Write the failing resolver tests.** Create `lib/mcp/__tests__/mr-target.test.ts`:

```ts
/**
 * resolveMrTarget / resolveRepoTarget: the MCP layer's one place that turns
 * {repoName, iid, mrUrl} into the serialized identity and iid the daemon
 * verbs take. Runs against a temp HOME with a seeded repo index and machine
 * store, the same stores the CLI's --repo resolver reads.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { REPO_INDEX_NS } from "../../repo-index.ts";
import { machineSettingsPath } from "../../rt-paths.ts";
import { closeStateDb, setKvValue } from "../../state/index.ts";
import { parseMrUrl, resolveMrTarget, resolveRepoTarget } from "../mr-target.ts";

const APP = "remote:gitlab.example.com%2Facme%2Fapp";
const SUB = "remote:gitlab.example.com%2Facme%2Fplatform%2Fapp";
const URL_APP = "https://gitlab.example.com/acme/app/-/merge_requests/7";

describe("parseMrUrl", () => {
  test("plain, subgroup and suffixed URLs", () => {
    expect(parseMrUrl(URL_APP)).toEqual({ host: "gitlab.example.com", projectPath: "acme/app", iid: 7 });
    expect(parseMrUrl("https://gitlab.example.com/acme/platform/app/-/merge_requests/12/diffs")).toEqual({ host: "gitlab.example.com", projectPath: "acme/platform/app", iid: 12 });
    expect(parseMrUrl(`${URL_APP}#note_5`)).toEqual({ host: "gitlab.example.com", projectPath: "acme/app", iid: 7 });
    expect(parseMrUrl(`${URL_APP}?tab=pipelines`)).toEqual({ host: "gitlab.example.com", projectPath: "acme/app", iid: 7 });
    expect(parseMrUrl(`${URL_APP}/diffs?commit_id=abc#x`)).toEqual({ host: "gitlab.example.com", projectPath: "acme/app", iid: 7 });
    expect(parseMrUrl(`  ${URL_APP}  `)).toEqual({ host: "gitlab.example.com", projectPath: "acme/app", iid: 7 });
  });

  test("refuses http, a missing iid, an issue URL and garbage", () => {
    expect(parseMrUrl("http://gitlab.example.com/acme/app/-/merge_requests/7")).toBeNull();
    expect(parseMrUrl("https://gitlab.example.com/acme/app/-/merge_requests/")).toBeNull();
    expect(parseMrUrl("https://gitlab.example.com/acme/app/-/issues/7")).toBeNull();
    expect(parseMrUrl("not a url")).toBeNull();
  });
});

function withTempHome(): void {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mr-target-")));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });
}

describe("resolveMrTarget", () => {
  withTempHome();

  test("a serialized identity and iid pass through", async () => {
    expect(await resolveMrTarget({ repoName: APP, iid: 7 })).toEqual({ ok: true, identity: APP, iid: 7 });
  });

  test("an absolute checkout path derives the identity from its origin remote", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "rt-mr-target-repo-")));
    execSync("git init -q", { cwd: repo });
    execSync("git remote add origin https://gitlab.example.com/acme/app.git", { cwd: repo });
    expect(await resolveMrTarget({ repoName: repo, iid: 7 })).toEqual({ ok: true, identity: APP, iid: 7 });
    rmSync(repo, { recursive: true, force: true });
  });

  test("a label matching exactly one registered repo resolves", async () => {
    setKvValue(REPO_INDEX_NS, APP, "/repos/app");
    expect(await resolveMrTarget({ repoName: "app", iid: 7 })).toEqual({ ok: true, identity: APP, iid: 7 });
  });

  test("an ambiguous label is refused naming every match", async () => {
    setKvValue(REPO_INDEX_NS, APP, "/repos/a/app");
    setKvValue(REPO_INDEX_NS, SUB, "/repos/b/app");
    const res = await resolveMrTarget({ repoName: "app", iid: 7 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain(APP);
      expect(res.error).toContain(SUB);
      expect(res.error).toContain("pass the full identity");
    }
  });

  test("an unknown label is refused", async () => {
    expect(await resolveMrTarget({ repoName: "nope", iid: 7 })).toEqual({
      ok: false,
      error: 'repoName "nope" did not match a registered repo; pass its serialized identity, an absolute checkout path, or the label of exactly one registered repo',
    });
  });

  test("mrUrl alone supplies the registered identity and the iid, through subgroups and suffixes", async () => {
    setKvValue(REPO_INDEX_NS, SUB, "/repos/app");
    expect(await resolveMrTarget({ mrUrl: "https://gitlab.example.com/acme/platform/app/-/merge_requests/12/diffs#note_3" }))
      .toEqual({ ok: true, identity: SUB, iid: 12 });
  });

  test("mrUrl goes through identityFromRemote, so a machine-store override applies", async () => {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), JSON.stringify({
      "rt.repoIdentityOverrides": { "https://gitlab.example.com/acme/fork": "gitlab.example.com/acme/app" },
    }));
    setKvValue(REPO_INDEX_NS, APP, "/repos/app");
    expect(await resolveMrTarget({ mrUrl: "https://gitlab.example.com/acme/fork/-/merge_requests/3" }))
      .toEqual({ ok: true, identity: APP, iid: 3 });
  });

  test("mrUrl for a repo rt has not registered is refused, never guessed", async () => {
    expect(await resolveMrTarget({ mrUrl: URL_APP })).toEqual({
      ok: false,
      error: `mrUrl names gitlab.example.com/acme/app (${APP}), which is not registered with rt; run rt repos register in its checkout first`,
    });
  });

  test("a repo pinned by an override keyed on its ssh remote resolves from its https MR URL through the checkout's origin", async () => {
    const checkout = realpathSync(mkdtempSync(join(tmpdir(), "rt-mr-target-fork-")));
    execSync("git init -q", { cwd: checkout });
    execSync("git remote add origin git@gitlab.example.com:acme/fork.git", { cwd: checkout });
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), JSON.stringify({
      "rt.repoIdentityOverrides": { "git@gitlab.example.com:acme/fork.git": "gitlab.example.com/acme/app" },
    }));
    setKvValue(REPO_INDEX_NS, APP, checkout);
    setKvValue(REPO_INDEX_NS, "remote:gitlab.example.com%2Facme%2Fgone", "/repos/no-longer-here");
    expect(await resolveMrTarget({ mrUrl: "https://gitlab.example.com/acme/fork/-/merge_requests/3" }))
      .toEqual({ ok: true, identity: APP, iid: 3 });
    rmSync(checkout, { recursive: true, force: true });
  });

  test("an MR URL whose origin matches two registered checkouts is refused as ambiguous, naming both", async () => {
    const a = realpathSync(mkdtempSync(join(tmpdir(), "rt-mr-target-a-")));
    const b = realpathSync(mkdtempSync(join(tmpdir(), "rt-mr-target-b-")));
    for (const dir of [a, b]) {
      execSync("git init -q", { cwd: dir });
      execSync("git remote add origin git@gitlab.example.com:acme/app.git", { cwd: dir });
    }
    const TEAM_A = "remote:gitlab.example.com%2Fteam-a%2Fapp";
    const TEAM_B = "remote:gitlab.example.com%2Fteam-b%2Fapp";
    setKvValue(REPO_INDEX_NS, TEAM_A, a);
    setKvValue(REPO_INDEX_NS, TEAM_B, b);
    const res = await resolveMrTarget({ mrUrl: URL_APP });
    expect(res).toEqual({ ok: false, error: `mrUrl matches more than one registered repo: ${TEAM_A}, ${TEAM_B}; pass repoName to pick one` });
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  });

  test("repoName and mrUrl that resolve to different repos are refused", async () => {
    setKvValue(REPO_INDEX_NS, APP, "/repos/app");
    setKvValue(REPO_INDEX_NS, SUB, "/repos/sub");
    expect(await resolveMrTarget({ repoName: SUB, mrUrl: URL_APP })).toEqual({
      ok: false,
      error: `repoName resolves to ${SUB} but mrUrl names ${APP}; pass one of them, or make them agree`,
    });
  });

  test("iid and mrUrl that disagree are refused", async () => {
    setKvValue(REPO_INDEX_NS, APP, "/repos/app");
    expect(await resolveMrTarget({ iid: 8, mrUrl: URL_APP })).toEqual({ ok: false, error: "iid 8 does not match mrUrl's merge request 7" });
  });

  test("a repoName, iid and mrUrl that agree resolve", async () => {
    setKvValue(REPO_INDEX_NS, APP, "/repos/app");
    expect(await resolveMrTarget({ repoName: "app", iid: 7, mrUrl: URL_APP })).toEqual({ ok: true, identity: APP, iid: 7 });
  });

  test("neither repoName nor mrUrl is refused before any lookup", async () => {
    expect(await resolveMrTarget({ iid: 7 })).toEqual({ ok: false, error: 'pass "repoName" or "mrUrl"' });
    expect(await resolveMrTarget({ repoName: "   ", iid: 7 })).toEqual({ ok: false, error: 'pass "repoName" or "mrUrl"' });
  });

  test("repoName without iid or mrUrl is refused", async () => {
    expect(await resolveMrTarget({ repoName: APP })).toEqual({ ok: false, error: 'pass "iid" or "mrUrl"' });
  });

  test("wrong-shaped fields are refused naming the field", async () => {
    expect(await resolveMrTarget({ repoName: 5, iid: 7 })).toEqual({ ok: false, error: '"repoName" must be a string' });
    expect(await resolveMrTarget({ repoName: APP, iid: "7" })).toEqual({ ok: false, error: '"iid" must be a positive integer' });
    expect(await resolveMrTarget({ repoName: APP, iid: 0 })).toEqual({ ok: false, error: '"iid" must be a positive integer' });
    expect(await resolveMrTarget({ repoName: APP, iid: 1.5 })).toEqual({ ok: false, error: '"iid" must be a positive integer' });
    expect(await resolveMrTarget({ mrUrl: 7 })).toEqual({ ok: false, error: '"mrUrl" must be a string' });
    expect(await resolveMrTarget({ mrUrl: "https://gitlab.example.com/acme/app/-/issues/7" })).toEqual({
      ok: false,
      error: "mrUrl must look like https://<host>/<group>/<project>/-/merge_requests/<iid>",
    });
  });
});

describe("resolveRepoTarget", () => {
  withTempHome();

  test("repoName alone resolves with no iid", async () => {
    expect(await resolveRepoTarget({ repoName: APP })).toEqual({ ok: true, identity: APP, iid: undefined });
  });

  test("mrUrl alone names the project and carries its iid", async () => {
    setKvValue(REPO_INDEX_NS, APP, "/repos/app");
    expect(await resolveRepoTarget({ mrUrl: URL_APP })).toEqual({ ok: true, identity: APP, iid: 7 });
  });

  test("neither is refused", async () => {
    expect(await resolveRepoTarget({})).toEqual({ ok: false, error: 'pass "repoName" or "mrUrl"' });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test lib/mcp/__tests__/mr-target.test.ts`
Expected: FAIL, `../mr-target.ts` cannot be resolved.

- [ ] **Step 3: Create `lib/mcp/mr-target.ts`:**

```ts
/**
 * Turns the target an MR write tool was given ({repoName, iid, mrUrl}) into
 * the serialized identity and iid the daemon verbs take. Resolution is a
 * client-side concern, like --repo on the CLI: the daemon keeps taking the
 * serialized identity only. repoName goes through tryResolveRepoArg (an
 * identity, an absolute checkout path, or a label matching exactly one
 * registered repo); mrUrl maps its host and project path through
 * identityFromRemote, so the machine store's identity overrides apply, and
 * must name a repo rt has registered. An override is keyed by the remote as
 * git observed it (often the ssh form), which the https form built from a
 * URL never matches, so when that form names no registered repo the
 * registered checkouts' own origin remotes are the tie back to the URL.
 */
import { getRemoteUrl } from "../pickers.ts";
import { tryResolveRepoArg } from "../repo-arg.ts";
import { isRepoRegistered, loadRepoIndex } from "../repo-index.ts";
import { identityFromRemote, normalizeRemote, serializeIdentity } from "../settings/identity.ts";

export type TargetInput = { repoName?: unknown; iid?: unknown; mrUrl?: unknown };

export type RepoTarget =
  | { ok: true; identity: string; iid: number | undefined }
  | { ok: false; error: string };

export type MrTarget =
  | { ok: true; identity: string; iid: number }
  | { ok: false; error: string };

export const MR_URL_SHAPE = "mrUrl must look like https://<host>/<group>/<project>/-/merge_requests/<iid>";

const MR_URL_RE = /^https:\/\/([^/?#]+)\/(.+?)\/-\/merge_requests\/(\d+)(?:\/[^?#]*)?(?:[?#].*)?$/;

export function parseMrUrl(url: string): { host: string; projectPath: string; iid: number } | null {
  const m = MR_URL_RE.exec(url.trim());
  if (!m) return null;
  const iid = Number(m[3]);
  if (!Number.isInteger(iid) || iid <= 0) return null;
  return { host: m[1]!, projectPath: m[2]!, iid };
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/** Registered identities whose checkout's origin remote normalizes to the URL's host/path; a checkout that is gone or has no origin is skipped. */
async function identitiesByOriginRemote(host: string, projectPath: string): Promise<string[]> {
  const wanted = `${host.toLowerCase()}/${projectPath}`;
  const matches: string[] = [];
  for (const [identity, checkout] of Object.entries(loadRepoIndex())) {
    const remote = await getRemoteUrl(checkout);
    if (remote && normalizeRemote(remote) === wanted) matches.push(identity);
  }
  return matches;
}

export async function resolveRepoTarget(input: TargetInput): Promise<RepoTarget> {
  if (input.repoName !== undefined && typeof input.repoName !== "string") return { ok: false, error: '"repoName" must be a string' };
  if (input.iid !== undefined && !isPositiveInt(input.iid)) return { ok: false, error: '"iid" must be a positive integer' };
  if (input.mrUrl !== undefined && typeof input.mrUrl !== "string") return { ok: false, error: '"mrUrl" must be a string' };
  const repoName = typeof input.repoName === "string" ? input.repoName.trim() : "";
  const mrUrl = typeof input.mrUrl === "string" ? input.mrUrl.trim() : "";
  if (!repoName && !mrUrl) return { ok: false, error: 'pass "repoName" or "mrUrl"' };

  let fromUrl: { identity: string; iid: number } | undefined;
  if (mrUrl) {
    const parsed = parseMrUrl(mrUrl);
    if (!parsed) return { ok: false, error: MR_URL_SHAPE };
    const direct = identityFromRemote(`https://${parsed.host}/${parsed.projectPath}`);
    if (!direct) return { ok: false, error: MR_URL_SHAPE };
    const directWire = serializeIdentity(direct);
    if (isRepoRegistered(directWire)) {
      fromUrl = { identity: directWire, iid: parsed.iid };
    } else {
      const matches = await identitiesByOriginRemote(parsed.host, parsed.projectPath);
      if (matches.length > 1) {
        return { ok: false, error: `mrUrl matches more than one registered repo: ${matches.join(", ")}; pass repoName to pick one` };
      }
      if (matches.length === 0) {
        return { ok: false, error: `mrUrl names ${direct.id} (${directWire}), which is not registered with rt; run rt repos register in its checkout first` };
      }
      fromUrl = { identity: matches[0]!, iid: parsed.iid };
    }
  }

  let fromName: string | undefined;
  if (repoName) {
    const res = await tryResolveRepoArg(repoName);
    if (res.kind === "ambiguous") {
      return { ok: false, error: `repoName "${repoName}" matches more than one repo: ${res.matches.join(", ")}; pass the full identity` };
    }
    if (res.kind === "none") {
      return { ok: false, error: `repoName "${repoName}" did not match a registered repo; pass its serialized identity, an absolute checkout path, or the label of exactly one registered repo` };
    }
    fromName = res.identity;
  }

  if (fromName && fromUrl && fromName !== fromUrl.identity) {
    return { ok: false, error: `repoName resolves to ${fromName} but mrUrl names ${fromUrl.identity}; pass one of them, or make them agree` };
  }
  if (fromUrl && input.iid !== undefined && input.iid !== fromUrl.iid) {
    return { ok: false, error: `iid ${input.iid} does not match mrUrl's merge request ${fromUrl.iid}` };
  }
  const identity = fromName ?? fromUrl!.identity;
  const iid = isPositiveInt(input.iid) ? input.iid : fromUrl?.iid;
  return { ok: true, identity, iid };
}

export async function resolveMrTarget(input: TargetInput): Promise<MrTarget> {
  const res = await resolveRepoTarget(input);
  if (!res.ok) return res;
  if (res.iid === undefined) return { ok: false, error: 'pass "iid" or "mrUrl"' };
  return { ok: true, identity: res.identity, iid: res.iid };
}
```

- [ ] **Step 4: Run the resolver tests and confirm they pass**

Run: `bun test lib/mcp/__tests__/mr-target.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Update the tool tests.** In `lib/mcp/__tests__/tools.test.ts`:

Replace the `fs` import line and add the state imports, so the top of the file reads:

```ts
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mcpTools } from "../tools.ts";
import { normalizeGateQuestions } from "../../../packages/rt-client/src/gate-options.ts";
import type { GateQuestion } from "../../../packages/rt-client/src/commands.ts";
import { REPO_INDEX_NS } from "../../repo-index.ts";
import { closeStateDb, setKvValue } from "../../state/index.ts";
```

Replace the test `mr_comment_inline schema requires the position fields and forbids extras` with:

```ts
  test("mr_comment_inline schema requires the position fields, offers mrUrl and forbids extras", () => {
    const tool = mcpTools().find((t) => t.name === "mr_comment_inline")!;
    const schema = tool.inputSchema as { required?: string[]; additionalProperties?: boolean; properties?: Record<string, unknown> };
    expect(schema.required).toEqual(["body", "path", "line"]);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(
      ["repoName", "iid", "mrUrl", "body", "path", "line", "oldPath", "oldLine"].sort(),
    );
  });
```

Replace the test `mr_comment schema requires repoName, iid, body and allows only resolvable beside them` with:

```ts
    test("mr_comment schema requires only body and offers the target props and resolvable", () => {
      const schema = mcpTools().find((t) => t.name === "mr_comment")!.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
      expect(schema.required).toEqual(["body"]);
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["body", "iid", "mrUrl", "repoName", "resolvable"]);
    });
```

Replace the test `mr_create schema requires the branches and title and has no iid` with:

```ts
    test("mr_create schema requires the branches and title, offers repoName and mrUrl, and has no iid", () => {
      const schema = mcpTools().find((t) => t.name === "mr_create")!.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
      expect(schema.required).toEqual(["sourceBranch", "targetBranch", "title"]);
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["description", "draft", "mrUrl", "repoName", "sourceBranch", "targetBranch", "title"]);
    });
```

Add this block directly after the `describe("mr state tools over mr:action and discussions:resolve", ...)` block:

```ts
  describe("mr target resolution wiring", () => {
    const APP = "remote:gitlab.example.com%2Facme%2Fapp";
    const SUB = "remote:gitlab.example.com%2Facme%2Fplatform%2Fapp";
    const origHome = process.env.HOME;
    let home: string;

    beforeEach(() => {
      home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mcp-target-")));
      process.env.HOME = home;
      closeStateDb();
    });

    afterEach(() => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: realRtCommand }));
      process.env.HOME = origHome;
      closeStateDb();
      rmSync(home, { recursive: true, force: true });
    });

    function fakeDaemon(reply: (cmd: string) => unknown = () => ({ ok: true })) {
      const calls: Array<{ cmd: string; payload: Record<string, unknown>; timeoutMs?: number }> = [];
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string, payload: Record<string, unknown>, opts?: { timeoutMs?: number }) => {
          calls.push({ cmd, payload, timeoutMs: opts?.timeoutMs });
          return reply(cmd);
        },
      }));
      return calls;
    }

    test("a repo label resolves to the registered identity before the daemon call", async () => {
      setKvValue(REPO_INDEX_NS, APP, "/repos/app");
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_approve")!;
      const res = await tool.handler({ repoName: "app", iid: 7 }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: true, body: { approved: true } });
      expect(calls).toEqual([{ cmd: "mr:action", payload: { repoName: APP, iid: 7, action: "approve", args: [] }, timeoutMs: 30_000 }]);
    });

    test("mrUrl alone targets a registered repo and supplies iid", async () => {
      setKvValue(REPO_INDEX_NS, APP, "/repos/app");
      const calls = fakeDaemon(() => ({ ok: true, data: { noteId: 1, discussionId: "d1", resolvable: true, url: "u", mrUrl: "m" } }));
      const tool = mcpTools().find((t) => t.name === "mr_comment")!;
      const res = await tool.handler({ mrUrl: "https://gitlab.example.com/acme/app/-/merge_requests/7/diffs#note_1", body: "hi" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(true);
      expect(calls[0]!.payload).toEqual({ repoName: APP, iid: 7, body: "hi" });
    });

    test("mr_create takes the repo from mrUrl and sends no iid", async () => {
      setKvValue(REPO_INDEX_NS, APP, "/repos/app");
      const calls = fakeDaemon(() => ({ ok: true, data: { iid: 12, url: "u" } }));
      const tool = mcpTools().find((t) => t.name === "mr_create")!;
      await tool.handler({ mrUrl: "https://gitlab.example.com/acme/app/-/merge_requests/7", sourceBranch: "feat", targetBranch: "main", title: "T" }, {} as NodeJS.ProcessEnv);
      expect(calls[0]!.payload).toEqual({ repoName: APP, sourceBranch: "feat", targetBranch: "main", title: "T" });
    });

    test("an mrUrl for a repo rt has not registered is refused with no daemon call", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_ready")!;
      const res = await tool.handler({ mrUrl: "https://gitlab.example.com/acme/app/-/merge_requests/7" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("not registered with rt");
      expect(res.error).toContain(APP);
      expect(calls).toEqual([]);
    });

    test("repoName and mrUrl that disagree are refused with no daemon call", async () => {
      setKvValue(REPO_INDEX_NS, APP, "/repos/app");
      setKvValue(REPO_INDEX_NS, SUB, "/repos/sub");
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_rebase")!;
      const res = await tool.handler({ repoName: SUB, mrUrl: "https://gitlab.example.com/acme/app/-/merge_requests/7" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe(`repoName resolves to ${SUB} but mrUrl names ${APP}; pass one of them, or make them agree`);
      expect(calls).toEqual([]);
    });

    test("a tool given neither repoName nor mrUrl is refused with no daemon call", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_rebase")!;
      const res = await tool.handler({}, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe('pass "repoName" or "mrUrl"');
      expect(calls).toEqual([]);
    });

    test("non-target input errors come before any resolution", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_reply_thread")!;
      const res = await tool.handler({ mrUrl: "https://gitlab.example.com/acme/app/-/merge_requests/7", discussionId: "d1" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe('"body" is required');
      expect(calls).toEqual([]);
    });

    test("every MR-level write tool offers repoName, iid and mrUrl with none required; mr_create offers repoName and mrUrl", () => {
      for (const name of ["mr_reply_thread", "mr_comment_inline", "mr_comment", "mr_approve", "mr_resolve_thread", "mr_ready", "mr_retry", "mr_rebase"]) {
        const schema = mcpTools().find((t) => t.name === name)!.inputSchema as { properties: Record<string, unknown>; required?: string[] };
        expect(Object.keys(schema.properties), name).toEqual(expect.arrayContaining(["repoName", "iid", "mrUrl"]));
        expect(schema.required ?? [], name).not.toContain("repoName");
        expect(schema.required ?? [], name).not.toContain("iid");
      }
      const create = mcpTools().find((t) => t.name === "mr_create")!.inputSchema as { properties: Record<string, unknown>; required?: string[] };
      expect(Object.keys(create.properties)).toEqual(expect.arrayContaining(["repoName", "mrUrl"]));
      expect(create.properties.iid).toBeUndefined();
      expect(create.required).not.toContain("repoName");
    });
  });
```

- [ ] **Step 6: Run the tool tests and confirm the new and changed ones fail**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Expected: FAIL on the three schema tests and every test in `mr target resolution wiring`; everything else still passes.

- [ ] **Step 7: Implement the wiring in `lib/mcp/tools.ts`.**

Add the import after the `import { runRtVerb } from "./rt-verb.ts";` line:

```ts
import { resolveMrTarget, resolveRepoTarget } from "./mr-target.ts";
```

Replace the `REPO_NAME_RULE` constant (line 102) with:

```ts
const REPO_NAME_RULE = "Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.";

const MR_TARGET_PROPS = {
  repoName: { type: "string", description: "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo." },
  iid: { type: "number" },
  mrUrl: { type: "string", description: "The MR's https URL; supplies both the repo and iid." },
};

const REPO_TARGET_PROPS = {
  repoName: MR_TARGET_PROPS.repoName,
  mrUrl: { type: "string", description: "An MR URL in the target project; names the repo, its iid is not used." },
};
```

Replace the block from `type MrActionName = ...` through the end of `runMrAction` (lines 111-127) with:

```ts
type MrActionName = Commands["mr:action"]["payload"]["action"];

/** mr:action replies a bare {ok:true}, so each tool names its own result body. */
async function runMrAction(target: { identity: string; iid: number }, action: MrActionName, args: unknown[], body: unknown): Promise<ToolResult> {
  const res = await rtCommand<Commands["mr:action"]["data"]>("mr:action", {
    repoName: target.identity,
    iid: target.iid,
    action,
    args,
  }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
  return res.ok ? ok(body) : err(explainError(res.error ?? "request failed"));
}
```

Replace the nine tool entries from `name: "mr_reply_thread"` through the end of `mr_rebase` (lines 417-648) with:

```ts
    {
      name: "mr_reply_thread",
      description: `GitLab only. Reply to an existing MR discussion thread. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS, discussionId: { type: "string" }, body: { type: "string" } },
        required: ["discussionId", "body"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "discussionId", type: "string" }, { name: "body", type: "string" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const res = await rtCommand<Commands["discussions:reply"]["data"]>("discussions:reply", {
          repoName: target.identity,
          iid: target.iid,
          discussionId: input.discussionId as string,
          body: input.body as string,
        }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
        return fromResponse(res);
      },
    },
    {
      name: "mr_comment_inline",
      description: `GitLab only. Post a NEW positioned inline comment (DiffNote) on an MR diff line, with server-side verification: the daemon re-checks the created note's type and deletes-and-retries once when GitLab silently drops the position. The retry re-fetches diff_refs; it cannot repair a position GitLab rejects outright. Use mr_reply_thread to reply to an existing thread. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...MR_TARGET_PROPS,
          body: { type: "string" },
          path: { type: "string" },
          line: { type: "number" },
          oldPath: { type: "string" },
          oldLine: { type: "number" },
        },
        required: ["body", "path", "line"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [
          { name: "body", type: "string" },
          { name: "path", type: "string" },
          { name: "line", type: "number" },
        ]) ?? checkOptional(input, [{ name: "oldPath", type: "string" }, { name: "oldLine", type: "number" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["mr:comment-inline"]["payload"] = {
          repoName: target.identity,
          iid: target.iid,
          body: input.body as string,
          path: input.path as string,
          line: input.line as number,
        };
        if (input.oldPath !== undefined) payload.oldPath = input.oldPath as string;
        if (input.oldLine !== undefined) payload.oldLine = input.oldLine as number;
        return fromResponse(await rtCommand<Commands["mr:comment-inline"]["data"]>("mr:comment-inline", payload, { timeoutMs: MR_WRITE_TIMEOUT_MS }));
      },
    },
    {
      name: "mr_comment",
      description: `GitLab only. Post a NEW top-level note on an MR: a review's summary, or anything with no diff line to anchor to. resolvable (default true) opens a discussion a human can resolve; false posts a plain note, for a summary that carries nothing to resolve. Posts once and never retries. Returns noteId, discussionId (null for a plain note), resolvable as GitLab reports it, url (the note) and mrUrl. Use mr_comment_inline for a diff line and mr_reply_thread for an existing thread. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS, body: { type: "string" }, resolvable: { type: "boolean" } },
        required: ["body"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "body", type: "string" }]) ?? checkOptional(input, [{ name: "resolvable", type: "boolean" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["mr:comment"]["payload"] = { repoName: target.identity, iid: target.iid, body: input.body as string };
        if (input.resolvable !== undefined) payload.resolvable = input.resolvable as boolean;
        const res = await rtCommand<Commands["mr:comment"]["data"]>("mr:comment", payload, { timeoutMs: MR_WRITE_TIMEOUT_MS });
        return withLandingHint(fromResponse(res), "the MR's discussions");
      },
    },
    {
      name: "mr_create",
      description: `GitLab only. Create a merge request from an already-pushed sourceBranch into targetBranch. Pass targetBranch explicitly (read the default branch from git); it is never guessed. draft defaults to true. Write the title, and optionally the description, yourself (e.g. from the branch's commits). Creates once and never retries. Returns iid and url (url is null when GitLab created the MR but reading it back failed). ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...REPO_TARGET_PROPS,
          sourceBranch: { type: "string" },
          targetBranch: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          draft: { type: "boolean" },
        },
        required: ["sourceBranch", "targetBranch", "title"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [
          { name: "sourceBranch", type: "string" },
          { name: "targetBranch", type: "string" },
          { name: "title", type: "string" },
        ]) ?? checkOptional(input, [{ name: "description", type: "string" }, { name: "draft", type: "boolean" }]);
        if (bad) return err(bad);
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["mr:create"]["payload"] = {
          repoName: target.identity,
          sourceBranch: input.sourceBranch as string,
          targetBranch: input.targetBranch as string,
          title: input.title as string,
        };
        if (input.description !== undefined) payload.description = input.description as string;
        if (input.draft !== undefined) payload.draft = input.draft as boolean;
        const res = await rtCommand<Commands["mr:create"]["data"]>("mr:create", payload, { timeoutMs: MR_WRITE_TIMEOUT_MS });
        return withLandingHint(fromResponse(res), "mr_map for an open MR on the source branch");
      },
    },
    {
      name: "mr_approve",
      description: `GitLab only. Approve an MR as the token's user, or withdraw that approval with approved: false. Call it only once approving is decided (a review's Approve disposition, after its findings have posted). ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS, approved: { type: "boolean" } },
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "approved", type: "boolean" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const approved = input.approved !== false;
        return runMrAction(target, approved ? "approve" : "unapprove", [], { approved });
      },
    },
    {
      name: "mr_resolve_thread",
      description: `GitLab only. Resolve an MR discussion thread, or reopen it with resolved: false. Post any reply first with mr_reply_thread; resolving does not post. Returns {discussionId, resolved}. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS, discussionId: { type: "string" }, resolved: { type: "boolean" } },
        required: ["discussionId"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "discussionId", type: "string" }]) ?? checkOptional(input, [{ name: "resolved", type: "boolean" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const discussionId = input.discussionId as string;
        const resolved = input.resolved !== false;
        const res = await rtCommand<Commands["discussions:resolve"]["data"]>("discussions:resolve", {
          repoName: target.identity,
          iid: target.iid,
          discussionId,
          resolved,
        }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
        return res.ok ? ok({ discussionId, resolved }) : err(explainError(res.error ?? "request failed"));
      },
    },
    {
      name: "mr_ready",
      description: `GitLab only. Mark a draft MR ready for review, or back to draft with ready: false. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS, ready: { type: "boolean" } },
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "ready", type: "boolean" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const ready = input.ready !== false;
        return runMrAction(target, "toggleDraft", [!ready], { ready });
      },
    },
    {
      name: "mr_retry",
      description: `GitLab only. Retry one CI job (jobId) or a whole pipeline (pipelineId) on an MR; pass exactly one. The MR named by the target is the one whose state is refreshed afterward. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS, jobId: { type: "number" }, pipelineId: { type: "number" } },
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "jobId", type: "number" }, { name: "pipelineId", type: "number" }])
          ?? checkPositiveInts(input, ["jobId", "pipelineId"]);
        if (bad) return err(bad);
        const hasJob = input.jobId !== undefined;
        if (hasJob === (input.pipelineId !== undefined)) return err('pass exactly one of "jobId" or "pipelineId"');
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        return hasJob
          ? runMrAction(target, "retryJob", [input.jobId], { jobId: input.jobId })
          : runMrAction(target, "retryPipeline", [input.pipelineId], { pipelineId: input.pipelineId });
      },
    },
    {
      name: "mr_rebase",
      description: `GitLab only. Ask GitLab to rebase the MR's source branch onto its target server-side (no checkout). GitLab accepts the request and rebases asynchronously, so re-read the MR before assuming the rebase finished or succeeded. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...MR_TARGET_PROPS },
        additionalProperties: false,
      },
      async handler(input) {
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        return runMrAction(target, "rebase", [], { rebased: true });
      },
    },
```

Note: `checkPositiveInts`'s doc comment still says it covers `iid`; change it to `/** mr:action only checks typeof on jobId/pipelineId, so 0, negative, fractional or NaN would otherwise reach the forge as a 404 instead of a clear input error. iid gets the same check inside resolveMrTarget. */`.

- [ ] **Step 8: Run the MCP tests**

Run: `bun test lib/mcp/__tests__/tools.test.ts lib/mcp/__tests__/mr-target.test.ts lib/mcp/__tests__/rt-verb.test.ts`
Expected: PASS, all files. The existing `mr state tools` cases still pass because `"remote:x"` is a well-formed identity that `tryResolveRepoArg` passes through without an index read.

- [ ] **Step 9: Typecheck and the module-graph guards**

Run: `bunx tsc --noEmit`
Then: `bun test lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-ui-in-cli.test.ts`
Expected: no errors; both guard files pass (the daemon graph never reaches `lib/mcp`).

- [ ] **Step 10: Commit**

```bash
git add lib/mcp/mr-target.ts lib/mcp/__tests__/mr-target.test.ts lib/mcp/tools.ts lib/mcp/__tests__/tools.test.ts
bash scripts/repo-purity.sh
git commit -m "mcp: resolve MR write targets from repoName, path, label or mrUrl (RT-315)"
```

---

### Task 2: `mr:create` gains labels and squash; `mr_create` forwards them

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (the `"mr:create"` entry, lines 776-782)
- Modify: `lib/daemon/handlers/mr.ts` (imports; two module-private helpers after `RETRY_ACTIONS`; the `"mr:create"` handler, lines 171-212)
- Modify: `lib/daemon/__tests__/mr-create.test.ts` (harness gains `restRequest` capture; new cases)
- Modify: `lib/mcp/tools.ts` (`mr_create` schema and handler; a `checkStringArray` helper after `checkPositiveInts`)
- Modify: `lib/mcp/__tests__/tools.test.ts` (the `mr_create` schema test; new forward/refusal cases)

**Interfaces:**
- Produces: `Commands["mr:create"]` payload `{ repoName; sourceBranch; targetBranch; title; description?; draft?; labels?: string[]; squash?: boolean }`, data `{ iid: number; url: string | null; squashApplied?: boolean; squashError?: string }`.
- Produces (module-private in `mr.ts`, reused by Task 3): `labelsError(v: unknown, field: string): string | undefined`, `trimmedLabels(v: unknown[]): string[]`, `putMergeRequest(provider, projectPath, iid, body, op): Promise<{ ok: true } | { ok: false; error: string }>`.
- Produces (module-private in `tools.ts`, reused by Task 3): `checkStringArray(input, name): string | undefined`.

- [ ] **Step 1: Extend the daemon test.** In `lib/daemon/__tests__/mr-create.test.ts`, replace the `harness` function with:

```ts
type RestCall = { method: string; path: string; body: unknown };

function harness(
  create: (input: any) => Promise<any>,
  opts: { writeback?: (repo: string, pp: string, pr: any) => void; restReply?: () => Promise<Response> } = {},
) {
  const inputs: any[] = [];
  const writebacks: any[] = [];
  const rest: RestCall[] = [];
  const handlers = createMRHandlers(fakeCtx(), () => {}, {
    getContext: async () => ({
      provider: {
        createPullRequest: async (input: any) => { inputs.push(input); return create(input); },
        restRequest: async (method: string, path: string, body: unknown) => {
          rest.push({ method, path, body });
          return opts.restReply ? opts.restReply() : new Response("{}", { status: 200 });
        },
      },
      projectPath: "g/p",
    }),
    writeback: opts.writeback ?? ((repo, pp, pr) => writebacks.push({ repo, pp, iid: pr.iid })),
  });
  return { handlers, inputs, writebacks, rest };
}
```

Update the one call that passed a writeback positionally, `harness(async () => ({ iid: 12, webUrl: null }), () => { throw new Error("store boom"); })`, to `harness(async () => ({ iid: 12, webUrl: null }), { writeback: () => { throw new Error("store boom"); } })`.

Add these cases at the end of the `describe("mr:create", ...)` block:

```ts
  test("labels pass through to glance trimmed; squash lands as one PUT after the create", async () => {
    const { handlers, inputs, rest } = harness(async () => ({ iid: 12, webUrl: "u" }));
    const res = await handlers["mr:create"]({ ...base, labels: [" needs-review", "team-a "], squash: true });
    expect(inputs[0]).toMatchObject({ labels: ["needs-review", "team-a"] });
    expect(rest).toEqual([{ method: "PUT", path: "/projects/g%2Fp/merge_requests/12", body: { squash: true } }]);
    expect(res).toEqual({ ok: true, data: { iid: 12, url: "u", squashApplied: true } });
  });

  test("squash: false is written too, and an omitted squash writes nothing", async () => {
    const off = harness(async () => ({ iid: 12, webUrl: "u" }));
    const res = await off.handlers["mr:create"]({ ...base, squash: false });
    expect(off.rest).toEqual([{ method: "PUT", path: "/projects/g%2Fp/merge_requests/12", body: { squash: false } }]);
    expect(res).toEqual({ ok: true, data: { iid: 12, url: "u", squashApplied: true } });

    const none = harness(async () => ({ iid: 12, webUrl: "u" }));
    const plain = await none.handlers["mr:create"](base);
    expect(none.rest).toEqual([]);
    expect(plain).toEqual({ ok: true, data: { iid: 12, url: "u" } });
    expect(none.inputs[0]).not.toHaveProperty("labels");
  });

  test("a squash write that fails after the create landed is still ok, with squashApplied false and the reason", async () => {
    const rejected = harness(async () => ({ iid: 12, webUrl: "u" }), {
      restReply: async () => new Response("insufficient scope", { status: 403, statusText: "Forbidden" }),
    });
    const res = await rejected.handlers["mr:create"]({ ...base, squash: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toMatchObject({ iid: 12, url: "u", squashApplied: false });
      expect(res.data.squashError).toContain("403");
    }

    const threw = harness(async () => ({ iid: 12, webUrl: "u" }), {
      restReply: async () => { throw new Error("socket hang up"); },
    });
    const res2 = await threw.handlers["mr:create"]({ ...base, squash: true });
    expect(res2.ok).toBe(true);
    if (res2.ok) expect(res2.data.squashError).toContain("socket hang up");
  });

  test("the read-back-failure path still attempts the squash write with the iid it has", async () => {
    const { handlers, rest } = harness(async () => {
      throw new ReadBackFailedError("Created MR but failed to fetch it back", {
        operation: "createPullRequest", projectPath: "g/p", iid: 12, writeApplied: true,
      });
    });
    const res = await handlers["mr:create"]({ ...base, squash: true });
    expect(rest).toEqual([{ method: "PUT", path: "/projects/g%2Fp/merge_requests/12", body: { squash: true } }]);
    expect(res).toEqual({ ok: true, data: { iid: 12, url: null, squashApplied: true } });
  });

  test("a blank label, a label with a comma, or a non-array is refused before the provider is called", async () => {
    const { handlers, inputs, rest } = harness(async () => { throw new Error("should not be called"); });
    for (const labels of [["ok", " "], ["a,b"], "a", [5]]) {
      expect(await handlers["mr:create"]({ ...base, labels })).toEqual({ ok: false, error: "invalid labels" });
    }
    expect(inputs).toEqual([]);
    expect(rest).toEqual([]);
  });

  test("labels: [] is a no-op: the create goes through with no labels field", async () => {
    const { handlers, inputs } = harness(async () => ({ iid: 12, webUrl: "u" }));
    const res = await handlers["mr:create"]({ ...base, labels: [] });
    expect(res).toEqual({ ok: true, data: { iid: 12, url: "u" } });
    expect(inputs[0]).not.toHaveProperty("labels");
  });

  test("a non-boolean squash is refused before the provider is called", async () => {
    const { handlers, inputs } = harness(async () => { throw new Error("should not be called"); });
    expect(await handlers["mr:create"]({ ...base, squash: "true" })).toEqual({ ok: false, error: "invalid squash" });
    expect(inputs).toEqual([]);
  });
```

- [ ] **Step 2: Run it and confirm the new cases fail**

Run: `bun test lib/daemon/__tests__/mr-create.test.ts`
Expected: FAIL on the six new cases (labels not forwarded, no `restRequest` call, `squashApplied` missing, "invalid labels"/"invalid squash" not returned).

- [ ] **Step 3: Widen the catalog entry.** In `packages/rt-client/src/commands.ts`, replace the `"mr:create"` entry with:

```ts
  /** Creates an MR (a draft unless `draft: false`) and writes it back so the
      board sees it before the next sweep. Never retries. `url` is null when
      GitLab created the MR but reading it back failed. `labels` apply at
      creation (an empty array sends nothing); `squash` is one follow-up write, and a create that landed is
      never reported failed over it: `squashApplied: false` plus
      `squashError` means set it with mr:update instead of creating again. */
  "mr:create": {
    payload: { repoName: string; sourceBranch: string; targetBranch: string; title: string; description?: string; draft?: boolean; labels?: string[]; squash?: boolean };
    data: { iid: number; url: string | null; squashApplied?: boolean; squashError?: string };
  };
```

- [ ] **Step 4: Implement in `lib/daemon/handlers/mr.ts`.**

After the `const RETRY_ACTIONS = ...` line, add:

```ts
/** GitLab's label params are comma-separated, so a comma inside one label would read as two. An empty array is a no-op, not an error. */
function labelsError(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  const bad = !Array.isArray(v) || v.some((l) => typeof l !== "string" || !l.trim() || l.includes(","));
  return bad ? `invalid ${field}` : undefined;
}

function trimmedLabels(v: unknown[]): string[] {
  return v.map((l) => String(l).trim());
}

/** glance types neither squash nor add/remove-labels, so they ride its raw REST door. */
async function putMergeRequest(
  provider: { restRequest: (method: string, path: string, body?: unknown, op?: string) => Promise<Response> },
  projectPath: string,
  iid: number,
  body: Record<string, unknown>,
  op: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await provider.restRequest("PUT", `/projects/${encodeURIComponent(projectPath)}/merge_requests/${iid}`, body, op);
    if (res.ok) return { ok: true };
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, error: `GitLab returned ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
```

In the header comment's verb list, change the `mr:create` line to:

```ts
 *   mr:create            - create an MR (draft by default, labels, squash) and write it back
```

Replace the `"mr:create"` handler with:

```ts
    "mr:create": async (payload) => {
      const p = payload as { sourceBranch?: unknown; targetBranch?: unknown; title?: unknown; description?: unknown; draft?: unknown; labels?: unknown; squash?: unknown } | undefined;
      const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
      const sourceBranchInput = p?.sourceBranch, targetBranchInput = p?.targetBranch, titleInput = p?.title;
      if (!nonBlank(sourceBranchInput) || !nonBlank(targetBranchInput) || !nonBlank(titleInput)) {
        return { ok: false, error: "missing repoName/sourceBranch/targetBranch/title" };
      }
      // Trimmed once here so the same-branch guard and the provider call see identical values;
      // untrimmed " main" vs "main" would pass the guard and reach GitLab as a bad branch name.
      const sourceBranch = sourceBranchInput.trim();
      const targetBranch = targetBranchInput.trim();
      const title = titleInput.trim();
      if (p?.description !== undefined && typeof p.description !== "string") return { ok: false, error: "invalid description" };
      if (p?.draft !== undefined && typeof p.draft !== "boolean") return { ok: false, error: "invalid draft" };
      const labelsBad = labelsError(p?.labels, "labels");
      if (labelsBad) return { ok: false, error: labelsBad };
      if (p?.squash !== undefined && typeof p.squash !== "boolean") return { ok: false, error: "invalid squash" };
      if (sourceBranch === targetBranch) return { ok: false, error: "sourceBranch and targetBranch are the same" };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      const repoName = decoded.repo;
      const labels = p && Array.isArray(p.labels) && p.labels.length > 0 ? trimmedLabels(p.labels) : undefined;
      const squash = p && typeof p.squash === "boolean" ? p.squash : undefined;

      try {
        const { provider, projectPath } = await contextFor(repoName);
        let iid: number;
        let url: string | null;
        try {
          const pr: PullRequest = await provider.createPullRequest({
            projectPath, title, sourceBranch, targetBranch,
            draft: p?.draft !== false,
            ...(typeof p?.description === "string" && { description: p.description }),
            ...(labels && { labels }),
          });
          try {
            writeback(repoName, projectPath, pr);
          } catch (err) {
            ctx.log.warn({ err, repo: repoName, iid: pr.iid }, "mr:create write-back failed");
          }
          iid = pr.iid;
          url = pr.webUrl;
        } catch (err) {
          // The MR exists once glance reports writeApplied; ok:false here would
          // invite a second create.
          if (!(err instanceof ReadBackFailedError && err.writeApplied)) throw err;
          ctx.log.warn({ err, repo: repoName, iid: err.iid }, "mr:create landed but its read-back failed");
          iid = err.iid;
          url = null;
        }
        if (squash === undefined) return { ok: true, data: { iid, url } };
        const set = await putMergeRequest(provider, projectPath, iid, { squash }, "mr:create squash");
        if (set.ok) return { ok: true, data: { iid, url, squashApplied: true } };
        ctx.log.warn({ repo: repoName, iid, error: set.error }, "mr:create landed but its squash write failed");
        return { ok: true, data: { iid, url, squashApplied: false, squashError: set.error } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
```

- [ ] **Step 5: Rebuild rt-client and run the daemon tests**

Run: `bun run --cwd packages/rt-client build`
Then: `bun test lib/daemon/__tests__/mr-create.test.ts lib/daemon/__tests__/mr-writeback.test.ts lib/daemon/__tests__/rt-client-commands.test.ts packages/rt-client`
Expected: PASS.

- [ ] **Step 6: Write the failing tool tests.** In `lib/mcp/__tests__/tools.test.ts`, replace the `mr_create schema ...` test (from Task 1) with:

```ts
    test("mr_create schema requires the branches and title, offers repoName, mrUrl, labels and squash, and has no iid", () => {
      const schema = mcpTools().find((t) => t.name === "mr_create")!.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
      expect(schema.required).toEqual(["sourceBranch", "targetBranch", "title"]);
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["description", "draft", "labels", "mrUrl", "repoName", "squash", "sourceBranch", "targetBranch", "title"]);
    });
```

Add after the `a timed-out mr_create says the MR may still land ...` test:

```ts
    test("mr_create forwards labels and squash", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: { iid: 12, url: "u", squashApplied: true } }));
      const tool = mcpTools().find((t) => t.name === "mr_create")!;
      const res = await tool.handler({ repoName: "remote:x", sourceBranch: "feat", targetBranch: "main", title: "T", labels: ["a", "b"], squash: true }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: true, body: { iid: 12, url: "u", squashApplied: true } });
      expect(calls[0]!.payload).toEqual({ repoName: "remote:x", sourceBranch: "feat", targetBranch: "main", title: "T", labels: ["a", "b"], squash: true });
    });

    test("mr_create refuses a non-array labels and a string squash before calling the daemon", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: { iid: 12, url: "u" } }));
      const tool = mcpTools().find((t) => t.name === "mr_create")!;
      const base = { repoName: "remote:x", sourceBranch: "feat", targetBranch: "main", title: "T" };
      expect((await tool.handler({ ...base, labels: "a" }, {} as NodeJS.ProcessEnv)).error).toBe('"labels" must be an array of strings');
      expect((await tool.handler({ ...base, labels: ["a", 5] }, {} as NodeJS.ProcessEnv)).error).toBe('"labels" must be an array of strings');
      expect((await tool.handler({ ...base, squash: "true" }, {} as NodeJS.ProcessEnv)).error).toBe('"squash" must be a boolean');
      expect(calls).toEqual([]);
    });
```

- [ ] **Step 7: Run and confirm failure**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Expected: FAIL on the schema test and the two new cases.

- [ ] **Step 8: Implement the tool side in `lib/mcp/tools.ts`.**

After `checkPositiveInts`, add:

```ts
function checkStringArray(input: Record<string, unknown>, name: string): string | undefined {
  const v = input[name];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return `"${name}" must be an array of strings`;
  return undefined;
}
```

In the `mr_create` tool:
- Change the description to: `` `GitLab only. Create a merge request from an already-pushed sourceBranch into targetBranch. Pass targetBranch explicitly (read the default branch from git); it is never guessed. draft defaults to true. Write the title, and optionally the description, yourself (e.g. from the branch's commits). labels apply at creation; squash sets the MR's squash-on-merge flag right after it. Creates once and never retries. Returns iid, url (null when GitLab created the MR but reading it back failed) and, when squash was passed, squashApplied; squashApplied false with squashError means the MR exists, so set squash with mr_update rather than creating again. ${REPO_NAME_RULE}` ``
- Add to `properties`, after `draft`: `labels: { type: "array", items: { type: "string" } }, squash: { type: "boolean" },`
- Replace the `const bad = ...` expression with:

```ts
        const bad = checkRequired(input, [
          { name: "sourceBranch", type: "string" },
          { name: "targetBranch", type: "string" },
          { name: "title", type: "string" },
        ]) ?? checkOptional(input, [{ name: "description", type: "string" }, { name: "draft", type: "boolean" }, { name: "squash", type: "boolean" }])
          ?? checkStringArray(input, "labels");
```

- After `if (input.draft !== undefined) payload.draft = input.draft as boolean;`, add:

```ts
        if (input.labels !== undefined) payload.labels = input.labels as string[];
        if (input.squash !== undefined) payload.squash = input.squash as boolean;
```

- [ ] **Step 9: Run the MCP tests, typecheck, commit**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Then: `bunx tsc --noEmit`
Expected: PASS; no errors.

```bash
git add packages/rt-client/src/commands.ts lib/daemon/handlers/mr.ts lib/daemon/__tests__/mr-create.test.ts lib/mcp/tools.ts lib/mcp/__tests__/tools.test.ts
bash scripts/repo-purity.sh
git commit -m "daemon+mcp: mr:create and mr_create take labels and squash (RT-315)"
```

---

### Task 3: `mr:update` verb and `mr_update` tool

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (`Commands` entry after `"mr:create"`; `COMMAND_NAMES` after `"mr:create",`)
- Modify: `lib/daemon/handlers/mr.ts` (imports; header list; return type; new handler after `"mr:create"`)
- Create: `lib/daemon/__tests__/mr-update.test.ts`
- Modify: `lib/mcp/tools.ts` (new tool after `mr_create`)
- Modify: `lib/mcp/__tests__/tools.test.ts` (`NAMES`, roster count, `repoArgTools`, new block)
- Modify: `e2e/tests/mcp-serve.test.ts` (`EXPECTED_TOOL_NAMES`, line 181)

**Interfaces:**
- Consumes: `labelsError`, `trimmedLabels`, `putMergeRequest` (Task 2); `resolveMrTarget`, `MR_TARGET_PROPS`, `checkStringArray` (Tasks 1 and 2); `MRHandlerOverrides.getContext/writeback/fetchSingle` (existing).
- Produces: `Commands["mr:update"]` payload `{ repoName: string; iid: number; title?: string; description?: string; addLabels?: string[]; removeLabels?: string[]; squash?: boolean }`, data `{ iid: number; url: string; applied: string[] }` (`applied` lists the field names that landed, in write order).

- [ ] **Step 1: Write the failing daemon test.** Create `lib/daemon/__tests__/mr-update.test.ts`:

```ts
/**
 * mr:update: title/description through glance (draft state survives),
 * add/remove labels and squash in one REST PUT, glance first; a partial
 * failure names what landed so a retry can carry only the rest.
 */
import { describe, expect, test } from "bun:test";
import { ReadBackFailedError } from "@mattstack/glance";
import { createMRHandlers } from "../handlers/mr.ts";
import { fakeStore } from "./fake-cache-store.ts";

const REPO = "remote:gitlab.com%2Fg%2Fp";
const URL = "https://gitlab.example.com/g/p/-/merge_requests/7";
const fakeCtx = () => ({
  cache: fakeStore({}),
  repoIndex: () => ({ [REPO]: "/tmp/repo" }),
  log: { warn() {}, info() {}, debug() {}, error() {} } as any,
});
const base = { repoName: REPO, iid: 7 };
const prOf = (iid: number) => ({ iid, webUrl: URL, title: "t" }) as any;

function harness(opts: {
  update?: (projectPath: string, iid: number, input: any) => Promise<any>;
  restReply?: () => Promise<Response>;
  fetchSingle?: () => Promise<any>;
  writeback?: (repo: string, pp: string, pr: any) => void;
} = {}) {
  const seq: string[] = [];
  const updates: any[] = [];
  const rest: Array<{ method: string; path: string; body: unknown }> = [];
  const writebacks: any[] = [];
  const singles: number[] = [];
  const handlers = createMRHandlers(fakeCtx(), () => {}, {
    getContext: async () => ({
      provider: {
        baseURL: "https://gitlab.example.com",
        updatePullRequest: async (pp: string, iid: number, input: any) => {
          seq.push("glance");
          updates.push(input);
          return opts.update ? opts.update(pp, iid, input) : prOf(iid);
        },
        restRequest: async (method: string, path: string, body: unknown) => {
          seq.push("rest");
          rest.push({ method, path, body });
          return opts.restReply ? opts.restReply() : new Response("{}", { status: 200 });
        },
      },
      projectPath: "g/p",
    }),
    writeback: opts.writeback ?? ((repo, pp, pr) => writebacks.push({ repo, pp, iid: pr.iid })),
    fetchSingle: async (_p, _pp, iid) => { singles.push(iid); return opts.fetchSingle ? opts.fetchSingle() : prOf(iid); },
  });
  return { handlers, seq, updates, rest, writebacks, singles };
}

describe("mr:update", () => {
  test("title alone goes through glance, writes the returned PR back, and reports applied", async () => {
    const h = harness();
    const res = await h.handlers["mr:update"]({ ...base, title: " New title " });
    expect(h.updates).toEqual([{ title: "New title" }]);
    expect(h.rest).toEqual([]);
    expect(h.writebacks).toEqual([{ repo: REPO, pp: "g/p", iid: 7 }]);
    expect(h.singles).toEqual([]);
    expect(res).toEqual({ ok: true, data: { iid: 7, url: URL, applied: ["title"] } });
  });

  test("description alone goes through glance", async () => {
    const h = harness();
    await h.handlers["mr:update"]({ ...base, description: "why" });
    expect(h.updates).toEqual([{ description: "why" }]);
    expect(h.rest).toEqual([]);
  });

  test("labels and squash go in one PUT, with add and remove never replace, then one follow-up fetch for write-back", async () => {
    const h = harness();
    const res = await h.handlers["mr:update"]({ ...base, addLabels: [" a", "b "], removeLabels: ["c"], squash: true });
    expect(h.updates).toEqual([]);
    expect(h.rest).toEqual([{ method: "PUT", path: "/projects/g%2Fp/merge_requests/7", body: { add_labels: "a,b", remove_labels: "c", squash: true } }]);
    expect(h.singles).toEqual([7]);
    expect(h.writebacks.length).toBe(1);
    expect(res).toEqual({ ok: true, data: { iid: 7, url: URL, applied: ["addLabels", "removeLabels", "squash"] } });
  });

  test("with both groups, glance runs first and the REST write second", async () => {
    const h = harness();
    const res = await h.handlers["mr:update"]({ ...base, title: "T", squash: false });
    expect(h.seq).toEqual(["glance", "rest"]);
    expect(h.rest[0]!.body).toEqual({ squash: false });
    expect(res).toEqual({ ok: true, data: { iid: 7, url: URL, applied: ["title", "squash"] } });
  });

  test("a REST failure after glance landed is ok:false naming what landed and what did not", async () => {
    const h = harness({ restReply: async () => new Response("nope", { status: 403, statusText: "Forbidden" }) });
    const res = await h.handlers["mr:update"]({ ...base, title: "T", addLabels: ["a"], squash: true });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("title landed");
      expect(res.error).toContain("addLabels/squash did not");
      expect(res.error).toContain("403");
      expect(res.error).toContain("retrying with only the failed fields is safe");
    }
  });

  test("a glance failure stops before the REST write and says so", async () => {
    const h = harness({ update: async () => { throw new Error("updatePullRequest failed: 409"); } });
    const res = await h.handlers["mr:update"]({ ...base, title: "T", squash: true });
    expect(h.rest).toEqual([]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("title did not land");
      expect(res.error).toContain("409");
      expect(res.error).toContain("squash not attempted");
    }
  });

  test("a glance read-back failure with writeApplied counts as landed and the REST write still runs", async () => {
    const h = harness({
      update: async () => {
        throw new ReadBackFailedError("Updated MR but failed to fetch it back", {
          operation: "updatePullRequest", projectPath: "g/p", iid: 7, writeApplied: true,
        });
      },
    });
    const res = await h.handlers["mr:update"]({ ...base, title: "T", squash: true });
    expect(h.rest.length).toBe(1);
    expect(h.singles).toEqual([7]);
    expect(res).toEqual({ ok: true, data: { iid: 7, url: URL, applied: ["title", "squash"] } });
  });

  test("empty label arrays are no-ops beside a real field: nothing is sent for them", async () => {
    const h = harness();
    const res = await h.handlers["mr:update"]({ ...base, title: "T", addLabels: [], removeLabels: [] });
    expect(h.updates).toEqual([{ title: "T" }]);
    expect(h.rest).toEqual([]);
    expect(res).toEqual({ ok: true, data: { iid: 7, url: URL, applied: ["title"] } });
  });

  test("a write-back or follow-up throw never fails a landed update", async () => {
    const thrown = harness({ writeback: () => { throw new Error("store boom"); } });
    expect((await thrown.handlers["mr:update"]({ ...base, title: "T" })).ok).toBe(true);
    const fetchBroke = harness({ fetchSingle: async () => { throw new Error("fetch broke"); } });
    expect((await fetchBroke.handlers["mr:update"]({ ...base, squash: true })).ok).toBe(true);
  });

  test("refusals happen before any provider call", async () => {
    const h = harness({ update: async () => { throw new Error("should not be called"); } });
    expect(await h.handlers["mr:update"]({ ...base })).toEqual({ ok: false, error: "nothing to update" });
    expect(await h.handlers["mr:update"]({ ...base, title: "  " })).toEqual({ ok: false, error: "invalid title" });
    expect(await h.handlers["mr:update"]({ ...base, description: 5 })).toEqual({ ok: false, error: "invalid description" });
    expect(await h.handlers["mr:update"]({ ...base, addLabels: ["a,b"] })).toEqual({ ok: false, error: "invalid addLabels" });
    expect(await h.handlers["mr:update"]({ ...base, removeLabels: [" "] })).toEqual({ ok: false, error: "invalid removeLabels" });
    expect(await h.handlers["mr:update"]({ ...base, addLabels: [], removeLabels: [] })).toEqual({ ok: false, error: "nothing to update" });
    expect(await h.handlers["mr:update"]({ ...base, squash: "true" })).toEqual({ ok: false, error: "invalid squash" });
    expect(await h.handlers["mr:update"]({ repoName: REPO, iid: 0, title: "T" })).toEqual({ ok: false, error: "missing repoName/iid" });
    expect(await h.handlers["mr:update"]({ repoName: REPO, iid: 1.5, title: "T" })).toEqual({ ok: false, error: "missing repoName/iid" });
    expect(await h.handlers["mr:update"]({ repoName: "remote:gitlab.com%2Fother%2Fx", iid: 7, title: "T" })).toEqual({ ok: false, error: "repo-unknown" });
    expect(h.updates).toEqual([]);
    expect(h.rest).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test lib/daemon/__tests__/mr-update.test.ts`
Expected: FAIL, `handlers["mr:update"]` is not a function.

- [ ] **Step 3: Add the catalog entry.** In `packages/rt-client/src/commands.ts`, directly after the `"mr:create"` entry:

```ts
  /** Edits an open MR. title/description go through glance (a title change
      keeps draft state); addLabels/removeLabels/squash go in one REST PUT
      (add and remove, never replace the set; an empty array sends nothing).
      Glance first, then REST; a partial failure is ok:false naming what
      landed, and every field is idempotent, so retrying with the failed
      fields is safe. `applied` lists the fields that landed, in write order.
      Refused as `nothing to update` when no field would change anything. */
  "mr:update": {
    payload: { repoName: string; iid: number; title?: string; description?: string; addLabels?: string[]; removeLabels?: string[]; squash?: boolean };
    data: { iid: number; url: string; applied: string[] };
  };
```

In `COMMAND_NAMES`, add `"mr:update",` directly after `"mr:create",`.

- [ ] **Step 4: Implement the handler in `lib/daemon/handlers/mr.ts`.**

Change the glance type import to `import type { PullRequest, UpdatePullRequestInput } from "@mattstack/glance";`.

In the header comment's verb list, after the `mr:create` line, add:

```ts
 *   mr:update            - edit title/description (glance) and labels/squash (REST), glance first
```

Add to the return type intersection of `createMRHandlers`, after the `"mr:create"` line:

```ts
  & { "mr:update": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:update">> }
```

After the `"mr:create"` handler, add:

```ts
    "mr:update": async (payload) => {
      const p = payload as { iid?: unknown; title?: unknown; description?: unknown; addLabels?: unknown; removeLabels?: unknown; squash?: unknown } | undefined;
      const iid = p?.iid;
      if (typeof iid !== "number" || !Number.isInteger(iid) || iid <= 0) return { ok: false, error: "missing repoName/iid" };
      if (p?.title !== undefined && (typeof p.title !== "string" || !p.title.trim())) return { ok: false, error: "invalid title" };
      if (p?.description !== undefined && typeof p.description !== "string") return { ok: false, error: "invalid description" };
      const labelsBad = labelsError(p?.addLabels, "addLabels") ?? labelsError(p?.removeLabels, "removeLabels");
      if (labelsBad) return { ok: false, error: labelsBad };
      if (p?.squash !== undefined && typeof p.squash !== "boolean") return { ok: false, error: "invalid squash" };

      const edit: UpdatePullRequestInput = {};
      if (typeof p?.title === "string") edit.title = p.title.trim();
      if (typeof p?.description === "string") edit.description = p.description;
      const put: Record<string, unknown> = {};
      const putFields: string[] = [];
      if (p && Array.isArray(p.addLabels) && p.addLabels.length > 0) { put.add_labels = trimmedLabels(p.addLabels).join(","); putFields.push("addLabels"); }
      if (p && Array.isArray(p.removeLabels) && p.removeLabels.length > 0) { put.remove_labels = trimmedLabels(p.removeLabels).join(","); putFields.push("removeLabels"); }
      if (p && typeof p.squash === "boolean") { put.squash = p.squash; putFields.push("squash"); }
      const editFields = Object.keys(edit);
      if (editFields.length + putFields.length === 0) return { ok: false, error: "nothing to update" };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      const repoName = decoded.repo;

      try {
        const { provider, projectPath } = await contextFor(repoName);
        const applied: string[] = [];
        let returnedPr: PullRequest | null = null;
        if (editFields.length > 0) {
          try {
            returnedPr = await provider.updatePullRequest(projectPath, iid, edit);
          } catch (err) {
            if (!(err instanceof ReadBackFailedError && err.writeApplied)) {
              const rest = putFields.length > 0 ? `; ${putFields.join("/")} not attempted` : "";
              return { ok: false, error: `${editFields.join("/")} did not land: ${String(err)}${rest}` };
            }
            ctx.log.warn({ err, repo: repoName, iid }, "mr:update landed but its read-back failed");
          }
          applied.push(...editFields);
        }
        if (putFields.length > 0) {
          const res = await putMergeRequest(provider, projectPath, iid, put, "mr:update");
          if (!res.ok) {
            const landed = applied.length > 0 ? `${applied.join("/")} landed; ` : "";
            return { ok: false, error: `${landed}${putFields.join("/")} did not: ${res.error}; retrying with only the failed fields is safe` };
          }
          applied.push(...putFields);
        }
        // Same never-fail contract as mr:action's write-back: the edit is on the forge already.
        try {
          if (returnedPr) {
            writeback(repoName, projectPath, returnedPr);
          } else {
            const pr = await fetchSingle(provider, projectPath, iid);
            if (pr) writeback(repoName, projectPath, pr);
          }
        } catch (err) {
          ctx.log.warn({ err, repo: repoName, iid }, "mr:update write-back failed");
        }
        return { ok: true, data: { iid, url: `${provider.baseURL}/${projectPath}/-/merge_requests/${iid}`, applied } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
```

- [ ] **Step 5: Rebuild rt-client and run the daemon tests**

Run: `bun run --cwd packages/rt-client build`
Then: `bun test lib/daemon/__tests__/mr-update.test.ts lib/daemon/__tests__/mr-create.test.ts lib/daemon/__tests__/rt-client-commands.test.ts packages/rt-client`
Expected: PASS.

- [ ] **Step 6: Write the failing tool tests.** In `lib/mcp/__tests__/tools.test.ts`:

Replace `NAMES` with:

```ts
const NAMES = ["gate_answer","gate_ask","gate_list","chat_post","chat_dm","chat_ack","chat_claim","chat_release","mr_reply_thread","mr_comment_inline","mr_comment","mr_create","mr_update","mr_approve","mr_resolve_thread","mr_ready","mr_retry","mr_rebase","mr_map","herd_gates","herd_ask","herd_answer","herd_report","rt_verb"];
```

Change the roster count test to `roster has 24 tools` / `toBe(24)`. Add `{ name: "mr_update", field: "repoName" },` to `repoArgTools` after the `mr_create` row. In the `mr target resolution wiring` block's last test, add `"mr_update"` to the loop's name list.

Add this block after the `mr target resolution wiring` block:

```ts
  describe("mr_update", () => {
    afterEach(() => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: realRtCommand }));
    });

    function fakeDaemon(reply: () => unknown = () => ({ ok: true, data: { iid: 7, url: "u", applied: ["title"] } })) {
      const calls: Array<{ cmd: string; payload: Record<string, unknown>; timeoutMs?: number }> = [];
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string, payload: Record<string, unknown>, opts?: { timeoutMs?: number }) => {
          calls.push({ cmd, payload, timeoutMs: opts?.timeoutMs });
          return reply();
        },
      }));
      return calls;
    }

    const T = { repoName: "remote:x", iid: 7 };

    test("schema offers the target props and the five fields, requires none, forbids extras", () => {
      const schema = mcpTools().find((t) => t.name === "mr_update")!.inputSchema as { required?: string[]; additionalProperties?: boolean; properties?: Record<string, unknown> };
      expect(schema.required ?? []).toEqual([]);
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["addLabels", "description", "iid", "mrUrl", "removeLabels", "repoName", "squash", "title"]);
    });

    test("sends mr:update with only the given fields and the write timeout", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_update")!;
      const res = await tool.handler({ ...T, title: "T", addLabels: ["a"], squash: false }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: true, body: { iid: 7, url: "u", applied: ["title"] } });
      expect(calls).toEqual([{ cmd: "mr:update", payload: { ...T, title: "T", addLabels: ["a"], squash: false }, timeoutMs: 30_000 }]);
    });

    test("refuses no field, only empty label arrays, a string squash, and non-array labels before calling the daemon", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_update")!;
      const nothing = 'nothing to update; pass at least one of "title", "description", "addLabels", "removeLabels" or "squash"';
      expect((await tool.handler({ ...T }, {} as NodeJS.ProcessEnv)).error).toBe(nothing);
      expect((await tool.handler({ ...T, addLabels: [], removeLabels: [] }, {} as NodeJS.ProcessEnv)).error).toBe(nothing);
      expect((await tool.handler({ ...T, squash: "true" }, {} as NodeJS.ProcessEnv)).error).toBe('"squash" must be a boolean');
      expect((await tool.handler({ ...T, addLabels: "a" }, {} as NodeJS.ProcessEnv)).error).toBe('"addLabels" must be an array of strings');
      expect((await tool.handler({ ...T, removeLabels: [1] }, {} as NodeJS.ProcessEnv)).error).toBe('"removeLabels" must be an array of strings');
      expect(calls).toEqual([]);
    });

    test("a timed-out mr_update says the write may still land and what to check", async () => {
      fakeDaemon(() => ({ ok: false, error: "rt daemon unreachable at /x.sock: The operation timed out." }));
      const tool = mcpTools().find((t) => t.name === "mr_update")!;
      const res = await tool.handler({ ...T, title: "T" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toContain("may still land");
      expect(res.error).toContain("title, labels and squash");
    });

    test("a partial-failure error from the daemon passes through verbatim", async () => {
      fakeDaemon(() => ({ ok: false, error: "title landed; squash did not: GitLab returned 403 Forbidden; retrying with only the failed fields is safe" }));
      const tool = mcpTools().find((t) => t.name === "mr_update")!;
      const res = await tool.handler({ ...T, title: "T", squash: true }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe("title landed; squash did not: GitLab returned 403 Forbidden; retrying with only the failed fields is safe");
    });
  });
```

In `e2e/tests/mcp-serve.test.ts`, change the mr line of `EXPECTED_TOOL_NAMES` to:

```ts
  "mr_approve", "mr_comment", "mr_comment_inline", "mr_create", "mr_map", "mr_ready", "mr_rebase", "mr_reply_thread", "mr_resolve_thread", "mr_retry", "mr_update",
```

- [ ] **Step 7: Run and confirm failure**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Expected: FAIL on the roster tests and every `mr_update` case.

- [ ] **Step 8: Implement the tool.** In `lib/mcp/tools.ts`, after the `mr_create` tool, add:

```ts
    {
      name: "mr_update",
      description: `GitLab only. Edit an open MR: title, description, addLabels, removeLabels (add and remove, never the whole set, so labels CI or teammates set survive) and squash (the MR's squash-on-merge flag). Pass at least one. A title change keeps the MR's draft state. Title and description are written first, then labels and squash in one call; a partial failure names what landed, and every field is idempotent, so retry with only the failed fields. Returns iid, url and applied (the fields that landed). ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...MR_TARGET_PROPS,
          title: { type: "string" },
          description: { type: "string" },
          addLabels: { type: "array", items: { type: "string" } },
          removeLabels: { type: "array", items: { type: "string" } },
          squash: { type: "boolean" },
        },
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "title", type: "string" }, { name: "description", type: "string" }, { name: "squash", type: "boolean" }])
          ?? checkStringArray(input, "addLabels") ?? checkStringArray(input, "removeLabels");
        if (bad) return err(bad);
        const changes = ["title", "description", "addLabels", "removeLabels", "squash"]
          .filter((f) => input[f] !== undefined && !(Array.isArray(input[f]) && (input[f] as unknown[]).length === 0));
        if (changes.length === 0) return err('nothing to update; pass at least one of "title", "description", "addLabels", "removeLabels" or "squash"');
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["mr:update"]["payload"] = { repoName: target.identity, iid: target.iid };
        if (input.title !== undefined) payload.title = input.title as string;
        if (input.description !== undefined) payload.description = input.description as string;
        if (input.addLabels !== undefined) payload.addLabels = input.addLabels as string[];
        if (input.removeLabels !== undefined) payload.removeLabels = input.removeLabels as string[];
        if (input.squash !== undefined) payload.squash = input.squash as boolean;
        const res = await rtCommand<Commands["mr:update"]["data"]>("mr:update", payload, { timeoutMs: MR_WRITE_TIMEOUT_MS });
        return withLandingHint(fromResponse(res), "the MR's title, labels and squash setting");
      },
    },
```

- [ ] **Step 9: Run the unit and e2e MCP tests, typecheck, commit**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Then: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/mcp-serve.test.ts`
Then: `bunx tsc --noEmit`
Expected: PASS, PASS, no errors.

```bash
git add packages/rt-client/src/commands.ts lib/daemon/handlers/mr.ts lib/daemon/__tests__/mr-update.test.ts lib/mcp/tools.ts lib/mcp/__tests__/tools.test.ts e2e/tests/mcp-serve.test.ts
bash scripts/repo-purity.sh
git commit -m "daemon+mcp: add mr:update and mr_update (RT-315)"
```

---

### Task 4: `rt.mcp.uploadRoots`, the upload guard, `mr:upload` and `mr_upload`

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (new row after `rt.trustedBrowserOrigins`, line 288)
- Create: `lib/daemon/upload-guard.ts`
- Create: `lib/daemon/__tests__/upload-guard.test.ts`
- Create: `lib/daemon/handlers/mr-upload.ts`
- Create: `lib/daemon/__tests__/mr-upload.test.ts`
- Modify: `lib/daemon/command-router.ts` (import after `createDiscussionHandlers`; spread after the `createDiscussionHandlers(...)` line)
- Modify: `packages/rt-client/src/commands.ts` (`Commands` entry after `"mr:update"`; `COMMAND_NAMES` after `"mr:update",`)
- Modify: `lib/mcp/tools.ts` (`MR_UPLOAD_TIMEOUT_MS`; new tool after `mr_update`)
- Modify: `lib/mcp/__tests__/tools.test.ts` (`NAMES`, roster count, `repoArgTools`, new block)
- Modify: `e2e/tests/mcp-serve.test.ts` (`EXPECTED_TOOL_NAMES`)

**Interfaces:**
- Consumes: `getSetting` (`lib/settings/resolve.ts`), `loadRegistry` (`lib/worktree/registry.ts`), `getRepoContext` and `providerRequestHook` (`lib/daemon/freshness.ts`), `loadSecrets` (`lib/linear.ts`), `decodeRepo` (`lib/daemon/identity-decoder.ts`), `resolveRepoTarget` and `REPO_TARGET_PROPS` (Task 1).
- Produces:
  - `lib/daemon/upload-guard.ts`: `UPLOAD_MAX_BYTES = 52_428_800`, `UPLOAD_EXTENSIONS`, `claudeTempRoots(uid: number | null): string[]`, `isInsideRoot(realpath: string, root: string): boolean`, `checkUploadPath(path: unknown, roots: readonly string[], opts?: { maxBytes?: number }): UploadCheck` where `UploadCheck = { ok: true; realpath: string; filename: string; mime: string; size: number } | { ok: false; error: string }`.
  - `lib/daemon/handlers/mr-upload.ts`: `export interface MrUploadSeams { repoContext?; gitlabToken?; worktreePaths?; uploadRoots?; tempRoots?; fetchFn?; requestHook? }` and `createMrUploadHandlers(ctx: Pick<HandlerContext, "repoIndex" | "log">, seams?: MrUploadSeams): { "mr:upload": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:upload">> } & HandlerMap`.
  - `Commands["mr:upload"]` payload `{ repoName: string; path: string }`, data `{ url: string; markdown: string }`.

Docs row: there is no per-key settings table under `website/docs` (the generated reference and `rt settings list` print registry descriptions), so the key's user-facing row is the paragraph Task 5 adds to `website/docs/guides/mcp.mdx`; the registry `description` is what `rt settings list` shows.

- [ ] **Step 1: Write the failing guard tests.** Create `lib/daemon/__tests__/upload-guard.test.ts`:

```ts
/**
 * checkUploadPath: the network-free half of mr:upload. Every refusal the
 * spec lists is pinned here against real files under a temp root, so the
 * handler test can trust the guard and cover only the POST.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { UPLOAD_MAX_BYTES, checkUploadPath, claudeTempRoots, isInsideRoot } from "../upload-guard.ts";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const GIF = Buffer.from("GIF89a\0\0\0\0\0\0\0\0\0\0", "latin1");
const WEBP = Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1");
const MP4 = Buffer.from("\0\0\0\x18ftypisom\0\0\0\0", "latin1");
const MOV = Buffer.from("\0\0\0\x14ftypqt  \0\0\0\0", "latin1");
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("checkUploadPath", () => {
  let root: string;
  let rootReal: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rt-upload-root-"));
    rootReal = realpathSync(root);
    outside = realpathSync(mkdtempSync(join(tmpdir(), "rt-upload-outside-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  function file(dir: string, name: string, bytes: Buffer): string {
    const p = join(dir, name);
    writeFileSync(p, bytes);
    return p;
  }

  test("a png under a root passes and reports its realpath, name, mime and size", () => {
    const p = file(root, "shot.png", PNG);
    expect(checkUploadPath(p, [root])).toEqual({ ok: true, realpath: join(rootReal, "shot.png"), filename: "shot.png", mime: "image/png", size: PNG.length });
  });

  test("a root given through a symlinked alias still contains the file (tmpdir is such an alias on macOS)", () => {
    const p = file(root, "shot.png", PNG);
    expect(checkUploadPath(join(rootReal, "shot.png"), [root]).ok).toBe(true);
    expect(checkUploadPath(p, [rootReal]).ok).toBe(true);
  });

  test("every allowed type passes when its bytes match, and .PNG is read case-insensitively", () => {
    for (const [name, bytes, mime] of [
      ["a.jpg", JPG, "image/jpeg"], ["a.jpeg", JPG, "image/jpeg"], ["a.gif", GIF, "image/gif"], ["a.webp", WEBP, "image/webp"],
      ["a.mp4", MP4, "video/mp4"], ["a.mov", MOV, "video/quicktime"], ["a.webm", WEBM, "video/webm"], ["a.PNG", PNG, "image/png"],
    ] as const) {
      const res = checkUploadPath(file(root, name, bytes), [root]);
      expect(res.ok, name).toBe(true);
      if (res.ok) expect(res.mime, name).toBe(mime);
    }
  });

  test("a relative path is refused", () => {
    expect(checkUploadPath("shot.png", [root])).toEqual({ ok: false, error: "path must be absolute" });
  });

  test("a non-string path is refused", () => {
    expect(checkUploadPath(5, [root])).toEqual({ ok: false, error: "path must be absolute" });
  });

  test("a missing file is refused", () => {
    const res = checkUploadPath(join(root, "nope.png"), [root]);
    expect(res).toEqual({ ok: false, error: `file not found: ${join(root, "nope.png")}` });
  });

  test("a directory is refused", () => {
    mkdirSync(join(root, "dir.png"));
    expect(checkUploadPath(join(root, "dir.png"), [root])).toEqual({ ok: false, error: "path is not a regular file" });
  });

  test("a symlink inside a root that points outside it is refused without reading the target", () => {
    const target = file(outside, "secret.png", PNG);
    symlinkSync(target, join(root, "link.png"));
    const res = checkUploadPath(join(root, "link.png"), [root]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("outside the allowed upload roots");
  });

  test("a file outside every root is refused naming the root classes", () => {
    const p = file(outside, "shot.png", PNG);
    expect(checkUploadPath(p, [root])).toEqual({
      ok: false,
      error: "path is outside the allowed upload roots (a worktree of the target repo, the Claude Code temp root, or an rt.mcp.uploadRoots entry)",
    });
  });

  test("an empty roots list refuses everything", () => {
    expect(checkUploadPath(file(root, "shot.png", PNG), []).ok).toBe(false);
  });

  test("a disallowed extension is refused before the bytes are read", () => {
    expect(checkUploadPath(file(root, "notes.txt", PNG), [root])).toEqual({
      ok: false,
      error: "extension must be one of png, jpg, jpeg, gif, webp, mp4, mov, webm",
    });
    expect(checkUploadPath(file(root, "noext", PNG), [root]).ok).toBe(false);
  });

  test("a file renamed to .png whose bytes are not a PNG is refused", () => {
    expect(checkUploadPath(file(root, "fake.png", Buffer.from("hello world, not a png")), [root])).toEqual({
      ok: false,
      error: "file bytes do not match a .png signature",
    });
    expect(checkUploadPath(file(root, "fake.mp4", PNG), [root])).toEqual({ ok: false, error: "file bytes do not match a .mp4 signature" });
  });

  test("a file over the cap is refused, and the cap defaults to 50 MB", () => {
    expect(UPLOAD_MAX_BYTES).toBe(50 * 1024 * 1024);
    const p = file(root, "big.png", Buffer.concat([PNG, Buffer.alloc(32)]));
    const res = checkUploadPath(p, [root], { maxBytes: 16 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("cap is 50 MB");
  });

  test("a root that does not exist on disk is skipped, not an error", () => {
    expect(checkUploadPath(file(root, "shot.png", PNG), ["/nonexistent/root", root]).ok).toBe(true);
  });
});

describe("root helpers", () => {
  test("isInsideRoot needs a real descendant, not a prefix match or the root itself", () => {
    expect(isInsideRoot("/a/b/c.png", "/a/b")).toBe(true);
    expect(isInsideRoot("/a/bc/c.png", "/a/b")).toBe(false);
    expect(isInsideRoot("/a/b", "/a/b")).toBe(false);
    expect(isInsideRoot("/a/b/../c.png", "/a/b")).toBe(false);
  });

  test("claudeTempRoots names the private root and its /tmp alias, or nothing without a uid", () => {
    expect(claudeTempRoots(501)).toEqual(["/private/tmp/claude-501", "/tmp/claude-501"]);
    expect(claudeTempRoots(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test lib/daemon/__tests__/upload-guard.test.ts`
Expected: FAIL, `../upload-guard.ts` cannot be resolved.

- [ ] **Step 3: Create `lib/daemon/upload-guard.ts`:**

```ts
/**
 * The network-free half of mr:upload. Every mattstack MCP tool runs with no
 * permission check, so this is the only thing between an agent and sending an
 * arbitrary local file to a forge: the realpath must be a regular file under
 * one of the caller's roots, the extension must be an image or video type and
 * the leading bytes must agree with it, and the size is capped. Symlinks are
 * resolved before the containment check, so a link inside a root that points
 * outside it is refused without its target ever being read.
 */
import { closeSync, openSync, readSync, realpathSync, statSync } from "fs";
import { basename, extname, isAbsolute, relative } from "path";

export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export const UPLOAD_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "mp4", "mov", "webm"] as const;

export type UploadCheck =
  | { ok: true; realpath: string; filename: string; mime: string; size: number }
  | { ok: false; error: string };

const HEAD_BYTES = 12;

function startsWith(head: Uint8Array, bytes: number[]): boolean {
  return bytes.every((b, i) => head[i] === b);
}

function ascii(head: Uint8Array, at: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (head[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

const TYPES: Record<(typeof UPLOAD_EXTENSIONS)[number], { mime: string; matches: (head: Uint8Array) => boolean }> = {
  png:  { mime: "image/png",       matches: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg:  { mime: "image/jpeg",      matches: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  jpeg: { mime: "image/jpeg",      matches: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  gif:  { mime: "image/gif",       matches: (h) => ascii(h, 0, "GIF87a") || ascii(h, 0, "GIF89a") },
  webp: { mime: "image/webp",      matches: (h) => ascii(h, 0, "RIFF") && ascii(h, 8, "WEBP") },
  mp4:  { mime: "video/mp4",       matches: (h) => ascii(h, 4, "ftyp") },
  mov:  { mime: "video/quicktime", matches: (h) => ["ftyp", "moov", "mdat", "free", "wide", "skip"].some((atom) => ascii(h, 4, atom)) },
  webm: { mime: "video/webm",      matches: (h) => startsWith(h, [0x1a, 0x45, 0xdf, 0xa3]) },
};

export function claudeTempRoots(uid: number | null): string[] {
  if (uid === null) return [];
  return [`/private/tmp/claude-${uid}`, `/tmp/claude-${uid}`];
}

export function isInsideRoot(realpath: string, root: string): boolean {
  const rel = relative(root, realpath);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

function readHead(path: string): Uint8Array {
  const fd = openSync(path, "r");
  try {
    const buf = new Uint8Array(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

export function checkUploadPath(path: unknown, roots: readonly string[], opts: { maxBytes?: number } = {}): UploadCheck {
  if (typeof path !== "string" || !isAbsolute(path)) return { ok: false, error: "path must be absolute" };
  const real = safeRealpath(path);
  if (real === null) return { ok: false, error: `file not found: ${path}` };
  const stat = statSync(real);
  if (!stat.isFile()) return { ok: false, error: "path is not a regular file" };

  const contained = roots.some((root) => {
    const rootReal = safeRealpath(root);
    return isInsideRoot(real, root) || (rootReal !== null && isInsideRoot(real, rootReal));
  });
  if (!contained) {
    return { ok: false, error: "path is outside the allowed upload roots (a worktree of the target repo, the Claude Code temp root, or an rt.mcp.uploadRoots entry)" };
  }

  const ext = extname(real).slice(1).toLowerCase() as (typeof UPLOAD_EXTENSIONS)[number];
  const type = (UPLOAD_EXTENSIONS as readonly string[]).includes(ext) ? TYPES[ext] : undefined;
  if (!type) return { ok: false, error: `extension must be one of ${UPLOAD_EXTENSIONS.join(", ")}` };

  const maxBytes = opts.maxBytes ?? UPLOAD_MAX_BYTES;
  if (stat.size > maxBytes) {
    return { ok: false, error: `file is ${(stat.size / (1024 * 1024)).toFixed(1)} MB; the upload cap is ${Math.round(UPLOAD_MAX_BYTES / (1024 * 1024))} MB` };
  }

  if (!type.matches(readHead(real))) return { ok: false, error: `file bytes do not match a .${ext} signature` };
  return { ok: true, realpath: real, filename: basename(real), mime: type.mime, size: stat.size };
}
```

- [ ] **Step 4: Run the guard tests and confirm they pass**

Run: `bun test lib/daemon/__tests__/upload-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the setting.** In `packages/rt-client/src/settings/registry-defs.ts`, directly after the `rt.trustedBrowserOrigins` row (before the `// --- mattstack (installer-lane)` comment), add:

```ts
  {
    key: "rt.mcp.uploadRoots",
    type: "array",
    scopes: ["machine"],
    default: [],
    merge: "replace",
    description: "Absolute directories the mr_upload MCP tool may read files from, beside its built-in roots (the target repo's worktrees and this user's Claude Code temp root). Machine-only: path literals never travel. A non-absolute entry is ignored with a warning. A fresh key, not an ownership-latch port, so a default is fine here.",
  },
```

Then run: `bun run --cwd packages/rt-client build`
Then: `bun test packages/rt-client lib/__tests__/settings-paths-parity.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing handler tests.** Create `lib/daemon/__tests__/mr-upload.test.ts`:

```ts
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
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `bun test lib/daemon/__tests__/mr-upload.test.ts`
Expected: FAIL, `../handlers/mr-upload.ts` cannot be resolved.

- [ ] **Step 8: Add the catalog entry.** In `packages/rt-client/src/commands.ts`, directly after the `"mr:update"` entry:

```ts
  /** Uploads one local image or video to the target project (GitLab
      POST /projects/:id/uploads, multipart) and returns the absolute url and
      the markdown that embeds it in that project's MRs. Works before an MR
      exists. The daemon refuses a path outside its allowed roots, a
      directory, a file over 50 MB, or bytes that do not match the
      extension. Uploads once; an orphaned upload is harmless. */
  "mr:upload": {
    payload: { repoName: string; path: string };
    data: { url: string; markdown: string };
  };
```

In `COMMAND_NAMES`, add `"mr:upload",` directly after `"mr:update",`.

- [ ] **Step 9: Create `lib/daemon/handlers/mr-upload.ts`:**

```ts
/**
 * mr:upload: one multipart POST to GitLab's project uploads endpoint, behind
 * the path guard in ../upload-guard.ts. glance has no multipart support, so
 * the request is built here with the same token and base URL getRepoContext
 * gives every other GitLab verb, and it reports through providerRequestHook
 * like a provider call. The allowed roots are assembled per call: the target
 * repo's index path and worktree registry, the Claude Code temp root for this
 * uid, and rt.mcp.uploadRoots read through the resolver at call time.
 */
import { readFileSync } from "fs";
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
        form.append("file", new Blob([readFileSync(checked.realpath)], { type: checked.mime }), checked.filename);
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
```

- [ ] **Step 10: Wire the router.** In `lib/daemon/command-router.ts`, after `import { createDiscussionHandlers } from "./handlers/discussions.ts";` add:

```ts
import { createMrUploadHandlers } from "./handlers/mr-upload.ts";
```

After the `...createDiscussionHandlers({ repoIndex: ctx.repoIndex, cache: ctx.cache }, broadcast),` line add:

```ts
    ...createMrUploadHandlers({ repoIndex: ctx.repoIndex, log: ctx.log }),
```

- [ ] **Step 11: Rebuild rt-client and run the daemon tests**

Run: `bun run --cwd packages/rt-client build`
Then: `bun test lib/daemon/__tests__/mr-upload.test.ts lib/daemon/__tests__/upload-guard.test.ts lib/daemon/__tests__/rt-client-commands.test.ts packages/rt-client lib/__tests__/no-eager-tui.test.ts`
Expected: PASS (the router now resolves `mr:upload`; the daemon graph still reaches none of the banned modules).

- [ ] **Step 12: Commit the daemon half**

```bash
git add packages/rt-client/src/settings/registry-defs.ts packages/rt-client/src/commands.ts lib/daemon/upload-guard.ts lib/daemon/__tests__/upload-guard.test.ts lib/daemon/handlers/mr-upload.ts lib/daemon/__tests__/mr-upload.test.ts lib/daemon/command-router.ts
bash scripts/repo-purity.sh
git commit -m "daemon: add mr:upload behind a path guard and rt.mcp.uploadRoots (RT-315)"
```

- [ ] **Step 13: Write the failing tool tests.** In `lib/mcp/__tests__/tools.test.ts`:

Replace `NAMES` with:

```ts
const NAMES = ["gate_answer","gate_ask","gate_list","chat_post","chat_dm","chat_ack","chat_claim","chat_release","mr_reply_thread","mr_comment_inline","mr_comment","mr_create","mr_update","mr_upload","mr_approve","mr_resolve_thread","mr_ready","mr_retry","mr_rebase","mr_map","herd_gates","herd_ask","herd_answer","herd_report","rt_verb"];
```

Change the roster count test to `roster has 25 tools` / `toBe(25)`. Add `{ name: "mr_upload", field: "repoName" },` to `repoArgTools` after the `mr_update` row.

Add this block after the `describe("mr_update", ...)` block:

```ts
  describe("mr_upload", () => {
    afterEach(() => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: realRtCommand }));
    });

    function fakeDaemon(reply: () => unknown = () => ({ ok: true, data: { url: "https://gitlab.example.com/-/project/9/uploads/a/x.png", markdown: "![x](/uploads/a/x.png)" } })) {
      const calls: Array<{ cmd: string; payload: Record<string, unknown>; timeoutMs?: number }> = [];
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string, payload: Record<string, unknown>, opts?: { timeoutMs?: number }) => {
          calls.push({ cmd, payload, timeoutMs: opts?.timeoutMs });
          return reply();
        },
      }));
      return calls;
    }

    test("schema requires path, offers repoName and mrUrl, has no iid, forbids extras", () => {
      const schema = mcpTools().find((t) => t.name === "mr_upload")!.inputSchema as { required?: string[]; additionalProperties?: boolean; properties?: Record<string, unknown> };
      expect(schema.required).toEqual(["path"]);
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["mrUrl", "path", "repoName"]);
    });

    test("sends mr:upload with the resolved repo, the path and the 120s timeout, and returns url and markdown", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_upload")!;
      const res = await tool.handler({ repoName: "remote:x", path: "/tmp/shot.png" }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: true, body: { url: "https://gitlab.example.com/-/project/9/uploads/a/x.png", markdown: "![x](/uploads/a/x.png)" } });
      expect(calls).toEqual([{ cmd: "mr:upload", payload: { repoName: "remote:x", path: "/tmp/shot.png" }, timeoutMs: 120_000 }]);
    });

    test("refuses a missing path and a missing target before calling the daemon", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_upload")!;
      expect((await tool.handler({ repoName: "remote:x" }, {} as NodeJS.ProcessEnv)).error).toBe('"path" is required');
      expect((await tool.handler({ path: "/tmp/shot.png" }, {} as NodeJS.ProcessEnv)).error).toBe('pass "repoName" or "mrUrl"');
      expect(calls).toEqual([]);
    });

    test("a daemon refusal passes through verbatim", async () => {
      fakeDaemon(() => ({ ok: false, error: "file bytes do not match a .png signature" }));
      const tool = mcpTools().find((t) => t.name === "mr_upload")!;
      const res = await tool.handler({ repoName: "remote:x", path: "/tmp/shot.png" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe("file bytes do not match a .png signature");
    });

    test("a timed-out upload says retrying is safe, not that it may double-post", async () => {
      fakeDaemon(() => ({ ok: false, error: "rt daemon unreachable at /x.sock: The operation timed out." }));
      const tool = mcpTools().find((t) => t.name === "mr_upload")!;
      const res = await tool.handler({ repoName: "remote:x", path: "/tmp/shot.png" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("retrying is safe");
      expect(res.error).not.toContain("before retrying");
    });

    test("description says GitLab only and names the allowed roots and types", () => {
      const tool = mcpTools().find((t) => t.name === "mr_upload")!;
      expect(tool.description.startsWith("GitLab only.")).toBe(true);
      expect(tool.description).toContain("rt.mcp.uploadRoots");
      expect(tool.description).toContain("png");
      expect(tool.description).toContain("50 MB");
    });
  });
```

In `e2e/tests/mcp-serve.test.ts`, change the mr line of `EXPECTED_TOOL_NAMES` to:

```ts
  "mr_approve", "mr_comment", "mr_comment_inline", "mr_create", "mr_map", "mr_ready", "mr_rebase", "mr_reply_thread", "mr_resolve_thread", "mr_retry", "mr_update", "mr_upload",
```

- [ ] **Step 14: Run and confirm failure**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Expected: FAIL on the roster tests and every `mr_upload` case.

- [ ] **Step 15: Implement the tool.** In `lib/mcp/tools.ts`, after the `MR_WRITE_TIMEOUT_MS` constant add:

```ts
/** A 50 MB multipart POST over a slow link outlives the 30s write timeout. */
const MR_UPLOAD_TIMEOUT_MS = 120_000;
```

After the `mr_update` tool, add:

```ts
    {
      name: "mr_upload",
      description: `GitLab only. Upload one local image or video (png, jpg, jpeg, gif, webp, mp4, mov, webm; at most 50 MB) to the target project and get back url and markdown; paste the markdown into an MR description or note (mr_create, mr_update, mr_comment). Works before an MR exists. path must be absolute and under an allowed root: a worktree of the target repo, this user's Claude Code temp root (the session scratchpad lives there), or a directory in the rt.mcp.uploadRoots setting; anything else, a directory, or a file whose bytes do not match its extension is refused. Uploads once; a timed-out upload may have landed, but an unused upload is harmless, so retrying is safe. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...REPO_TARGET_PROPS, path: { type: "string", description: "Absolute path of the file to upload." } },
        required: ["path"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "path", type: "string" }]);
        if (bad) return err(bad);
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const res = await rtCommand<Commands["mr:upload"]["data"]>("mr:upload", { repoName: target.identity, path: input.path as string }, { timeoutMs: MR_UPLOAD_TIMEOUT_MS });
        const out = fromResponse(res);
        if (out.ok || !/timed ?out|timeout/i.test(out.error ?? "")) return out;
        return err(`${out.error}; the upload may have landed anyway, and an unused upload is harmless, so retrying is safe`);
      },
    },
```

- [ ] **Step 16: Run the unit and e2e MCP tests, typecheck, commit**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Then: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/mcp-serve.test.ts`
Then: `bunx tsc --noEmit`
Expected: PASS, PASS, no errors.

```bash
git add lib/mcp/tools.ts lib/mcp/__tests__/tools.test.ts e2e/tests/mcp-serve.test.ts
bash scripts/repo-purity.sh
git commit -m "mcp: add mr_upload (RT-315)"
```

---

### Task 5: Docs

**Files:**
- Modify: `website/docs/guides/mcp.mdx` (the `### MR` table and the paragraph under it, lines 44-57)
- Modify: `AGENTS.md` (the `mr_*` paragraph in "Gates and the `rt_verb` MCP tool", lines 185-191)

- [ ] **Step 1: Replace the MR table and its paragraph in `website/docs/guides/mcp.mdx` with** (the outer fence is four backticks only because the replacement itself carries a bash fence):

````mdx
| Tool | What it does |
| --- | --- |
| `mr_reply_thread` | Reply to an existing MR discussion thread (GitLab only). |
| `mr_comment_inline` | Post a new positioned inline comment on an MR diff line (GitLab only). |
| `mr_comment` | Post a new top-level note: resolvable by default, or a plain note with `resolvable: false` (GitLab only). |
| `mr_resolve_thread` | Resolve a discussion thread, or reopen it with `resolved: false` (GitLab only). |
| `mr_approve` | Approve an MR, or withdraw the approval with `approved: false` (GitLab only). |
| `mr_ready` | Mark a draft MR ready, or back to draft with `ready: false` (GitLab only). |
| `mr_retry` | Retry one CI job or a whole pipeline (GitLab only). |
| `mr_rebase` | Request a server-side rebase of the MR's source branch (GitLab only). |
| `mr_create` | Create an MR from a pushed branch, as a draft by default, with optional `labels` and `squash` (GitLab only). |
| `mr_update` | Edit an open MR's `title`, `description`, `addLabels`, `removeLabels` or `squash`; at least one (GitLab only). |
| `mr_upload` | Upload one local image or video to the project and get back the markdown that embeds it (GitLab only). |
| `mr_map` | List open MRs joined to the local worktrees holding their branches. |

Every `mr_*` write tool names its target with `repoName` (the repo's serialized identity such as `remote:gitlab.com%2Facme%2Facme-dev`, an absolute path to a checkout or worktree, or a repo label that matches exactly one registered repo) or with `mrUrl` (the MR's URL; its project must be registered with rt, and the URL supplies the iid). A URL is matched to a registered repo by identity first, then by the registered checkouts' origin remotes, so a repo pinned to another identity through `rt.repoIdentityOverrides` still resolves; a URL matching two checkouts is refused as ambiguous. Given both, they must agree. `mr_map` takes `repo` (identity or label). There is no merge tool.

`mr_upload` reads only regular files under the target repo's worktrees, your Claude Code temp root (`/private/tmp/claude-<uid>/`, where session scratchpads live), or a directory listed in the machine-scoped `rt.mcp.uploadRoots` setting, and only png, jpg, jpeg, gif, webp, mp4, mov or webm files up to 50 MB whose bytes match their extension. To allow another folder on this machine:

```bash
rt settings set rt.mcp.uploadRoots '["/Users/you/Screenshots"]' --scope machine
```
````

- [ ] **Step 2: Update the `mr_*` paragraph in `AGENTS.md`** (the one beginning "The `mr_*` tools in the same file are the rest of that grant.") to:

```markdown
The `mr_*` tools in the same file are the rest of that grant.
`mcp__plugin_mattstack_mattstack` is in `BASE_PERMISSIONS`, so every tool on
the server runs on every estate machine with no permission check, and a new
`mr_*` tool is a forge write any agent can make unasked. They cover what
board panes and pipeline verbs write (notes, approvals, resolves, draft
state, retries, rebase, create, update, upload). Merge, and anything equally
irreversible, stays off the server so the classifier or a human stays in
front of it. `mr_upload` is the one tool that reads local files, so its
daemon guard (`lib/daemon/upload-guard.ts`) refuses anything outside the
target repo's worktrees, the user's Claude Code temp root and
`rt.mcp.uploadRoots`, and anything whose bytes do not match its image or
video extension; widen the roots through that setting, never by loosening
the guard. Target resolution (`repoName` as identity, path or label, or
`mrUrl`) lives in `lib/mcp/mr-target.ts`; the daemon verbs still take the
serialized identity only.
```

- [ ] **Step 3: Scan for dashes, then commit**

Run: `git diff main -U0 | rg '^\+.*(\x{2014}|\x{2013})'`
Expected: prints nothing (rg exits 1 with no match); the escapes are U+2014 and U+2013 so this plan itself carries neither character.

```bash
git add website/docs/guides/mcp.mdx AGENTS.md
bash scripts/repo-purity.sh
git commit -m "docs: mr_update, mr_upload, uploadRoots and MR URL targets in the MCP guide (RT-315)"
```

---

### Task 6: Verify, smoke against the harness GitLab project, ship the PR, deploy to the dev machine

**Files:**
- Create (scratch, never committed): `/private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/bbd9c65a-7ece-4bd6-bf72-dfed5168c0dd/scratchpad/rt315b-smoke.ts`

- [ ] **Step 1: Full suites, captured once**

Run: `bun run test:all > /private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/bbd9c65a-7ece-4bd6-bf72-dfed5168c0dd/scratchpad/test-all.log 2>&1`
Then: `tail -40 /private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/bbd9c65a-7ece-4bd6-bf72-dfed5168c0dd/scratchpad/test-all.log`
Then: `grep -E " [1-9][0-9]* fail$" /private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/bbd9c65a-7ece-4bd6-bf72-dfed5168c0dd/scratchpad/test-all.log`
Expected: the test run reports exit 0 and the grep prints no lines (bun's summary prints ` 0 fail` for a clean suite, which that pattern skips). If anything fails, re-run the failing file alone, and check whether it also fails on clean `main` before calling it pre-existing (full-suite flakes rotate).

- [ ] **Step 2: Typecheck and picker gate**

Run: `bunx tsc --noEmit`
Then: `bun run picker:check`
Expected: both clean.

- [ ] **Step 3: Pre-merge API smoke against the harness GitLab project.** The project is `m4tthew-dev/glance-test-repo` (project id `79691134`, the `provider: "gitlab"` entry in `/Users/matt/Documents/GitHub/glance/harness_credentials.json`, fields `path_with_namespace` and `project_id`). Act as the `owner` user (`users[].role === "owner"`, field `token`) and never print a token. The script creates its own branch and commit through the API, so no clone and no token on a command line. Create the scratch HOME first: `mkdir -p /private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/bbd9c65a-7ece-4bd6-bf72-dfed5168c0dd/scratchpad/smoke-home`. Write `/private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/bbd9c65a-7ece-4bd6-bf72-dfed5168c0dd/scratchpad/rt315b-smoke.ts`:

```ts
/**
 * Phase 1b pre-merge smoke against the harness GitLab project. Calls the
 * daemon handlers directly (no daemon, no built binary) under a scratch
 * HOME set before any rt module loads. Prints observed results, never a
 * token, and cleans up its MR and branch at the end.
 */
const SCRATCH = "/private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/bbd9c65a-7ece-4bd6-bf72-dfed5168c0dd/scratchpad";
process.env.HOME = `${SCRATCH}/smoke-home`;

const WT = "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/saruman";
const { GitLabProvider } = await import(`${WT}/node_modules/@mattstack/glance/src/index.ts`);
const { createMRHandlers } = await import(`${WT}/lib/daemon/handlers/mr.ts`);
const { createMrUploadHandlers } = await import(`${WT}/lib/daemon/handlers/mr-upload.ts`);
const { createDiscussionHandlers } = await import(`${WT}/lib/daemon/handlers/discussions.ts`);
const { mkdirSync, writeFileSync } = await import("fs");

const creds = JSON.parse(await Bun.file("/Users/matt/Documents/GitHub/glance/harness_credentials.json").text());
const repo = creds.repos.find((r: { provider: string }) => r.provider === "gitlab");
const token: string = creds.users.find((u: { role: string }) => u.role === "owner").token;
const projectPath: string = repo.path_with_namespace;
const projectId: number = repo.project_id;
const baseURL = "https://gitlab.com";
const repoName = `remote:${encodeURIComponent(`gitlab.com/${projectPath}`)}`;
const stamp = Date.now().toString(36);
const branch = `rt315b-smoke-${stamp}`;
const enc = encodeURIComponent(projectPath);
const ctx = { repoIndex: () => ({ [repoName]: "/tmp/none" }), cache: undefined as any, log: console as any };
const provider = new GitLabProvider(baseURL, token);

const api = async (method: string, path: string, body?: unknown) => {
  const res = await provider.restRequest(method, path, body, "smoke");
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

const project = await api("GET", `/projects/${enc}`);
const target: string = project.default_branch;
await api("POST", `/projects/${enc}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(target)}`);
await api("POST", `/projects/${enc}/repository/commits`, {
  branch,
  commit_message: `rt315b smoke ${stamp}`,
  actions: [{ action: "create", file_path: `smoke/${stamp}.md`, content: `smoke ${stamp}\n` }],
});
console.log("branch", branch, "on", target);

const m = createMRHandlers(ctx, () => {}, { getContext: async () => ({ provider, projectPath }), writeback: () => {}, fetchSingle: async () => null });
const created = await m["mr:create"]({ repoName, sourceBranch: branch, targetBranch: target, title: `rt315b smoke ${stamp}`, labels: ["rt-smoke"], squash: true });
console.log("create", JSON.stringify(created));
if (!created.ok) process.exit(1);
const iid = created.data.iid;
const afterCreate = await api("GET", `/projects/${enc}/merge_requests/${iid}`);
console.log("after create", { labels: afterCreate.labels, squash: afterCreate.squash, draft: afterCreate.draft, title: afterCreate.title });

const updated = await m["mr:update"]({ repoName, iid, title: `rt315b smoke ${stamp} (updated)`, addLabels: ["rt-smoke-2"], removeLabels: ["rt-smoke"], squash: false });
console.log("update", JSON.stringify(updated));
const afterUpdate = await api("GET", `/projects/${enc}/merge_requests/${iid}`);
console.log("after update", { labels: afterUpdate.labels, squash: afterUpdate.squash, draft: afterUpdate.draft, title: afterUpdate.title });

const pngDir = `${SCRATCH}/smoke-upload`;
mkdirSync(pngDir, { recursive: true });
const pngPath = `${pngDir}/rt315b-${stamp}.png`;
writeFileSync(pngPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
const u = createMrUploadHandlers({ repoIndex: ctx.repoIndex, log: ctx.log }, {
  repoContext: async () => ({ provider: { baseURL }, projectPath, projectId }),
  gitlabToken: async () => token,
  worktreePaths: () => [],
});
const uploaded = await u["mr:upload"]({ repoName, path: pngPath });
console.log("upload", JSON.stringify(uploaded));
if (!uploaded.ok) process.exit(1);

const d = createDiscussionHandlers(ctx, () => {}, {
  repoContext: async () => ({ provider: { baseURL }, projectPath, projectId }),
  gitlabToken: async () => token,
  refresh: async () => undefined,
});
const note = await d["mr:comment"]({ repoName, iid, body: `rt315b smoke upload\n\n${uploaded.data.markdown}`, resolvable: false });
console.log("note", JSON.stringify(note));
const notes = await api("GET", `/projects/${enc}/merge_requests/${iid}/notes?sort=desc&order_by=created_at&per_page=1`);
console.log("last note body", notes[0]?.body);

await api("PUT", `/projects/${enc}/merge_requests/${iid}`, { state_event: "close" });
await api("DELETE", `/projects/${enc}/repository/branches/${encodeURIComponent(branch)}`);
console.log("cleaned up", { iid, branch });
```

Run: `bun /private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/bbd9c65a-7ece-4bd6-bf72-dfed5168c0dd/scratchpad/rt315b-smoke.ts`

The glance import is by absolute path, not the bare `@mattstack/glance` specifier: Bun resolves bare specifiers from the importing file's directory, so from the scratchpad it would auto-install a second copy and `instanceof ReadBackFailedError` would fail across the two. `process.env.HOME` is set before the dynamic imports because the handlers' module-scope loggers and the settings resolver bind to it. The png lands under the scratchpad, which is inside `/private/tmp/claude-501/`, so the handler's built-in temp root allows it with no `rt.mcp.uploadRoots` write. Expected:
- `create` is `ok` with an iid and `squashApplied: true`; `after create` shows `labels: ["rt-smoke"]`, `squash: true`, `draft: true`.
- `update` is `ok` with `applied: ["title", "addLabels", "removeLabels", "squash"]`; `after update` shows the new title with the draft marker still on, `labels: ["rt-smoke-2"]`, `squash: false`.
- `upload` is `ok` with a `url` starting `https://gitlab.com/` and a `markdown` starting `![`.
- `note` is `ok`, and `last note body` contains the upload markdown; opening the MR in a browser shows the image rendered (the MR is closed but readable).
- `cleaned up` prints; the branch is gone from the project.

Record the observed results for the PR body. If a step fails, the script exits before cleanup: close the MR and delete the branch by hand with the same API calls before rerunning.

- [ ] **Step 4: Push and open the PR.** Run the mattstack writing-style lookup first (`rt_verb` with `["skills","writing-style","show"]`), then compose the PR body in that style. Run `bash scripts/repo-purity.sh` before the push. Title: `mcp: mr_update, mr_upload and MR URL targets (RT-315 phase 1b)`. The body covers: target resolution (`repoName` as identity, path or label, or `mrUrl`; daemon still identity-only), `mr_create` labels/squash and the never-`ok:false` rule, `mr_update`'s two writes and partial-failure wording, `mr_upload`'s guard and `rt.mcp.uploadRoots`, the smoke results, and a note that team-pack fills switch in their own follow-up and GitHub is RT-321. It ends with the Claude Code attribution line the executing session's harness names.

- [ ] **Step 5: Review loop.** Wait for CodeRabbit's review and green CI, and address every actionable finding (commit per fix, re-run the affected tests, `bash scripts/repo-purity.sh` before every push). If CodeRabbit is rate limited, run an Opus subagent review of the branch instead; that review is the review. Merge only after Matt confirms.

- [ ] **Step 6: Deploy to the dev machine.** After `ExitWorktree` (keep), in the main checkout:
  1. `git branch --show-current` must print `main`. If it does not, stop: another lane owns the checkout.
  2. `git pull --ff-only`.
  3. `bun run --cwd packages/rt-client build`.
  4. Announce in `#rt` that the daemon is restarting for the new MR verbs (`mr:update`, `mr:upload`), then run `rt daemon restart` and `rt daemon status`.
  5. Confirm `mr_update` and `mr_upload` are listed in a fresh Claude session, and that `mr_approve` accepts `mrUrl` alone for an MR on the harness project once that project is registered with rt (the board acceptance run for RT-315 follows this deploy, per the spec).
