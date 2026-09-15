# L5: mr:comment-inline daemon command (RT-146; spans glance + repo-tools)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daemon command that posts a positioned inline MR comment (DiffNote), verifies it landed as one, and repairs the silent general-note degrade in code.

**Architecture:** glance's NoteMutator gains `fetchDiffRefs` + `createPositionedDiscussion`; a new handler in `lib/daemon/handlers/discussions.ts` composes fetch-refs -> post -> verify -> (delete + retry once). The verify re-reads the created discussion's first note type.

**Tech Stack:** TypeScript; glance (m4ttstack/glance, packages/glance) + repo-tools daemon; bun test both sides.

**Spec:** `docs/superpowers/specs/2026-09-14-gate-seam-mcp-epic-design.md` (Phase 3)

## Global Constraints

- Contract C6 and C10 in `docs/superpowers/plans/2026-09-14-gate-seam-00-contracts.md` binding.
- Two repos, strict order: glance PR merges + publishes FIRST, then repo-tools bumps `@mattstack/glance` and lands the handler. glance publish follows that repo's own release conventions (read its README/CONTRIBUTING before publishing; announce the version bump in #rt like any shared-package bump).
- Announce before the repo-tools merge (touches commands.ts).
- `bun run test:all` in repo-tools before verified.

---

### Task 1 (glance): fetchDiffRefs

**Files:**
- Modify: `~/Documents/GitHub/glance/packages/glance/src/NoteMutator.ts`
- Test: the package's existing NoteMutator test file (find it under packages/glance; mirror its fetch-mocking pattern exactly)

**Interfaces:**
- Produces: `export interface DiffRefs { base_sha: string; start_sha: string; head_sha: string }`, `fetchDiffRefs(projectId: number, mrIid: number): Promise<DiffRefs>` (GET `/api/v4/projects/:id/merge_requests/:iid` reading `.diff_refs`).

- [ ] **Step 1: failing test**: mock the GET returning `{diff_refs: {base_sha: "b", start_sha: "s", head_sha: "h"}}`; assert the method returns it and throws a descriptive error when `diff_refs` is null (MR with no diff yet).
- [ ] **Step 2:** run, expect fail. **Step 3:** implement with the class's existing request helper (same auth header + error style as createNote). **Step 4:** run, pass. **Step 5:** commit `glance: NoteMutator.fetchDiffRefs`.

### Task 2 (glance): createPositionedDiscussion

**Files:**
- Modify: `NoteMutator.ts`
- Test: same test file

**Interfaces:**
- Produces:

```ts
export interface TextPosition {
  position_type: "text";
  new_path: string; new_line: number;
  old_path?: string; old_line?: number;
  base_sha: string; start_sha: string; head_sha: string;
}
createPositionedDiscussion(projectId: number, mrIid: number, body: string, position: TextPosition): Promise<CreatedDiscussion>;
```

POST `/api/v4/projects/:id/merge_requests/:iid/discussions` with a JSON body `{body, position}` and `Content-Type: application/json` (JSON, never bracketed form fields... the nesting silently drops otherwise, which is the whole defect class).

- [ ] **Step 1: failing test** asserting the request body carries the nested `position` object as JSON and the created discussion parses. **Step 2-5:** red, implement, green, commit `glance: NoteMutator.createPositionedDiscussion`.

### Task 3 (glance): note type on CreatedDiscussion

**Files:**
- Modify: `NoteMutator.ts` (`CreatedNote` gains `type: string | null`, parsed from the response; GitLab returns `"DiffNote"` for positioned notes, `null` for general ones)
- Test: extend Task 2's test with both type values.

- [ ] Red, implement, green, commit `glance: surface note type for DiffNote verification`. Then glance lane wrap: the repo's test suite green, PR, merge, publish per its conventions, announce the version.

### Task 4 (repo-tools): wire contract

**Files:**
- Modify: `package.json` (bump `@mattstack/glance` to the Task 3 release; `bun install`)
- Modify: `packages/rt-client/src/commands.ts` (entry + COMMAND_NAMES, after the discussions block at commands.ts:646-649)

**Interfaces:**
- Produces contract C6's `"mr:comment-inline"` entry verbatim:

```ts
/** Positioned inline MR comment with server-side DiffNote verification:
    posts, re-checks the created note's type, deletes and retries once on
    the silent general-note degrade. `verified: true` means the check ran. */
"mr:comment-inline": {
  payload: { repoName: string; iid: number; body: string; path: string; line: number; oldPath?: string; oldLine?: number };
  data: { discussionId: string; noteId: number; verified: true };
};
```

- [ ] Add entry + name, `cd packages/rt-client && bun run build`, commit `rt-client: mr:comment-inline entry; glance bump`.

### Task 5 (repo-tools): the handler, test-first

**Files:**
- Modify: `lib/daemon/handlers/discussions.ts` (new handler beside discussions:reply; reuse its provider/token/grants plumbing exactly... read the reply handler in full first and mirror its repo resolution, NoteMutator construction, and refreshDiscussions call)
- Test: beside the existing discussions handler tests, with a fake NoteMutator seam

**Interfaces:**
- Consumes: glance `NoteMutator.fetchDiffRefs/createPositionedDiscussion/deleteNote`, `CreatedNote.type`.
- Produces: the C6 behavior: post -> if first note's `type !== "DiffNote"` -> deleteNote + retry once -> still degraded -> `{ok:false, error:"GitLab dropped the position (note type <type>); body preserved nothing... see the deleted note ids in this error"}` style message naming both attempts' note ids; on success `{discussionId, noteId, verified: true}` and a discussions cache refresh so the board sees the new thread.

- [ ] **Step 1: failing tests** with the fake mutator: (a) clean DiffNote first try; (b) degrade then clean on retry (assert deleteNote called with the first note id); (c) degrade twice -> ok:false naming both ids; (d) unknown repo -> the same refusal string discussions:reply produces (read it and assert verbatim).
- [ ] **Step 2-4:** red, implement, green (`bun test lib/daemon`, then `bun run test:all`).
- [ ] **Step 5:** commit `daemon: mr:comment-inline with DiffNote verify + single repair retry`.

### Task 6: lane wrap

- [ ] `bun run test:all` + `bun run picker:check` green; announce; push; PR "RT-146: mr:comment-inline daemon command".
- [ ] Note in the PR body: the MCP tool over this lands in RT-151; the gitlab-mr-threads skill deletion in SKILLS-67.
