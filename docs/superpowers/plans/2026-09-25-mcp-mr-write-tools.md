# MCP MR Write Tools (phase 1, GitLab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every MR write that board panes and pipeline verbs make on GitLab goes through a named rt MCP tool. The skills name those tools, so no write reaches the auto-mode classifier.

**Architecture:** Seven thin MCP tools in `lib/mcp/tools.ts`, each wrapping one daemon verb. Two verbs are new: `mr:comment` in `lib/daemon/handlers/discussions.ts` and `mr:create` in `lib/daemon/handlers/mr.ts`. The other five tools reuse `mr:action` and `discussions:resolve`. Part B then points the skills in mattstack-skills and mattstack-apps at the tools.

**Tech Stack:** Bun + TypeScript, `bun:test`, `@mattstack/glance` (`NoteMutator`, `GitLabProvider`), rt-client command catalog, Markdown skills.

**Spec:** `docs/superpowers/specs/2026-09-25-mcp-mr-write-tools-design.md`

## Global Constraints

- Every new tool takes `repoName` as the serialized identity (for example `remote:gitlab.com%2Facme%2Facme-dev`). Every tool except `mr_create` also takes `iid`.
- Every write tool uses `MR_WRITE_TIMEOUT_MS` (30_000) and never retries on its own.
- No tool or verb for merge.
- Tool descriptions say "GitLab only".
- No em dashes or en dashes anywhere (code, comments, commits, docs, skills). Use "...", parens, or rephrase.
- Comments only state constraints the code cannot show. No narration, no ticket or review citations in source.
- rt-client: after touching `packages/rt-client/src/commands.ts`, run `bun run --cwd packages/rt-client build`. `packages/rt-client/test/dist-freshness.test.ts` guards this.
- Never run a built binary or a second daemon against the real `~/.mattstack`. Smoke tests call handlers directly.
- Never touch an employer GitLab project. Smoke tests use the harness test project only.
- Employer-visible repos and packs never carry `RT-315` or any mattstack ticket id. mattstack repos may.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR bodies end with the Claude Code attribution line.

## Review Focus

1. **A boolean option sent as a string.** `approved: "false"`, `ready: "false"`, `resolved: "false"` or `resolvable: "false"` must be rejected as a type error before any daemon call. It must never read as true and approve, mark ready, resolve or post resolvable. (Task 3, Task 4)
2. **A client-side timeout on `mr_comment` or `mr_create`.** The daemon may still post or create after the client gives up. The error must say the write may still land and name where to check before retrying. (Task 3)
3. **GitLab creates the MR, then the read-back fails.** glance throws `ReadBackFailedError` with `writeApplied: true`. `mr:create` must return `ok` with the created `iid` (url null), never `ok: false`, which invites a duplicate MR. (Task 2)
4. **`mr_retry` with both `jobId` and `pipelineId`, or neither.** Input error, no daemon call. (Task 4)
5. **A whitespace-only `body` or `title`.** Refused before any network call, so GitLab never gets an empty note or MR. (Task 1, Task 2)

---

# Part A: rt (this worktree, branch `rt-315-mcp-mr-write-tools`)

### Task 1: `mr:comment` daemon verb

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (the `Commands` entry after `"mr:comment-inline"`, and `COMMAND_NAMES` after `"mr:comment-inline"`)
- Modify: `lib/daemon/handlers/discussions.ts` (header list, seams, handler map type, new handler)
- Modify: `lib/daemon/__tests__/rt-client-commands.test.ts` (`WAVE_3_COMMAND_NAMES`)
- Create: `lib/daemon/__tests__/discussions-comment.test.ts`

**Interfaces:**
- Produces: `Commands["mr:comment"]` with payload `{ repoName: string; iid: number; body: string; resolvable?: boolean }` and data `{ noteId: number; discussionId: string | null; resolvable: boolean; url: string; mrUrl: string }`.
- Produces: `export type CommentMutator = Pick<NoteMutator, "createDiscussion" | "createNote">` and the seam `DiscussionHandlerSeams.commentMutator?: (baseURL: string, token: string) => CommentMutator`.

- [ ] **Step 1: Move RT-315 to In Progress in Linear** (linear-matt `save_issue`, `id: "RT-315"`, `state: "In Progress"`).

- [ ] **Step 2: Write the failing test file** `lib/daemon/__tests__/discussions-comment.test.ts`:

```ts
/**
 * mr:comment: posts one top-level note, as a resolvable discussion by
 * default or a plain note, and never reports a landed note as failed.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CreatedDiscussion, CreatedNote } from "@mattstack/glance";
import { closeStateDb } from "../../state/index.ts";
import { createDiscussionHandlers, type CommentMutator, type DiscussionHandlerSeams } from "../handlers/discussions.ts";
import { fakeStore } from "./fake-cache-store.ts";

const fakeCtx = { repoIndex: () => ({}), cache: fakeStore({}) };
const IDENTITY = "remote:gitlab.com%2Fg%2Fsub%2Frepo-tools";
const MR_URL = "https://gitlab.example.com/g/sub/repo-tools/-/merge_requests/7";

function note(id: number, resolvable: boolean | null): CreatedNote {
  return { id, resolvable, type: null } as unknown as CreatedNote;
}

function makeSeams(mutator: Partial<CommentMutator>, refresh?: DiscussionHandlerSeams["refresh"]): DiscussionHandlerSeams {
  const unexpected = async (): Promise<never> => { throw new Error("unexpected mutator call"); };
  return {
    repoContext: async () => ({ provider: { baseURL: "https://gitlab.example.com" }, projectPath: "g/sub/repo-tools", projectId: 99 }),
    gitlabToken: async () => "tok",
    commentMutator: () => ({ createDiscussion: unexpected, createNote: unexpected, ...mutator }) as CommentMutator,
    refresh: refresh ?? (async () => undefined),
  };
}

describe("mr:comment", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rt-comment-"));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("default posts a resolvable discussion and returns the note and MR urls", async () => {
    let args: unknown[] = [];
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({
      createDiscussion: async (...a) => { args = a; return { id: "d1", notes: [note(101, true)] } as CreatedDiscussion; },
    }));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "summary" });
    expect(args).toEqual([99, 7, "summary"]);
    expect(res).toEqual({
      ok: true,
      data: { noteId: 101, discussionId: "d1", resolvable: true, url: `${MR_URL}#note_101`, mrUrl: MR_URL },
    });
  });

  test("resolvable:false posts a plain note with a null discussionId", async () => {
    let args: unknown[] = [];
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({
      createNote: async (...a) => { args = a; return note(202, false); },
    }));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "summary", resolvable: false });
    expect(args).toEqual([99, 7, "summary"]);
    expect(res).toEqual({
      ok: true,
      data: { noteId: 202, discussionId: null, resolvable: false, url: `${MR_URL}#note_202`, mrUrl: MR_URL },
    });
  });

  test("resolvable reports what GitLab returned, not what was asked", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({
      createDiscussion: async () => ({ id: "d1", notes: [note(101, false)] }) as CreatedDiscussion,
    }));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "x" });
    expect(res.ok && res.data.resolvable).toBe(false);
  });

  test("a whitespace-only body is refused before any network call", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({}));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "  \n " });
    expect(res).toEqual({ ok: false, error: "missing repoName/iid/body" });
  });

  test("a fractional or non-positive iid is refused before any network call", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({}));
    expect(await h["mr:comment"]({ repoName: IDENTITY, iid: 1.5, body: "x" })).toEqual({ ok: false, error: "missing repoName/iid/body" });
    expect(await h["mr:comment"]({ repoName: IDENTITY, iid: 0, body: "x" })).toEqual({ ok: false, error: "missing repoName/iid/body" });
  });

  test("a non-boolean resolvable is refused before any network call", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({}));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "x", resolvable: "false" });
    expect(res).toEqual({ ok: false, error: "invalid resolvable" });
  });

  test("a non-identity repoName is refused the way discussions:reply refuses it", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({}));
    const res = await h["mr:comment"]({ repoName: "not-an-identity", iid: 7, body: "x" });
    expect(res).toEqual({ ok: false, error: "repo must be a serialized identity" });
  });

  test("a discussion created with no notes names the discussion it created", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({
      createDiscussion: async () => ({ id: "d9", notes: [] }) as unknown as CreatedDiscussion,
    }));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("d9");
  });

  test("a refresh throw after the post still returns ok", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(
      { createDiscussion: async () => ({ id: "d1", notes: [note(101, true)] }) as CreatedDiscussion },
      async () => { throw new Error("refresh boom"); },
    ));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "x" });
    expect(res.ok).toBe(true);
  });

  test("the refresh completes before the handler resolves", async () => {
    let refreshFinished = false;
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(
      { createDiscussion: async () => ({ id: "d1", notes: [note(101, true)] }) as CreatedDiscussion },
      async () => { await new Promise((r) => setTimeout(r, 10)); refreshFinished = true; },
    ));
    await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "x" });
    expect(refreshFinished).toBe(true);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `bun test lib/daemon/__tests__/discussions-comment.test.ts`
Expected: FAIL. `CommentMutator` is not exported and `h["mr:comment"]` is undefined.

- [ ] **Step 4: Add the catalog entry.** In `packages/rt-client/src/commands.ts`, directly after the `"mr:comment-inline": { ... };` entry:

```ts
  /** Top-level MR note. `resolvable` (default true) opens a discussion a
      human can resolve; false posts a plain note and `discussionId` is null.
      `resolvable` in the reply is what GitLab reports. Posts once, never
      retries. */
  "mr:comment": {
    payload: { repoName: string; iid: number; body: string; resolvable?: boolean };
    data: { noteId: number; discussionId: string | null; resolvable: boolean; url: string; mrUrl: string };
  };
```

In `COMMAND_NAMES`, add `"mr:comment",` directly after `"mr:comment-inline",`. In `lib/daemon/__tests__/rt-client-commands.test.ts`, add `"mr:comment",` to `WAVE_3_COMMAND_NAMES`, keeping it alphabetical (after `"mr:action",`).

- [ ] **Step 5: Implement the handler** in `lib/daemon/handlers/discussions.ts`.

In the header comment's verb list, after the `mr:comment-inline` line, add:

```ts
 *   mr:comment           - post a new top-level note (resolvable discussion or plain note)
```

After the `CommentInlineMutator` type, add:

```ts
/** The subset of NoteMutator mr:comment needs; test seam. */
export type CommentMutator = Pick<NoteMutator, "createDiscussion" | "createNote">;
```

In `DiscussionHandlerSeams`, after `mutator?`, add:

```ts
  commentMutator?: (baseURL: string, token: string) => CommentMutator;
```

In `createDiscussionHandlers`, add to the return type intersection (after the `"mr:comment-inline"` line):

```ts
  & { "mr:comment": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:comment">> }
```

After `const mutatorFn = ...`, add:

```ts
  const commentMutatorFn = seams.commentMutator ?? ((baseURL: string, token: string) => new NoteMutator(baseURL, token, providerRequestHook()));
```

After the `"mr:comment-inline"` handler, add:

```ts
    "mr:comment": async (payload) => {
      const p = payload as { repoName?: string; iid?: number; body?: string; resolvable?: unknown } | undefined;
      const iid  = p?.iid;
      const body = p?.body;
      if (!p?.repoName || typeof iid !== "number" || !Number.isInteger(iid) || iid <= 0 ||
          typeof body !== "string" || !body.trim()) {
        return { ok: false, error: "missing repoName/iid/body" };
      }
      if (p.resolvable !== undefined && typeof p.resolvable !== "boolean") {
        return { ok: false, error: "invalid resolvable" };
      }
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;

      const repoPath = ctx.repoIndex()[repoName];
      try {
        const repoCtx = await repoContextFn(repoName, repoPath);
        const token = await gitlabTokenFn();
        if (!token) return { ok: false, error: "no gitlabToken in secrets" };
        const mutator = commentMutatorFn(repoCtx.provider.baseURL, token);

        let noteId: number;
        let discussionId: string | null;
        let resolvable: boolean;
        if (p.resolvable === false) {
          const created = await mutator.createNote(repoCtx.projectId, iid, body);
          noteId = created.id;
          discussionId = null;
          resolvable = created.resolvable === true;
        } else {
          const created = await mutator.createDiscussion(repoCtx.projectId, iid, body);
          const first = created.notes[0];
          if (!first) return { ok: false, error: `GitLab created discussion ${created.id} with no notes` };
          noteId = first.id;
          discussionId = created.id;
          resolvable = first.resolvable === true;
        }

        // A refresh failure must never turn a landed note into ok:false: the
        // caller would retry and post it twice.
        await refreshFn(repoName, iid).catch((err) =>
          log.warn({ err, repoName, iid }, "mr:comment: post-comment discussions refresh failed"));

        const mrUrl = `${repoCtx.provider.baseURL}/${repoCtx.projectPath}/-/merge_requests/${iid}`;
        return { ok: true, data: { noteId, discussionId, resolvable, url: `${mrUrl}#note_${noteId}`, mrUrl } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
```

- [ ] **Step 6: Rebuild rt-client and run the tests**

Run: `bun run --cwd packages/rt-client build`
Then: `bun test lib/daemon/__tests__/discussions-comment.test.ts lib/daemon/__tests__/discussions-comment-inline.test.ts lib/daemon/__tests__/rt-client-commands.test.ts packages/rt-client`
Expected: PASS, all files.

- [ ] **Step 7: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/rt-client/src/commands.ts lib/daemon/handlers/discussions.ts lib/daemon/__tests__/discussions-comment.test.ts lib/daemon/__tests__/rt-client-commands.test.ts
git commit -m "daemon: add mr:comment for top-level MR notes (RT-315)"
```

---

### Task 2: `mr:create` daemon verb

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (`Commands` entry after `"mr:action"`, `COMMAND_NAMES` after `"mr:action"`)
- Modify: `lib/daemon/handlers/mr.ts` (header list, handler map type, new handler)
- Modify: `lib/daemon/__tests__/rt-client-commands.test.ts`
- Create: `lib/daemon/__tests__/mr-create.test.ts`

**Interfaces:**
- Produces: `Commands["mr:create"]` with payload `{ repoName: string; sourceBranch: string; targetBranch: string; title: string; description?: string; draft?: boolean }` and data `{ iid: number; url: string | null }`.
- Consumes: `MRHandlerOverrides.getContext` / `writeback` (existing).

- [ ] **Step 1: Write the failing test file** `lib/daemon/__tests__/mr-create.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { ReadBackFailedError } from "@mattstack/glance";
import { createMRHandlers } from "../handlers/mr.ts";
import { fakeStore } from "./fake-cache-store.ts";

const REPO = "remote:gitlab.com%2Fg%2Fp";
const fakeCtx = () => ({
  cache: fakeStore({}),
  repoIndex: () => ({ [REPO]: "/tmp/repo" }),
  log: { warn() {}, info() {}, debug() {}, error() {} } as any,
});
const base = { repoName: REPO, sourceBranch: "feat", targetBranch: "main", title: "Add thing" };

function harness(create: (input: any) => Promise<any>, writeback?: (repo: string, pp: string, pr: any) => void) {
  const inputs: any[] = [];
  const writebacks: any[] = [];
  const handlers = createMRHandlers(fakeCtx(), () => {}, {
    getContext: async () => ({
      provider: { createPullRequest: async (input: any) => { inputs.push(input); return create(input); } },
      projectPath: "g/p",
    }),
    writeback: writeback ?? ((repo, pp, pr) => writebacks.push({ repo, pp, iid: pr.iid })),
  });
  return { handlers, inputs, writebacks };
}

describe("mr:create", () => {
  test("defaults to draft, writes the MR back, and returns iid and url", async () => {
    const { handlers, inputs, writebacks } = harness(async () => ({ iid: 12, webUrl: "https://gitlab.com/g/p/-/merge_requests/12" }));
    const res = await handlers["mr:create"](base);
    expect(inputs).toEqual([{ projectPath: "g/p", title: "Add thing", sourceBranch: "feat", targetBranch: "main", draft: true }]);
    expect(writebacks).toEqual([{ repo: REPO, pp: "g/p", iid: 12 }]);
    expect(res).toEqual({ ok: true, data: { iid: 12, url: "https://gitlab.com/g/p/-/merge_requests/12" } });
  });

  test("draft:false and a description pass straight through", async () => {
    const { handlers, inputs } = harness(async () => ({ iid: 3, webUrl: null }));
    await handlers["mr:create"]({ ...base, draft: false, description: "why" });
    expect(inputs[0]).toMatchObject({ draft: false, description: "why" });
  });

  test("a missing or whitespace-only title or branch is refused before the provider is called", async () => {
    const { handlers, inputs } = harness(async () => { throw new Error("should not be called"); });
    for (const bad of [{ title: undefined }, { title: "  " }, { sourceBranch: "" }, { targetBranch: " " }]) {
      const res = await handlers["mr:create"]({ ...base, ...bad });
      expect(res).toEqual({ ok: false, error: "missing repoName/sourceBranch/targetBranch/title" });
    }
    expect(inputs).toEqual([]);
  });

  test("the same source and target branch is refused", async () => {
    const { handlers, inputs } = harness(async () => { throw new Error("should not be called"); });
    const res = await handlers["mr:create"]({ ...base, targetBranch: "feat" });
    expect(res).toEqual({ ok: false, error: "sourceBranch and targetBranch are the same" });
    expect(inputs).toEqual([]);
  });

  test("a non-boolean draft or non-string description is refused", async () => {
    const { handlers, inputs } = harness(async () => { throw new Error("should not be called"); });
    expect(await handlers["mr:create"]({ ...base, draft: "false" })).toEqual({ ok: false, error: "invalid draft" });
    expect(await handlers["mr:create"]({ ...base, description: 5 })).toEqual({ ok: false, error: "invalid description" });
    expect(inputs).toEqual([]);
  });

  test("a repo absent from the index is repo-unknown", async () => {
    const { handlers } = harness(async () => { throw new Error("should not be called"); });
    const res = await handlers["mr:create"]({ ...base, repoName: "remote:gitlab.com%2Fother%2Fx" });
    expect(res).toEqual({ ok: false, error: "repo-unknown" });
  });

  test("a read-back failure after the MR landed returns ok with the created iid", async () => {
    const { handlers, writebacks } = harness(async () => {
      throw new ReadBackFailedError("Created MR but failed to fetch it back", {
        operation: "createPullRequest", projectPath: "g/p", iid: 12, writeApplied: true,
      });
    });
    const res = await handlers["mr:create"](base);
    expect(res).toEqual({ ok: true, data: { iid: 12, url: null } });
    expect(writebacks).toEqual([]);
  });

  test("a write-back throw does not fail a created MR", async () => {
    const { handlers } = harness(async () => ({ iid: 12, webUrl: null }), () => { throw new Error("store boom"); });
    const res = await handlers["mr:create"](base);
    expect(res).toEqual({ ok: true, data: { iid: 12, url: null } });
  });

  test("a provider error returns ok:false with its message", async () => {
    const { handlers } = harness(async () => { throw new Error("createPullRequest failed: 409 Another open merge request already exists"); });
    const res = await handlers["mr:create"](base);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("409");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test lib/daemon/__tests__/mr-create.test.ts`
Expected: FAIL. `handlers["mr:create"]` is not a function.

- [ ] **Step 3: Add the catalog entry.** In `packages/rt-client/src/commands.ts`, directly after the `"mr:action"` entry:

```ts
  /** Creates an MR (a draft unless `draft: false`) and writes it back so the
      board sees it before the next sweep. Never retries. `url` is null when
      GitLab created the MR but reading it back failed. */
  "mr:create": {
    payload: { repoName: string; sourceBranch: string; targetBranch: string; title: string; description?: string; draft?: boolean };
    data: { iid: number; url: string | null };
  };
```

Add `"mr:create",` to `COMMAND_NAMES` after `"mr:action",`, and to `WAVE_3_COMMAND_NAMES` in `lib/daemon/__tests__/rt-client-commands.test.ts` after `"mr:comment",`.

- [ ] **Step 4: Implement the handler** in `lib/daemon/handlers/mr.ts`.

In the header comment's verb list, after the `mr:action` line, add:

```ts
 *   mr:create            - create an MR (draft by default) and write it back
```

Add to the return type intersection of `createMRHandlers`:

```ts
  & { "mr:create": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:create">> }
```

After the `"mr:action"` handler, add:

```ts
    "mr:create": async (payload) => {
      const p = payload as { sourceBranch?: unknown; targetBranch?: unknown; title?: unknown; description?: unknown; draft?: unknown } | undefined;
      const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
      const sourceBranch = p?.sourceBranch, targetBranch = p?.targetBranch, title = p?.title;
      if (!nonBlank(sourceBranch) || !nonBlank(targetBranch) || !nonBlank(title)) {
        return { ok: false, error: "missing repoName/sourceBranch/targetBranch/title" };
      }
      if (p?.description !== undefined && typeof p.description !== "string") return { ok: false, error: "invalid description" };
      if (p?.draft !== undefined && typeof p.draft !== "boolean") return { ok: false, error: "invalid draft" };
      if (sourceBranch === targetBranch) return { ok: false, error: "sourceBranch and targetBranch are the same" };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      const repoName = decoded.repo;

      try {
        const { provider, projectPath } = await contextFor(repoName);
        const pr: PullRequest = await provider.createPullRequest({
          projectPath, title, sourceBranch, targetBranch,
          draft: p?.draft !== false,
          ...(typeof p?.description === "string" && { description: p.description }),
        });
        try {
          writeback(repoName, projectPath, pr);
        } catch (err) {
          ctx.log.warn({ err, repo: repoName, iid: pr.iid }, "mr:create write-back failed");
        }
        return { ok: true, data: { iid: pr.iid, url: pr.webUrl } };
      } catch (err) {
        // The MR exists once glance reports writeApplied; ok:false here would
        // invite a second create.
        if (err instanceof ReadBackFailedError && err.writeApplied) {
          ctx.log.warn({ err, repo: repoName, iid: err.iid }, "mr:create landed but its read-back failed");
          return { ok: true, data: { iid: err.iid, url: null } };
        }
        return { ok: false, error: String(err) };
      }
    },
```

- [ ] **Step 5: Rebuild rt-client and run the tests**

Run: `bun run --cwd packages/rt-client build`
Then: `bun test lib/daemon/__tests__/mr-create.test.ts lib/daemon/__tests__/mr-writeback.test.ts lib/daemon/__tests__/rt-client-commands.test.ts packages/rt-client`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors. If `description` spreads as `false` in the input type, replace the spread with an explicit `if` on a mutable input object.

- [ ] **Step 7: Commit**

```bash
git add packages/rt-client/src/commands.ts lib/daemon/handlers/mr.ts lib/daemon/__tests__/mr-create.test.ts lib/daemon/__tests__/rt-client-commands.test.ts
git commit -m "daemon: add mr:create (RT-315)"
```

---

### Task 3: `mr_comment` and `mr_create` MCP tools

**Files:**
- Modify: `lib/mcp/tools.ts`
- Modify: `lib/mcp/__tests__/tools.test.ts`
- Modify: `e2e/tests/mcp-serve.test.ts` (`EXPECTED_TOOL_NAMES`)

**Interfaces:**
- Consumes: `Commands["mr:comment"]`, `Commands["mr:create"]` (Tasks 1 and 2).
- Produces, in `lib/mcp/tools.ts` (module-private, used again in Task 4):
  - `REPO_NAME_RULE: string`
  - `checkOptional(input, fields: Array<{ name: string; type: "string" | "number" | "boolean" }>): string | undefined`
  - `withLandingHint(res: ToolResult, check: string): ToolResult`

- [ ] **Step 1: Write the failing tests.** In `lib/mcp/__tests__/tools.test.ts`:

Replace the `NAMES` line with:

```ts
const NAMES = ["gate_answer","gate_ask","gate_list","chat_post","chat_dm","chat_ack","chat_claim","chat_release","mr_reply_thread","mr_comment_inline","mr_comment","mr_create","mr_map","herd_gates","herd_ask","herd_answer","herd_report","rt_verb"];
```

Change the `roster has 16 tools` test to:

```ts
  test("roster has 18 tools", () => {
    expect(mcpTools().length).toBe(18);
  });
```

In `every mr tool's repo-arg description names the serialized identity form`, add these entries to `repoArgTools`:

```ts
      { name: "mr_comment", field: "repoName" },
      { name: "mr_create", field: "repoName" },
```

Add this block before the `describe("mr_map", ...)` block:

```ts
  describe("mr write tools: mr_comment, mr_create", () => {
    afterEach(() => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: realRtCommand }));
    });

    function fakeDaemon(reply: (cmd: string, payload: Record<string, unknown>) => unknown) {
      const calls: Array<{ cmd: string; payload: Record<string, unknown>; timeoutMs?: number }> = [];
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string, payload: Record<string, unknown>, opts?: { timeoutMs?: number }) => {
          calls.push({ cmd, payload, timeoutMs: opts?.timeoutMs });
          return reply(cmd, payload);
        },
      }));
      return calls;
    }

    const COMMENT_DATA = { noteId: 1, discussionId: "d1", resolvable: true, url: "u#note_1", mrUrl: "u" };

    test("mr_comment schema requires repoName, iid, body and allows only resolvable beside them", () => {
      const schema = mcpTools().find((t) => t.name === "mr_comment")!.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
      expect(schema.required).toEqual(["repoName", "iid", "body"]);
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["body", "iid", "repoName", "resolvable"]);
    });

    test("mr_comment sends mr:comment with the write timeout and returns the daemon's data", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: COMMENT_DATA }));
      const tool = mcpTools().find((t) => t.name === "mr_comment")!;
      const res = await tool.handler({ repoName: "remote:x", iid: 7, body: "hi" }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: true, body: COMMENT_DATA });
      expect(calls).toEqual([{ cmd: "mr:comment", payload: { repoName: "remote:x", iid: 7, body: "hi" }, timeoutMs: 30_000 }]);
    });

    test("mr_comment forwards resolvable:false", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: COMMENT_DATA }));
      const tool = mcpTools().find((t) => t.name === "mr_comment")!;
      await tool.handler({ repoName: "remote:x", iid: 7, body: "hi", resolvable: false }, {} as NodeJS.ProcessEnv);
      expect(calls[0]!.payload.resolvable).toBe(false);
    });

    test("mr_comment refuses a string resolvable before calling the daemon", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: COMMENT_DATA }));
      const tool = mcpTools().find((t) => t.name === "mr_comment")!;
      const res = await tool.handler({ repoName: "remote:x", iid: 7, body: "hi", resolvable: "false" }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: false, body: undefined, error: '"resolvable" must be a boolean' });
      expect(calls).toEqual([]);
    });

    test("a timed-out mr_comment says the note may still land and where to check", async () => {
      fakeDaemon(() => ({ ok: false, error: "rt daemon unreachable at /x.sock: The operation timed out." }));
      const tool = mcpTools().find((t) => t.name === "mr_comment")!;
      const res = await tool.handler({ repoName: "remote:x", iid: 7, body: "hi" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("may still land");
      expect(res.error).toContain("discussions");
    });

    test("a daemon error that is not a timeout passes through without the landing hint", async () => {
      fakeDaemon(() => ({ ok: false, error: "no gitlabToken in secrets" }));
      const tool = mcpTools().find((t) => t.name === "mr_comment")!;
      const res = await tool.handler({ repoName: "remote:x", iid: 7, body: "hi" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe("no gitlabToken in secrets");
    });

    test("mr_create schema requires the branches and title and has no iid", () => {
      const schema = mcpTools().find((t) => t.name === "mr_create")!.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
      expect(schema.required).toEqual(["repoName", "sourceBranch", "targetBranch", "title"]);
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["description", "draft", "repoName", "sourceBranch", "targetBranch", "title"]);
    });

    test("mr_create sends mr:create, leaving draft to the daemon default when omitted", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: { iid: 12, url: "u" } }));
      const tool = mcpTools().find((t) => t.name === "mr_create")!;
      const res = await tool.handler({ repoName: "remote:x", sourceBranch: "feat", targetBranch: "main", title: "T" }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: true, body: { iid: 12, url: "u" } });
      expect(calls).toEqual([{ cmd: "mr:create", payload: { repoName: "remote:x", sourceBranch: "feat", targetBranch: "main", title: "T" }, timeoutMs: 30_000 }]);
    });

    test("mr_create refuses a string draft before calling the daemon", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: { iid: 12, url: "u" } }));
      const tool = mcpTools().find((t) => t.name === "mr_create")!;
      const res = await tool.handler({ repoName: "remote:x", sourceBranch: "feat", targetBranch: "main", title: "T", draft: "true" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe('"draft" must be a boolean');
      expect(calls).toEqual([]);
    });

    test("a timed-out mr_create says the MR may still land and to check mr_map", async () => {
      fakeDaemon(() => ({ ok: false, error: "rt daemon unreachable at /x.sock: The operation timed out." }));
      const tool = mcpTools().find((t) => t.name === "mr_create")!;
      const res = await tool.handler({ repoName: "remote:x", sourceBranch: "feat", targetBranch: "main", title: "T" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toContain("may still land");
      expect(res.error).toContain("mr_map");
    });
  });
```

In `e2e/tests/mcp-serve.test.ts`, change the mr line of `EXPECTED_TOOL_NAMES` to:

```ts
  "mr_comment", "mr_comment_inline", "mr_create", "mr_map", "mr_reply_thread",
```

- [ ] **Step 2: Run the unit tests and confirm they fail**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Expected: FAIL on the roster tests and every `mr_comment`/`mr_create` test (tool not found).

- [ ] **Step 3: Implement.** In `lib/mcp/tools.ts`:

After `checkRequired`, add:

```ts
/** Optional fields get the same check: a string "false" must never read as true. */
function checkOptional(input: Record<string, unknown>, fields: Array<{ name: string; type: "string" | "number" | "boolean" }>): string | undefined {
  for (const f of fields) {
    const v = input[f.name];
    if (v !== undefined && typeof v !== f.type) return `"${f.name}" must be a ${f.type}`;
  }
  return undefined;
}
```

Replace the `MR_WRITE_TIMEOUT_MS` doc comment and add the two helpers after it:

```ts
/** Matches lib/daemon-client.ts's DISCUSSIONS_TIMEOUT_MS: a GitLab write is
    slower than rtCommand's 15s default, and a client-side abort here would
    still leave the daemon writing, so a retry would duplicate the write.
    Shared by every mr write tool for that reason. */
const MR_WRITE_TIMEOUT_MS = 30_000;

const REPO_NAME_RULE = "repoName must be the repo's serialized identity (e.g. remote:gitlab.com%2Facme%2Facme-dev), not a bare host/path or display name.";

/** A timed-out create or post may still land daemon-side (see MR_WRITE_TIMEOUT_MS). */
function withLandingHint(res: ToolResult, check: string): ToolResult {
  if (res.ok || !/timed out/i.test(res.error ?? "")) return res;
  return err(`${res.error}; the write may still land, so check ${check} before retrying`);
}
```

In the `mr_reply_thread` and `mr_comment_inline` descriptions, replace the trailing identity sentence with `${REPO_NAME_RULE}` (template literal), so every mr tool shares one wording.

After the `mr_comment_inline` tool, add:

```ts
    {
      name: "mr_comment",
      description: `GitLab only. Post a NEW top-level note on an MR: a review's summary, or anything with no diff line to anchor to. resolvable (default true) opens a discussion a human can resolve; false posts a plain note, for a summary that carries nothing to resolve. Posts once and never retries. Returns noteId, discussionId (null for a plain note), resolvable as GitLab reports it, url (the note) and mrUrl. Use mr_comment_inline for a diff line and mr_reply_thread for an existing thread. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          repoName: { type: "string" },
          iid: { type: "number" },
          body: { type: "string" },
          resolvable: { type: "boolean" },
        },
        required: ["repoName", "iid", "body"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [
          { name: "repoName", type: "string" },
          { name: "iid", type: "number" },
          { name: "body", type: "string" },
        ]) ?? checkOptional(input, [{ name: "resolvable", type: "boolean" }]);
        if (bad) return err(bad);
        const payload: Commands["mr:comment"]["payload"] = {
          repoName: input.repoName as string,
          iid: input.iid as number,
          body: input.body as string,
        };
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
          repoName: { type: "string" },
          sourceBranch: { type: "string" },
          targetBranch: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          draft: { type: "boolean" },
        },
        required: ["repoName", "sourceBranch", "targetBranch", "title"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [
          { name: "repoName", type: "string" },
          { name: "sourceBranch", type: "string" },
          { name: "targetBranch", type: "string" },
          { name: "title", type: "string" },
        ]) ?? checkOptional(input, [{ name: "description", type: "string" }, { name: "draft", type: "boolean" }]);
        if (bad) return err(bad);
        const payload: Commands["mr:create"]["payload"] = {
          repoName: input.repoName as string,
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
```

- [ ] **Step 4: Run the unit tests and confirm they pass**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the MCP e2e file**

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/mcp-serve.test.ts`
Expected: PASS (the roster assertion sees both new tools).

- [ ] **Step 6: Typecheck, then commit**

Run: `bunx tsc --noEmit` (expect no errors).

```bash
git add lib/mcp/tools.ts lib/mcp/__tests__/tools.test.ts e2e/tests/mcp-serve.test.ts
git commit -m "mcp: add mr_comment and mr_create (RT-315)"
```

---

### Task 4: `mr_approve`, `mr_resolve_thread`, `mr_ready`, `mr_retry`, `mr_rebase` tools, plus docs

**Files:**
- Modify: `lib/mcp/tools.ts`
- Modify: `lib/mcp/__tests__/tools.test.ts`
- Modify: `e2e/tests/mcp-serve.test.ts`
- Modify: `website/docs/guides/mcp.mdx` (the `### MR` section)
- Modify: `AGENTS.md` (the "Gates and the `rt_verb` MCP tool" section)

**Interfaces:**
- Consumes: `REPO_NAME_RULE`, `checkOptional`, `MR_WRITE_TIMEOUT_MS` (Task 3); existing daemon verbs `mr:action` (flat `{ok:true}` reply) and `discussions:resolve`.
- Produces: module-private `runMrAction(input, action, args, body): Promise<ToolResult>`.

- [ ] **Step 1: Write the failing tests.** In `lib/mcp/__tests__/tools.test.ts`:

Replace `NAMES` with:

```ts
const NAMES = ["gate_answer","gate_ask","gate_list","chat_post","chat_dm","chat_ack","chat_claim","chat_release","mr_reply_thread","mr_comment_inline","mr_comment","mr_create","mr_approve","mr_resolve_thread","mr_ready","mr_retry","mr_rebase","mr_map","herd_gates","herd_ask","herd_answer","herd_report","rt_verb"];
```

Change the roster count test to `roster has 23 tools` / `toBe(23)`. Add to `repoArgTools`:

```ts
      { name: "mr_approve", field: "repoName" },
      { name: "mr_resolve_thread", field: "repoName" },
      { name: "mr_ready", field: "repoName" },
      { name: "mr_retry", field: "repoName" },
      { name: "mr_rebase", field: "repoName" },
```

Add this block after the `mr write tools: mr_comment, mr_create` block:

```ts
  describe("mr state tools over mr:action and discussions:resolve", () => {
    afterEach(() => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: realRtCommand }));
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

    const T = { repoName: "remote:x", iid: 7 };
    const cases: Array<{ tool: string; input: Record<string, unknown>; action: string; args: unknown[]; body: unknown }> = [
      { tool: "mr_approve", input: {}, action: "approve", args: [], body: { approved: true } },
      { tool: "mr_approve", input: { approved: false }, action: "unapprove", args: [], body: { approved: false } },
      { tool: "mr_ready", input: {}, action: "toggleDraft", args: [false], body: { ready: true } },
      { tool: "mr_ready", input: { ready: false }, action: "toggleDraft", args: [true], body: { ready: false } },
      { tool: "mr_retry", input: { jobId: 812 }, action: "retryJob", args: [812], body: { jobId: 812 } },
      { tool: "mr_retry", input: { pipelineId: 555 }, action: "retryPipeline", args: [555], body: { pipelineId: 555 } },
      { tool: "mr_rebase", input: {}, action: "rebase", args: [], body: { rebased: true } },
    ];

    for (const c of cases) {
      test(`${c.tool} ${JSON.stringify(c.input)} sends mr:action ${c.action} ${JSON.stringify(c.args)}`, async () => {
        const calls = fakeDaemon();
        const tool = mcpTools().find((t) => t.name === c.tool)!;
        const res = await tool.handler({ ...T, ...c.input }, {} as NodeJS.ProcessEnv);
        expect(res).toEqual({ ok: true, body: c.body });
        expect(calls).toEqual([{ cmd: "mr:action", payload: { ...T, action: c.action, args: c.args }, timeoutMs: 30_000 }]);
      });
    }

    for (const [tool, field] of [["mr_approve", "approved"], ["mr_ready", "ready"], ["mr_resolve_thread", "resolved"]] as const) {
      test(`${tool} refuses ${field}: "false" before calling the daemon`, async () => {
        const calls = fakeDaemon();
        const t = mcpTools().find((x) => x.name === tool)!;
        const res = await t.handler({ ...T, discussionId: "d1", [field]: "false" }, {} as NodeJS.ProcessEnv);
        expect(res.error).toBe(`"${field}" must be a boolean`);
        expect(calls).toEqual([]);
      });
    }

    test("mr_retry refuses both ids and neither id before calling the daemon", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_retry")!;
      const both = await tool.handler({ ...T, jobId: 1, pipelineId: 2 }, {} as NodeJS.ProcessEnv);
      const neither = await tool.handler({ ...T }, {} as NodeJS.ProcessEnv);
      expect(both.error).toBe('pass exactly one of "jobId" or "pipelineId"');
      expect(neither.error).toBe('pass exactly one of "jobId" or "pipelineId"');
      expect(calls).toEqual([]);
    });

    test("mr_retry refuses a string jobId", async () => {
      const calls = fakeDaemon();
      const tool = mcpTools().find((t) => t.name === "mr_retry")!;
      const res = await tool.handler({ ...T, jobId: "812" }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe('"jobId" must be a number');
      expect(calls).toEqual([]);
    });

    test("an mr:action daemon error is explained, not returned as a bare code", async () => {
      fakeDaemon(() => ({ ok: false, error: "repo-unknown" }));
      const tool = mcpTools().find((t) => t.name === "mr_approve")!;
      const res = await tool.handler({ ...T }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).not.toBe("repo-unknown");
      expect(res.error).toContain("unknown repo");
    });

    test("mr_resolve_thread resolves by default and returns a compact body, not the discussions list", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: { discussions: [{ id: "d1" }], fetchedAt: 1 } }));
      const tool = mcpTools().find((t) => t.name === "mr_resolve_thread")!;
      const res = await tool.handler({ ...T, discussionId: "d1" }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: true, body: { discussionId: "d1", resolved: true } });
      expect(calls).toEqual([{ cmd: "discussions:resolve", payload: { ...T, discussionId: "d1", resolved: true }, timeoutMs: 30_000 }]);
    });

    test("mr_resolve_thread resolved:false unresolves", async () => {
      const calls = fakeDaemon(() => ({ ok: true, data: { discussions: [], fetchedAt: 1 } }));
      const tool = mcpTools().find((t) => t.name === "mr_resolve_thread")!;
      const res = await tool.handler({ ...T, discussionId: "d1", resolved: false }, {} as NodeJS.ProcessEnv);
      expect(res).toEqual({ ok: true, body: { discussionId: "d1", resolved: false } });
      expect(calls[0]!.payload.resolved).toBe(false);
    });
  });
```

In `e2e/tests/mcp-serve.test.ts`, change the mr line of `EXPECTED_TOOL_NAMES` to:

```ts
  "mr_approve", "mr_comment", "mr_comment_inline", "mr_create", "mr_map", "mr_ready", "mr_rebase", "mr_reply_thread", "mr_resolve_thread", "mr_retry",
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Expected: FAIL (the five tools are missing).

- [ ] **Step 3: Implement.** In `lib/mcp/tools.ts`, after `withLandingHint`:

```ts
type MrActionName = Commands["mr:action"]["payload"]["action"];

const MR_TARGET_FIELDS: Array<{ name: string; type: FieldType }> = [
  { name: "repoName", type: "string" },
  { name: "iid", type: "number" },
];

/** mr:action replies a bare {ok:true}, so each tool names its own result body. */
async function runMrAction(input: Record<string, unknown>, action: MrActionName, args: unknown[], body: unknown): Promise<ToolResult> {
  const res = await rtCommand<Commands["mr:action"]["data"]>("mr:action", {
    repoName: input.repoName as string,
    iid: input.iid as number,
    action,
    args,
  }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
  return res.ok ? ok(body) : err(explainError(res.error ?? "request failed"));
}
```

After the `mr_create` tool, add:

```ts
    {
      name: "mr_approve",
      description: `GitLab only. Approve an MR as the token's user, or withdraw that approval with approved: false. Call it only once approving is decided (a review's Approve disposition, after its findings have posted). ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { repoName: { type: "string" }, iid: { type: "number" }, approved: { type: "boolean" } },
        required: ["repoName", "iid"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, MR_TARGET_FIELDS) ?? checkOptional(input, [{ name: "approved", type: "boolean" }]);
        if (bad) return err(bad);
        const approved = input.approved !== false;
        return runMrAction(input, approved ? "approve" : "unapprove", [], { approved });
      },
    },
    {
      name: "mr_resolve_thread",
      description: `GitLab only. Resolve an MR discussion thread, or reopen it with resolved: false. Post any reply first with mr_reply_thread; resolving does not post. Returns {discussionId, resolved}. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { repoName: { type: "string" }, iid: { type: "number" }, discussionId: { type: "string" }, resolved: { type: "boolean" } },
        required: ["repoName", "iid", "discussionId"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, [...MR_TARGET_FIELDS, { name: "discussionId", type: "string" }])
          ?? checkOptional(input, [{ name: "resolved", type: "boolean" }]);
        if (bad) return err(bad);
        const discussionId = input.discussionId as string;
        const resolved = input.resolved !== false;
        const res = await rtCommand<Commands["discussions:resolve"]["data"]>("discussions:resolve", {
          repoName: input.repoName as string,
          iid: input.iid as number,
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
        properties: { repoName: { type: "string" }, iid: { type: "number" }, ready: { type: "boolean" } },
        required: ["repoName", "iid"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, MR_TARGET_FIELDS) ?? checkOptional(input, [{ name: "ready", type: "boolean" }]);
        if (bad) return err(bad);
        const ready = input.ready !== false;
        return runMrAction(input, "toggleDraft", [!ready], { ready });
      },
    },
    {
      name: "mr_retry",
      description: `GitLab only. Retry one CI job (jobId) or a whole pipeline (pipelineId) on an MR; pass exactly one. iid names the MR whose state is refreshed afterward. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { repoName: { type: "string" }, iid: { type: "number" }, jobId: { type: "number" }, pipelineId: { type: "number" } },
        required: ["repoName", "iid"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, MR_TARGET_FIELDS)
          ?? checkOptional(input, [{ name: "jobId", type: "number" }, { name: "pipelineId", type: "number" }]);
        if (bad) return err(bad);
        const hasJob = input.jobId !== undefined;
        if (hasJob === (input.pipelineId !== undefined)) return err('pass exactly one of "jobId" or "pipelineId"');
        return hasJob
          ? runMrAction(input, "retryJob", [input.jobId], { jobId: input.jobId })
          : runMrAction(input, "retryPipeline", [input.pipelineId], { pipelineId: input.pipelineId });
      },
    },
    {
      name: "mr_rebase",
      description: `GitLab only. Ask GitLab to rebase the MR's source branch onto its target server-side (no checkout). GitLab accepts the request and rebases asynchronously, so re-read the MR before assuming the rebase finished or succeeded. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { repoName: { type: "string" }, iid: { type: "number" } },
        required: ["repoName", "iid"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkRequired(input, MR_TARGET_FIELDS);
        if (bad) return err(bad);
        return runMrAction(input, "rebase", [], { rebased: true });
      },
    },
```

- [ ] **Step 4: Run the unit and e2e MCP tests**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Then: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/mcp-serve.test.ts`
Expected: PASS both.

- [ ] **Step 5: Update the docs.** In `website/docs/guides/mcp.mdx`, replace the `### MR` table and the paragraph under it with:

```mdx
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
| `mr_create` | Create an MR from a pushed branch, as a draft by default (GitLab only). |
| `mr_map` | List open MRs joined to the local worktrees holding their branches. |

Every `mr_*` write tool takes the repo's serialized identity as `repoName` (e.g. `remote:gitlab.com%2Facme%2Facme-dev`), not a bare host/path. `mr_map` also accepts the short repo-label alias. There is no merge tool.
```

- [ ] **Step 6: Add the AGENTS.md rule.** In `AGENTS.md`, section "## Gates and the `rt_verb` MCP tool", insert this paragraph after the first paragraph (the one ending "is a permission grant on every estate machine."):

```markdown
The `mr_*` tools in the same file are the rest of that grant.
`mcp__plugin_mattstack_mattstack` is in `BASE_PERMISSIONS`, so every tool on
the server runs on every estate machine with no permission check, and a new
`mr_*` tool is a forge write any agent can make unasked. They cover what
board panes and pipeline verbs write (notes, approvals, resolves, draft
state, retries, rebase, create). Merge, and anything equally irreversible,
stays off the server so the classifier or a human stays in front of it.
```

- [ ] **Step 7: Typecheck, scan for dashes, commit**

Run: `bunx tsc --noEmit` (expect no errors).
Run: `rg -n '—|–' lib/mcp/tools.ts website/docs/guides/mcp.mdx AGENTS.md lib/daemon/handlers/mr.ts lib/daemon/handlers/discussions.ts`. Expect no matches in lines this branch added. Check with `git diff main -U0 | rg '^\+.*(—|–)'`, which should print nothing.

```bash
git add lib/mcp/tools.ts lib/mcp/__tests__/tools.test.ts e2e/tests/mcp-serve.test.ts website/docs/guides/mcp.mdx AGENTS.md
git commit -m "mcp: add mr_approve, mr_resolve_thread, mr_ready, mr_retry, mr_rebase (RT-315)"
```

---

### Task 5: Verify, smoke against real GitLab, ship the rt PR, deploy to the dev machine

**Files:**
- Create (scratch, never committed): `/private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/bbd9c65a-7ece-4bd6-bf72-dfed5168c0dd/scratchpad/rt315-smoke.ts`

- [ ] **Step 1: Full suites, captured once**

Run: `bun run test:all > /private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/bbd9c65a-7ece-4bd6-bf72-dfed5168c0dd/scratchpad/test-all.log 2>&1; echo "exit=$?"`
Then: `tail -40 /private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/bbd9c65a-7ece-4bd6-bf72-dfed5168c0dd/scratchpad/test-all.log`
Expected: exit 0. If anything fails, check whether it also fails on clean `main` before calling it pre-existing (full-suite flakes rotate). Re-run the failing file alone.

- [ ] **Step 2: Typecheck and picker gate**

Run: `bunx tsc --noEmit`, then `bun run picker:check`.
Expected: both clean.

- [ ] **Step 3: Pre-merge API smoke against the harness GitLab project.** The project is `m4tthew-dev/glance-test-repo` (project id `79691134`, `repos[0]` in `/Users/matt/Documents/GitHub/glance/harness_credentials.json`). Post as the `owner` user (`users[0]`) and never print a token. Push two throwaway branches off its default branch through a scratch clone in the scratchpad. Open one MR by hand (the target for the comments). Leave the second branch for `mr:create`. Write `/private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/bbd9c65a-7ece-4bd6-bf72-dfed5168c0dd/scratchpad/rt315-smoke.ts`:

```ts
import { GitLabProvider } from "@mattstack/glance";
import { createDiscussionHandlers } from "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/galadriel/lib/daemon/handlers/discussions.ts";
import { createMRHandlers } from "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/galadriel/lib/daemon/handlers/mr.ts";

const creds = JSON.parse(await Bun.file("/Users/matt/Documents/GitHub/glance/harness_credentials.json").text());
const repo = creds.repos.find((r: { provider: string }) => r.provider === "gitlab");
const token: string = creds.users.find((u: { role: string }) => u.role === "owner").token;
const projectPath: string = repo.path_with_namespace;
const projectId: number = repo.project_id;
const baseURL = "https://gitlab.com";
const repoName = `remote:${encodeURIComponent(`gitlab.com/${projectPath}`)}`;
const iid = Number(process.argv[2]);
const ctx = { repoIndex: () => ({ [repoName]: "/tmp/none" }), cache: undefined as any, log: console as any };

const d = createDiscussionHandlers(ctx, () => {}, {
  repoContext: async () => ({ provider: { baseURL }, projectPath, projectId }),
  gitlabToken: async () => token,
  refresh: async () => undefined,
});
console.log("resolvable", await d["mr:comment"]({ repoName, iid, body: "rt315 smoke: resolvable" }));
console.log("plain", await d["mr:comment"]({ repoName, iid, body: "rt315 smoke: plain", resolvable: false }));

const provider = new GitLabProvider(baseURL, token);
const m = createMRHandlers(ctx, () => {}, {
  getContext: async () => ({ provider, projectPath }),
  writeback: () => {},
  fetchSingle: async () => null,
});
console.log("create", await m["mr:create"]({ repoName, sourceBranch: process.argv[3]!, targetBranch: process.argv[4]!, title: "rt315 smoke create" }));
```

Run it from the worktree root, so `@mattstack/glance` resolves: `bun /private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/bbd9c65a-7ece-4bd6-bf72-dfed5168c0dd/scratchpad/rt315-smoke.ts <iid> <second branch> <default branch>`. Expected:
- `resolvable` returns `resolvable: true` and a discussionId.
- `plain` returns `resolvable: false` and a null discussionId.
- Both `url` values open the exact notes in a browser.
- `create` returns an iid, and the new MR is a draft.

Then close both smoke MRs and delete their branches. Record the observed results for the PR body.

- [ ] **Step 4: Push and open the PR.** Run the mattstack writing-style lookup first (`rt_verb` with `["skills","writing-style","show"]`), then compose the PR body in that style. The title is `mcp: MR write tools so board posting skips the classifier (RT-315)`. The body covers the tools, the two new verbs, the merge exclusion, the smoke results, and a phase-2 note. It ends with the Claude Code attribution line.

- [ ] **Step 5: Review loop.** Wait for CodeRabbit's review and green CI, and address every actionable finding (commit per fix, re-run the affected tests). If CodeRabbit is rate limited, run an Opus subagent review of the branch instead; that review is the review. Merge only after Matt confirms.

- [ ] **Step 6: Deploy to the dev machine.** After `ExitWorktree` (keep), in the main checkout:
  1. `git branch --show-current` must print `main`. If it doesn't, stop: another lane owns the checkout.
  2. `git pull --ff-only`.
  3. `bun run --cwd packages/rt-client build`.
  4. Announce in `#rt` that the daemon is restarting for new MR verbs, then run `rt daemon restart` and `rt daemon status`.
  5. Confirm the new tools are listed in a fresh Claude session.

---

# Part B: skills (after Task 5's merge and deploy)

Part B runs from a session whose cwd is the target repo (use `rt:herdr-inject` to `/cd` there), in a worktree of that repo. The controller executes it inline, not through SDD, because writing-skills' baseline and verification runs need fresh subagents the controller spawns. Every skill edit loads `superpowers:writing-skills` and `mattstack:editing-skills` first. Each skill change needs a RED baseline (a fresh agent given the unchanged skill and a GitLab board scenario improvises `glab` shell) before the edit, and a GREEN rerun after it. Record both under `docs/superpowers/tests/2026-09-25-mcp-mr-tools/red-green.md` in mattstack-skills.

New skill text states current mechanics only: it names the tools. It never narrates the old `glab` way. The GREEN runs decide whether a rationalization-closing line is needed.

### Task 6: Review cluster (mattstack-skills)

**Files:**
- Modify: `attachments/review/review/SKILL.md` (the "Posting mechanics" paragraph after `{{include:review-posting}}`)
- Modify: `attachments/review-posting/SKILL.md` (Close HARD-GATE, its red-flag row, its quick-reference row)
- Modify: `attachments/review/receive-review/SKILL.md` (the sentence "Posting mechanics belong to the forge CLI and the adapter.")
- Create: `docs/superpowers/tests/2026-09-25-mcp-mr-tools/red-green.md`

- [ ] **Step 1: RED baseline.** Run a fresh agent on the unchanged compiled review verb. Scenario: a GitLab MR, a decided selection with one anchored finding and one unanchored finding, disposition Approve. Record the commands it plans for the summary and the approve. Run a second fresh agent on receive-review with two threads answered `post:` + `resolve:`, and record how it resolves.

- [ ] **Step 2: Edit review's Posting mechanics paragraph** to this text:

```markdown
Posting mechanics on GitLab: a positioned inline comment is the
`mr_comment_inline` tool, a thread reply is `mr_reply_thread`, the summary
is ONE `mr_comment`, and the Approve disposition is `mr_approve` once the
findings have posted. The summary posts resolvable (the default) when its
issue list carries a selected finding with no `file` anchor, and with
`resolvable: false` when it carries none. The daemon verifies DiffNote
placement and, on the silent general-note degrade, retries ONCE with fresh
diff_refs (deleting the stray notes; it cannot fix a position GitLab
rejects outright), so never hand-build a `glab api` position payload.
`mr_comment` returns `mrUrl`, the link the close needs.
```

- [ ] **Step 3: Edit review-posting's Close HARD-GATE.** Change "read from the forge CLI -- never hand-assembled" to "read from the forge (the `mrUrl` a posting tool returned, or the forge CLI) -- never hand-assembled". Update the matching red-flag row ("read from the forge CLI") and quick-reference row the same way.

- [ ] **Step 4: Edit receive-review.** Replace "Posting mechanics belong to the forge CLI and the adapter." with:

```markdown
On GitLab a reply posts with the `mr_reply_thread` tool and a resolve is
`mr_resolve_thread`, after its reply when both are picked; on other forges
posting mechanics belong to the forge CLI and the adapter.
```

- [ ] **Step 5: GREEN.** Re-run both scenarios with fresh agents against the edited text. The review agent must plan `mr_comment_inline`, then `mr_comment` (resolvable, since an unanchored finding is present), then `mr_approve`, with no shell posting. The receive-review agent must plan `mr_reply_thread` then `mr_resolve_thread`. Record both. If an agent still reaches for `glab`, add the one line that closes the rationalization it gave, then re-run.

- [ ] **Step 6: Certify and commit.** Run `sh tests/certify.sh attachments/review/review`, `sh tests/certify.sh attachments/review-posting` and `sh tests/certify.sh attachments/review/receive-review`, and add the rows `CERTIFICATION.md` requires. Commit: `review: post summary, approve, resolve through rt MR tools (RT-315)`.

### Task 7: Pipeline cluster (mattstack-skills)

**Files:**
- Modify: `attachments/pipeline/ship/SKILL.md` (§2 generic path, §3 "Yes:" line)
- Modify: `attachments/pipeline/stage-ship/SKILL.md` ("Forge-host rule" section)
- Modify: `attachments/pipeline/watch-ci/SKILL.md` (triage retry sentence in the forge-bound launch paragraph, mark-ready "Yes:" line)
- Modify: `attachments/pipeline/stage-watch-ci/SKILL.md` (triage retry sentence, `ci` gate "Retry:" clause, mark-ready "Yes:" line)
- Modify: `docs/superpowers/tests/2026-09-25-mcp-mr-tools/red-green.md`

- [ ] **Step 1: RED baseline.** Run fresh agents on ship's generic path (GitLab origin), on a watch-ci exit-1 triage report with one INFRA job (`id 812`), and on a mark-ready Yes. Record the commands.

- [ ] **Step 2: Edit ship §2 generic path.** The create sentence becomes:

```markdown
Push with `git push -u origin <branch>`, then create the MR/PR against the
repo's default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`,
minus `origin/`): on GitLab the `mr_create` tool (`draft: false` only when
the gate said ready; write the title from the branch's commits), on GitHub
`gh pr create --fill --draft` (drop the draft flag when the gate said
ready). Print the URL.
```

Ship §3's "Yes:" line becomes: "Yes: the `mr_ready` tool on GitLab, `gh pr ready <number>` on GitHub, per the forge-host rule above."

- [ ] **Step 3: Edit stage-ship's Forge-host rule.** "A GitLab host means `glab` (`glab mr create`, `glab mr update <iid> --ready`)" becomes "A GitLab host means rt's MR tools (`mr_create`, `mr_ready`)". The GitHub half is unchanged.

- [ ] **Step 4: Edit watch-ci and stage-watch-ci.**
  - The triage sentence "retry each INFRA-verdict blocking failure once with the retry command the report prints" becomes "retry each INFRA-verdict blocking failure once (on GitLab the `mr_retry` tool with `jobId` set to the job's `id` in the report; elsewhere the retry command the report prints)".
  - stage-watch-ci's `ci` gate clause "Retry: the report's retry command, relaunch the watcher." becomes "Retry: `mr_retry` on GitLab (the report's job `id`), else the report's retry command; relaunch the watcher."
  - In both files, the mark-ready "GitLab means `glab mr update <iid> --ready`" becomes "GitLab means the `mr_ready` tool".

- [ ] **Step 5: GREEN.** Re-run the three scenarios with fresh agents and confirm each plans the tool, not shell. Record the results.

- [ ] **Step 6: Certify, bump, commit.** Run `sh tests/certify.sh` on each edited attachment and add the CERTIFICATION rows. Bump `.claude-plugin/plugin.json` `version` to the next minor from what `main` holds at that moment (other sessions bump too, so re-read it). Commit the bump with this task's edits: `pipeline: create, ready, retry through rt MR tools (RT-315)`.

### Task 8: Doctor (mattstack-apps)

**Files:**
- Modify: `apps/board/skills/doctor/SKILL.md` (generic-path bullet under "If no domain skill resolved", API tier's first bullet)

- [ ] **Step 1: RED baseline.** Run a fresh agent on the unchanged doctor skill, `--tier api --fix-classes retry-flake,clean-api-rebase`, with a GitLab MR that has one flaky failed job (id 812) and is behind its target. Record the commands it plans.

- [ ] **Step 2: Edit.**
  - The generic-path bullet becomes: "...`glab mr view <mrUrl>` to read conflict/pipeline state, attempt a mechanical rebase (the `mr_rebase` tool), and retry obviously-flaky pipelines (`mr_retry` with the job or pipeline id)."
  - The API tier's first bullet becomes: "The only mutations allowed are pipeline/job retries (`mr_retry`), (if `clean-api-rebase` is in `--fix-classes`) a server-side rebase (`mr_rebase`), and held drafts via `--draft-bin`."

- [ ] **Step 3: GREEN, then commit.** Re-run the scenario with a fresh agent, confirm it plans the tools, and record the result in the PR body. Commit: `doctor: retry and rebase through rt MR tools (RT-315)`.

### Task 9: Release gate, publish, acceptance, close

- [ ] **Step 1: Release gate (Matt's decision).** mattstack-skills `main` is what teammates' installs pull, and a skill naming a tool their rt lacks strands the pane. Before merging Tasks 6 and 7, ask Matt through `mattstack:wrap-up` to choose: cut an rt release now (`rt:release`), or accept the skew until the next release.

- [ ] **Step 2: PRs and merge.** Open one mattstack-skills PR (Tasks 6 and 7) and one mattstack-apps PR (Task 8). Wait for CodeRabbit and green CI, address findings, and merge on Matt's confirmation.

- [ ] **Step 3: Sync the caches.** From the canonical checkouts on `main`, run `rt skills sync --pack mattstack`, then `rt skills check` to find the stale compiled packs and `rt skills sync --pack <pack>` for each one. Pack commits carry no mattstack ticket id. In mattstack-apps, check `git branch --show-current` is `main`, then `git pull --ff-only` (board wrapper skills are symlinked). Read every affected compiled verb in full (not grep) to confirm the new text landed and no `{{` remains. Restart the sessions sync reports.

- [ ] **Step 4: Acceptance run (RT-315).** Launch a board review on a GitLab MR (the harness test project, never an employer MR) and answer its post gate on the board, with no pane interaction. Expected:
  - The inline thread, the summary (resolvable when it carries an unanchored finding) and the approve all land.
  - The pane shows no classifier denial and no approval prompt.
  - The close links the MR by `mrUrl`.

- [ ] **Step 5: Close out.**
  - Mark RT-315 Done with a comment linking the three PRs and the acceptance result.
  - File the phase 2 ticket in the rt team (PM-shaped: Problem / Fix / Acceptance / Source): "GitHub parity for rt MR write tools". Source it from the spec's "Phase 2: GitHub" section.
  - Link the phase 2 ticket as related to RT-315.
