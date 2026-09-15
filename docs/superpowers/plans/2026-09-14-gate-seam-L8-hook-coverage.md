# L8: gate-fork hook coverage, repo-tools half (RT-149)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Herd-spawned workers get RT_GATE_SUBJECT stamped (so the AskUserQuestion PreToolUse hook covers them), and installed app bundles carry gate-fork.sh.

**Architecture:** One-field addition to the herd spawn's agent:start payload; one build.sh copy step. The board half is explicitly NOT here (BOARD-31).

**Tech Stack:** Bun, TypeScript, bun test; build.sh (rehearse via workflow_dispatch only, never a local re-sign of a blessed bundle).

**Spec:** `docs/superpowers/specs/2026-09-14-gate-seam-mcp-epic-design.md` (Phase 2)

## Global Constraints

- Contract C9 + C10 binding.
- NEVER rebuild or re-sign an installed/blessed app bundle to test the build.sh change; the release workflow's dispatch rehearsal is the only validation surface for that half.
- Announce before merge (touches handlers/herd.ts, same file as L2's Task 4: coordinate; if L2 is in flight, rebase on its branch or sequence after it... the two edits are in different functions but the same file).
- `bun run test:all` before verified.

---

### Task 1: herd spawn stamps the subject

**Files:**
- Modify: `lib/daemon/handlers/herd.ts` (the `herd:spawn` handler's agent:start payload; find the `deps.agent` / agent-start call inside the spawn handler and add the field)
- Test: extend the existing herd spawn handler test to assert the agent:start payload received `subject: "herd:<id>/<job>"` (the same string `herdSubject(herdId, name)` builds for herd:ask; import and reuse that builder, never a second template string)

**Interfaces:**
- Consumes: the existing `herdSubject(herdId: string, job: string): string` helper (defined in lib/daemon/herd-store.ts, already imported at handlers/herd.ts:13; the one herd:ask uses at herd.ts:464).
- Produces: every herd-spawned agent record carries `subject`, which agent:start already persists and stamps as RT_GATE_SUBJECT at launch (commands.ts:349-354 documents that contract; no agent.ts change needed).

- [ ] **Step 1:** failing test on the spawn handler's agent:start payload.
- [ ] **Step 2:** one-line payload addition: `subject: herdSubject(herdId, name),`.
- [ ] **Step 3:** herd suites + `bun run test` green.
- [ ] **Step 4: Commit** `herd: spawn stamps the gate subject so workers get the gate-fork hook`.

### Task 2: verify the injection path end to end (read, then one live check)

**Files:**
- Read: `lib/daemon/handlers/agent.ts` (the launch path consuming `subject`: confirm it env-stamps RT_GATE_SUBJECT and injects the hook settings via `mergeGateForkHookSettings`; cite the lines in the PR body)
- Test: if agent.ts's existing tests cover subject-conditional hook injection, extend one case to start from a herd-spawn-shaped payload; if not, add that assertion where the launch argv/settings are built (there is a seam: `lib/agent-argv.ts` per agent-hooks.ts:93-96).

- [ ] **Step 1:** trace + cite; **Step 2:** the assertion; **Step 3:** green; **Step 4: Commit** `herd spawn hook coverage: launch-path assertion`.

### Task 3: bundle the hook script

**Files:**
- Modify: the app-bundle build script (locate the Helpers copy section: `grep -rn "Contents/Helpers\|HELPERS_DIR" scripts/ rt-tray/ | grep -i build`; agent-hooks.ts:13-16 names the gap and `lib/bundle-layout.ts` names the constant). Add a copy of `scripts/hooks/gate-fork.sh` into the bundle's Helpers dir alongside rt-ui.

- [ ] **Step 1:** add the copy step, matching how rt-ui is copied (permissions bit preserved: the hook must stay executable).
- [ ] **Step 2:** validation is the release workflow's `workflow_dispatch` rehearsal (per rt-release step 8), NOT a local bundle build. This lane only asserts the script path lands in the dispatch run's artifact: note in the PR that the next release rehearsal must check `Contents/Helpers/gate-fork.sh` exists in the built zip, and add that line to the release-rehearsal checklist if `docs/release-and-distribution.md` carries one (read it; add the row where its rehearsal checklist lives).
- [ ] **Step 3: Commit** `build: embed gate-fork.sh under Contents/Helpers`.

### Task 4: lane wrap

- [ ] `bun run test:all` + `bun run picker:check`; announce (herd.ts coordination with L2 explicitly); push; PR "RT-149: herd spawns get the gate-fork hook; bundle carries the script".
- [ ] PR body: the board half is BOARD-31 (subject stamping in mattstack-apps agent-launch.ts), deliberately out of this lane.
