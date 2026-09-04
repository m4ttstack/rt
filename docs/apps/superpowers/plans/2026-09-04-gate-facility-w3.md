# Gate Facility W3 Implementation Plan — everything answers everywhere

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every gated decision in the mattstack pipeline, the respond and doctor flows, the console, and shepherdr rides the rt daemon's gate facility, answerable from any surface, first answer wins.

**Architecture:** The engine's gate@1 decision sites adopt the shared `gate-protocol` part via one verbatim v4 recipe (publish `run:<id>` gates; attended panes keep their forms and record `--by pane`; unattended panes block in a bounded `rt gate wait` loop); the board grows respond/doctor gate kinds on a subject+kind-keyed cache with a kind-aware sweep; the console renders and answers `run:` gates over its existing WS relay; shepherdr's run-backed herd questions collapse onto the registry; the acme-web pack's fills bump to @2 with dual provides and release BEFORE the board's @2 wrappers deploy.

**Tech Stack:** rt daemon gate facility (LIVE; CLI `rt gate ...`; rt-client ≥0.15.0), Bun + TS (board), Hono + React + TanStack Query (console), compile-native skill prose (engine + pack).

**Spec:** rt main `docs/superpowers/specs/2026-09-03-gate-facility-design.md` — sections "Pane", "Console (new)", "Adopters" (Respond/Doctor/Pipeline hard gates/Shepherdr), "Waves > W3", "Verification > W3". The spec is the binding authority.

**Recon (read before dispatching):** `.superpowers/sdd/2026-09-04-gate-facility-w3/w3-recon-engine.md`, `w3-recon-board.md`, `w3-recon-console.md`.

## Global Constraints

- Every push, publish, plugin update, and merge is individually gated on Matt.
- Strict option membership: answers carry option text verbatim; surfaces never reorder or translate to indices; nuance form `{"value": <verbatim>, "note": "..."}`.
- Answers NEVER travel in messages; the registry is the only authority; doorbell pushes are verify-only signals.
- The in-pane experience does not change for attended panes; unattended panes never present forms.
- A consumed (answered) gate is terminal; re-asking opens a NEW gate. A resumed pane NEVER re-runs `gate open` for the gate it was resumed for.
- Every option on a published gate must be executable from the wait's return on the pane side ("leave it to me in the pane" = the pane stops mechanized action and hands over; "Hold" = park the work). Pane-only `meta` markers are DESCOPED from W3 (the spec's "may mark" stays future-optional).
- Repo purity; team names only in the acme-web pack repo and gitignored briefs. Skill edits under superpowers:writing-skills (em dashes OK in SKILL.md).
- Engine bumps same-commit (plugin.json, "; bump to 0.15.0"); pack per its convention. Board: full `bun test` + `bun run typecheck`. Console: `bun run test` + `typecheck` + `format:check`. Engine/pack: certify.sh touched dirs + repo-purity + `rt skills check` current.
- gateList/gate:list paging: terminate on `gates.length < limit` OR cursor-no-progress, NEVER on falsy cursor. Daemon error mapping by exact equality only. Every new state field goes on the interface AND the writer's explicit merge list.

## Sequencing (hard edges)

E1 → E2/E3/E4/E5 (the verbatim recipe is the dependency). B1 → B2 → B3/B4 → B5. E4 + B3 → P1. E6 (engine released + plugin updated, Matt-gated) → P-lane compiles. **P3 (pack released + plugin updated, Matt-gated) → B6 (board merge/deploy)** — the @2 wrappers must never deploy before the fills provide @2, or every respond/doctor launch degrades domain-free against real MRs. C-lane is independent. V last.

---

## Lane E — engine (repo: `~/Documents/GitHub/mattstack-skills`, worktree `.worktrees/gate-facility-w3`, branch `gate-facility-w3`)

### Task E1: the facility recipe — gate-protocol runs integration + Stage contract v4

**Files:**
- Modify: `attachments/gate-protocol/SKILL.md` (add "## Runs integration")
- Modify: `attachments/parameterized-skills/references/convention.md` (Stage contract v3 → v4 ~:300-420; scope catalogue :413-416)

**Produces:** THE VERBATIM RECIPE BLOCK below, which lands word-for-word in gate-protocol's "## Runs integration" and which E2/E3/E4 sites copy, changing ONLY the kind and the questions JSON. Later tasks quote it; do not paraphrase it.

- [ ] **Step 1:** Add "## Runs integration" to gate-protocol/SKILL.md containing exactly this recipe (adjusting only surrounding prose to the part's voice):

````markdown
A gated pipeline site publishes its decision on the run's subject and lets
attendance pick the branch. Each tool call is a fresh shell: capture values
in the same call that uses them.

1. **Read the run identity once** (id and attendance from the run record):

   ```bash
   SNAP=$(rt runs snapshot)   # reads RT_RUN_DB; {"run":{...},"stages":[...],...}
   RUN_ID=$(printf '%s' "$SNAP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["run"]["id"])')
   SPAWNED_BY=$(printf '%s' "$SNAP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["run"].get("spawned_by") or "")')
   ```

   **Attendance rule:** unattended iff `SPAWNED_BY` is non-empty; attended
   otherwise. Every site uses this test and no other.

2. **Bracket and publish.** Keep the run-record bracket, then open the gate.
   Attended panes include a nudge so an external answer doorbells this
   session; unattended panes need none (the wait is the delivery):

   ```bash
   rt runs field set gate <scope> --stage <stage>
   if [ -z "$SPAWNED_BY" ]; then   # attended: nudge this session so an external answer doorbells it
     GATE=$(rt gate open --subject "run:$RUN_ID" --kind <scope> --questions '<questions json>' \
       --nudge "{\"session\":\"$CLAUDE_CODE_SESSION_ID\"}")
   else                            # unattended: no nudge; the wait is the delivery
     GATE=$(rt gate open --subject "run:$RUN_ID" --kind <scope> --questions '<questions json>')
   fi
   GATE_ID=$(printf '%s' "$GATE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
   ```

3. **Attended:** present the site's question as today's unchanged in-pane
   form, then record the form's choice: `rt gate answer "$GATE_ID"
   --answers '<json>' --by pane`. A CAS rejection means another surface
   answered first — say which answer won and proceed on the recorded one.
   If the doorbell arrived while the form sat, the next step is the same
   registry verify either way.

4. **Unattended:** block in a bounded wait and re-run on budget:

   ```bash
   rt gate wait "$GATE_ID" --timeout 90s
   ```

   Exit 124 with `{"ok":true,"timedOut":true}` = no answer yet: run the
   same command again; this loop IS the wait. Exit 0 prints
   `{"ok":true,"status":"answered","row":{...}}` — the answers are at
   `row.answer.answers`, the deciding surface at `row.answer.by`.
   `status:"closed"` or a `gate not found` failure is terminal: the
   decision site was abandoned; end this path cleanly, never invent an
   answer, never present a form.

5. **Record at execution time**, decider = the surface that answered:

   ```bash
   rt runs decision record --contract gate@1 --scope <scope> \
     --selection '<json>' --decided-by <row.answer.by>
   ```

   (`--decided-by` is `pane`, `board`, `console`, or `shepherd` — never a
   verb name.)

6. **Daemon down** (gate open fails): attended sites fall back to the
   unchanged in-pane form alone, recording `--decided-by pane`; unattended
   sites fail the stage rather than presenting a form.
````

- [ ] **Step 2:** Stage contract v4 in convention.md: the recipe sentence becomes "bracket with `field set gate` → publish and resolve per gate-protocol's Runs integration → `decision record --decided-by <the answer's by>`". Scope catalogue :413-416: remove `post-severity`, `post-disposition`, `verdicts`, `fixes`; add `respond-plan`, `respond-post`, `doctor-escalation`; the standalone list reads `(`post`, `respond-plan`, `respond-post`, `doctor-escalation`, `self-review`, `sweep`, `push`, `conflict`, `wrap-up`)`. (E4 owns the receive-review prose; THIS task owns the catalogue.)
- [ ] **Step 3:** certify.sh both dirs; commit "gate-protocol: runs integration recipe; convention: stage contract v4, scope catalogue updated".

### Task E2: pipeline stage sites adopt (5 files, 7 sites)

**Files:** `attachments/pipeline/stage-plan/SKILL.md:81-98` (plan), `stage-provision/SKILL.md:62-78` (provision), `stage-evidence/SKILL.md:41-51` (evidence) + `:63-76` (evidence-attach), `stage-ship/SKILL.md:31-46` (ship), `stage-watch-ci/SKILL.md:104-118` (ci:watch-ci:<attempt>) + `:120-133` (mark-ready).

- [ ] **Step 1:** Each verb gains `{{include:gate-protocol}}` once (own `## Gate protocol` section, placed per the wrap-up-form include convention). Each site's recipe becomes: "run gate-protocol's Runs integration with kind `<scope>` and these questions:" followed by the site's EXISTING questions/options verbatim. Copy the E1 recipe's invocations exactly; change only kind and questions. The site's option text, recommendations, and Hold options are preserved character-for-character.
- [ ] **Step 2:** certify.sh each dir; `rt skills check --pack mattstack` current; commit "pipeline stages publish facility gates (v4)".

### Task E3: standalone verbs + forge adopt (7 files, 15 sites); resume offers stay in-pane

**Files:** `attachments/pipeline/ship/SKILL.md:63-82,105-120`, `watch-ci/SKILL.md:144-157,159-167`, `work/SKILL.md:79-93,114-134,136-146,148-167`, `attachments/review/self-review/SKILL.md:141-158,106-112`, `attachments/forge/sync-open-mrs/SKILL.md:85,110`, `rebase-worktree/SKILL.md:94,115`, `checkout/SKILL.md:38`.

- [ ] **Step 1:** Same verbatim-copy adoption as E2 for all 15 sites. Self-review's fix/ship gate is the V1 smoke target — its unattended branch must read exactly as the recipe's step 4. **Resume offers (ship:25-37, watch-ci:31-45, self-review:31-45, receive-review:31-45, work:98-112) are DESCOPED from publishing**: they fire before any run is chosen, attended-only by definition; they keep today's in-pane form unchanged. Leave their text alone.
- [ ] **Step 2:** certify.sh each dir; commit "standalone verbs and forge publish facility gates".

### Task E4: receive-review restructures — adjudicate and execute, never decide

**Files:** `attachments/review/receive-review/SKILL.md` (gates at 142-152, 178-186, 194-211).

**Produces (B3 and P1 quote these verbatim):** Gate 1 kind `respond-plan` question shape — one multi-select question per thread GROUP (groups bound the form cap, threads stay individually decidable because option values carry thread ids):

```json
[
  {"id": "threads-1", "label": "Threads 1-8: reply, fix, or skip each", "multi": true,
   "options": ["reply:<threadId>", "fix:<threadId>", "skip:<threadId>", "... one triple per thread in the group, ids verbatim"]},
  {"id": "code-changes", "label": "Approve the proposed code changes?", "multi": false,
   "options": ["approve", "revise"]}
]
```

(Selecting `fix:<id>` implies the reply; `skip:<id>` means neither; exactly one of the triple per thread is expected — the verb validates and re-asks on a contradictory selection via a NEW gate.) Gate 2 kind `respond-post`:

```json
[
  {"id": "replies", "label": "Post which replies?", "multi": true, "options": ["<threadId> per drafted reply"]},
  {"id": "disposition", "label": "Disposition", "multi": false, "options": ["resolve-addressed", "leave-open"]}
]
```

The caller-handed answers object is `{plan: {"threads-1": [...], "code-changes": "..."}, post: {"replies": [...], "disposition": "..."}}` — the raw gate answers keyed by question id, verbatim option strings.

- [ ] **Step 1:** Collapse the three gates: the verb produces the adjudication (verdict table + drafted replies + recommendations) and reports it in one structured block. DECISION INTAKE: a caller that hands answers (the board wrapper) supplies the `{plan, post}` object above and no question is asked. Otherwise the verb runs the two gates itself per E1's recipe (kinds `respond-plan` then `respond-post`, the question shapes above, chunked forms → ONE atomic answer per the part). One decision record per gate at execution time, scopes `respond-plan`/`respond-post`, decided-by from the answer.
- [ ] **Step 2:** Execution halves keep everything: fresh-context adjudication HARD-GATE, one-at-a-time verified fixes, reply voice rules, posting HARD-GATE — driven by decided answers, never deciding.
- [ ] **Step 3:** certify.sh; commit "receive-review: caller-owned two-gate protocol (respond-plan, respond-post)".

### Task E5: shepherdr rides the registry

**Files:** `attachments/orchestration/shepherdr/SKILL.md` (~301-352), `references/job-template.md` (:42-49 + the Method/run-start guidance), `references/herd-bus.md`, `hooks/pipeline-gate-stop.sh` (:90-93).

- [ ] **Step 1 (worker contract):** Run-backed worker questions stop using `herd-ask.py` — they are the pipeline sites' facility gates (E2/E3). `job-template.md`: delete the run-backed herd-ask instruction; ADD to the worker brief: "when your Method runs a pipeline verb, start the run with `--spawned-by shepherdr` on `run-start`" — this is what makes every site's attendance test take the unattended branch. KEEP herd-ask/relay for design-job and pre-run questions (no run id; relay-only in v1). The shepherd's own strategy/model + account questions stay as today.
- [ ] **Step 2 (shepherd surface):** After spawning, register ONE `rt gate subscribe --subject-prefix run: --session <this session>` (session id from `$CLAUDE_CODE_SESSION_ID`). A gate push carries only the gate id and status — NEVER the question. On any push: `rt gate list --open --subject-prefix run:` and match rows against the herd DB's `jobs` run ids — that read-back IS the filter; unrelated runs' gates are dropped silently. Present matched questions in the shepherd conversation exactly as today's relay; record the human's choice `rt gate answer <id> --answers '<json>' --by shepherd` (CAS loss = say which answer won, proceed). Recovery after any gap: the same list-and-match, plus `rt gate subscriptions` to confirm its own row is alive, re-subscribing if pruned. herd-wait.sh and herd-bridge.py stay (pane lifecycle is not a gate concern).
- [ ] **Step 3:** `pipeline-gate-stop.sh` :90-93 stderr: the "open the decision" exit references gate-protocol's Runs integration, not the old field-set-only text.
- [ ] **Step 4:** certify.sh shepherdr; `bash hooks/tests/test-herdr-doorbell.sh` + `bash attachments/orchestration/shepherdr/scripts/herd-scripts.test.sh` green (scripts unchanged); commit "shepherdr: run-backed herd questions ride the gate registry; one subscription, answers --by shepherd".

### Task E6: engine release pass

- [ ] **Step 1:** repo-purity, bun test, stubs-no-source-collision, `rt skills compile/check --pack mattstack` current, certify every touched dir. Bump plugin.json → `0.15.0` in the final commit ("engine: pipeline + respond + shepherdr on the gate facility; 0.15.0"). CERTIFICATION.md rows: controller appends.
- [ ] **Step 2 (Matt gates):** push + `claude plugin update mattstack`.

---

## Lane B — board (repo: board, worktree deft-inlet, branch `gate-kinds-w3` off main 8b33cbb)

### Task B1: subject+kind cache keying; gateId-addressed answers; kind-aware sweep

**Files:**
- Modify: `src/gates/cache.ts` (key subject+kind; internal shape implementer's pick, tests pin behavior), `src/gates/answer.ts`, `src/server.ts` (`findAnswerableGateId` :1289, `gateResumeIo` ~:1794 — the FUNCTION is `gateResumeIo`, the type `GateResumeEventIo` — `/gate/answer` handler, attachGates call sites :541/:612 area), `src/gates/store.ts` (client GateRow gains `kind: string` and `label: string` mapped from the facility row's `meta.label ?? kind`), `src/client/board/RowView.tsx`, `src/client/board/GateCard.tsx` (title renders `label`), `src/gates/sweep.ts` + `src/gates/execute-sweep-action.ts` (kind-aware, below)
- Test: `gates-cache.test.ts`, `gates-answer.test.ts`, `gates-sweep.test.ts`, `gates-execute-sweep-action.test.ts`, client tests

**Interfaces produced:**
- `GateCache.get(subject, kind)`, `GateCache.rowsFor(subject): FacilityGateRow[]`, `rows()` unchanged.
- `attachGates` attaches `gates: GateRow[]` (plural; singular `gate` retires), each `{gateId, kind, label, status, openedAt, questions, answers?}`. Answered-row scoping is PER KIND: `review-post` renders while `mr.review.status` non-terminal; `respond-plan`/`respond-post` while `mr.respond.status` non-terminal; `doctor-escalation` while `mr.doctor.status` non-terminal (the attach chain already carries all three states — server.ts:552-554).
- `/gate/answer` body `{gateId, answers}`; `answerGate(gateId, answers, io)` resolves by id over cache rows (open|parked only); mrUrl lookup retires.
- **Kind-aware sweep:** `planSweep(rows, states, now, graceMs)` where `states = {reviews, responds, doctors}` — a park action's `tabId` joins from the state map the row's KIND owns; `close-missed-done` scans only `review-post` rows for its no-open-row check AND gains respond/doctor equivalents scoped to their own kinds and state maps. `ExecuteSweepActionIo` takes per-kind `{writeState, filePath}` records so a parked doctor gate closes the DOCTOR pane's tab and a done-review close never depends on other kinds' open gates.

- [ ] **Step 1 (RED):** two kinds coexist on one subject; answered patch finds the right row by id; attachGates returns both with kind+label and per-kind answered scoping (a done review with a live respond gate: review card gone, respond card present); `/gate/answer` by gateId preserves 200/409/404/400/502; sweep parks a doctor row closing the doctor tab while the review tab survives; close-missed-done fires for a done review even with an open respond gate on the same MR.
- [ ] **Step 2-4:** implement → GREEN → full suite + typecheck.
- [ ] **Step 5:** commit "gates: subject+kind cache, gateId answers, kind-aware sweep and cards".

### Task B2: verbs generalize over kind + state file; resume rebuilds by kind

**Files:**
- Modify: `src/gates/verbs.ts` (gateOpen takes `kind`; `meta.label` = `review gate !<iid>` / `respond gate !<iid>` / `doctor gate !<iid>` by kind; state read stays `{mrUrl, iid, status}`-shaped; gateId AND `gateKind` persist to the state via the injected writer), `bin/gate.ts` (`gate open <state> --kind <k> --questions <json>` — kind REQUIRED, no default), **`skills/review/SKILL.md` (the open invocation gains `--kind review-post`; ONLY that line changes — everything else byte-identical)**, `src/respond-state.ts` + `src/doctor-state.ts` (add `gateId?`, `gateKind?`, `resumedGateId?` to interfaces AND merge lists), `src/review-state.ts` (add `gateKind?` to interface AND merge list), `src/gates/resume.ts` (kind map: `review-post` → board:review as today; `respond-plan`|`respond-post` → `dispatchPrompt("board:respond", {mrUrl, statePath: respondFilePath(mrUrl), statusBin: statusBinPath(), skill: <the respond-side resolveLaunchSkill mirror>, resumedGate})`; `doctor-escalation` → `dispatchPrompt("board:doctor", {...doctor args, resumedGate})`; an UNKNOWN kind still throws — the deliberate never-silently-mishandle guard stays), `src/server.ts` (`gateResumeIo` gains the per-kind seam record `{readState, writeState, filePath, resolveSkill, prompt}` per kind — reviews keep today's wiring; responds/doctors wire their own state fns and workspace), `src/herdr.ts` (respondPrompt/doctorPrompt accept `resumedGate?` → `--resumed-gate`)
- Test: `gates-verbs.test.ts` (all three wrapper invocations carry --kind; missing kind = usage error; label by kind; gateKind persisted), `gates-resume.test.ts` (per-kind rebuild + exactly-once per state file + unknown-kind throw), `respond-state.test.ts` / `doctor-state.test.ts` / review-state coverage (merge-list widening x3)

- [ ] Steps: RED → GREEN → full suite (review flow byte-identical EXCEPT the one --kind line — assert the wrapper text carries it) → commit "gates: verbs and resume generalize over kind; states carry gate fields".

### Task B3: respond wrapper speaks mr-respond@2 (two gates)

**Files:** rewrite `skills/respond/SKILL.md` (slot → `slot-respond: "required mr-respond@2 -- owns processing review feedback on one MR: fetching threads, adjudicating, drafting, implementing decided fixes, and executing posting once handed the decisions. Never presents decision gates or decides what posts."`); `src/__tests__/skills-resolve.test.ts` (wrappers table `mr-respond@1` → `@2` AND the `fixtureSkill("fake:respond", ...)` line :37-40). Writing-skills mandatory.

- [ ] **Step 1:** Flow: statuses unchanged. After the domain skill reports its adjudication table, the wrapper opens Gate 1 `gate open <state> --kind respond-plan --questions '<E4's Gate-1 shape, quoted verbatim from the plan>'`, waits (bounded pending loop; closed/not-found/no-gate-open terminal per the review wrapper's closed-gate section — mirror that prose), hands the plan answers down as E4's `{plan: ...}` object; after fixes, Gate 2 `--kind respond-post` (E4's Gate-2 shape), waits, hands `{post: ...}` down, then `done --posted N --threads M`. **Re-entry (`--resumed-gate <id>`):** never re-adjudicate and never re-open; read `gateKind` from the state file to learn WHICH gate the id names (B2 persists it): `respond-plan` → `gate wait` returns the recorded plan instantly, implement from it, then proceed to Gate 2 fresh; `respond-post` → wait returns the post answers, execute posting from the draft. Escape hatch + CAS + strict membership prose: same contract as the review wrapper, self-contained.
- [ ] **Step 2:** suite; commit "respond wrapper: two facility gates (mr-respond@2)".

### Task B4: doctor wrapper escalation gates (mr-doctor@2 family)

**Files:** rewrite `skills/doctor/SKILL.md` gate-relevant prose (slots → `mr-doctor@2` / `mr-doctor-api@2`); `skills-resolve.test.ts` wrappers table + fixture lines. Writing-skills mandatory.

- [ ] **Step 1:** Where the flow dead-ends in `error` with an ENUMERABLE decision (conflict strategy, author-gate override, budget extension — the §Escalation phrasing cases at :198-206), the wrapper instead opens `gate open <state> --kind doctor-escalation --questions '[{"id":"action","label":"<one-line situation>","multi":false,"options":[<executable options verbatim>, "leave it to me in the pane"]}]'` and waits (bounded loop). Every option is executable from the wait return: "leave it to me in the pane" = stop mechanized action, say so, and hold the pane for the human. Non-enumerable failures remain `error` exactly as today. **The author-gate invariant survives verbatim: "Re-verify the author gate before applying, every time" (:164-170) — an answered `author-gate override` escalation STILL re-verifies independently before acting; quote the existing prose in the new section.** **Re-entry (`--resumed-gate <id>`):** never re-diagnose and NEVER re-run `gate open` (a re-open would supersede and orphan the human's answer); `gate wait` returns the recorded escalation answer instantly; act on it.
- [ ] **Step 2:** suite; commit "doctor wrapper: enumerable dead-ends escalate through the facility (mr-doctor@2)".

### Task B5: legacy-state boot migration

**Files:** `src/server.ts` (one-shot boot pass beside :1822-1832's pattern), state readers/writers.

- [ ] **Step 1:** Boot pass (best-effort, `!FIXTURE_DIR`, try/catch log): for each REVIEW and RESPOND state file with `sessionId` set and no `agentId`, write `sessionId: ""` (the merge-list trap: `patch.sessionId ?? prev.sessionId` makes undefined a no-op — `""` is the clear, same as tabId's documented convention). DoctorState has no sessionId field — doctors are excluded. Log one line per migrated file. Tests: legacy review + respond files clear; agentId-bearing and clean states untouched.
- [ ] **Step 2:** suite; commit "boot: legacy session pointers cleared so parked gates resume via the agent path".

### Task B6: board PR (gated behind P3)

- [ ] Full suite + typecheck; push `gate-kinds-w3`; PR base main covering B1-B5 + the W3 plan doc; coderabbit + CI. **Merge only after Lane P's release is live (P3): Matt gates the merge, then `deck restart board`.** The PR body states the ordering dependency.

---

## Lane C — console (repo: console, branch `run-gates` off main)

### Task C1: rt-client bump + server gate surface

**Files:**
- Modify: `package.json` (`@mattstack/rt-client` → `^0.15.0`; regen lock), `src/server/index.ts:11` (add RelaySpec `{ match: t => t.startsWith('gate/'), topic: 'gates' }`), Create: `src/server/gates.ts`, mount in `src/server/routes.ts` (chained — the :10-14 comment is load-bearing for RPC types)
- Test: `src/server/gates.test.ts`

**Interfaces produced:** `GET /api/gates` → `{ gates: GateRow[] }` (server pages `gateList({subjectPrefix:"run:", limit:200, cursor})`, terminating per the global paging rule); `POST /api/gates/:id/answer` body `{answers}` → `gateAnswer({id, answers, by:"console"})` → 200 ok; 409 + `{row}` on `conflict`; 404 only on exact `not-found`/`closed`; 502 on transport-style failure; 400 on other validation-shaped daemon errors.

- [ ] Steps: RED (paging terminates on short page AND repeated cursor; answer maps all five statuses) → GREEN → test/typecheck → commit "server: run gate list + answer endpoints; gate events join the WS relay".

### Task C2: RunRow badge + RunDetail gate card

**Files:**
- Create: `src/app/runs/GateCard.tsx` + `src/app/runs/gate-format.ts` (port from board `src/client/board/GateCard.tsx` + `gate-format.ts`: question rendering multi/single, GateAnswerSummary via unwrapGateAnswer, three states, null-payload-disables-submit, stopPropagation, parseConflictResponse for 409; DROP mrUrl keying — POST `{answers}` to `/api/gates/:id/answer`)
- Create: `src/app/runs/useGates.ts` (useQuery `['gates']` → `client.api.gates.$get()`; extend `useRuns.ts:44-53`'s WS invalidation to `['gates']` and UPDATE the stale :35-38 comment — the socket now carries two topics)
- Modify: `src/app/runs/RunRow.tsx` (blocked chip in the trailing Group :213-234 when an OPEN gate exists for `run:<run.id>`; the Group is a fixed-width 232px nowrap band — widen or rebalance it deliberately for the chip), `src/app/runs/RunDetail.tsx` (gate card sibling between SummaryCard and the Tabs Paper when a gate for the run is `open` or `parked`, or `answered` while the run's status is still `running` — the run's own liveness is the scoping window, no time-based window; Answer sits beside the existing FocusPaneAction)
- Test: RunRow/RunDetail (extend the vi.mock('../api') nested stubs; notifications.clean() where toast assertions repeat), GateCard.test.tsx

- [ ] Steps: RED → GREEN → test/typecheck/format → commit "runs: blocked badge + gate card answer surface (run: gates)".

### Task C3: console PR

- [ ] Push, PR base main (body: run-gate surface; rt-client ^0.15.0 = the gate verbs' floor), coderabbit + CI; **Matt gates merge**.

---

## Lane P — pack (repo: `/Users/matt/.mattstack/teams/acme-web`, branch `gate-kinds-fills`)

### Task P1: respond fill → thin @2 adapter (dual provides)

**Files:** `mattstack/packs/acme-web/attachments/board-respond/SKILL.md` (`provides: "mr-respond@1 mr-respond@2"`), PACK.md ledger row, recompiled `skills/` output vs engine 0.15.0 (installed post-E6; else the S2-documented `--pack-dir`/`--mattstack-dir` escape hatch, re-verified post-update).

- [ ] Steps (writing-skills): the fill invokes receive-review declaring caller-owned decisions; reports the adjudication table up to the wrapper shaped so the wrapper can build E4's Gate-1 questions (quote E4's shapes verbatim from the plan); on handed `{plan}` implements; on handed `{post}` executes posting and hands the outcome back. Under an @1 wrapper: the engine's own facility gates ask (E4's fallback). Pack checks clean; @1-compat commit note.

### Task P2: doctor fills → @2 (dual provides both)

**Files:** `attachments/board-doctor/SKILL.md` + `board-doctor-api/SKILL.md` (`provides: "mr-doctor@1 mr-doctor@2"` / `"mr-doctor-api@1 mr-doctor-api@2"`), PACK.md rows, recompile.

- [ ] Steps: the fills name their enumerable option sets verbatim (conflict strategies, author-gate override, budget extension) so the wrapper's escalation gate carries executable option text; non-enumerable stays error; the author-gate re-verify invariant restated. Checks; commit.

### Task P3: review fill drops @1 + pack release (Matt-gated; unblocks B6)

- [ ] `board-review/SKILL.md` `provides: "mr-review@2"` only + PACK.md row. Pack version bump; acceptance/check scripts clean; **Matt gates push + plugin update.** This release must be LIVE before B6 merges.

---

## Lane V — W3 exit: the spec's five smokes (run WITH Matt)

- [ ] **V1:** herd-spawned worker blocked at a self-review gate (unattended: no form) answered from the console; the wait returns, the run proceeds, no message ever sent.
- [ ] **V2:** attended `:work` pane answered from the console reconciles at the human's next touch (the recipe's nudge makes the doorbell real; queued doorbell → registry verify → recorded answer wins).
- [ ] **V3:** a shepherd herd question (worker gate) answered from the console; the shepherd's push + list-and-match sees it resolved.
- [ ] **V4:** a doctor escalation answered from the board card.
- [ ] **V5:** respond's two gates end to end — plan answered from the board card, post answered in-pane (the console renders `run:` only; `mr:` gates answer from board or pane).
- [ ] Close SKILLS-58 (herd path shipped) with the dogfood evidence; note SKILLS-35's watcher fragility structurally resolved.

## Explicitly out of W3

Cross-rendering (console↔`mr:`, board↔`run:`); retiring `rt runs field set gate` bracketing; resume offers publishing (attended-only, pre-run — kept in-pane); design-job/pre-run shepherd questions off the relay; pane-only `meta` option markers and card-side disabling; the board answering herd gates. W4 candidates; none blocks the spec's W3 verification.
