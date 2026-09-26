# Console: one organized settings page, shapes shared through settings-kit

Spans two repos: `m4ttstack/rt` (`packages/settings-kit`, published as
`@mattstack/settings-kit`) and this repo (`apps/console`, `apps/board`).
Mockups: `console settings.pen` (browse in both schemes, filtering,
composite row states, Board section, Codex tab with empty and loading
states).

## Problem

Console's only way to reach most settings is Cmd+K, which lists all 102
registered keys, each row the key followed by its full description. Long descriptions wrap to
ten lines, so the palette turns into a wall of text, and runs get buried
under config. The Settings rail page shows only the six `agent.*` fields.
Nothing shows where a value comes from at a glance, and object and array
keys cannot be edited anywhere except board's modal, which covers board
keys only.

## Fix

`/settings` becomes the home for every registered key: grouped into 12
sections, filterable, each row editable in place with its source layer
shown as a coloured badge. Cmd+K drops settings entirely. The composite
shape declarations board keeps privately move into settings-kit so board,
console and boxscore share one definition, and settings-kit only admits a
composite write whose value matches its declared shape.

Delivery order: settings-kit 0.2.0 ships to npm first, then this repo
consumes it (board, then console).

## settings-kit 0.2.0 (`m4ttstack/rt`)

**New headless entry `@mattstack/settings-kit/shapes`.** No React, no rt
imports; pure data and functions over `SettingDefWire`.

```ts
type LeafType = 'string' | 'number' | 'boolean' | { enum: readonly string[] };
type CompositeShape =
  | { kind: 'stringList' }
  | { kind: 'pairList'; fields: readonly [string, string] }
  | { kind: 'stringMap'; labels: readonly [string, string] }
  | { kind: 'leaves'; fields: Record<string, LeafType>; fallbacks?: Record<string, string> }
  | { kind: 'external'; app: string };
export const SHAPES: Record<string, CompositeShape>;
export const ENUMS: Record<string, readonly string[]>;
```

- `stringMap` is a plain object of string to string, edited as two
  columns; `labels` names them. `pairList` (an array of two-field objects)
  stays for parity with board, though no shipped key uses it today.
- `external` replaces board's `roster` and `tabs` kinds. Settings-kit knows
  only that another app owns the editor; board keeps rendering its roster
  and tabs editors for those keys.
- Helpers moved verbatim from `apps/board/src/client/board/config-shapes.ts`:
  `matchesShape`, `getLeaf`, `setLeaf`, `addToList`, `filterDefs`,
  `isSet`, `formatValue`, `parseScalar`, `rowKind`. `rowKind` returns
  `'scalar' | 'enum' | CompositeShape['kind'] | 'readonly'`; `enum` is a
  string scalar listed in `ENUMS`.
- New `summarize(def): string`: the collapsed composite line.
  `stringList` gives `N <noun>` (noun from the last key segment,
  singularised when N is 1), `pairList` and `stringMap` give `N entries`,
  `leaves` gives
  `S of F set` where S counts fields present in the effective value.
- New `targetScope(def): string`: the scope an edit writes to. The winning
  layer when it is one of `def.scopes`; otherwise `def.scopes[0]`.
- `DEFAULT_SLACK_EMOJI` moves with `board.slack`'s fallbacks.

**Shapes shipped in 0.2.0.**

| key | shape |
|---|---|
| `board.projects`, `board.botUsernames`, `board.ticketPrefixes` | stringList |
| `board.workspaces`, `board.cwds`, `board.slack`, `board.triage`, `board.reReview` | leaves (fields as board declares today) |
| `board.tabs`, `board.members`, `board.hiddenMembers` | external `board` |
| `rt.homeSnapshot`, `rt.teamSnapshot` | leaves: enabled bool; debounceSec, pushDelaySec, janitorThresholdHours, janitorIntervalMin number; teamSnapshot adds pullIntervalSec |
| `rt.gitStatus` | leaves: sweep bool; sweepIntervalSec, fetchIntervalSec number |
| `rt.worktreeApp` | leaves: enabled, killProcesses bool; claudeHook string |
| `rt.notifications` | leaves: one bool per key of `NOTIFICATION_TYPES` in rt's `lib/notifier.ts` (16 today) |
| `rt.repoRoots`, `rt.trustedBrowserOrigins`, `setup.waived` | stringList |
| `rt.repoIdentityOverrides` | stringMap `['remote URL', 'identity']` |
| `boxscore.projects`, `boxscore.linearDoneStates`, `boxscore.excludeFilePatterns`, `boxscore.ignoredMrs`, `boxscore.botPatterns` | stringList |
| `boxscore.sizeBand` | leaves: tooSmall, tooLarge number |
| `gitq.workSlots` | leaves: workSlotLocation string, maxWorkSlots number |

`ENUMS`: `agent.provider` (claude, codex), `rt.logLevel` (trace, debug,
info, warn, error), `boxscore.defaultRange` (7d, 30d, 90d), `mattstack.mode`
(dev, prod).

Every other object or array key has no shape and stays read-only: nested
maps (`rt.cron`, `rt.repoTracking`, `rt.workspacePrefs`,
`rt.sdmEnrichment`, `deck.*`, `mattstack.integrations`, `mattstack.tracking`),
arrays of objects (`rt.notify.eventBridges`, `mattstack.roster`,
`claude.*`), and repo-scoped keys with no shape (`rt.roles`, `rt.worktrees`,
`rt.sync`, `rt.hooks`, and the rest flagged `repoScoped`). A repo-scoped key
that does have a shape (`rt.gitStatus`) is editable at its global layers
only; its per-repo rungs stay file-edited.

**Fix: the effective layer is the strongest, not the weakest.**
`explainSetting` returns rows weakest-first (default, team, user, machine),
but `effectiveFromRows` returns the first present row, so it reports the
weakest layer as the winner. Measured on 2026-09-22: `rt.homeSnapshot`
(default plus machine) reports `default`; `board.agent.model` (user plus
machine) reports `user`. Board's settings modal shows those wrong values
today. The fix walks the rows strongest-first. For a `merge: 'deep'` object
it also reports the merged value (default, then each present valid layer
overlaid in order, arrays replacing) instead of one layer's slice. An
invalid strongest layer still reports `invalid` with no value.

**Server.** `SettingsHandlerOptions.allowComposite` widens to
`boolean | 'shaped'`. `'shaped'` admits a composite write only when
`SHAPES` has the key and `matchesShape` accepts the value; otherwise 400
with `"<key>" has no editable shape` or `value does not match <key>'s
shape`. `external` shapes are never writable through the handler. `true`
keeps today's behaviour for any host still passing it. Every write route
(`set`, `unset`) requires an `application/json` media type and answers 415
otherwise, the same CSRF rule board's `requireJsonBody` applies.

**React.** `useSettingsScope` gains
`move(key, from, to): Promise<string | null>`: `set` at `to` with the
`from` layer's own authored value (never the effective one, which for a
deep-merged key carries defaults and other layers), then `unset` at
`from`. It refuses when `from` holds no value. If the unset fails it
resolves `moved to <to>, but <from> still holds a value: <reason>` so the
row can say the old layer still wins.

**Release.** Version 0.2.0, published from `packages/settings-kit` with the
npm OTP from Bitwarden. The rt-client peer range is unchanged.

## Board (`apps/board`)

- `config-shapes.ts` drops everything that moved; it keeps
  `rosterSummary`, `slugTabId`, `scopeLabel` and `groupByScope`, and
  imports the rest from `@mattstack/settings-kit/shapes`.
- `ConfigModal` maps `external` rows to its existing `RosterControl` and
  `TabsControl` by key. Nothing it renders changes.
- `server.ts` passes `allowComposite: 'shaped'`.
- `@mattstack/settings-kit` enters the root catalog at `0.2.0`; board,
  boxscore and console declare `"catalog:"` (board and boxscore pin
  `^0.1.3` directly today, against the catalog rule). Boxscore adopting the
  shared shapes is out of scope.

## Console (`apps/console`)

**Server.** `src/server/settings.ts` keeps its three console-only reads
(`runs-prune-days`, `default-editor`, `linear-workspace`) and drops its own
`defs`, `explain` and `set` routes, `defToWire` and `sanitizeRows`.
`settingsHandler` mounts at `/api/settings/*`, after those three typed
routes, with `allowComposite: 'shaped'` and settings-kit's default
`allowWrite`. That default is already the Host rule board uses
(`localhost`, `127.0.0.1`, `::1`, `*.localhost`, `*.mattstack`); a tunnel
forwards the public Host, so a tunnelled write never passes. Today
console's own `/api/settings/set` has no locality gate at all, so this
closes that gap. The router is built by `createSettingsRoutes(kit)` so
tests inject settings-kit's `rt` override instead of mocking rt-client.

**Palette.** `ConsolePalette` drops `useSettingsDefs` and the config
actions. It indexes runs plus the two static nav actions, as before config
was added.

**Routes.** `/settings` renders `SettingsPage`. `/config/:key` stays as the
explain drill-in with its current staging UI; only `useExplainKey` and
`useSetSetting` change, from Hono RPC to plain `fetch` against
settings-kit's `explain` and `set` routes (same JSON shapes).
`AgentDefaultsPage`, `useSettingsDefs` and `useSettingsPrefix` are
deleted, and client types come from `@mattstack/settings-kit/react`.

**Page units** (`src/app/settings/`):

- `groups.ts`: `GROUPS`, an ordered list of `{id, label, tier, match(key)}`
  in three tiers. rt: Agents, Worktrees & repos, Daemon, Herd & panes,
  Notifications & gates, Commands. Apps: Board, Boxscore, Chat, Deck, gitq.
  Suite: Suite-wide. `groupOf(key)` returns the first match. A key nothing
  matches lands in a section named after its first key segment, so a newly
  registered key always appears.
- `units.ts`: the number suffix a key's name implies (`Days` to days,
  `Minutes`/`Mins`/`Min` to min, `Sec` to sec, `Hours` to hours).
- `SettingsPage.tsx`: one `useSettingsScope('')` for all defs. Left index
  with per-group counts; toolbar with the filter (`/` focuses it, Esc
  clears it), the Changed and Editable chips, and the any/user/team/machine
  scope control; then sections. URL state: `?q=` for the filter, `#<group>`
  scrolls the index target into view.
- `SettingsSection.tsx`: title, count, one-line purpose. A section with
  more than 12 keys splits into Team / You / This machine subheads by each
  key's `scopes[0]`, the order board's modal uses.
- `SettingRow.tsx`: key (namespace muted), `ScopeBadge`, the description's
  first sentence, the control for its `rowKind`, save status, and a chevron
  link to `/config/:key`.
- `ScopeBadge.tsx`: Mantine `Badge variant="light"` with a 6px dot. team
  is `purple`, user is `cyan` (both boxscore's existing choice), machine is
  `accent`. `default` and `unset` render as muted text, not a badge. The
  badge is hidden when it equals its subhead's scope. On a writable key
  with more than one allowed scope it opens a `Menu` of the other scopes,
  which calls `move`.
- `controls/`: `ScalarControl` (TextInput, NumberInput with the unit,
  Switch, Select for `enum`), `StringListControl` (inline `TagsInput` up to
  3 items of 16 characters or fewer, else an expanded one-row-per-item
  list with an add field), `PairListControl`, `LeavesControl` (one row per
  field with its own badge; first five fields, then "N more fields"),
  `ReadonlyControl` (summary, a JSON preview when expanded, and the store
  file path), `ExternalControl` (summary plus "edited in <app>", no link:
  console has no way to address another app's URL today).
- The Agents section keeps today's Claude/Codex tabs over the
  provider-scoped keys and the model autocomplete from `useAgentModels`.

**Saving and errors.** A control saves on blur or Enter to
`targetScope(def)`, the same no-staging model as board. Status sits beside
the control: `saving…`, then `saved` with a check for 1.4s. A refusal shows
rt's message verbatim under the row in `--tk-text-bad-small`. A stored
composite that fails `matchesShape` renders "unexpected shape" and a Clear
button that unsets the winning layer. The page's own load failure is an
`Alert` over the sections; the index and toolbar still render.

**Colour and type.** Per `docs/ui-authoring.md`: role tokens only, weights
400/500/700, muted text on `--tk-text-3`, 12px hue text on the `-small`
tokens, filter matches as Mantine `Highlight` (warn light wash). No
scheme branching.

## Testing

- settings-kit: every entry in `SHAPES` accepts its own sample value and
  rejects a wrong-typed leaf; `summarize` and `targetScope` table tests; the
  handler's `'shaped'` gate (shaped key accepted, unshaped rejected,
  mismatched value rejected, `external` rejected) and the 415 on a
  non-JSON write; `move` success and the partial-failure message. A parity
  test in the rt repo asserts `rt.notifications`' fields equal the keys of
  `NOTIFICATION_TYPES`, since settings-kit cannot import `lib/`.
- board: existing config and modal tests pass unchanged against the
  imported helpers.
- console: `groups.test.ts` asserts every key from rt-client's `allDefs()`
  lands in exactly one group and no group is empty; filter, badge-hiding
  and `rowKind`-to-control tests; palette test asserts no config actions.
- UI: Fast Browser against the served console in both schemes, compared
  with the pen artboards, before calling it done.

## Out of scope

- Boxscore's settings page adopting the shared shapes.
- Editors for nested maps, arrays of objects, and repo-scoped layers.
- Linking an `external` row into the owning app.
- Filtering on values.
