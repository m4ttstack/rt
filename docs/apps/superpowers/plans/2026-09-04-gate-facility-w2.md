# Gate Facility W2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the board onto the merged gate facility, flip the review skills to caller-owned decisions, and land the three held gate-events branches — review gates end to end on the facility.

**Architecture:** The board stops owning gate state: its status-bin verbs become thin clients of the daemon's `gate:*` facility (same CLI shape the wrapper already speaks), its UI renders from a subscription-fed cache reconciled by `gate list`, and parked resume triggers off `gate/answered` events by gate kind. The skills layer moves the posting decision to the caller per the spec's skills-layer section. Board wrapper panes are UNATTENDED (publish + blocking wait; the board card is their surface) — a spike-settled ruling.

**Tech Stack:** Bun + TypeScript everywhere; board (bun test), rt (bun run test), console (vitest via `bun run test -- --run`); mattstack skills compile pipeline (`rt skills compile/check`, mattstack:editing-skills).

**Spec:** rt repo `docs/superpowers/specs/2026-09-03-gate-facility-design.md` (on merged rt main). The W2 obligations are its Surfaces/Board, Skills layer, Adopters/Review, and Waves sections. Prior-family docs: this repo's `docs/superpowers/specs/2026-09-02-gate-events-design.md` + plan (superseded where they conflict with the facility spec).

## Global Constraints

- Worktrees, fixed: board = THIS worktree (deft-inlet, branch `gate-events-spec`); rt = noble-cedar (branch `gate-events-rt`); console = amber-eagle (branch `gate-events-console`); the skills engine repo = `~/Documents/GitHub/mattstack-skills` (use its `.worktrees/` convention); the team pack = its own repo (never named in board/rt tracked files — task briefs carry paths at dispatch time, briefs are gitignored scratch).
- **rt-client publish stays frozen until Lane R merges; then 0.15.0 (settings keys + gate wrappers) is THE unfreeze, Matt-gated (npm OTP).** Board re-pins only to the published 0.15.0.
- Wrapper CLI contract is IDENTICAL in shape: `<status-bin> gate open <state> --questions <json>`, `gate wait <state>`, `gate answer <state> --answers <json> --by pane`. The daemon gateId is plumbing the wrapper never sees.
- Board gates: subject `mr:<webUrl>`, kind `review-post` (the by-kind resume map also carries `respond-plan`/`doctor-escalation` for W3; only `review-post` fires in W2).
- Board panes are unattended: `gate open` passes NO nudge; `pane`/`agent` refs passed for focus/resume.
- Facility semantics are settled (CAS conflict = ok+conflict+winner; park CAS-guarded, park-first-then-close-pane; strict option membership; `gate/**` topics with `paneId` payloads): consume, never re-implement.
- Every push, PR, merge, publish, plugin update, and deploy is individually Matt-gated.
- Suite + typecheck green before every commit, per repo: board `bun test` + `bun run typecheck`; rt `bun run test` + `bunx tsc --noEmit`; console `bun run test -- --run`.

## File Structure (board rework core)

- `src/gates/verbs.ts` — REWORK: thin facility clients keyed by state path; gateId recorded in the review state file at open, read at wait/answer.
- `src/gates/store.ts` — SHRINK: the local gate-file store retires; a `GateCache` (in-memory, subscription-fed, gateList-reconciled) replaces it for UI reads; `attachGates` reads the cache.
- `src/gates/ingest.ts` — REWORK: relay subscription on `gate/**` (mr: subjects) feeding the cache + SSE; boot reconcile via `gateList`; `ensureBridgeRule` retargeted to `gate/opened/*` with payload-label templates + paneId suppression.
- `src/gates/answer.ts` — REWORK: `/gate/answer` proxies `gateAnswer --by board`; conflict surfaces the winner; resume trigger MOVES OUT of this path.
- `src/gates/resume.ts` — NEW: subscription-triggered parked resume by kind + boot pass over answered-while-down parked gates (extracted from answer.ts's resumeParkedGate).
- `src/gates/sweep.ts` + `execute-sweep-action.ts` — REWORK: plan from cache rows; park via facility (CAS-guarded, park-then-close-pane).
- `skills/review/SKILL.md` — wrapper text updated to the facility protocol (unattended; bounce-surviving wait; escape hatch; degraded mode kept).
- rt/skills-engine/pack files named per task.

---

## Lane R — land the held rt branch, unfreeze the publish

### Task R1: fold main into gate-events-rt, PR, merge

**Files (rt, noble-cedar):** merge commit; conflict resolution only.

- [ ] **Step 1:** `git fetch origin && git merge origin/main` on `gate-events-rt` (122 commits behind: the facility + setup work). Expected conflicts, resolve by ADDITIVE UNION in each: `packages/rt-client/src/commands.ts` (branch adds `ChatPane.focused`; main added gate rows/types — keep both), `packages/rt-client/src/client.ts` (main added the gate wrappers beside the events ones — keep both), `packages/rt-client/package.json` (branch says 0.14.0, main lower — keep 0.14.0), `packages/rt-client/src/settings/registry-defs.ts` (if `board.reReview` landed on main meanwhile, fold key counts the way the count-conflict was resolved before: union of keys, count = total).
- [ ] **Step 2:** `bun run test` + `bunx tsc --noEmit` green (rt-client dist rebuild if dist-freshness trips). rt-client's OWN suite green.
- [ ] **Step 3:** Commit the merge; push; open the PR (base main). Body: what the branch carries (events wrappers' original home, notifier event bridges, tray pane-focus action, `board.agent.*` + `board.gateGraceMinutes` + `rt.notify.eventBridges` registry keys, `ChatPane.focused`) + that 0.14.0 was published from this branch.
- [ ] **Step 4 (Matt gates):** coderabbit + CI green → Matt merges.

### Task R2: rt-client 0.15.0 publish (Matt-gated)

- [ ] **Step 1:** On merged main: bump `packages/rt-client/package.json` to 0.15.0, commit via PR or direct per Matt's call.
- [ ] **Step 2:** Build (`bun run build` in packages/rt-client), rt-client suite green, `npm pack --dry-run` sanity.
- [ ] **Step 3 (Matt):** `npm publish --ignore-scripts --otp` (bw vault flow). Registry `latest` = 0.15.0. Announce to max/gail: publish freeze LIFTED.

---

## Lane B — board rework onto the facility

Sequential after R2 (the re-pin needs published wrappers). All tasks in deft-inlet on `gate-events-spec`.

### Task B1: fold main + re-pin rt-client ^0.15.0

- [ ] **Step 1:** `git merge origin/main` (1 commit, the theme pass; merge-tree shows zero conflicts).
- [ ] **Step 2:** package.json `@mattstack/rt-client` → `^0.15.0`; `bun install`; confirm `gateOpen/gateAnswer/gateWait/gateList/gatePark/gateClose` + `GateRow/GateQuestion/GATE_BY_PANE` import from the package.
- [ ] **Step 3:** Full suite + typecheck. Existing gates tests still pass (nothing reworked yet). Commit: "deps: fold main; re-pin rt-client ^0.15.0 (facility wrappers)".

### Task B2: verbs.ts to facility clients (wrapper contract unchanged)

**Interfaces:**
- Consumes: rt-client `gateOpen({subject, kind, questions, agent?, pane?})`, `gateWait({id, waitMs?})`, `gateAnswer({id, answers, by})`.
- Produces (wrapper-facing CLI, IDENTICAL shape): `gate open <state> --questions <json>` prints nothing new; `gate wait <state>` prints `{answers, by, answeredAt}` exactly as today; `gate answer <state> --answers <json> --by pane` records the pane answer.

- [ ] **Step 1: failing tests** — rework `src/__tests__/gates-verbs.test.ts`: fake rt-client wrappers injected via `GateVerbIo`; `gateOpen` calls the facility with `subject: "mr:"+mrUrl`, `kind: "review-post"`, NO nudge, `meta: { label: "review gate !<iid>" }` (iid derived from the MR url the way the board's tab labels do — the bridge template renders this label, so without it every tray notification reads bare "review-post"), and writes `gateId` into the review state file; `gateWait` reads the gateId and loops the facility wait (registry-first makes re-entry safe; timeout re-enters; `closed` surfaces as a clean terminal error); a CAS-lost pane answer prints the winner and exits 0.
  **gateId persistence trap (reviewer-verified):** `writeReviewState` merges an EXPLICIT field list (`src/review-state.ts:60-90`) — a field not on that list is clobbered by the next status write. Add `gateId?: string` to `ReviewState` AND the merge list, with a test interleaving `gate open` -> a `reviewing` status write -> `gate wait` proving the gateId survives.
- [ ] **Step 2-4:** RED → implement → GREEN. The journal-cursor/eventsList plumbing DELETES (the facility wait replaced the client-side fold — the exact retirement the facility exists for).
- [ ] **Step 5:** Full suite + typecheck; commit "gates: status-bin verbs are facility clients; wrapper contract unchanged".

### Task B3: the GateCache + store shrink

- [ ] **Step 1: failing tests** — `gates-store.test.ts` reworked: `GateCache.applyRow(row)` / `applyEvent(frame)` / `reconcile(rows)` (gateList result replaces matching subjects). Event handling per payload thickness: `opened`/`answered` carry full context; `parked`/`closed`/`released` are THIN (`{id, subject, kind, ...}`) — the cache patches by id and TOLERATES an unknown id (drop the patch; the next reconcile fills the gap). `attachGates` renders open and parked rows; an answered row renders ONLY while the review state is non-terminal (not yet `done`/`error`) — NOT keyed on `released`, which stays false forever for unattended board gates (nothing nudges, nothing releases; reviewer-verified). The local gate-file read/write/prune functions DELETE (`state/gates/` no longer written; one-time boot cleanup removes leftovers).
- [ ] **Step 2-5:** RED → implement → GREEN → suite → commit "gates: daemon-backed cache replaces local gate files".

### Task B4: ingest — subscription, reconcile, bridge retarget

- [ ] **Step 1: failing tests** — `gates-ingest.test.ts` reworked: relay frames with topic `gate/**` and `payload.subject` starting `mr:` feed `GateCache.applyEvent` + SSE nudge; non-mr subjects ignored; boot reconcile = `gateList({subjectPrefix: "mr:"})` paged via the cursor → `reconcile`; `ensureBridgeRule` writes pattern `gate/opened/*` with a template using the payload `label` + suppression keyed on payload `paneId` (upsert semantics preserved: replace the old `board/gate/opened/*` rule if present, never duplicate).
- [ ] **Step 2-5:** RED → GREEN → suite → commit "gates: ingest subscribes gate/**, reconciles via gate list, retargets the bridge rule".

### Task B5: answer endpoint proxies the facility

- [ ] **Step 1: failing tests** — `gates-answer.test.ts` reworked: `/gate/answer` calls `gateAnswer({id, answers, by: "board"})`; conflict → HTTP 409 with the winning row in the body (the card shows "answered elsewhere" + winner); unknown gate → 404; strict-membership rejection → 400 with the daemon's message; NO resume logic here anymore (moves to B6).
- [ ] **Step 2-5:** RED → GREEN → suite → commit "gates: board answers proxy the facility CAS".

### Task B6: resume.ts — event-triggered parked resume by kind

**Interfaces:**
- Produces: `handleAnsweredEvent(frame, io)` — when the frame's gate is one this board parked: rebuild the wrapper prompt BY KIND (`review-post` → `board:review … --resumed-gate <gateId>`; map entries for `respond-plan`/`doctor-escalation` exist and throw "not wired until W3" if hit) and `resumeAgentPane`; `bootResumePass(io)` — `gateList` for answered+parked-history gates missed while the board was down.
- The `--resumed-gate` wrapper re-entry contract is unchanged (correctness requirement from the prior pass: never re-open on resume).

- [ ] **Step 1: failing tests** — extracted from the old answer-path tests + new: console-answered parked gate resumes (the event path, NOT the endpoint); missing agentId degrades to notify. **Exactly-once dedup is PINNED (reviewer-verified gap):** the resume writes `resumedGateId: <gateId>` into the review state via the (B2-widened) merge list; both the event path and the boot pass skip any gate whose id equals the recorded `resumedGateId`. `released` can NEVER be the marker — unattended gates are consumed via `gate wait` and are never released. Test: two consecutive boot passes over the same answered parked gate resume exactly once; the event path after a boot-pass resume is also a no-op. Boot passes page `gateList` with the cursor (never assume one page).
- [ ] **Step 2-5:** RED → GREEN → suite → commit "gates: parked resume rides gate/answered events, by gate kind".

### Task B7: sweep on facility rows

- [ ] **Step 1: failing tests** — `gates-sweep.test.ts` reworked: `planSweep` over cache rows; park executes `gatePark(id)` FIRST and closes the pane only on ok (a CAS rejection = the gate got answered mid-sweep: no pane close, log once — the TOCTOU guard is now the daemon's); `close-missed-done` unchanged; pruning off-board MRs = `gateClose({id, reason: "pruned"})`.
- [ ] **Step 2-5:** RED → GREEN → suite → commit "gates: sweep executes facility transitions, park-first".

### Task B8: wrapper SKILL.md to the facility protocol

- [ ] **Step 1:** Rewrite `skills/review/SKILL.md`'s gate-protocol section: same verbs, plus — the wait survives daemon bounces (the CLI loop does; say nothing else changes), `closed` means the decision site was abandoned (end cleanly, no invented answer), the escape hatch's CAS loss means "proceed on the recorded answer" (the verb prints the winner), degraded mode (daemon down at OPEN time) unchanged. **Escape-hatch answers under strict membership:** the recorded value must be one of the question's option texts VERBATIM (the daemon rejects anything else); the human's phrasing/nuance rides the per-answer `note`. Slot contract stays `mr-review@2`. Update `skills-resolve` tests if wording is asserted. Load superpowers:writing-skills discipline for the prose (the controller passes this to the implementer).
- [ ] **Step 2:** Suite + typecheck; commit "wrapper: gate protocol rides the facility".

### Task B9: board PR

- [ ] **Step 1:** Full suite + typecheck green; push `gate-events-spec`; open the PR (base main) — body covers the family: launch-via-agent, focus, gates-on-the-facility, auto-close, park/resume, wrapper @2, claudeCommand→board.agent.* migration (the known main-board 0.14.0 blocker this branch resolves).
- [ ] **Step 2 (Matt gates):** coderabbit + CI → Matt merges. Deploy is a separate Matt gate after Lane V.

---

## Lane S — skills layer (parallel with Lane B after R1)

### Task S1: engine — Deliver rewrite + posting-execution + the pane-protocol part

**Files (mattstack-skills, own worktree/branch):**
- `attachments/review/review/SKILL.md` — the Deliver step per the spec's skills layer: present draft + state levels in one structured line; caller-owned answers or the ONE combined fallback question; execute posting per review-posting; rt-runs decision recording at execution (`--decided-by` = the winner's `by`).
- `attachments/review-posting/SKILL.md` — execution-only rewrite (no side door, summary scoping, empty-selection, approve-order, tacit-approval, forge-conditional, writing-style, close HARD-GATE, report-file input mode for resumes, never-asks guard).
- `attachments/gate-protocol/SKILL.md` — NEW shared part: publish → attended (form + queued doorbell reconcile-on-touch + priming: the doorbell phrase is a verify-only signal) / unattended (publish + blocking wait; closed = abandon; escape hatch + CAS-loss rule); one atomic answer for chunked forms; strict-membership rule (answer values are option texts verbatim, nuance in notes); Hold/Iterate semantics (a consumed gate is terminal — the verb opens a NEW gate when it re-asks; those options are pane-only via meta).
- Engine version bump; `rt skills check` clean.

- [ ] Steps: edits under superpowers:writing-skills discipline → compile check → commit → **Matt gates:** push + plugin update.

### Task S2: team-pack fill to @2 (dual provides)

**Files (the team pack's repo; paths in the dispatch brief only):** the review fill becomes the thin @2 adapter per the spec (invoke the verb caller-owned; save report; report levels; execute on handed `{tiers, outcome}`; `--resumed-gate` = post from the report file, never re-review); `provides: "mr-review@1 mr-review@2"` in BOTH spots (fill frontmatter + pack manifest row); recompile (`skills/review` regenerates against the S1 engine); pack version bump; commit carries the @1-compat note; **Matt gates:** push + plugin update. Dropping `@1` happens after the board deploys (W3 start).

---

## Lane C — console branch lands

### Task C1: fold main into gate-events-console, PR, merge

- [ ] `git merge origin/main` in amber-eagle; `bun run test -- --run` green; push; PR; **Matt gates** merge. (rt-client stays ^0.11.0 per the settled ruling; console's gate surface is W3.)

---

## Lane V — W2 exit: live verification (run WITH Matt)

### Task V1: review end to end on the facility

**Preconditions:** S1 + S2 pushed AND `claude plugin update` run for both packs (the wrapper resolves the @2 fill through the installed plugins); B9 board branch running (dev build or deployed per Matt); R2 published + B1 re-pin landed.

- [ ] Fresh review with findings: board launches the pane (rt agent), wrapper publishes `mr:` gate via the facility, card renders from the subscription, answer on the card → the blocked wrapper wait returns → posting executes with the selected tiers → done reaction. Tray notification fires via the retargeted bridge rule.
- [ ] Clean review: outcome-only gate, one-click approve.
- [ ] **Parked resume (REQUIRED):** park past grace (shrink `board.gateGraceMinutes`), answer from the board → the resume rides the `gate/answered` event → fresh pane posts from the report file, no re-review, no hang.
- [ ] Escape hatch: answer in-pane conversationally; board card shows the pane's answer won.
- [ ] Degraded: daemon down at gate-open time → one combined AskUserQuestion in-pane.
- [ ] Record results in this doc; then Matt's deploy gate.

---

## After W2

W3 (pipeline part adoption, console gate surface, respond @2, doctor @2, shepherdr) plans against the deployed W2 state. Drop the pack's `@1` provides at W3 start.
