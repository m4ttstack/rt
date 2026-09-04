# Gate Facility W3 Implementation Plan — everything answers everywhere

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every gated decision in the mattstack pipeline, the respond and doctor flows, the console, and shepherdr rides the rt daemon's gate facility, answerable from any surface, first answer wins.

**Architecture:** The engine's 26 gate@1 decision sites adopt the shared `gate-protocol` part (publish `run:<id>` gates; attended panes keep their forms, unattended panes block in `gate wait`); the board grows respond/doctor gate kinds on a subject+kind-keyed cache; the console renders and answers `run:` gates over its existing WS relay; shepherdr's herd question channel collapses onto the registry; the acme-web pack's fills bump to @2 with dual provides.

**Tech Stack:** rt daemon gate facility (LIVE, rt-client ≥0.15.0), Bun + TS (board), Hono + React + TanStack Query (console), compile-native skill prose (engine + pack).

**Spec:** rt main `docs/superpowers/specs/2026-09-03-gate-facility-design.md` — sections "Pane", "Console (new)", "Adopters" (Respond/Doctor/Pipeline hard gates/Shepherdr), "Waves > W3", "Verification > W3". The spec is the binding authority.

**Recon (read before dispatching):** `.superpowers/sdd/w3-recon-engine.md`, `w3-recon-board.md`, `w3-recon-console.md` (exact file:line anchors for every claim below).

## Global Constraints

- Every push, publish, plugin update, and merge is individually gated on Matt.
- Strict option membership: answers carry option text verbatim; surfaces never reorder or translate to indices; the nuance form is `{"value": <verbatim>, "note": "..."}`.
- Answers NEVER travel in messages; the registry is the only authority; doorbell pushes are verify-only signals.
- The in-pane experience does not change for attended panes; unattended panes never present forms.
- A consumed (answered) gate is terminal; re-asking opens a NEW gate.
- Repo purity: no real employer/project/person names in board/rt/engine tracked files; team names live only in the acme-web pack repo and gitignored briefs.
- Skill edits run under superpowers:writing-skills (em dashes permitted in SKILL.md files).
- Engine version bumps ride the same commit (plugin.json, msg suffix "; bump to 0.15.0"); pack bumps per its own convention.
- Board suite: full `bun test` + `bun run typecheck` green per task. Console: `bun run test`, `typecheck`, `format:check`. Engine/pack: certify.sh on touched dirs + repo-purity + `rt skills check` current.
- rt-client for gate verbs is ≥0.15.0 everywhere it is used (console bumps; board already ^0.15.0).

## Sequencing

Lanes E (engine), B (board), C (console), P (pack) run with these hard edges: E1 → E2/E3/E4/E5 (the recipe/part text is the dependency); B1 → B2 → B3/B4 (keying, then verb generalization, then kinds); E4 + B3 → P1; E6 lands before P-lane compiles; C is independent of E/B/P; V last. Board tasks are sequential (one worktree); E tasks sequential (one worktree); C and P parallel to anything outside their repo.

---

## Lane E — engine: the pipeline part everywhere (repo: `~/Documents/GitHub/mattstack-skills`, worktree `.worktrees/gate-facility-w3`, branch `gate-facility-w3`)

### Task E1: the facility recipe — gate-protocol runs integration + Stage contract v4

**Files:**
- Modify: `attachments/gate-protocol/SKILL.md` (add a "## Runs integration" section)
- Modify: `attachments/parameterized-skills/references/convention.md` (~lines 300-420: Stage contract v3 → v4; scope catalogue at :413-416)

**Produces (later tasks rely on):** the v4 recipe text that every site rewrite copies its shape from; the exact publish invocation `rt gate open --subject run:$RT_RUN_ID --kind <scope> --questions '<json>' --json` and the decided-by rule.

- [ ] **Step 1:** In `gate-protocol/SKILL.md`, add "## Runs integration": a gated pipeline site publishes with subject `run:<run id>` (the id from `run-identity`'s `$RT_RUN_ID`) and kind = the site's decision scope; keep the existing `rt runs field set gate <scope> --stage <stage>` bracketing before the publish (run-record continuity; removal is a later cleanup); after the answer (any surface), `rt runs decision record --contract gate@1 --scope <scope> --selection '<json>' --decided-by <the CAS answer's by>` — the decider is the surface (`pane`, `board`, `console`, `shepherd`), never a verb name. Attendance comes from the invocation context per the part's existing modes: a human-run verb presents the unchanged form THEN records via `gate answer --by pane` (publish-first order per the part's Attended branch); a `--spawned-by` worker publishes and blocks in `gate wait` (bounded: re-run on `{"status":"pending"}`).
- [ ] **Step 2:** Stage contract v4 in convention.md: replace the v3 recipe sentence (`field set gate` → one sentence → structured-question tool → stop → `decision record`) with: `field set gate` → **publish per gate-protocol Runs integration** → attended form / unattended wait per gate-protocol → `decision record --decided-by <answer.by>`. Scope catalogue :413-416: drop `post-severity`, `post-disposition`; the standalone list reads `(`post`, `self-review`, `verdicts`, `fixes`, `sweep`, `push`, `conflict`, `wrap-up`)` (respond's `verdicts`/`fixes` collapse in E4 — leave them listed until E4 removes them, or fold the removal here if E4 lands first in execution order; the executing controller picks and notes it).
- [ ] **Step 3:** certify.sh both dirs; commit "gate-protocol: runs integration; convention: stage contract v4 (facility publish), scope catalogue drops the retired pair".

### Task E2: pipeline stage sites adopt (5 files, 8 sites)

**Files:** `attachments/pipeline/stage-plan/SKILL.md:81-98`, `stage-provision/SKILL.md:62-78`, `stage-evidence/SKILL.md:41-51,63-76`, `stage-ship/SKILL.md:31-46`, `stage-watch-ci/SKILL.md:104-118,120-133`.

- [ ] **Step 1:** Each site: add `{{include:gate-protocol}}` once per verb (own `## Gate protocol` section, placed like the existing wrap-up-form include convention), rewrite the site's gate recipe to v4 (publish subject `run:$RT_RUN_ID`, kind = scope, the site's exact questions/options unchanged, attended/unattended per the part, decision record decided-by from the answer). The QUESTIONS and options at every site are preserved verbatim — only the ask/record mechanics change.
- [ ] **Step 2:** certify.sh each dir; `rt skills check --pack mattstack` (shepherdr/wrap-up unaffected but confirm current); commit "pipeline stages publish facility gates (v4 recipe)".

### Task E3: standalone verbs + forge + resume offers adopt (6 files, 13 sites)

**Files:** `attachments/pipeline/ship/SKILL.md` (63-82, 105-120, resume 25-37), `watch-ci/SKILL.md` (144-157, 159-167, resume 31-45), `work/SKILL.md` (79-93, 114-134, 136-146, 148-167, resume 98-112), `attachments/review/self-review/SKILL.md` (141-158, 106-112, resume 31-45), `attachments/forge/sync-open-mrs/SKILL.md` (85, 110), `rebase-worktree/SKILL.md` (94, 115), `checkout/SKILL.md` (38).

- [ ] **Step 1:** Same v4 rewrite per site as E2 (include once per verb). Resume offers are `clarify`-scope gates: publish with kind `clarify`, options = one Resume per candidate + Start fresh + Hold, Hold marked pane-only via `meta` (gate-protocol's Hold/Iterate rule). Self-review's fix/ship gate is the spec's named smoke target — its unattended branch (herd worker) must read cleanly: publish, block in wait, act on the returned selection, record decided-by from the answer.
- [ ] **Step 2:** certify.sh each dir; commit "standalone verbs, forge, resume offers publish facility gates".

### Task E4: receive-review restructures — adjudicate and execute, never decide

**Files:** `attachments/review/receive-review/SKILL.md` (gates at 142-152, 178-186, 194-211; resume offer 31-45).

- [ ] **Step 1:** Collapse three gates to the @2 caller-owned shape mirroring review's Deliver: the verb produces the adjudication (verdict table + drafted replies + recommendations) and reports it in one structured block; DECISION INTAKE: a caller that hands answers (the board wrapper) supplies `{plan, post}` answers and no question is asked; otherwise the verb asks via the facility per v4 — Gate 1 kind `respond-plan`: per-thread questions (each thread individually decidable: option values carry thread ids verbatim, e.g. `reply:<threadId>`, `fix:<threadId>`, `skip:<threadId>`), grouped so no one form chunk exceeds the tool's question cap, exactly ONE atomic `gate answer` after the last chunk (the part's chunking rule), plus the code-changes approval question; Gate 2 kind `respond-post` after fixes: replies + disposition. Decision-record vocabulary: the `verdicts`/`fixes`/`post` trio retires; one record per gate at execution time, scopes `respond-plan` and `respond-post`, decided-by from the answer. Remove `verdicts`/`fixes` from convention.md's scope catalogue in this task (E1's step 2 leaves them listed with a note when E1 executes first).
- [ ] **Step 2:** The execution halves keep everything: fresh-context adjudication dispatch HARD-GATE, fix-implementation one-at-a-time verified, reply voice rules, the posting HARD-GATE mechanics — all now driven by decided answers, never deciding.
- [ ] **Step 3:** certify.sh; commit "receive-review: caller-owned two-gate protocol (respond-plan, respond-post)".

### Task E5: shepherdr rides the registry

**Files:** `attachments/orchestration/shepherdr/SKILL.md` (relay sections ~301-352), `references/job-template.md` (:42-49 worker question contract), `references/herd-bus.md`, `hooks/pipeline-gate-stop.sh` (:90-93 stderr recipe text). Scripts `herd-ask.py`/`herd-answer.py`/`relay-answer.sh` remain for v1 (see step 1 ruling).

- [ ] **Step 1 (the contract swap):** Worker questions that occur INSIDE a pipeline run stop using `herd-ask.py` — they are now the pipeline sites' facility gates (E2/E3 did the work; the worker is unattended via `--spawned-by`, publishes `run:<id>`, blocks in wait). `job-template.md` worker brief: delete the "run herd-ask and STOP your turn" instruction for run-backed questions; the worker simply proceeds through its gated pipeline (the wait returns the answer as a tool result). KEEP herd-ask/relay for the two non-run channels in v1: design-job questions and any pre-run ask (they have no run id; the spec scopes them to the relay in v1). The shepherd's strategy/model and account questions stay exactly as today (attended AskUserQuestion in the shepherd's own turn).
- [ ] **Step 2 (the shepherd surface):** After spawning, the shepherd registers ONE `rt gate subscribe --subject-prefix run: --session <its session>` and filters pushes to its herd's run ids; on a herd gate push it presents the question in the shepherd conversation exactly as today's relay does and records the human's choice with `rt gate answer <id> --answers '<json>' --by shepherd` (CAS loss = say which answer won, proceed). Recovery after a gap: `rt gate list --open --subject-prefix run:` filtered to herd runs, plus a liveness check on its own subscription row (`rt gate subscriptions`), re-subscribing if pruned. The herd-wait.sh bus loop and herd-bridge.py pane lifecycle stay (blocked/gone panes are not gate concerns).
- [ ] **Step 3:** `pipeline-gate-stop.sh` stderr text: the "open the decision as a form" exit now says publish per gate-protocol (v4 recipe reference), not the old field-set text.
- [ ] **Step 4:** certify.sh shepherdr; `bash hooks/tests/test-herdr-doorbell.sh` + `bash attachments/orchestration/shepherdr/scripts/herd-scripts.test.sh` still green (scripts unchanged); commit "shepherdr: herd worker questions ride the gate registry; one subscription, answers --by shepherd".

### Task E6: engine release pass

- [ ] **Step 1:** `tests/repo-purity.sh`, `bun test`, `tests/stubs-no-source-collision.sh`, `rt skills compile --pack mattstack` + `check` current, re-run certify on every touched dir. Bump `.claude-plugin/plugin.json` to `0.15.0` in the final commit ("engine: pipeline + respond + shepherdr on the gate facility; 0.15.0"). CERTIFICATION.md rows are the CONTROLLER's to append (per its footer): gate-protocol (runs integration), each touched verb dir.
- [ ] **Step 2 (Matt gates):** push branch/main + `claude plugin update mattstack`; then every OTHER compiled pack reporting stale gets its refresh in Lane P.

---

## Lane B — board: respond + doctor kinds on a multi-kind cache (repo: board, fresh worktree branch `gate-kinds-w3` off main ≥ 8b33cbb)

### Task B1: subject+kind cache keying, gateId-addressed answers

**Files:**
- Modify: `src/gates/cache.ts` (key `${subject} ${kind}`, or nested Map — implementer picks, tests pin behavior), `src/gates/answer.ts`, `src/server.ts` (:1289 findAnswerableGateId, :1796 gateResumeEventIo, `/gate/answer` handler), `src/gates/store.ts` (client GateRow gains `kind: string`), `src/gates/cache.ts` attachGates, `src/client/board/RowView.tsx`, `src/client/board/GateCard.tsx`, `src/gates/sweep.ts` (planSweep per-row already; verify no one-open-row-per-MR assumption survives)
- Test: extend `gates-cache.test.ts`, `gates-answer.test.ts`, `gates-sweep.test.ts`, client tests

**Interfaces produced:** `GateCache.get(subject, kind)`, `GateCache.rowsFor(subject): FacilityGateRow[]`; `attachGates` attaches `gates: GateRow[]` (plural; `gate` singular retired) each `{gateId, kind, status, openedAt, questions, answers?}`; `/gate/answer` body becomes `{gateId, answers}` (the card already holds gateId; the mrUrl+cache lookup path retires); `answerGate(gateId, answers, io)` resolves by id over cache rows (open|parked only).

- [ ] **Step 1 (RED):** tests — two kinds on one subject coexist (opened review-post + respond-plan; neither clobbers); answered patch by id finds the right row; attachGates returns both as `gates[]` with kind; RowView/GateCard render N cards keyed gateId; `/gate/answer` by gateId 200/409/404/502 mapping preserved; sweep parks each open row independently.
- [ ] **Step 2-4:** implement → GREEN → full suite + typecheck.
- [ ] **Step 5:** commit "gates: cache keys subject+kind; answers address the gateId; rows render per kind".

### Task B2: verbs generalize over kind + state file; respond/doctor states carry gate fields

**Files:**
- Modify: `src/gates/verbs.ts` (gateOpen takes a `kind` parameter; `meta.label` derives from it — `review gate !<iid>` / `respond gate !<iid>` / `doctor gate !<iid>`; reads any state shape with `{mrUrl, iid, status}`; writes gateId back via an injected state-writer), `bin/gate.ts` (`gate open <state> --kind <k> --questions <json>`; kind required — no default), `src/respond-state.ts` + `src/doctor-state.ts` (add `gateId?`, `resumedGateId?` to the interfaces AND each `write*State` explicit merge list — the B2/B6 W2 trap, now twice more), `src/gates/resume.ts` (RESUMABLE kinds map: `review-post` → `dispatchPrompt("board:review", ...)` as today; `respond-plan`|`respond-post` → `dispatchPrompt("board:respond", {mrUrl, statePath: respondFilePath(mrUrl), statusBin: statusBinPath(), skill: io.resolveLaunchSkill(...) with the respond slot — mirror how review's resume resolves its skill via reviewSkillForTab, using the respond-side equivalent, resumedGate})`; `doctor-escalation` → `dispatchPrompt("board:doctor", {...doctor args, resumedGate})`; the not-wired throw retires), `src/herdr.ts` (respondPrompt/doctorPrompt accept `resumedGate?` → `--resumed-gate` like reviewPrompt)
- Test: `gates-verbs.test.ts`, `gates-resume.test.ts` (per-kind resume rebuild incl. exactly-once via the respective state's resumedGateId), `respond-state.test.ts`, `doctor-state.test.ts` (merge-list widening)

**Interfaces produced:** `gate open <state> --kind <kind> --questions <json>` (wrapper CLI, all three wrappers use it); resume rebuilds by kind with each kind's own state file + wrapper.

- [ ] Steps: RED (kind-parameterized open persists gateId to the right state file; respond gate resume dispatches board:respond with --resumed-gate; doctor likewise; review path byte-identical) → GREEN → suite → commit "gates: verbs and resume generalize over kind; respond/doctor states carry gate fields".

### Task B3: respond wrapper speaks mr-respond@2 (two gates)

**Files:** `skills/review/SKILL.md` untouched; rewrite `skills/respond/SKILL.md` (slot line becomes `slot-respond: "required mr-respond@2 -- owns processing review feedback on one MR: fetching threads, adjudicating, drafting, implementing decided fixes, and executing posting once handed the decisions. Never presents decision gates or decides what posts."`). Writing-skills mandatory.

- [ ] **Step 1:** Wrapper flow: statuses unchanged (triaging→implementing→drafting→done); after the domain skill reports its adjudication (per-thread verdict table + recommendations), the WRAPPER opens Gate 1: `gate open <state> --kind respond-plan --questions '<per-thread + code-changes approval JSON>'` (options carry thread ids verbatim; grouped under the form cap; the wrapper builds questions from the fill's reported table), `gate wait` (bounded pending re-run loop, closed = end cleanly per the review wrapper's closed-gate section — mirror that prose), hand the plan answers down; after fixes, Gate 2 `--kind respond-post` (replies + disposition), wait, hand down, `done --posted N --threads M`. `--resumed-gate <id>`: re-enter without re-adjudicating — `gate wait` returns the recorded answers instantly; act on whichever gate the id names (plan → implement; post → post from the draft/report). Escape hatch + CAS + strict membership: same prose contract as the review wrapper (point at the same behaviors, keep the text self-contained per include rules).
- [ ] **Step 2:** suite green (skills-resolve asserts slot lines — update the wrapper's expected contract in `src/__tests__/skills-resolve.test.ts` wrappers table `mr-respond@1` → `mr-respond@2`); commit "respond wrapper: two facility gates (mr-respond@2)".

### Task B4: doctor wrapper escalation gates (mr-doctor@2 family)

**Files:** rewrite `skills/doctor/SKILL.md` gate-relevant prose (slot lines → `mr-doctor@2` / `mr-doctor-api@2`); writing-skills mandatory. `src/__tests__/skills-resolve.test.ts` wrappers table updated.

- [ ] **Step 1:** Where the flow today dead-ends in `error` with an enumerable human decision (conflict strategy, author-gate override, budget extension — the §Escalation phrasing cases), the wrapper instead opens `gate open <state> --kind doctor-escalation --questions '[{"id":"action","label":"<the situation>","multi":false,"options":[<the executable options verbatim>, "leave it to me in the pane"]}]'`, waits (bounded loop), acts on the answer ("leave it to me in the pane" = pane-only via meta, the human takes over in-pane). Non-enumerable failures remain `error` exactly as today. Unanswered escalations park via the board sweep and resume via B2's doctor-escalation kind.
- [ ] **Step 2:** suite; commit "doctor wrapper: enumerable dead-ends escalate through the facility (mr-doctor@2)".

### Task B5: legacy-state boot migration + board card polish for kinds

**Files:** `src/server.ts` (one-shot boot pass beside the :1822-1832 pattern), `src/review-state.ts`/`respond-state.ts`/`doctor-state.ts` readers; `src/client/board/GateCard.tsx` (kind-aware card title from `meta.label` already carried; verify respond/doctor gates render legibly).

- [ ] **Step 1:** Boot pass (best-effort, `!FIXTURE_DIR`, try/catch log): for each review/respond/doctor state file with `sessionId` set and NO `agentId`, delete the `sessionId` (write via the state writer, preserving status) — the next launch takes the agent path and future parks auto-resume; log one line per migrated file. Test: a legacy-shaped state file loses sessionId; an agentId-bearing state is untouched; a clean install no-ops.
- [ ] **Step 2:** suite; commit "boot: legacy session pointers cleared so parked gates resume via the agent path".

### Task B6: board PR

- [ ] Full suite + typecheck; push `gate-kinds-w3`; PR (base main) covering B1-B5; coderabbit + CI; **Matt gates merge**, then `deck restart board`.

---

## Lane C — console: run gates render and answer (repo: console, worktree amber-eagle or fresh branch `run-gates` off main)

### Task C1: rt-client bump + server gate surface

**Files:**
- Modify: `package.json` (`@mattstack/rt-client` → `^0.15.0`; regen lock), `src/server/index.ts:11` (add RelaySpec `{ match: t => t.startsWith('gate/'), topic: 'gates' }`), Create: `src/server/gates.ts`, mount in `src/server/routes.ts` (chained, per the :10-14 comment)
- Test: `src/server/gates.test.ts` (colocated, per panes.test.ts pattern)

**Interfaces produced:** `GET /api/gates?prefix=run:` → `{ gates: GateRow[] }` (server pages `gateList({subjectPrefix:"run:", limit:200, cursor})` to exhaustion — the W2 cursor lesson: terminate on `gates.length < limit` OR cursor-no-progress, NEVER on falsy cursor); `POST /api/gates/:id/answer` body `{answers}` → `gateAnswer({id, answers, by: "console"})`, 200 on ok, 409 + `{row}` on `conflict`, 502 on `!ok` transport-style errors, 400 on validation-shaped daemon errors (mirror the board's exact-equality lesson: only literal `not-found`/`closed` → 404).

- [ ] Steps: RED (route tests: paging terminates on short page AND on repeated cursor; answer maps 200/409/404/400/502) → GREEN → `bun run test` + typecheck → commit "server: run gate list + answer endpoints; gate events join the WS relay".

### Task C2: RunRow badge + RunDetail gate card

**Files:**
- Create: `src/app/runs/GateCard.tsx` + `src/app/runs/gate-format.ts` (port from board `src/client/board/GateCard.tsx` + `src/client/board/gate-format.ts`: keep GateQuestionField multi/single rendering, GateAnswerSummary with unwrapGateAnswer, the three states, disabled-until-complete via null-returning payload builder, stopPropagation; DROP mrUrl keying — the payload is `{answers}` to `/api/gates/:id/answer`; keep 409 conflict rendering via parseConflictResponse)
- Create: `src/app/runs/useGates.ts` (useQuery `['gates']` → `client.api.gates.$get({query:{prefix:'run:'}})`, invalidated by the `/ws` 'gates' topic alongside runs — extend `useRuns.ts:44-53`'s invalidation to `['gates']`)
- Modify: `src/app/runs/RunRow.tsx` (blocked badge in the :213-234 trailing Group when an OPEN gate exists for `run:<run.id>` — a small chip labeled "blocked", visually adjacent to LivenessChip), `src/app/runs/RunDetail.tsx` (gate card as a sibling between SummaryCard and the Tabs Paper when an open|parked|answered-recent gate exists for the run; the card's action row keeps Answer beside the existing FocusPaneAction)
- Test: RunRow.test.tsx + RunDetail.test.tsx (extend the vi.mock('../api') nested stubs with `gates` routes; notifications.clean() lesson applies), GateCard.test.tsx

- [ ] Steps: RED (badge appears only for open gates on the row's run id; card renders questions, answers post by gateId, 409 shows the winner, answered state renders) → GREEN → test/typecheck/format → commit "runs: blocked badge + gate card answer surface (run: gates)".

### Task C3: console PR

- [ ] Push branch, PR base main (body: run-gate surface, rt-client ^0.15.0 bump — the gate verbs' floor), coderabbit + CI; **Matt gates merge**.

---

## Lane P — pack: fills to @2, review @1 drops (repo: `/Users/matt/.mattstack/teams/acme-web`, branch `gate-kinds-fills`)

### Task P1: respond fill → thin @2 adapter (dual provides)

**Files:** `mattstack/packs/acme-web/attachments/board-respond/SKILL.md` (frontmatter `provides: "mr-respond@1 mr-respond@2"`), PACK.md ledger row, recompiled `skills/` output. Compiles against engine 0.15.0 (installed after E6's Matt-gated update; if the plugin isn't updated yet, the S2-documented `--pack-dir`/`--mattstack-dir` escape hatch against the engine worktree, re-verified post-update).

- [ ] Steps (writing-skills): the fill invokes receive-review declaring caller-owned decisions; reports the adjudication table up to the wrapper in the wrapper's Gate-1 question shape; on handed plan answers implements; on handed post answers executes posting and hands the outcome back. Under an @1 wrapper: the engine's own facility gates ask (E4's fallback), today's behavior preserved. Pack checks clean; commit carries the @1-compat note.

### Task P2: doctor fills → @2 (dual provides both)

**Files:** `attachments/board-doctor/SKILL.md` + `board-doctor-api/SKILL.md` (`provides: "mr-doctor@1 mr-doctor@2"` / `"mr-doctor-api@1 mr-doctor-api@2"`), PACK.md rows, recompile.

- [ ] Steps: the fills' escalation-relevant prose names the enumerable option sets they report to the wrapper (conflict strategy options, author-gate override, budget extension) so the wrapper's `doctor-escalation` gate carries executable option text verbatim; non-enumerable stays error. Checks; commit.

### Task P3: review fill drops @1 + pack release

- [ ] `board-review/SKILL.md` `provides: "mr-review@2"` only + PACK.md row (the reworked board is deployed — the spec's drop condition holds). Pack version bump per convention; all acceptance/check scripts clean; **Matt gates push + plugin update** (with P1/P2 in one release).

---

## Lane V — W3 exit: the spec's five smokes (run WITH Matt)

- [ ] **V1:** a herd-spawned worker blocked at a self-review gate (unattended: no form) answered from the console; the blocked wait returns and the run proceeds with no message ever sent.
- [ ] **V2:** an attended `:work` pane answered from the console reconciles at the human's next touch (queued doorbell, registry verify, recorded answer wins).
- [ ] **V3:** a shepherd herd question answered from the console (worker gate; shepherd sees the push; console answers first).
- [ ] **V4:** a doctor escalation answered from the board card.
- [ ] **V5:** respond's two gates end to end (plan answered from the board, post answered from the pane or console).
- [ ] Close SKILLS-58 with the dogfood evidence (the herd path shipped); note SKILLS-35's watcher fragility is structurally resolved (daemon-owned subscriptions).

## Explicitly out of W3

Cross-rendering (console showing `mr:` gates / board showing `run:` gates); retiring the `rt runs field set gate` bracketing; migrating design-job/pre-run shepherd questions off the relay; the board answering herd gates. Each is a W4 candidate, none blocks the spec's W3 verification.
