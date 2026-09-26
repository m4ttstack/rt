# Gate Kit Extraction Brief

Input to the ui-platform monorepo spec (app-kit repo,
`docs/superpowers/specs/2026-09-05-ui-platform-monorepo-design.md`) and the
seed of the future gate-kit spec. Matt's direction (2026-09-06): a HEADLESS
gate library shipped like settings-kit, so tui-kit and app-kit implement
only rendering. Placement is Matt's call at the platform spec's phase-end
check-in; the coupling table below is the input to that call.

Anchors reference board main 44865c5 and console main 630f35c (post-W4,
post-follow-up-sweep). The W4 wave's final reviews caught the two apps
diverging once already on supposedly shared logic (worktree-path
normalization), which is the concrete case for extraction.

## Extraction inventory (the byte-identical or rule-identical pairs)

| Shape | board | console | Today |
|---|---|---|---|
| Answer payload builder (null until every required question answered; one atomic submission) | `src/client/board/gate-format.ts:41` `gateAnswerPayload` | `src/app/runs/gate-format.ts:28` `gateAnswerPayload` | rule-identical, hand-synced |
| Option value/label mapping (render label, submit value verbatim) | `gate-format.ts:128` `optionValue`, `:134` `optionDisplayFor`, `:142` `displayForValue` | `gate-format.ts:92` `optionValue`, `:96` `optionLabel`, `:100` `displayValueLabel` | rule-identical; board adds the legacy verb-token transform |
| Respond collapse (hide code-changes until a `fix:` selection; submit the `skip` sentinel while hidden) | `gate-format.ts:224-236` constants + `codeChangesHidden` | `gate-format.ts:108-118` constants + `codeChangesHidden` | byte-identical logic, hand-synced constants |
| Per-thread grouping predicate (complete unique verb set per token, flat fallback) | `gate-format.ts:197` `groupThreadOptions` | not yet ported | board-only; console wants it on adoption |
| Origin -> focus resolution (paneId direct, worktree match, reasoned failure) | `src/gates/focus.ts:31` `resolveOriginFocus`, `:19` `normalizeWorktreePath`, `:64` `panesForOrigin` | `src/server/gates.ts:97` `resolveOriginFocus`, `:81` `normalizeCwd` | rule-identical after a caught divergence; still two copies |
| CAS-winner handling (409/conflict:true carries the winning row; surface flips to answered) | `src/server.ts` answer proxy + card state | `src/server/gates.ts` answer route + `useGates` 409 invalidation | same contract, two implementations |
| Kind -> domain map | `src/gates/sweep.ts:31` `GATE_KINDS`, `:39` `domainForKind` (guarded by `src/__tests__/gates-kind-sync.test.ts`) | n/a (console is kind-agnostic) | board-owned; a kit would make it the shared registry of board-domain kinds |

Wire types both apps consume: `GateOption`, `GateOrigin`, `GateRow`,
`gateOptionValue`, `gateOptionLabel` from `@mattstack/rt-client`
(rt repo `packages/rt-client/src/commands.ts:97-108`). The barrel is
browser-unsafe (module-scope settings resolver touching fs), which is why
the console lint-walls value imports in app code and the board's client
re-declares types locally. The kit's browser-safe core entry designs this
trap away.

## Coupling table (daemon-versioned vs UI-versioned)

Per the platform spec's rule, home follows coupling: daemon-versioned
packages live in repo-tools beside rt-client and settings-kit;
UI-semantics-dominated packages live in the platform monorepo.

| Shape | Versions against | Class |
|---|---|---|
| Answer payload (`{gateId, answers}` dict, all-questions rule) | daemon `gate:answer` validation | daemon |
| CAS conflict contract (`conflict:true` + winning row) | daemon answer verb | daemon |
| Option `{value,label}` shape + value-only membership | daemon `gate:open` validation | daemon |
| Origin schema (`paneId/tabId/runId/worktree/presentation`) | daemon open verb + delivery | daemon |
| Focus resolution (paneList cwd match, paneFocus call) | daemon `pane:list`/`pane:focus` verbs + path-normalization semantics | daemon-leaning mixed |
| Collapse rule (form shaping over an unchanged atomic answer) | wrapper protocol conventions (kind + sentinel strings) | UI-leaning mixed |
| Grouping predicate, display transforms (label ?? value, verb-token legacy) | pure rendering policy | UI |
| Kind -> domain map | board wrapper protocol | UI (board-domain) |

Reading: the kit's load-bearing core (payload, CAS, options, origin,
focus) versions against daemon verbs; the UI-versioned pieces are thin
policy helpers layered on that core. By the spec's own rule this table
leans repo-tools (beside rt-client, published like settings-kit), with the
UI-policy helpers either included (they are dependency-free functions) or
left to the kits. Counterweight: if the triage modal work grows the
UI-policy layer faster than the daemon contract moves, the balance shifts
monorepo-ward. Matt decides at the platform phase-end check-in.

## Constraints the kit must satisfy (from the platform spec)

- Headless: zero react/mantine/soribashi dependencies; pure functions and
  framework-free state helpers only.
- Browser-safe core entry; any daemon I/O (paneList, answer submission)
  behind a separate subpath, designed against the rt-client barrel trap
  (app-server's vitest-safe-seams split is the house pattern).
- Consumers pin with >=0.x floors, not carets.
- Per-surface variance stays in the consumers: the board's tabId fallback
  in focus, the console's panesUnavailable reason wording, and all actual
  rendering.

## What adopting it retires

The hand-sync watch items above; the board's client-local type
re-declarations; the console's local helper duplication under the lint
wall; and the class of cross-surface divergence the W4 final reviews had
to catch by hand. The gate triage modal then builds once on the kit.

## Direction update (2026-09-06 afternoon): fold-in supersedes the home lean

Matt's direction via the ui-platform thread: ALL FIVE apps (chat, console,
boxscore, board, deck) fold into the app-kit monorepo, renamed
m4ttstack/apps; platform npm publishing ends. That flips this brief's home
conclusion: with board and console as workspace siblings, gate-kit's
natural home is an INTERNAL workspace package in m4ttstack/apps
(unpublished, like tokens), per the minimum-published-surface principle.

The daemon-versioned core in the coupling table is unchanged as a fact; it
now argues only for the kit's DEPENDENCY shape, not its address: the kit
consumes wire types from @mattstack/rt-client and moves in lockstep with
the workspace's single rt-client pin. Everything else in this brief
(inventory, constraints, headless boundary, per-surface variance) stands.
Formal placement remains Matt's call at the platform phase-end check-in.
