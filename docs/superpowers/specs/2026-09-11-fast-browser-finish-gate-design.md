# Fast Browser extension: required to finish setup unless waived

MAT-417. Ruling (Matt, 2026-09-11): the Chrome extension is not a nice-to-have.
Evidence capture and annotation (screenshots, GIFs, annotated proof in the
review and ship pipelines) run through it, so a machine without it silently
loses that capability. Setup must not finish until the extension verifies
installed and loaded, unless the user explicitly opts out with the cost stated.

This supersedes the 2026-09-03 ruling that `tool.fast-browser-extension` never
gates (MAT-401, rt#190) for this row only. That ruling was about Install
reachability and still holds: the extension is loaded by the user in Chrome,
never by Install, so it must never park `canInstall`. What changes is the end
of the wizard: Finish.

## What exists (verified in source)

- `lib/setup/validators/tools.ts` `fastBrowserExtensionRow`: `required: false`,
  `optionalNote` "You load this into Chrome yourself...". States: `skipped`
  (no Chrome, or doctor unreadable), `error` (doctor lacks the check),
  `needs-you` "not loaded in Chrome" with `FAST_BROWSER_LOAD_STEPS`,
  `needs-you` "loaded but not paired", `ready` "loaded and paired".
- `lib/setup/plan.ts`: `INSTALL_SATISFIED_IDS` flips rows required:false in plan
  mode and required:true in status mode. `requiredMissing` drives
  `canInstall` and the `setup apply` hard-precondition gate
  (`HARD_PRECONDITION_IDS` in commands/setup.ts).
- App: `SetupFlowModel.windowMayClose` is `step == .done`; the Done screen's
  primary button is "Finish" and it closes the window. `ReadinessModel
  .outstandingManualRows` lists required:false rows that are not ready and
  carry a steps/openURL action; the Done screen renders them as "Still to do".
- Settings: registry in `packages/rt-client/src/settings/registry-defs.ts`;
  scopes include `machine`; docs/settings-architecture.md governs new keys.

## Design

### A third row class: finish-gated

A row can be `finishGated: true` (new optional field on `Row`, default
false). Semantics:

- It never enters `requiredMissing` in plan mode, so `canInstall` and the
  `setup apply` gate are unchanged.
- In status mode it is `required: true` unless waived, and a new plan field
  `finishBlockedBy: string[]` lists finish-gated rows whose status is not
  `ready` and not `skipped` and that are not waived. `rt setup status --json`
  carries it; the human `setup status` prints "Finish: blocked by: ..." beside
  the existing Install line.
- `tool.fast-browser-extension` is the only member today. `skipped` (no
  Chrome; doctor unreadable) is not a block: nothing to load into, or a
  different row already reports the fault.

### Waiver

- Registry key `setup.waived`: `string[]` of row ids, scope `machine` only,
  never team or user, default `[]`. Machine-local because the extension is a
  per-Chrome-profile fact and the choice is per machine.
- `rt setup waive <row-id> [--json]` and `rt setup unwaive <row-id>` write it
  through the resolver. Both are leaf verbs with a required positional, so they
  declare `omitBehavior: "picker"` over the finish-gated rows (exempt is wrong:
  the set is enumerable). Waiving an id that is not finish-gated is a usage
  error, exit 2.
- A waived finish-gated row renders `required: false`, keeps its status and
  action, and gets `optionalNote` "Skipped on this Mac: agents cannot capture
  screenshots or annotate evidence from your browser. Load it later from
  Settings." It stays in `outstandingManualRows` so the Done screen still
  lists it (the existing "works without" prefix exclusion does not match this
  note by design).

### App

- Checklist screen: unchanged. The row shows as today (needs-you with the
  load steps); Install is not blocked by it.
- Done screen: when `finishBlockedBy` is non-empty, the headline reads
  "One step left before you finish" (plural form when more), the blocked
  row(s) render in a "Before you finish" section above "Still to do", and the
  Finish button is disabled. Each blocked row gets a secondary "Skip for now"
  button (`AXID.doneSkipRow(row.id)`).
- Skip for now opens a confirm sheet (`AXID.doneSkipConfirm`): title "Skip the
  Fast Browser extension?", body exactly: "Without the Fast Browser extension,
  agents cannot capture screenshots or annotate evidence from your browser.
  You can load it later from Settings." Buttons "Skip for now" (destructive
  style) and "Cancel". Confirming runs `rt setup waive tool.fast-browser-
  extension`, then `readiness.recheckAll()`; the row moves to "Still to do"
  and Finish enables.
- `windowMayClose` becomes `step == .done && finishBlockedBy.isEmpty` so the
  close/minimize buttons follow the gate exactly as Finish does. `readOnly`
  (settings-launched) flows are unaffected: they never reach Done.
- Settings Fast Browser pane: a "Skipped on this Mac" line with an "Un-skip"
  button when waived, running `rt setup unwaive`. No other settings surface.

### Remedy copy

While the Web Store listing is pending, the remedy stays
`FAST_BROWSER_LOAD_STEPS` (developer mode, load unpacked, path). When MAT-414
lands, the remedy becomes `openURL chrome://extensions/?id=
fnfikoifhimpdedpdepehibjjkcfbacm`; that swap is MAT-414's scope, not this.

## Error handling

- `rt setup waive` on a store write failure surfaces the resolver's error and
  exits 1; the app shows it in the sheet and leaves the gate closed.
- A doctor read failure keeps the row `skipped` and the gate open, as today:
  the fault is reported by `tool.fast-browser`, and a missing doctor must not
  strand the wizard.
- Nothing here writes to any store other than the machine scope, and nothing
  syncs.

## Testing

- Unit (TS): plan-mode `requiredMissing` never contains the row; status-mode
  `finishBlockedBy` contains it when needs-you and unwaived, is empty when
  ready, skipped, or waived; waived row's required/optionalNote shape; `waive`
  and `unwaive` round-trip through a fake store; non-gated id exits 2;
  `setup status` prints the Finish line; picker conformance passes.
- Checks (Swift, MattstackCoreChecks): `windowMayClose` false while blocked;
  Done model's blocked rows and section; confirm sheet copy pinned byte for
  byte; confirming calls the waive verb and re-checks.
- VM: the create walkthrough asserts Done shows "Before you finish" with the
  extension row and a disabled Finish when no extension is loaded, then drives
  Skip for now, asserts the sheet text, confirms, and asserts Finish enabled
  and `setup.waived` holding the id in the machine store. The existing
  `--no-graphics` driver reaches the Done screen already.

## Out of scope

- Installing the extension unattended (MAT-414).
- Any other row becoming finish-gated.
- Team-scope policy over waivers.
