# Console JSON editors, per-repo view and fix flow (spec 2 of 3)

**Status:** approved in brainstorming, 2026-09-25; revised after review round 1 and
the settings page audit
**Repo:** apps (`apps/console`, `apps/board`, `apps/boxscore`, `packages/ui`,
`packages/server`)
**Depends on:** spec 1, settings schemas and validation (rt), shipped as the
rt-client and settings-kit releases it names
**Sibling:** spec 3, settings migrations (rt). This spec does not need spec 3, but
reads its fields when present (see "Values from older schema versions").

## Why

Console's settings page can edit 24 JSON keys (settings-kit's shaped ones); the other
28 have no editor. An audit of the page on 2026-09-25 (103 keys against Matt's three
stores) found more:

1. **Per-repo values are invisible.** Nine repo-scoped keys (`rt.roles`,
   `rt.intercepts`, `rt.ignoredMrs`, `rt.sync`, `rt.branchNaming`, `rt.variations`,
   `rt.presets`, `rt.dopplerTemplate`, and `rt.worktrees`) show "unset" or "default"
   while the team or user store sets them for specific repos. The page resolves with
   no repo, so rt omits repo rungs; the explain modal has the same blind spot.
2. **Editing a repo-scoped key writes an all-repos value**, with nothing on the row
   saying so.
3. **JSON values cannot be read.** Rows show a count, and the explain modal cuts
   every value at 40 characters.
4. `rt.worktreeReadyApproval` (a hash approving the team's worktree `ready` shell)
   is a free-text box.
5. Unregistered keys left in stores (`board.claudeCommand`, `board.rtRepos` in the
   machine store) are never shown.

Everything else checked out: all scalar, switch and select values render their data,
no select holds a value outside its options, badges match the effective scope.

Spec 1 gives every JSON key a schema delivered as JSON Schema, per-layer issues on
`/defs`, repo resolution (`?repo=`) and a repo list. This spec uses them.

## Goals

1. Every writable JSON key is readable and editable in console, inline and in the
   explain modal.
2. Common shapes get a form; every JSON key also gets an Edit-as-JSON editor.
3. An edit is checked against the key's schema as you type; an invalid value can
   never be saved.
4. Per-repo values are visible and editable for a chosen repo, and a write's target
   (all repos or one repo, and which layer) is always stated.
5. Stored values that fail their schema are easy to find and fix.
6. Board and boxscore move to the same schema-based widgets.

## Non-goals

- Schemas themselves, server validation, `rt settings check` (spec 1).
- Migrations (spec 3).
- Editing `external` keys (board edits those in its own UI) or secrets.

## Design

### Repo picker

- The toolbar gains a repo select after the scope filter, fed by settings-kit's
  `GET /repos`: "All repos" (default) plus each identity by its display label. The
  choice lives in `?repo=` with the filter's params, so a reload keeps it.
- **All repos:** repo-scoped rows resolve as today (top-level layers only), and a
  row whose key is set in any repo section says so next to its source, for example
  "set in 2 repos", from `def.repos`. The row's control is labeled "all repos" so a
  write's reach is visible. The explain modal lists each repo that sets the key, its
  layer and value, and a link that switches the page to that repo.
- **One repo:** `/defs?repo=` resolves repo-scoped keys for it; rows show the repo's
  effective value and badge the repo rung (`team · repo`, `you · repo`,
  `machine · repo`). Edits write the repo section of the target layer (`repo` in the
  `/set` body); the control is labeled with the repo. Non-repo keys are unchanged.
- The Changed count and the Needs-fixing count follow the picked repo.

### Reading JSON values

- Every JSON row expands to show its value pretty-printed (two-space indent,
  monospace, wrapping) when it has no form, and the explain modal's layer lines show
  each layer's full value the same way instead of cutting at 40 characters. Long
  values scroll inside a capped block.

### Picking the editor

settings-kit's `recognize(schema)` (spec 1) picks the editor. Every JSON row keeps
its collapsed summary and expands in place.

| Recognized as | Editor |
|---|---|
| `stringList` | tag pills (today's widget, unchanged) |
| `stringMap` | key/value rows (today's widget, with `labels` from the schema) |
| `leaves` | labeled fields (today's widget, with `placeholder`s from the schema) |
| `objectList` (array of objects with scalar properties) | item cards |
| `objectMap` (map of string to object with scalar properties) | named sections |
| `json` (anything else) | JSON editor only |

For deep-merge keys the forms use the layer schema (spec 1), so every property is
optional within a layer and the summary names which fields this layer sets.

### Save model

- Scalar controls, tag pills and key/value rows keep today's save-on-commit.
- Item cards, named sections and the JSON editor edit a local draft with Save and
  Cancel on the row (and in the modal), because their in-between states (a new item
  with empty required fields) are invalid. Save is disabled while the draft fails
  its schema; Cancel and Escape discard the draft.

### Item cards (`objectList`)

- One card per item, in order, with Add item, Remove, and Move up / Move down.
- Each card shows a field for every required property plus every optional property
  the item already sets. An "Add property" menu lists the optional properties the
  schema allows and the item does not set yet; a set optional property has a remove
  control, a required one does not.
- Field controls follow today's scalar rules: enum → Select, boolean → Switch,
  number → NumberInput, string → TextInput (Autocomplete where suggestions exist);
  `title`, `description` and `placeholder` come from the schema's metadata.
- Unknown extra properties (allowed by spec 1's lenient schemas) are shown read-only
  at the bottom of the card with a note to use Edit as JSON, and are kept on save.
- New items start from the schema's defaults for required properties, else empty.

### Named sections (`objectMap`)

- One section per entry, titled by its name, with Remove; "Add entry" asks for a
  name (rejecting duplicates and empty names), then shows that entry's fields.
- Inside a section: the same field grid and "Add property" as an item card.

### JSON editor

- Every JSON row and the explain modal have an "Edit as JSON" toggle; for `json`
  keys it is the only editor.
- Built on the kit's lazy `CodeMirror` (`@mattstack/app-kit/lazy`) in `json` mode.
  The kit gains a `jsonSchema?: object` prop that lazily adds schema linting (errors
  underlined at their exact path) and completion of property names and enum values.
  CodeMirror packages stay inside the kit, per the import wall.
- The draft is pretty-printed with two-space indent. Save is disabled while the text
  does not parse or fails the schema; the first issue shows under the editor.
- Escape abandons the edit and does not close the explain modal.
- Switching between form and JSON keeps the draft; switching to the form is disabled
  while the JSON does not parse, with a note saying why.

### What an edit writes

- Every editor edits the target layer's own stored value, never the merged view,
  using `leafWrite`/`fieldSource`'s rule from view.ts: for a deep-merge key, the
  draft starts from that layer's authored value, so defaults and other layers'
  fields are never copied into the store being written.
- The draft is checked with settings-kit's `checkValue` against the key's schema
  (the layer schema for deep keys) as it changes. The server's `validateWrite`
  (spec 1) remains the final word, including the merged-result check; a refusal
  shows on the row like any other refused save.

### Fixing broken values

- The toolbar gains a "Needs fixing N" chip next to Changed and Editable. N counts
  keys with any entry in `def.issues` or `def.mergedIssues` (from `/defs`, no
  per-key calls); the chip filters to them.
- A flagged row shows a warning line per issue with its layer (and repo), for
  example `user · [2].url: expected string`.
- "Fix" on that line opens the key's explain modal (switching the picked repo when
  the issue is in a repo section) with that layer's editor open, form when it can
  draw the value, else JSON, with the issues highlighted and Save disabled until the
  value passes. "Remove from <layer>" stays available.
- Values that fail the type check (skipped by rt) take the same path, in JSON.

### Special rows

- `rt.worktreeReadyApproval` is read-only, explained ("approves the team's worktree
  `ready` commands by their hash; approve with `rt worktree ready-approve`"), with a
  Revoke action that removes it from its layer.
- A footer note lists unregistered keys found in stores (from `rt settings check`'s
  data via settings-kit), with their file, and says rt ignores them.

### Values from older schema versions

- When explain rows carry spec 3's `storedVersion` and migrated `value`, editors
  start from the migrated value, and a save writes the current shape under the current store name (`key@N`). Without spec 3 these
  fields are absent and nothing changes.
- A `diverged` issue (spec 3: an older store name changed after the current one
  was written, per its recorded baseline) shows both values on the row. Fix opens
  the editor on the current value with a "Use the older value" action that replaces
  the draft with the older, migrated value; Save writes the current name either
  way. The modal also offers "Remove the older name", which confirms while showing
  the older value and deletes that name and its baseline through settings-kit's `/prune` route (spec 3, forced for a diverged name); until then the issue stays listed.

### Writers and other apps

- Board's settings modal and boxscore's settings move off `SHAPES` to
  `recognize(schema)` with the same widgets; their `external` keys keep their own UIs.
- Writer tests in this repo, against the rt-client release from spec 1: console's
  bridge-rule reconcile output for `rt.notify.eventBridges`, deck's `deck.apps`
  writes, board's writes, boxscore's `mattstack.roster` and `boxscore.hiddenMembers`
  writes each pass `validateWrite`.

## Testing

- Tests first for each editor: add, remove, reorder and add-property on item cards;
  add and remove entry on named sections; Save disabled on invalid drafts; JSON parse
  and schema errors; switching between form and JSON keeping the draft; Escape
  abandoning without closing the modal; unknown extra properties preserved.
- A deep-merge key edited through each editor writes only the target layer's own
  fields.
- Repo picker: per-repo rows show repo values and rungs; writes carry `repo`; "set
  in N repos" with all repos; the Changed count follows the picked repo.
- Needs-fixing chip counts and filters from `/defs`; Fix opens the right layer and
  repo.
- Previously shaped keys render exactly as before (existing console, board and
  boxscore tests stay green).
- UI validation: Fast Browser against a branch build on live data, both schemes, for
  one key of each editor kind, the repo picker on the team repo that carries the
  per-repo values (identity invented in fixtures, e.g. `gitlab.example.com/acme/app`),
  and the fix flow, compared with the current page. Never save through the test
  server; check `rt settings get rt.notify.eventBridges --json` afterwards.

## Acceptance

- With the team repo picked (`gitlab.example.com/acme/app` in the fixture),
  `rt.roles`, `rt.intercepts` and the
  other seven audit keys show the team store's repo values; with All repos, each
  says "set in 1 repo".
- `rt.notify.eventBridges` can be read in full, edited as item cards and as JSON; an
  item without `pattern` cannot be saved.
- `deck.apps` can be edited as named sections.
- A key the forms cannot draw is editable as JSON with inline schema errors.
- A nonconforming stored value appears under Needs fixing and can be fixed from the
  modal.
- Nothing about today's shaped keys changes visually.
