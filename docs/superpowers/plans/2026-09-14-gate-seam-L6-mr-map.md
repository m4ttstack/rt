# L6: rt mr map (RT-147)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One verb joining the user's open MRs to the local worktrees holding their branches, replacing the map-open-mrs skill's manual join.

**Architecture:** Pure client composition: rt-client's `readProjectMRs` wrapper plus worktree:list via the client's generic typed command transport (no dedicated wrapper exists), joined by exact branch equality in a new `lib/mr-map.ts`, surfaced by a new `commands/mr.ts` tree branch. No daemon changes.

**Tech Stack:** Bun, TypeScript, bun test.

**Spec:** `docs/superpowers/specs/2026-09-14-gate-seam-mcp-epic-design.md` (Phase 3)

## Global Constraints

- Contract C7 + C10 binding (`docs/superpowers/plans/2026-09-14-gate-seam-00-contracts.md`).
- New command module needs the `lib/module-registry.ts` thunk entry.
- Repo identity: `--repo` takes the registry repo NAME and resolves through the identity helpers (`lib/settings/identity.ts` inside repo-tools); never key or send a bare name where a serialized identity is expected (the project-mrs:read payload's `repoName` field: read `lib/daemon/handlers/project-mrs.ts`'s expectations first and pass exactly what the board passes).
- Announce before merge (tree + registry files). `bun run test:all` + `bun run picker:check` before verified.

---

### Task 1: the join, test-first

**Files:**
- Create: `lib/mr-map.ts`
- Test: `lib/__tests__/mr-map.test.ts`

**Interfaces:**
- Produces:

```ts
export interface MrMapRow {
  ref: string;            // "!123"
  title: string;
  sourceBranch: string;
  worktree: string | null;
  mrState: string;
  ciStatus: string | null;
}
export function joinMrsToWorktrees(
  mrs: Array<{ iid: number; title: string; sourceBranch: string; state: string; pipelineStatus: string | null }>,
  trees: Array<{ path: string; branch: string | null }>,
): MrMapRow[];
```

- [ ] **Step 1: failing test**: exact-equality join (foo-1 never pairs with foo-10), NONE row for an MR with no tree, one row per MR in input order, a tree with a null branch never matches.
- [ ] **Step 2-4:** red, implement (a Map from branch -> path; exact string equality only), green.
- [ ] **Step 5: Commit** `mr-map: exact-branch join`.

### Task 2: the verb

**Files:**
- Create: `commands/mr.ts` (fn `mrMap`: resolve repo (default: current repo, same helper `commands/worktree.ts` uses... read its repo-defaulting first and reuse it), call `projectMrsRead` and `worktreeList` via rt-client, map the wire shapes into Task 1's inputs, print `{"ok":true,"rows":[...]}`)
- Modify: `lib/command-tree-def.ts`:

```ts
mr: {
  description: "Merge requests as rt sees them",
  subcommands: {
    map: {
      description: "Your open MRs joined to the local worktrees holding their branches",
      module: "./commands/mr.ts",
      fn: "mrMap",
      omitBehavior: "list",
      args: [
        { name: "Repo", flag: "--repo", type: "text", placeholder: "repo-tools", hint: "Registered repo name (defaults to the current repo)" },
        { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable rows (default output is a table)" },
      ],
    },
  },
},
```

- Modify: `lib/module-registry.ts` (thunk for `./commands/mr.ts`)

**Interfaces:**
- Consumes: Task 1's join; rt-client `readProjectMRs({repoName, ...})` and worktree:list through the client's generic typed command transport (no dedicated wrapper; follow how other verb modules issue raw commands). For readProjectMRs's demand/authors semantics, mirror how the mr-board's data layer calls it... read `~/Documents/GitHub/mattstack-apps/apps/board/src/data.ts` for the working call shape.
- Produces: C7's output. Non-JSON output: an aligned table (ref, branch, worktree-or-NONE), no UI framework.

- [ ] **Step 1:** implement; **Step 2:** run against the live daemon read-only: `bun run cli.ts mr map --repo repo-tools --json` (read-only verbs are safe from source against the real daemon; no isolated HOME needed for reads, but never run write verbs this way).
- [ ] **Step 3:** `bun run picker:check` + `bun run test` green. **Step 4: Commit** `mr map: open MRs joined to worktrees`.

### Task 3: lane wrap

- [ ] `bun run test:all`; announce (tree + registry touch); push; PR "RT-147: rt mr map".
- [ ] PR body notes: the map-open-mrs skill retires later (its own follow-up inside SKILLS-66/67 scope decides wording); the MCP mr_map tool lands in RT-151.
