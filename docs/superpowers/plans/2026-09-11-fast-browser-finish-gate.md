# Fast Browser Finish Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mattstack.app setup wizard cannot Finish while the Fast Browser Chrome extension is not loaded, unless the user skips it on this Mac with the cost stated; the CLI, the plan contract, the Settings window and the VM walkthrough all carry the same gate.

**Architecture:** A third row class, `finishGated`, rides on the existing `Row` contract and a new `Plan.finishBlockedBy` list, computed in `finalizePlan` from the same rows the checklist already renders. Install is untouched: finish-gated rows never enter `requiredMissing`. A machine-scoped registry key `setup.waived` (read and written only through the rt-client resolver) records the skip; `rt setup waive|unwaive` are the only writers. The Swift app decodes the two new fields, gates `windowMayClose` and the Finish button on `finishBlockedBy`, and drives the waive verb from a confirm sheet on the Done screen and an Un-skip button in Settings.

**Tech Stack:** Bun/TypeScript + bun:test for rt; Swift 5.9 / SwiftUI with the MattstackCoreChecks harness for the app; bash + osascript for the VM walkthrough.

**Spec:** `docs/superpowers/specs/2026-09-11-fast-browser-finish-gate-design.md`

## Global Constraints

- No em dashes or en dashes in any authored text, code, docs, or commit message. Grep the diff (`git diff | grep -P '[\x{2014}\x{2013}]'`) before every commit.
- Clean-code comments only: constraints the code cannot show. No ticket ids (MAT-*, RT-*) or ruling references in source, tests, or docs regenerated from source.
- The TS CLI stays UI-free (`lib/__tests__/no-ui-in-cli.test.ts`); pickers go through `lib/pick-wrappers.ts`.
- Every setting read goes through `getSetting`, every write through `setSetting` (`lib/settings/resolve.ts` / `lib/settings/write.ts`, both re-exports of `packages/rt-client`). Never a hand-built store path.
- `setup.waived` is scope `machine` only, default `[]`. Nothing here writes any other scope, and nothing syncs.
- New leaf verbs with a required positional declare `omitBehavior: "picker"` in `lib/command-tree-def.ts`, and the handler's picker is gated on `process.stdin.isTTY && !json && !process.env.RT_BATCH` (`bun run picker:check`).
- The command module `./commands/setup.ts` already has a thunk in `lib/module-registry.ts`; do not add another.
- `packages/rt-client/dist/` must be rebuilt (`cd packages/rt-client && bun run build`) after the registry edit or `dist-freshness.test.ts` fails.
- Copy strings are pinned by the spec and repeated verbatim below: the waived note, the Done headline, the section title, the sheet title, body and buttons.
- Public repo: `bash scripts/repo-purity.sh` must pass; fixture names stay neutral.
- One commit per task, message ending with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Do not push.
- Gates before reporting: `bun run test:all`, `bunx tsc --noEmit`, `bun run docs:check`, `bun run picker:check`, `bash scripts/repo-purity.sh`, `swift test --package-path rt-tray`.

## Rulings the spec left open (applied throughout)

1. **`requiredMissing` never lists a finish-gated row in either mode.** The spec says the row "never enters `requiredMissing` in plan mode" and reads `required: true` in status mode. Letting it into status-mode `requiredMissing` would make `rt setup status` print "Install: blocked by: tool.fast-browser-extension" beside the new Finish line for a row Install cannot act on, and would fail the apply run's own `verify` step (a status-mode plan whose `required && !ready` rows are critical) at the end of every fresh install, before the user could have loaded anything. So `finalizePlan` excludes `finishGated` rows from `requiredMissing`, `finishBlockedBy` is the only list that names them, and `rowsToChecks` in `commands/verify.ts` maps a finish-gated row to `warn`, never `critical`. The existing test "never counts against canInstall, in either mode" stays green.
2. **`finishBlockedBy` is computed in both modes.** The Done screen re-checks through the onboarding `ReadinessModel`, which runs `setup plan --json`; a status-only field would leave the app blind.
3. **A `skipped` finish-gated row keeps `required: false` in status mode.** Flipping it to required would count it as a required item left forever on a Mac with no Chrome. The waived note still applies to a skipped row when waived, so the shape is uniform.
4. **The app detects "waived" by the row's note prefix** (`Skipped on this Mac`), the same way it already detects "works without" rows; the contract gains only the two fields the spec names.
5. **The Settings "Fast Browser" pane is new** (there is none today): one tab showing the extension row, plus the Skipped line and Un-skip button when waived.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/setup/contract.ts` (modify) | `Row.finishGated?`, `Plan.finishBlockedBy`, `FINISH_GATED_ROW_IDS`, `finishBlockers()`, `finalizePlan(..., waived)` |
| `lib/setup/finish-gate.ts` (create) | `WAIVED_NOTE`, `WAIVED_SETTING_KEY`, `readWaived()`, `applyFinishGate()`, `WaiverStore`, `realWaiverStore()`, `waiveRow()`, `unwaiveRow()` |
| `lib/setup/plan.ts` (modify) | `PlanInputs.waived?`, composes `applyFinishGate` and passes waived ids to `finalizePlan` |
| `lib/setup/validators/tools.ts` (modify) | the extension row carries `finishGated: true` |
| `commands/verify.ts` (modify) | finish-gated rows are never critical |
| `packages/rt-client/src/settings/registry-defs.ts` (modify) | `setup.waived` registry row |
| `docs/settings-architecture.md` (modify) | `setup.*` joins the prefix list |
| `commands/setup.ts` (modify) | `setupWaive`, `setupUnwaive`, `renderFinishLine`, status prints the Finish line |
| `lib/command-tree-def.ts` (modify) | `setup waive`, `setup unwaive` leaves |
| `website/docs/reference/setup/*` (regenerate) | generated command reference |
| `rt-tray/Sources-core/Contract/PlanModels.swift` (modify) | decode `finishGated`, `finishBlockedBy` with defaults |
| `rt-tray/Sources-core/Readiness/ReadinessModel.swift` (modify) | `finishBlockedBy`, `finishBlockedRows`, blocked rows leave `outstandingManualRows` |
| `rt-tray/Sources-core/Setup/SetupFlowModel.swift` (modify) | `finishBlockedBy`, `windowMayClose` gate |
| `rt-tray/Sources-core/Setup/FinishGate.swift` (create) | `FinishGate` copy constants, `PlanRow.isWaived`, `WaiverClient`, `DoneModel` |
| `rt-tray/Sources/AccessibilityIDs.swift` (modify) | Done and Settings ids |
| `rt-tray/Sources/Setup/SetupWindowController.swift` (modify) | builds `DoneModel` |
| `rt-tray/Sources/Setup/SetupView.swift` (modify) | mirrors `finishBlockedBy` into the flow, Finish gate |
| `rt-tray/Sources/Setup/Screens/DoneScreen.swift` (modify) | headline, "Before you finish" section, Skip for now, confirm sheet |
| `rt-tray/Sources/Settings/FastBrowserPane.swift` (create) | the Fast Browser tab |
| `rt-tray/Sources/Settings/SettingsView.swift`, `SettingsWindowController.swift` (modify) | the new tab, `waivers` in the environment |
| `rt-tray/Sources/Setup/SetupCoordinator.swift` (modify) | builds the Settings `WaiverClient` |
| `rt-tray/Tests/MattstackCoreChecks/*` (modify/create) | plan decode, readiness, flow, `DoneModelChecks.swift` |
| `rt-tray/Tests/stub-rt/stub.ts` (modify) | stub plan carries `finishBlockedBy` |
| `rt-tray/vm/run/guest/ax.sh`, `drive-setup.sh`, `assert-installed.sh`, `rt-tray/vm/check-vm-scripts.sh` (modify) | Skip for now driven by wording; machine store asserted |

---

### Task 1: The finish-gated row class and `finishBlockedBy`

**Files:**
- Modify: `lib/setup/contract.ts`
- Create: `lib/setup/finish-gate.ts` (the `applyFinishGate` half; the store half comes in Task 2)
- Modify: `lib/setup/plan.ts`
- Modify: `lib/setup/validators/tools.ts` (`fastBrowserExtensionRow`)
- Modify: `commands/verify.ts` (`rowToCheck`)
- Test: `lib/setup/__tests__/plan.test.ts`, `lib/setup/__tests__/validators-tools.test.ts`, `commands/__tests__/verify-mapping.test.ts`, `commands/__tests__/setup-plan.test.ts` (plan literals)

**Interfaces:**
- Produces: `Row.finishGated?: boolean`; `Plan.finishBlockedBy: string[]`; `FINISH_GATED_ROW_IDS: readonly string[]`; `finishBlockers(groups, waived?)`; `finalizePlan(team, groups, now?, waived?)`; `applyFinishGate(groups, mode, waived?)`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/setup/__tests__/plan.test.ts` (imports: add `applyFinishGate` from `../finish-gate.ts` and `FINISH_GATED_ROW_IDS` from `../contract.ts`):

```ts
function gatedRow(status: Row["status"]): Row {
  return row({
    id: "tool.fast-browser-extension",
    kind: "tool",
    title: "Fast Browser extension",
    why: "x",
    required: false,
    optionalNote: "You load this into Chrome yourself; Install cannot do it for you.",
    status,
    detail: "d",
    action: { type: "steps", label: "Show steps…", steps: ["Open chrome://extensions"] },
    finishGated: true,
  });
}

function gatedPlan(status: Row["status"], mode: "plan" | "status", waived: string[] = []) {
  const groups: Group[] = [{ id: "tools", title: "Tools", rows: [gatedRow(status)] }];
  return finalizePlan({ slug: "acme", name: "Acme", mode: "none" }, applyFinishGate(groups, mode, waived), new Date(), waived);
}

describe("finish gate", () => {
  test("the contract names exactly one finish-gated row today", () => {
    expect([...FINISH_GATED_ROW_IDS]).toEqual(["tool.fast-browser-extension"]);
  });

  test("a needs-you finish-gated row blocks Finish in both modes and never Install", () => {
    for (const mode of ["plan", "status"] as const) {
      const plan = gatedPlan("needs-you", mode);
      expect(plan.finishBlockedBy).toEqual(["tool.fast-browser-extension"]);
      expect(plan.requiredMissing).toEqual([]);
      expect(plan.canInstall).toBe(true);
    }
  });

  test("ready and skipped finish-gated rows block nothing", () => {
    expect(gatedPlan("ready", "status").finishBlockedBy).toEqual([]);
    expect(gatedPlan("skipped", "status").finishBlockedBy).toEqual([]);
  });

  test("status mode reads an unwaived finish-gated row as required with no optionalNote; plan mode keeps the validator's shape", () => {
    const status = gatedPlan("needs-you", "status").groups[0]!.rows[0]!;
    expect(status.required).toBe(true);
    expect(status.optionalNote).toBeNull();
    const planned = gatedPlan("needs-you", "plan").groups[0]!.rows[0]!;
    expect(planned.required).toBe(false);
    expect(planned.optionalNote).toBe("You load this into Chrome yourself; Install cannot do it for you.");
  });

  test("a skipped finish-gated row stays optional in status mode", () => {
    expect(gatedPlan("skipped", "status").groups[0]!.rows[0]!.required).toBe(false);
  });

  test("composePlan's envelope carries finishBlockedBy in both modes", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    for (const mode of ["plan", "status"] as const) {
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode, teams: [] });
      expect(Array.isArray(plan.finishBlockedBy)).toBe(true);
    }
  });
});
```

Append to the `toolRows - tool.fast-browser-extension` describe in `lib/setup/__tests__/validators-tools.test.ts` (import `FINISH_GATED_ROW_IDS` from `../contract.ts`):

```ts
  test("the extension row is finish-gated, and it is the only tool row that is", async () => {
    const p = withChrome(doctorExec(withCheckStatus(REAL_DOCTOR, "extension-loaded", "fail")));
    const rows = await toolRows(p, [], { hasBrew: true, secrets: NO_SECRETS }, fastBrowserSeams());
    expect(rows.filter((r) => r.finishGated).map((r) => r.id)).toEqual([...FINISH_GATED_ROW_IDS]);
  });
```

Append to `commands/__tests__/verify-mapping.test.ts` inside `describe("rowsToChecks")`:

```ts
  test("a required finish-gated row that is not ready -> warn, never critical: the gate is Finish's, and apply's verify runs before anything could be loaded", () => {
    const check = oneCheck([baseRow({ id: "tool.fast-browser-extension", status: "needs-you", required: true, detail: "not loaded in Chrome", finishGated: true })], { ci: false });
    expect(check.status).toBe("warn");
    expect(check.severity).toBe("warning");
  });
```

Add `finishBlockedBy: []` to the three `Plan` literals in `commands/__tests__/setup-plan.test.ts` (lines with `requiredMissing: [...]`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/setup/__tests__/plan.test.ts lib/setup/__tests__/validators-tools.test.ts commands/__tests__/verify-mapping.test.ts`
Expected: FAIL (`applyFinishGate` is not exported, `finishBlockedBy` undefined, `finishGated` undefined).

- [ ] **Step 3: Implement the contract**

`lib/setup/contract.ts`: add to `Row` after `recheck`:

```ts
  /** Blocks the wizard's Finish (never Install) until ready, skipped, or waived on this Mac. */
  finishGated?: boolean;
```

Add to `Plan` after `requiredMissing`:

```ts
  finishBlockedBy: string[];
```

Add after `GROUP_TITLES`:

```ts
/** The rows that gate Finish. Enumerated here so `rt setup waive` can refuse anything else and offer a picker over the set. */
export const FINISH_GATED_ROW_IDS: readonly string[] = ["tool.fast-browser-extension"];
```

Replace `finalizePlan`:

```ts
/** A finish-gated row that is neither ready nor skipped, and not waived on this Mac, blocks Finish. `skipped` means there is nothing to load into, or another row already reports the fault. */
export function finishBlockers(groups: Group[], waived: readonly string[] = []): string[] {
  return groups.flatMap((g) =>
    g.rows.filter((r) => r.finishGated === true && r.status !== "ready" && r.status !== "skipped" && !waived.includes(r.id)).map((r) => r.id),
  );
}

/** Install enables only when every required row is ready; requiredMissing lists the others in group order. A finish-gated row is Finish's concern whatever its `required` reads, so it never lands here. */
export function finalizePlan(team: TeamRef, groups: Group[], now: Date = new Date(), waived: readonly string[] = []): Plan {
  const requiredMissing = groups.flatMap((g) => g.rows.filter((r) => r.required && !r.finishGated && r.status !== "ready").map((r) => r.id));
  return envelope({ team, groups, canInstall: requiredMissing.length === 0, requiredMissing, finishBlockedBy: finishBlockers(groups, waived) }, now);
}
```

- [ ] **Step 4: Create `lib/setup/finish-gate.ts`**

```ts
/**
 * The finish gate: rows that block the wizard's Finish (never Install) until
 * they are ready, skipped, or waived on this Mac. The waiver lives in the
 * machine-scoped `setup.waived` key and is read and written only through
 * the resolver.
 */

import type { Group } from "./contract.ts";

export const WAIVED_NOTE = "Skipped on this Mac: agents cannot capture screenshots or annotate evidence from your browser. Load it later from Settings.";

/**
 * In status mode an unwaived finish-gated row reads required:true, so the
 * post-install view names it as owed; a `skipped` one keeps its shape, since
 * there is nothing to load into. Plan mode leaves the validator's shape
 * alone, so Install stays reachable. A waived row reads optional with the
 * note that states the cost, in either mode.
 */
export function applyFinishGate(groups: Group[], mode: "plan" | "status", waived: readonly string[] = []): Group[] {
  return groups.map((g) => ({
    ...g,
    rows: g.rows.map((r) => {
      if (!r.finishGated) return r;
      if (waived.includes(r.id)) return { ...r, required: false, optionalNote: WAIVED_NOTE };
      if (mode === "status" && r.status !== "skipped") return { ...r, required: true, optionalNote: null };
      return r;
    }),
  }));
}
```

- [ ] **Step 5: Wire the post-pass into `composePlan`**

`lib/setup/plan.ts`: import `applyFinishGate` from `./finish-gate.ts`; replace the return of `composePlan`:

```ts
  return finalizePlan(team, applyFinishGate(applyInstallSatisfiedFlip(groups, i.mode), i.mode), i.p.now());
```

(Task 2 threads the waived list through.)

- [ ] **Step 6: Flag the validator row**

`lib/setup/validators/tools.ts`, in `fastBrowserExtensionRow`'s `base`, add `finishGated: true,` after `optionalNote`. Replace the function's doc comment with:

```ts
/**
 * Never gates Install in any Chrome state: loading an unpacked extension is a
 * Chrome step rt cannot perform, and nothing on the checklist can create the
 * extension directory before Install does. It gates Finish instead
 * (`finishGated`), unless the user waives it on this Mac.
 */
```

- [ ] **Step 7: Keep verify honest**

`commands/verify.ts`, in `rowToCheck`, replace the `// missing | invalid | error | needs-you` block with:

```ts
  // missing | invalid | error | needs-you
  // A finish-gated row blocks the wizard's Finish, not the install: apply's
  // own verify step runs before the user could have loaded anything.
  if (r.required && !r.finishGated && !ciNeverCritical(r, opts.ci) && !deliberateChoice(r)) return { name: r.id, status: "fail", detail, severity: "critical" };
  return { name: r.id, status: "warn", detail, severity: "warning" };
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test lib/setup commands/__tests__/verify-mapping.test.ts commands/__tests__/setup-plan.test.ts && bunx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 9: Commit**

```bash
git add lib/setup/contract.ts lib/setup/finish-gate.ts lib/setup/plan.ts lib/setup/validators/tools.ts commands/verify.ts lib/setup/__tests__/plan.test.ts lib/setup/__tests__/validators-tools.test.ts commands/__tests__/verify-mapping.test.ts commands/__tests__/setup-plan.test.ts
git commit -m "setup: finish-gated rows and plan.finishBlockedBy

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The `setup.waived` registry key and waived rendering

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts`
- Modify: `docs/settings-architecture.md` (prefix list)
- Modify: `lib/setup/finish-gate.ts` (add `WAIVED_SETTING_KEY`, `readWaived`)
- Modify: `lib/setup/plan.ts` (`PlanInputs.waived?`, thread through)
- Test: `lib/setup/__tests__/finish-gate.test.ts` (create), `lib/setup/__tests__/plan.test.ts`

**Interfaces:**
- Consumes: `applyFinishGate`, `finalizePlan(..., waived)` from Task 1.
- Produces: `WAIVED_SETTING_KEY = "setup.waived"`; `readWaived(opts?: { read?: SettingsReader; warn?: (m: string) => void }): string[]`; `PlanInputs.waived?: string[]`.

- [ ] **Step 1: Write the failing tests**

Create `lib/setup/__tests__/finish-gate.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getDef, validateValue } from "../../settings/registry.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { WAIVED_SETTING_KEY, readWaived } from "../finish-gate.ts";

let home: string;
let prevHome: string | undefined;
beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "rt-finish-gate-"));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

describe("setup.waived registry row", () => {
  test("machine scope only, array, default []", () => {
    const def = getDef(WAIVED_SETTING_KEY)!;
    expect(def.scopes).toEqual(["machine"]);
    expect(def.type).toBe("array");
    expect(def.default).toEqual([]);
    expect(validateValue(def, ["tool.fast-browser-extension"]).ok).toBe(true);
    expect(validateValue(def, "tool.fast-browser-extension").ok).toBe(false);
  });

  test("a user or team scope write is refused by the resolver", () => {
    expect(() => setSetting(WAIVED_SETTING_KEY, ["tool.fast-browser-extension"], "user")).toThrow();
    expect(() => setSetting(WAIVED_SETTING_KEY, ["tool.fast-browser-extension"], "team")).toThrow();
  });
});

describe("readWaived", () => {
  test("unset reads as none", () => {
    expect(readWaived()).toEqual([]);
  });

  test("reads the machine store through the resolver", () => {
    setSetting(WAIVED_SETTING_KEY, ["tool.fast-browser-extension"], "machine");
    expect(readWaived()).toEqual(["tool.fast-browser-extension"]);
    expect(getSetting(WAIVED_SETTING_KEY).provenance.map((p) => p.scope)).toEqual(["machine"]);
  });

  test("a non-array or non-string entry reads as none of it", () => {
    expect(readWaived({ read: () => "tool.fast-browser-extension" as never })).toEqual([]);
    expect(readWaived({ read: () => ["tool.fast-browser-extension", 7] as never })).toEqual(["tool.fast-browser-extension"]);
  });

  test("a resolver throw reads as none, with one warning", () => {
    const warnings: string[] = [];
    const ids = readWaived({
      read: () => {
        throw new Error("malformed store");
      },
      warn: (m) => warnings.push(m),
    });
    expect(ids).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("setup.waived");
  });
});
```

Check the `Resolved` shape in `packages/rt-client/src/settings/resolve.ts` (`provenance` entries carry `scope`); adjust the provenance assertion to the real field name if it differs.

Append to `lib/setup/__tests__/plan.test.ts` inside `describe("finish gate")` (import `WAIVED_NOTE` from `../finish-gate.ts`, `setSetting` from `../../settings/write.ts`, and `mkdtempSync`/`rmSync`/`tmpdir`/`join`):

```ts
  test("a waived finish-gated row reads optional with the skipped-on-this-Mac note, keeps its status and action, and leaves finishBlockedBy, in both modes", () => {
    for (const mode of ["plan", "status"] as const) {
      const plan = gatedPlan("needs-you", mode, ["tool.fast-browser-extension"]);
      const r = plan.groups[0]!.rows[0]!;
      expect(r.required).toBe(false);
      expect(r.optionalNote).toBe(WAIVED_NOTE);
      expect(r.status).toBe("needs-you");
      expect(r.action?.type).toBe("steps");
      expect(plan.finishBlockedBy).toEqual([]);
    }
  });

  test("composePlan reads the waiver through the resolver when none is injected", async () => {
    const prevHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "rt-plan-waived-"));
    process.env.HOME = home;
    try {
      setSetting("setup.waived", ["tool.fast-browser-extension"], "machine");
      const p = fakeProbes({ exec: readyExec, tray: grantedTray });
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: [] });
      const r = plan.groups.find((g) => g.id === "tools")!.rows.find((r) => r.id === "tool.fast-browser-extension")!;
      expect(r.optionalNote).toBe(WAIVED_NOTE);
      expect(plan.finishBlockedBy).toEqual([]);
    } finally {
      process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("an injected waived list wins over the store", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "status", teams: [], waived: ["tool.fast-browser-extension"] });
    const r = plan.groups.find((g) => g.id === "tools")!.rows.find((r) => r.id === "tool.fast-browser-extension")!;
    expect(r.optionalNote).toBe(WAIVED_NOTE);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/setup/__tests__/finish-gate.test.ts lib/setup/__tests__/plan.test.ts`
Expected: FAIL (`getDef("setup.waived")` undefined; `readWaived` not exported; `waived` not accepted).

- [ ] **Step 3: Register the key**

`packages/rt-client/src/settings/registry-defs.ts`, in the `--- mattstack (installer-lane) ---` block after `mattstack.mode`:

```ts
  {
    key: "setup.waived",
    type: "array",
    scopes: ["machine"],
    default: [],
    merge: "replace",
    description:
      "Finish-gated setup rows the user skipped on this Mac through `rt setup waive` (today only tool.fast-browser-extension); the wizard's Finish no longer waits on them. Machine-only: a loaded Chrome extension is a per-profile fact and the choice is per machine, so it never travels with a team or user store.",
  },
```

Then: `cd packages/rt-client && bun run build && cd ../..`.

`docs/settings-architecture.md`: change `Prefixes: \`rt.*\`, \`deck.*\`, \`board.*\`, \`gitq.*\`, \`mattstack.*\`, \`claude.*\`.` to include `` `setup.*` `` (machine-local installer state such as `setup.waived`).

- [ ] **Step 4: The reader**

`lib/setup/finish-gate.ts`: add imports and the reader:

```ts
import { getSetting } from "../settings/resolve.ts";
import type { SettingsReader } from "./team-settings.ts";

export const WAIVED_SETTING_KEY = "setup.waived";

/** The row ids waived on this Mac, read through the resolver on every call. A store the resolver cannot read means the waivers are unknown, so the gate stays closed: none. */
export function readWaived(opts: { read?: SettingsReader; warn?: (message: string) => void } = {}): string[] {
  const warn = opts.warn ?? ((message: string) => console.error(message));
  const read = opts.read ?? (<T>(key: string): T | undefined => getSetting<T>(key).value);
  let value: unknown;
  try {
    value = read<unknown>(WAIVED_SETTING_KEY);
  } catch (err) {
    warn(`rt: ${WAIVED_SETTING_KEY} could not be resolved (${err instanceof Error ? err.message : String(err)}) - treated as none`);
    return [];
  }
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
```

- [ ] **Step 5: Thread the waiver through the plan**

`lib/setup/plan.ts`: add to `PlanInputs`:

```ts
  /** Row ids waived on this Mac; defaults to the resolver's `setup.waived`. Tests inject their own list instead of writing a store. */
  waived?: string[];
```

In `composePlan`, before the return: `const waived = i.waived ?? readWaived();` and return

```ts
  return finalizePlan(team, applyFinishGate(applyInstallSatisfiedFlip(groups, i.mode), i.mode, waived), i.p.now(), waived);
```

Import `readWaived` alongside `applyFinishGate`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test lib/setup packages/rt-client && bunx tsc --noEmit`
Expected: PASS including `dist-freshness.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/rt-client/src/settings/registry-defs.ts docs/settings-architecture.md lib/setup/finish-gate.ts lib/setup/plan.ts lib/setup/__tests__/finish-gate.test.ts lib/setup/__tests__/plan.test.ts
git commit -m "setup: setup.waived machine key and waived row rendering

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `rt setup waive` and `rt setup unwaive`

**Files:**
- Modify: `lib/setup/finish-gate.ts` (`WaiverStore`, `realWaiverStore`, `waiveRow`, `unwaiveRow`)
- Modify: `commands/setup.ts` (`WaiveDeps`, `realWaiveDeps`, `setupWaive`, `setupUnwaive`; `exitWithUserError` accepts a narrower deps type)
- Modify: `lib/command-tree-def.ts` (two leaves under `setup`)
- Regenerate: `website/docs/reference` via `bun scripts/gen-docs.ts`
- Test: `lib/setup/__tests__/finish-gate.test.ts`, `commands/__tests__/setup-waive.test.ts` (create)

**Interfaces:**
- Consumes: `FINISH_GATED_ROW_IDS`, `WAIVED_SETTING_KEY`, `readWaived`.
- Produces: `WaiverStore { read(): string[]; write(ids: string[]): void }`; `waiveRow(id, store): string[]`; `unwaiveRow(id, store): string[]`; CLI `rt setup waive <row-id> [--json]`, `rt setup unwaive <row-id> [--json]` with `{ contract, at, ok: true, id, waived }` under `--json`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/setup/__tests__/finish-gate.test.ts` (import `realWaiverStore`, `unwaiveRow`, `waiveRow`, and `UserActionableError` from `../errors.ts`):

```ts
function fakeStore(initial: string[] = []) {
  const writes: string[][] = [];
  let ids = initial;
  return {
    writes,
    store: { read: () => ids, write: (next: string[]) => { writes.push(next); ids = next; } },
  };
}

describe("waiveRow / unwaiveRow", () => {
  test("waive adds the id once; a second waive writes nothing", () => {
    const { store, writes } = fakeStore();
    expect(waiveRow("tool.fast-browser-extension", store)).toEqual(["tool.fast-browser-extension"]);
    expect(waiveRow("tool.fast-browser-extension", store)).toEqual(["tool.fast-browser-extension"]);
    expect(writes).toEqual([["tool.fast-browser-extension"]]);
  });

  test("unwaive removes the id; unwaiving an absent id writes nothing", () => {
    const { store, writes } = fakeStore(["tool.fast-browser-extension"]);
    expect(unwaiveRow("tool.fast-browser-extension", store)).toEqual([]);
    expect(unwaiveRow("tool.fast-browser-extension", store)).toEqual([]);
    expect(writes).toEqual([[]]);
  });

  test("an id that is not finish-gated is a user error, and nothing is written", () => {
    const { store, writes } = fakeStore();
    expect(() => waiveRow("tool.chrome", store)).toThrow(UserActionableError);
    expect(() => unwaiveRow("tool.chrome", store)).toThrow(UserActionableError);
    expect(writes).toEqual([]);
  });

  test("the real store round-trips through the machine scope", () => {
    const store = realWaiverStore();
    waiveRow("tool.fast-browser-extension", store);
    expect(readWaived()).toEqual(["tool.fast-browser-extension"]);
    expect(getSetting(WAIVED_SETTING_KEY).provenance.map((p) => p.scope)).toEqual(["machine"]);
    unwaiveRow("tool.fast-browser-extension", store);
    expect(readWaived()).toEqual([]);
  });
});
```

Create `commands/__tests__/setup-waive.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { setupUnwaive, setupWaive, type WaiveDeps } from "../setup.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

function deps(overrides: Partial<WaiveDeps> & { initial?: string[] } = {}) {
  const lines: string[] = [];
  const errors: string[] = [];
  const writes: string[][] = [];
  let ids = overrides.initial ?? [];
  let picked: { message: string; options: string[] } | null = null;
  const d: WaiveDeps = {
    probes: fakeProbes(),
    store: { read: () => ids, write: (next) => { writes.push(next); ids = next; } },
    print: (s) => lines.push(s),
    printError: (s) => errors.push(s),
    exit: (code) => { throw new ExitSentinel(code); },
    isTTY: () => false,
    pick: async (message, options) => { picked = { message, options }; return null; },
    ...overrides,
  };
  return { d, lines, errors, writes, picked: () => picked };
}

async function exitCode(fn: () => Promise<void>): Promise<number | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    if (err instanceof ExitSentinel) return err.code;
    throw err;
  }
}

describe("rt setup waive", () => {
  test("--json writes the id at machine scope and prints an ok envelope", async () => {
    const t = deps();
    await setupWaive(["tool.fast-browser-extension", "--json"], {}, t.d);
    expect(t.writes).toEqual([["tool.fast-browser-extension"]]);
    expect(t.lines).toHaveLength(1);
    const body = JSON.parse(t.lines[0]!);
    expect(body.contract).toBe(1);
    expect(body.ok).toBe(true);
    expect(body.id).toBe("tool.fast-browser-extension");
    expect(body.waived).toEqual(["tool.fast-browser-extension"]);
  });

  test("human mode prints one line", async () => {
    const t = deps();
    await setupWaive(["tool.fast-browser-extension"], {}, t.d);
    expect(t.lines).toEqual(["setup waive: tool.fast-browser-extension skipped on this Mac"]);
  });

  test("an id that is not finish-gated exits 2 with the error envelope and writes nothing", async () => {
    const t = deps();
    expect(await exitCode(() => setupWaive(["tool.chrome", "--json"], {}, t.d))).toBe(2);
    expect(t.writes).toEqual([]);
    const body = JSON.parse(t.lines[0]!);
    expect(body.error.code).toBe("not-finish-gated");
    expect(body.error.message).toContain("tool.fast-browser-extension");
  });

  test("no id off a TTY exits 2 with usage, never a picker", async () => {
    const t = deps();
    expect(await exitCode(() => setupWaive([], {}, t.d))).toBe(2);
    expect(t.lines[0]).toBe("rt setup waive: usage: rt setup waive <row-id> [--json]");
    expect(t.picked()).toBeNull();
  });

  test("no id on a TTY offers a picker over the finish-gated rows; cancel exits 0", async () => {
    const t = deps({ isTTY: () => true });
    expect(await exitCode(() => setupWaive([], {}, t.d))).toBe(0);
    expect(t.picked()?.options).toEqual(["tool.fast-browser-extension"]);
    expect(t.writes).toEqual([]);
  });

  test("a picked id is waived like a typed one", async () => {
    const t = deps({ isTTY: () => true, pick: async () => "tool.fast-browser-extension" });
    await setupWaive([], {}, t.d);
    expect(t.writes).toEqual([["tool.fast-browser-extension"]]);
  });

  test("--json off a TTY never opens the picker", async () => {
    const t = deps({ isTTY: () => true });
    expect(await exitCode(() => setupWaive(["--json"], {}, t.d))).toBe(2);
    expect(t.picked()).toBeNull();
  });

  test("a store write failure surfaces the resolver's message on stderr and exits 1", async () => {
    const t = deps({ store: { read: () => [], write: () => { throw new Error("settings.local.jsonc: duplicate key"); } } });
    expect(await exitCode(() => setupWaive(["tool.fast-browser-extension", "--json"], {}, t.d))).toBe(1);
    expect(t.lines).toEqual([]);
    expect(t.errors).toEqual(["rt setup waive: settings.local.jsonc: duplicate key"]);
  });
});

describe("rt setup unwaive", () => {
  test("removes the id and prints the remaining list", async () => {
    const t = deps({ initial: ["tool.fast-browser-extension"] });
    await setupUnwaive(["tool.fast-browser-extension", "--json"], {}, t.d);
    expect(t.writes).toEqual([[]]);
    expect(JSON.parse(t.lines[0]!).waived).toEqual([]);
  });

  test("human mode prints one line", async () => {
    const t = deps({ initial: ["tool.fast-browser-extension"] });
    await setupUnwaive(["tool.fast-browser-extension"], {}, t.d);
    expect(t.lines).toEqual(["setup unwaive: tool.fast-browser-extension re-armed on this Mac"]);
  });

  test("an id that is not finish-gated exits 2", async () => {
    const t = deps();
    expect(await exitCode(() => setupUnwaive(["tool.chrome"], {}, t.d))).toBe(2);
    expect(t.lines[0]).toStartWith("rt setup unwaive: ");
  });
});
```

Note the `RT_BATCH` gate: the TTY tests above run with `process.env.RT_BATCH` unset; add `delete process.env.RT_BATCH` in a `beforeEach` if the suite runs under a batch env.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/setup/__tests__/finish-gate.test.ts commands/__tests__/setup-waive.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: The store half of `finish-gate.ts`**

Append to `lib/setup/finish-gate.ts` (add imports `setSetting` from `../settings/write.ts`, `FINISH_GATED_ROW_IDS` from `./contract.ts`, `UserActionableError` from `./errors.ts`):

```ts
export interface WaiverStore {
  read: () => string[];
  write: (ids: string[]) => void;
}

/** The only writer of `setup.waived`, and only at machine scope. */
export function realWaiverStore(): WaiverStore {
  return { read: () => readWaived(), write: (ids) => setSetting(WAIVED_SETTING_KEY, ids, "machine") };
}

function assertFinishGated(id: string): void {
  if (FINISH_GATED_ROW_IDS.includes(id)) return;
  throw new UserActionableError("not-finish-gated", `${id} is not a finish-gated row; finish-gated rows: ${FINISH_GATED_ROW_IDS.join(", ")}`);
}

/** Records `id` as skipped on this Mac; a second call writes nothing. Returns the stored list. */
export function waiveRow(id: string, store: WaiverStore): string[] {
  assertFinishGated(id);
  const current = store.read();
  if (current.includes(id)) return current;
  const next = [...current, id];
  store.write(next);
  return next;
}

/** Re-arms `id` on this Mac; an id that was not waived writes nothing. Returns the stored list. */
export function unwaiveRow(id: string, store: WaiverStore): string[] {
  assertFinishGated(id);
  const current = store.read();
  if (!current.includes(id)) return current;
  const next = current.filter((x) => x !== id);
  store.write(next);
  return next;
}
```

- [ ] **Step 4: The verbs in `commands/setup.ts`**

Change `exitWithUserError`'s last parameter type to `deps: Pick<SetupDeps, "probes" | "print" | "exit">`. Add imports: `FINISH_GATED_ROW_IDS` from `../lib/setup/contract.ts`; `realWaiverStore, unwaiveRow, waiveRow, type WaiverStore` from `../lib/setup/finish-gate.ts`.

Add a section after the `intent` section:

```ts
// ─── waive / unwaive (`rt setup waive|unwaive <row-id>`) ───────────────────

export interface WaiveDeps {
  probes: Probes;
  store: WaiverStore;
  print: (s: string) => void;
  printError: (s: string) => void;
  exit: (code: number) => never;
  isTTY: () => boolean;
  pick: (message: string, options: string[]) => Promise<string | null>;
}

export function realWaiveDeps(): WaiveDeps {
  return {
    probes: createRealProbes(),
    store: realWaiverStore(),
    print: (s) => console.log(s),
    printError: (s) => console.error(s),
    exit: process.exit,
    isTTY: () => process.stdin.isTTY === true,
    pick: async (message, options) => {
      const { filterableSelect } = await import("../lib/pick-wrappers.ts");
      return filterableSelect({ message, options: options.map((n) => ({ value: n, label: n })), stderr: true });
    },
  };
}

async function runWaiver(args: string[], deps: WaiveDeps, verb: "waive" | "unwaive"): Promise<void> {
  const json = args.includes("--json");
  let id = args.find((a) => !a.startsWith("--"));
  if (!id) {
    if (deps.isTTY() && !json && !process.env.RT_BATCH) {
      id = (await deps.pick(verb === "waive" ? "Skip which row on this Mac?" : "Re-arm which row on this Mac?", [...FINISH_GATED_ROW_IDS])) ?? undefined;
      if (!id) return deps.exit(0);
    } else {
      return exitWithUserError(new UserActionableError("usage", `usage: rt setup ${verb} <row-id> [--json]`), json, `setup ${verb}`, deps);
    }
  }

  let waived: string[];
  try {
    waived = verb === "waive" ? waiveRow(id, deps.store) : unwaiveRow(id, deps.store);
  } catch (err) {
    if (err instanceof UserActionableError) return exitWithUserError(err, json, `setup ${verb}`, deps);
    // A store the resolver refused to edit is reported as it was raised; the
    // app shows it in its sheet and keeps the gate closed.
    deps.printError(`rt setup ${verb}: ${err instanceof Error ? err.message : String(err)}`);
    return deps.exit(1);
  }

  if (json) {
    deps.print(JSON.stringify(envelope({ ok: true, id, waived }, deps.probes.now())));
    return;
  }
  deps.print(verb === "waive" ? `setup waive: ${id} skipped on this Mac` : `setup unwaive: ${id} re-armed on this Mac`);
}

export async function setupWaive(args: string[], _ctx: CommandContext = {}, deps: WaiveDeps = realWaiveDeps()): Promise<void> {
  await runWaiver(args, deps, "waive");
}

export async function setupUnwaive(args: string[], _ctx: CommandContext = {}, deps: WaiveDeps = realWaiveDeps()): Promise<void> {
  await runWaiver(args, deps, "unwaive");
}
```

Update the module doc comment at the top of `commands/setup.ts` with two usage lines:

```
 *   rt setup waive <row-id> [--json]           skip a finish-gated row on this Mac
 *   rt setup unwaive <row-id> [--json]         re-arm it
```

- [ ] **Step 5: The tree leaves**

`lib/command-tree-def.ts`, inside `setup.subcommands` after `intent`:

```ts
      waive: {
        description: "Skip a finish-gated checklist row on this Mac so setup can finish without it",
        module: "./commands/setup.ts",
        fn: "setupWaive",
        omitBehavior: "picker",
        args: [
          { name: "Row", type: "text", placeholder: "tool.fast-browser-extension", hint: "Finish-gated row id (today only tool.fast-browser-extension)" },
          SETUP_JSON_ARG,
        ],
      },
      unwaive: {
        description: "Re-arm a finish-gated checklist row you skipped on this Mac",
        module: "./commands/setup.ts",
        fn: "setupUnwaive",
        omitBehavior: "picker",
        args: [
          { name: "Row", type: "text", placeholder: "tool.fast-browser-extension", hint: "Finish-gated row id (today only tool.fast-browser-extension)" },
          SETUP_JSON_ARG,
        ],
      },
```

Then regenerate the reference: `bun scripts/gen-docs.ts` and `bun run docs:check`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test lib/setup commands/__tests__/setup-waive.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/module-registry.test.ts && bun run picker:check && bun run docs:check && bunx tsc --noEmit`
Expected: PASS, `0 violation(s)`, docs in sync.

- [ ] **Step 7: Commit**

```bash
git add lib/setup/finish-gate.ts commands/setup.ts lib/command-tree-def.ts website/docs/reference lib/setup/__tests__/finish-gate.test.ts commands/__tests__/setup-waive.test.ts
git commit -m "setup: waive and unwaive verbs over the finish-gated rows

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `rt setup status` prints the Finish line

**Files:**
- Modify: `commands/setup.ts` (`renderFinishLine`, `runPlan`)
- Test: `commands/__tests__/setup-plan.test.ts`

**Interfaces:**
- Produces: `renderFinishLine(plan: Plan): string` (`"Finish: ready"` or `"Finish: blocked by: a, b"`).

- [ ] **Step 1: Write the failing tests**

Append to `commands/__tests__/setup-plan.test.ts` (import `renderFinishLine`):

```ts
describe("renderFinishLine", () => {
  const base: Plan = { contract: 1, at: "2026-08-21T00:00:00.000Z", team: { slug: "", name: "", mode: "none" }, groups: [], canInstall: true, requiredMissing: [], finishBlockedBy: [] };

  test("no blockers -> Finish: ready", () => {
    expect(renderFinishLine(base)).toBe("Finish: ready");
  });

  test("blockers are listed by id", () => {
    expect(renderFinishLine({ ...base, finishBlockedBy: ["tool.fast-browser-extension"] })).toBe("Finish: blocked by: tool.fast-browser-extension");
  });
});

describe("setupStatus Finish line", () => {
  test("human mode prints the Finish line right after the Install line", async () => {
    const deps = captureDeps();
    await setupStatus([], {}, deps);
    const install = deps.lines.findIndex((l) => l.startsWith("Install: "));
    expect(install).toBeGreaterThan(0);
    expect(deps.lines[install + 1]).toBe("Finish: ready");
  });

  test("setup plan (human) prints no Finish line", async () => {
    const deps = captureDeps();
    await setupPlan([], {}, deps);
    expect(deps.lines.some((l) => l.startsWith("Finish: "))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test commands/__tests__/setup-plan.test.ts`
Expected: FAIL (`renderFinishLine` not exported; no Finish line).

- [ ] **Step 3: Implement**

`commands/setup.ts`, after `renderPlanHuman`:

```ts
/** The wizard's other gate, printed beside the Install line by `setup status`: Finish waits on finish-gated rows that are not ready, skipped, or waived on this Mac. */
export function renderFinishLine(plan: Plan): string {
  return plan.finishBlockedBy.length === 0 ? "Finish: ready" : `Finish: blocked by: ${plan.finishBlockedBy.join(", ")}`;
}
```

In `runPlan`, replace the human branch's tail:

```ts
  if (header) deps.print(header);
  for (const line of renderPlanHuman(plan)) deps.print(line);

  if (mode === "status") {
    deps.print(renderFinishLine(plan));
    const missingAccounts = missingAccountLines(plan);
    ...
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test commands/__tests__/setup-plan.test.ts && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/setup.ts commands/__tests__/setup-plan.test.ts
git commit -m "setup status: print the Finish line beside Install

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The app: models, Done screen, window gate

**Files:**
- Modify: `rt-tray/Sources-core/Contract/PlanModels.swift`
- Modify: `rt-tray/Sources-core/Readiness/ReadinessModel.swift`
- Modify: `rt-tray/Sources-core/Setup/SetupFlowModel.swift`
- Create: `rt-tray/Sources-core/Setup/FinishGate.swift`
- Modify: `rt-tray/Sources/AccessibilityIDs.swift`
- Modify: `rt-tray/Sources/Setup/SetupWindowController.swift`, `rt-tray/Sources/Setup/SetupView.swift`, `rt-tray/Sources/Setup/Screens/DoneScreen.swift`
- Modify: `rt-tray/Tests/stub-rt/stub.ts` (`finishBlockedBy: []` in the plan envelope)
- Test: `rt-tray/Tests/MattstackCoreChecks/PlanModelsChecks.swift`, `ReadinessModelChecks.swift`, `SetupFlowChecks.swift`, `DoneModelChecks.swift` (create), `AllChecks.swift`

**Interfaces:**
- Produces (MattstackCore, public): `PlanRow.finishGated: Bool`; `Plan.finishBlockedBy: [String]`; `ReadinessModel.finishBlockedBy`, `.finishBlockedRows`; `SetupFlowModel.finishBlockedBy`; `FinishGate.waivedNotePrefix`, `.beforeYouFinishTitle`, `.skipSheetTitle`, `.skipSheetBody`, `.skipSheetConfirm`, `.skipSheetCancel`, `.headline(blocked:)`; `PlanRow.isWaived`; `WaiverClient(rt:readiness:)` with `waive(_:) async -> String?`, `unwaive(_:) async -> String?`; `DoneModel(readiness:waivers:)` with `hasCheckedSincePostInstall`, `blockedRows`, `stillToDoRows`, `finishEnabled`, `headline`, `skipTarget`, `skipError`, `isSkipping`, `checkPostInstall()`, `requestSkip(_:)`, `cancelSkip()`, `confirmSkip()`.

- [ ] **Step 1: Write the failing checks**

`rt-tray/Tests/MattstackCoreChecks/PlanModelsChecks.swift`: append two checks to `planModelsChecks`:

```swift
    Check("finishGated and finishBlockedBy decode, and default to false / [] when an older rt omits them") { c in
        let plan = try JSONDecoder().decode(Plan.self, from: Data(samplePlanJSON.utf8))
        c.expectEqual(plan.finishBlockedBy, [])
        c.expect(plan.groups.flatMap(\.rows).allSatisfy { !$0.finishGated })
        let gated = samplePlanJSON
            .replacingOccurrences(of: "\"id\": \"tool.chrome\", \"kind\": \"tool\",", with: "\"id\": \"tool.chrome\", \"kind\": \"tool\", \"finishGated\": true,")
            .replacingOccurrences(of: "\"requiredMissing\": [\"perm.fda\", \"account.gitlab\"]", with: "\"requiredMissing\": [\"perm.fda\", \"account.gitlab\"], \"finishBlockedBy\": [\"tool.chrome\"]")
        let decoded = try JSONDecoder().decode(Plan.self, from: Data(gated.utf8))
        c.expectEqual(decoded.finishBlockedBy, ["tool.chrome"])
        c.expectEqual(decoded.groups.flatMap(\.rows).first { $0.id == "tool.chrome" }?.finishGated, true)
        let again = try JSONDecoder().decode(Plan.self, from: JSONEncoder().encode(decoded))
        c.expectEqual(again, decoded)
    },
```

`ReadinessModelChecks.swift`: extend `makeManualPlan` with a `waived: Bool = false` parameter and a `finishGated: true` extension row; when `waived`, the row's `optionalNote` is `FinishGate.waivedNotePrefix + ": agents cannot capture screenshots or annotate evidence from your browser. Load it later from Settings."`; compute `finishBlockedBy` as `waived || extensionStatus == .ready || extensionStatus == .skipped ? [] : ["tool.fast-browser-extension"]` and pass it to `Plan(...)`. Update `makePlan` and `makeSweepPlan` to pass `finishBlockedBy: []`. Append checks:

```swift
    Check("finishBlockedBy comes from the plan, blocked rows resolve in plan order, and a blocked row leaves outstandingManualRows") { c in
        let m = await MainActor.run { ReadinessModel(plans: FakePlans([makeManualPlan(extensionStatus: .needsYou)]), permissions: FakePermissions(), ticker: FakeTicker()) }
        await m.load()
        await MainActor.run {
            c.expectEqual(m.finishBlockedBy, ["tool.fast-browser-extension"])
            c.expectEqual(m.finishBlockedRows.map(\.id), ["tool.fast-browser-extension"])
            c.expect(!m.outstandingManualRows.map(\.id).contains("tool.fast-browser-extension"), "a row blocking Finish is not also still-to-do")
        }
    },
    Check("a waived extension row is not blocked, reads as waived, and is back in outstandingManualRows") { c in
        let m = await MainActor.run { ReadinessModel(plans: FakePlans([makeManualPlan(extensionStatus: .needsYou, waived: true)]), permissions: FakePermissions(), ticker: FakeTicker()) }
        await m.load()
        await MainActor.run {
            c.expectEqual(m.finishBlockedBy, [])
            c.expectEqual(m.row("tool.fast-browser-extension")?.isWaived, true)
            c.expect(m.outstandingManualRows.map(\.id).contains("tool.fast-browser-extension"), "the Done screen still lists a skipped row under Still to do")
        }
    },
    Check("an unwaived extension row is not waived, even when ready") { c in
        let m = await MainActor.run { ReadinessModel(plans: FakePlans([makeManualPlan(extensionStatus: .ready)]), permissions: FakePermissions(), ticker: FakeTicker()) }
        await m.load()
        await MainActor.run { c.expectEqual(m.row("tool.fast-browser-extension")?.isWaived, false) }
    },
```

`SetupFlowChecks.swift`: append:

```swift
    Check("windowMayClose follows the finish gate on Done and nowhere else") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .done)
            c.expectEqual(f.windowMayClose, true)
            f.finishBlockedBy = ["tool.fast-browser-extension"]
            c.expectEqual(f.windowMayClose, false, "a blocked Finish closes the titlebar buttons too")
            c.expectEqual(f.continueTitle, "Finish")
            f.finishBlockedBy = []
            c.expectEqual(f.windowMayClose, true)
            f.jump(to: .checklist)
            c.expectEqual(f.windowMayClose, false, "the gate never opens a non-Done step")
        }
    },
```

Create `rt-tray/Tests/MattstackCoreChecks/DoneModelChecks.swift`:

```swift
import Foundation
import MattstackCore

private func doneFixture(plans: [Plan], answers: [String: (Int32, String)] = [:]) async -> (DoneModel, ReadinessModel, ScriptedRt, FakePlans) {
    let rt = ScriptedRt()
    rt.answers = answers
    let fake = FakePlans(plans)
    let readiness = await MainActor.run { ReadinessModel(plans: fake, permissions: FakePermissions(), ticker: FakeTicker()) }
    let model = await MainActor.run { DoneModel(readiness: readiness, waivers: WaiverClient(rt: rt, readiness: readiness)) }
    return (model, readiness, rt, fake)
}

let doneModelChecks: [Check] = [
    Check("copy is pinned byte for byte") { c in
        c.expectEqual(FinishGate.beforeYouFinishTitle, "Before you finish")
        c.expectEqual(FinishGate.skipSheetTitle, "Skip the Fast Browser extension?")
        c.expectEqual(FinishGate.skipSheetBody, "Without the Fast Browser extension, agents cannot capture screenshots or annotate evidence from your browser. You can load it later from Settings.")
        c.expectEqual(FinishGate.skipSheetConfirm, "Skip for now")
        c.expectEqual(FinishGate.skipSheetCancel, "Cancel")
        c.expectEqual(FinishGate.waivedNotePrefix, "Skipped on this Mac")
        c.expectEqual(FinishGate.headline(blocked: 1), "One step left before you finish")
        c.expectEqual(FinishGate.headline(blocked: 2), "2 steps left before you finish")
    },
    Check("before the post-install check nothing is listed; after it the blocked row is in Before you finish, not Still to do, and Finish is disabled") { c in
        let (m, _, _, _) = await doneFixture(plans: [makeManualPlan(extensionStatus: .needsYou)])
        await MainActor.run {
            c.expectEqual(m.blockedRows.map(\.id), [])
            c.expectEqual(m.stillToDoRows.map(\.id), [])
            c.expectEqual(m.finishEnabled, false, "unchecked is closed, never open")
        }
        await m.checkPostInstall()
        await MainActor.run {
            c.expectEqual(m.hasCheckedSincePostInstall, true)
            c.expectEqual(m.blockedRows.map(\.id), ["tool.fast-browser-extension"])
            c.expectEqual(m.stillToDoRows.map(\.id), [], "mission-control's open-settings action never qualifies, and the blocked row is not listed twice")
            c.expectEqual(m.finishEnabled, false)
            c.expectEqual(m.headline, "One step left before you finish")
        }
    },
    Check("a failed post-install refresh keeps the gate closed") { c in
        final class Boom: PlanSource, @unchecked Sendable { func fetchPlan() async throws -> Plan { throw FakePlansExhausted() } }
        let readiness = await MainActor.run { ReadinessModel(plans: Boom(), permissions: FakePermissions(), ticker: FakeTicker()) }
        let m = await MainActor.run { DoneModel(readiness: readiness, waivers: WaiverClient(rt: ScriptedRt(), readiness: readiness)) }
        await m.checkPostInstall()
        await MainActor.run {
            c.expectEqual(m.hasCheckedSincePostInstall, false)
            c.expectEqual(m.finishEnabled, false)
        }
    },
    Check("no blockers after the check: Finish enabled, headline reads as installed") { c in
        let (m, _, _, _) = await doneFixture(plans: [makeManualPlan(extensionStatus: .ready)])
        await m.checkPostInstall()
        await MainActor.run {
            c.expectEqual(m.blockedRows.map(\.id), [])
            c.expectEqual(m.finishEnabled, true)
            c.expectEqual(m.headline, "Everything's working")
        }
    },
    Check("confirming Skip for now runs rt setup waive <id> --json, re-checks, and the row moves to Still to do with Finish enabled") { c in
        let (m, _, rt, plans) = await doneFixture(
            plans: [makeManualPlan(extensionStatus: .needsYou), makeManualPlan(extensionStatus: .needsYou, waived: true)],
            answers: ["setup waive tool.fast-browser-extension --json": (0, #"{"contract":1,"at":"t","ok":true,"id":"tool.fast-browser-extension","waived":["tool.fast-browser-extension"]}"#)])
        await m.checkPostInstall()
        let row = try await MainActor.run { try c.requireSome(m.blockedRows.first) }
        await MainActor.run { m.requestSkip(row) }
        await MainActor.run { c.expectEqual(m.skipTarget?.id, "tool.fast-browser-extension") }
        await m.confirmSkip()
        c.expectEqual(rt.calls.map(\.args), [["setup", "waive", "tool.fast-browser-extension", "--json"]])
        c.expectEqual(plans.fetches, 2, "confirming re-checks the plan")
        await MainActor.run {
            c.expectEqual(m.skipTarget?.id, nil, "the sheet closes on success")
            c.expectEqual(m.skipError, nil)
            c.expectEqual(m.blockedRows.map(\.id), [])
            c.expect(m.stillToDoRows.map(\.id).contains("tool.fast-browser-extension"))
            c.expectEqual(m.finishEnabled, true)
        }
    },
    Check("a waive that fails leaves the sheet up with the error and the gate closed") { c in
        let (m, _, rt, plans) = await doneFixture(
            plans: [makeManualPlan(extensionStatus: .needsYou)],
            answers: ["setup waive tool.fast-browser-extension --json": (2, #"{"contract":1,"at":"t","error":{"code":"not-finish-gated","message":"nope"}}"#)])
        await m.checkPostInstall()
        let row = try await MainActor.run { try c.requireSome(m.blockedRows.first) }
        await MainActor.run { m.requestSkip(row) }
        await m.confirmSkip()
        c.expectEqual(rt.calls.count, 1)
        c.expectEqual(plans.fetches, 1, "a failed waive does not re-check")
        await MainActor.run {
            c.expectEqual(m.skipTarget?.id, "tool.fast-browser-extension")
            c.expectEqual(m.skipError, "nope")
            c.expectEqual(m.finishEnabled, false)
        }
    },
    Check("cancel clears the sheet without running anything") { c in
        let (m, _, rt, _) = await doneFixture(plans: [makeManualPlan(extensionStatus: .needsYou)])
        await m.checkPostInstall()
        let row = try await MainActor.run { try c.requireSome(m.blockedRows.first) }
        await MainActor.run { m.requestSkip(row); m.cancelSkip() }
        await MainActor.run { c.expectEqual(m.skipTarget?.id, nil) }
        c.expectEqual(rt.calls.count, 0)
    },
    Check("WaiverClient.unwaive runs rt setup unwaive <id> --json and re-checks") { c in
        let (_, readiness, rt, plans) = await doneFixture(
            plans: [makeManualPlan(extensionStatus: .needsYou, waived: true), makeManualPlan(extensionStatus: .needsYou)],
            answers: ["setup unwaive tool.fast-browser-extension --json": (0, #"{"contract":1,"at":"t","ok":true,"id":"tool.fast-browser-extension","waived":[]}"#)])
        await readiness.load()
        let waivers = await MainActor.run { WaiverClient(rt: rt, readiness: readiness) }
        let err = await waivers.unwaive("tool.fast-browser-extension")
        c.expectEqual(err, nil)
        c.expectEqual(rt.calls.map(\.args), [["setup", "unwaive", "tool.fast-browser-extension", "--json"]])
        c.expectEqual(plans.fetches, 2)
        await MainActor.run { c.expectEqual(readiness.finishBlockedBy, ["tool.fast-browser-extension"]) }
    },
]
```

Register in `AllChecks.swift`: append `+ doneModelChecks`.

- [ ] **Step 2: Run the checks to verify they fail**

Run: `swift build --package-path rt-tray --target MattstackCoreChecks`
Expected: compile errors (`finishGated`, `finishBlockedBy`, `FinishGate`, `DoneModel`, `WaiverClient` undefined).

- [ ] **Step 3: Contract models**

`PlanModels.swift`, `PlanRow`: add `public var finishGated: Bool` after `recheck`, extend the memberwise init with `finishGated: Bool = false` (last parameter), and add:

```swift
    /// `finishGated` is new to the contract; an rt that predates it omits the
    /// key, and that must read as "not gated" rather than fail the plan.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(RowKind.self, forKey: .kind)
        title = try c.decode(String.self, forKey: .title)
        why = try c.decode(String.self, forKey: .why)
        required = try c.decode(Bool.self, forKey: .required)
        optionalNote = try c.decodeIfPresent(String.self, forKey: .optionalNote)
        status = try c.decode(RowStatus.self, forKey: .status)
        detail = try c.decodeIfPresent(String.self, forKey: .detail)
        action = try c.decodeIfPresent(RowAction.self, forKey: .action)
        recheck = try c.decode(RecheckPolicy.self, forKey: .recheck)
        finishGated = try c.decodeIfPresent(Bool.self, forKey: .finishGated) ?? false
    }
```

`Plan`: add `public var finishBlockedBy: [String]`, extend the init with `finishBlockedBy: [String] = []`, and add:

```swift
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        contract = try c.decode(Int.self, forKey: .contract)
        at = try c.decode(String.self, forKey: .at)
        team = try c.decode(TeamInfo.self, forKey: .team)
        groups = try c.decode([PlanGroup].self, forKey: .groups)
        canInstall = try c.decode(Bool.self, forKey: .canInstall)
        requiredMissing = try c.decode([String].self, forKey: .requiredMissing)
        finishBlockedBy = try c.decodeIfPresent([String].self, forKey: .finishBlockedBy) ?? []
    }
```

- [ ] **Step 4: ReadinessModel**

Add `@Published public private(set) var finishBlockedBy: [String] = []`; in `fetch()` after `groups = plan.groups`: `finishBlockedBy = plan.finishBlockedBy`. Add:

```swift
    /// The rows Finish waits on, in plan order.
    public var finishBlockedRows: [PlanRow] { finishBlockedBy.compactMap { row($0) } }
```

In `outstandingManualRows`, add `!finishBlockedBy.contains(row.id)` to the first `guard` so a blocked row is listed once, under "Before you finish". Update its doc comment: a row currently blocking Finish is excluded, since the Done screen lists it in its own section.

- [ ] **Step 5: SetupFlowModel**

Add `@Published public var finishBlockedBy: [String] = []` with the doc: mirrored from the readiness model by the setup view, so the window controller (which observes only the flow) restyles the titlebar when the gate moves. Change `windowMayClose` to `step == .done && finishBlockedBy.isEmpty`.

- [ ] **Step 6: Create `rt-tray/Sources-core/Setup/FinishGate.swift`**

```swift
import Foundation
import Combine

/// Copy and rules for the finish gate: finish-gated rows block the wizard's
/// Finish until ready, skipped, or waived on this Mac by `rt setup waive`.
public enum FinishGate {
    public static let waivedNotePrefix = "Skipped on this Mac"
    public static let beforeYouFinishTitle = "Before you finish"
    public static let skipSheetTitle = "Skip the Fast Browser extension?"
    public static let skipSheetBody = "Without the Fast Browser extension, agents cannot capture screenshots or annotate evidence from your browser. You can load it later from Settings."
    public static let skipSheetConfirm = "Skip for now"
    public static let skipSheetCancel = "Cancel"

    public static func headline(blocked: Int) -> String {
        blocked == 1 ? "One step left before you finish" : "\(blocked) steps left before you finish"
    }
}

public extension PlanRow {
    /// rt marks a waived row by its note, the same way a "works without"
    /// row is recognised; the contract carries no separate flag.
    var isWaived: Bool { finishGated && (optionalNote?.hasPrefix(FinishGate.waivedNotePrefix) ?? false) }
}

/// Runs the two waiver verbs and refreshes the plan after either succeeds,
/// so the row's shape on screen always comes from rt, never a local guess.
@MainActor
public final class WaiverClient {
    private let rt: RtRunning
    private let readiness: ReadinessModel

    public init(rt: RtRunning, readiness: ReadinessModel) {
        self.rt = rt; self.readiness = readiness
    }

    /// nil once the verb succeeded and the plan was re-read; otherwise the
    /// user-facing failure copy, with the plan left as it was.
    public func waive(_ rowId: String) async -> String? { await run("waive", rowId) }
    public func unwaive(_ rowId: String) async -> String? { await run("unwaive", rowId) }

    private func run(_ verb: String, _ rowId: String) async -> String? {
        let args = ["setup", verb, rowId, "--json"]
        do {
            let result = try await rt.run(args, stdin: nil)
            if let e = result.userError { return e.message }
            if result.exitCode != 0 { return result.failureCopy(verb: "setup \(verb) \(rowId)") }
        } catch {
            return (error as? RtClientError)?.copy ?? "rt setup \(verb) failed to start."
        }
        await readiness.recheckAll()
        return nil
    }
}

/// The Done screen's state: which rows block Finish, which are merely still
/// to do, and the Skip for now sheet. Nothing is listed until the
/// post-install re-check lands, since the model still holds the pre-Install
/// plan before then; the gate reads closed, never open, in that window.
@MainActor
public final class DoneModel: ObservableObject {
    @Published public private(set) var hasCheckedSincePostInstall = false
    @Published public var skipTarget: PlanRow?
    @Published public private(set) var skipError: String?
    @Published public private(set) var isSkipping = false

    private let readiness: ReadinessModel
    private let waivers: WaiverClient
    private var forward: AnyCancellable?

    public init(readiness: ReadinessModel, waivers: WaiverClient) {
        self.readiness = readiness; self.waivers = waivers
        forward = readiness.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }

    public var blockedRows: [PlanRow] { hasCheckedSincePostInstall ? readiness.finishBlockedRows : [] }
    public var stillToDoRows: [PlanRow] { hasCheckedSincePostInstall ? readiness.outstandingManualRows : [] }
    public var finishEnabled: Bool { hasCheckedSincePostInstall && readiness.finishBlockedBy.isEmpty }

    public var headline: String {
        let blocked = blockedRows.count
        if blocked > 0 { return FinishGate.headline(blocked: blocked) }
        let outstanding = stillToDoRows.count
        return outstanding == 0 ? "Everything's working" : "Installed, with \(outstanding) step\(outstanding == 1 ? "" : "s") left for you"
    }

    /// A failed refresh leaves `readiness` holding the stale pre-Install plan;
    /// the gate stays closed rather than presenting that as freshly confirmed.
    public func checkPostInstall() async {
        await readiness.recheckAll()
        if !readiness.lastRefreshFailed { hasCheckedSincePostInstall = true }
    }

    public func requestSkip(_ row: PlanRow) { skipError = nil; skipTarget = row }
    public func cancelSkip() { skipTarget = nil; skipError = nil }

    /// Success closes the sheet; the re-read plan moves the row to Still to
    /// do. Failure keeps the sheet up with the message and the gate closed.
    public func confirmSkip() async {
        guard let row = skipTarget else { return }
        isSkipping = true
        defer { isSkipping = false }
        if let error = await waivers.waive(row.id) {
            skipError = error
            return
        }
        skipTarget = nil
        skipError = nil
    }
}
```

- [ ] **Step 7: Accessibility ids**

`AccessibilityIDs.swift`, in the `// Done` block:

```swift
    static let doneBeforeYouFinish = "setup.done.beforeYouFinish"
    static func doneBeforeYouFinishRow(_ id: String) -> String { "setup.done.beforeYouFinish.\(id)" }
    static func doneBeforeYouFinishRowStatus(_ id: String) -> String { "setup.done.beforeYouFinish.\(id).status" }
    static func doneBeforeYouFinishRowAction(_ id: String) -> String { "setup.done.beforeYouFinish.\(id).action" }
    static func doneSkipRow(_ id: String) -> String { "setup.done.skip.\(id)" }
    static let doneSkipConfirm = "setup.done.skipConfirm"
    static let doneSkipConfirmSkip = "setup.done.skipConfirm.skip"
    static let doneSkipConfirmCancel = "setup.done.skipConfirm.cancel"
    static let doneSkipConfirmError = "setup.done.skipConfirm.error"
```

- [ ] **Step 8: Wire the window, view and screen**

`SetupWindowController.swift`: add `let done: DoneModel`; in `init`, after `team`: `self.done = DoneModel(readiness: environment.readiness, waivers: WaiverClient(rt: environment.rt, readiness: environment.readiness))`; pass `done: done` to `SetupView`.

`SetupView.swift`: add `@ObservedObject var done: DoneModel` after `install`; construct `DoneScreen(model: done, install: install, readiness: readiness, isOwner: ..., onInvite: ...)`; add after `.onChange(of: install.phase)`:

```swift
        // The window controller observes only the flow, so the gate is
        // mirrored there for the titlebar's close and minimize buttons.
        .onChange(of: readiness.finishBlockedBy, initial: true) { _, ids in flow.finishBlockedBy = ids }
```

In `continueEnabled`: `case .done: return done.finishEnabled`.

`DoneScreen.swift`: replace the file:

```swift
import SwiftUI
import MattstackCore

struct DoneScreen: View {
    @ObservedObject var model: DoneModel
    @ObservedObject var install: InstallRunModel
    @ObservedObject var readiness: ReadinessModel
    let isOwner: Bool
    let onInvite: () -> Void
    @State private var steps: (title: String, steps: [String])?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Image(systemName: headlineSymbol).font(.system(size: 40)).foregroundStyle(headlineTint)
                VStack(alignment: .leading) {
                    Text(model.headline).font(.title3.weight(.semibold))
                    Text(verifySummary).foregroundStyle(.secondary)
                }
            }
            Form {
                Section("Where things live") {
                    LabeledContent("Menu bar") { Text("the m at the top right") }
                    // keep the existing "Terminal" LabeledContent line exactly as it is in the file today
                    LabeledContent("Board") { Link("https://board.mattstack", destination: URL(string: "https://board.mattstack")!) }
                }
                if !model.blockedRows.isEmpty {
                    Section(FinishGate.beforeYouFinishTitle) {
                        ForEach(model.blockedRows) { row in
                            VStack(alignment: .leading, spacing: 6) {
                                RowView(row: row, isChecking: false, rowID: AXID.doneBeforeYouFinishRow(row.id),
                                        actionID: AXID.doneBeforeYouFinishRowAction(row.id), statusID: AXID.doneBeforeYouFinishRowStatus(row.id)) { show(row) }
                                HStack {
                                    Spacer()
                                    Button(FinishGate.skipSheetConfirm) { model.requestSkip(row) }
                                        .controlSize(.small)
                                        .accessibilityIdentifier(AXID.doneSkipRow(row.id))
                                }
                            }
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier(AXID.doneBeforeYouFinish)
                }
                if !model.stillToDoRows.isEmpty {
                    Section("Still to do") {
                        ForEach(model.stillToDoRows) { row in
                            RowView(row: row, isChecking: false, rowID: AXID.doneStillToDoRow(row.id),
                                    actionID: AXID.doneStillToDoRowAction(row.id), statusID: AXID.doneStillToDoRowStatus(row.id)) { show(row) }
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier(AXID.doneStillToDo)
                }
            }
            .formStyle(.grouped).scrollDisabled(true)
            HStack {
                Button("Open the board", action: openBoard).accessibilityIdentifier(AXID.doneOpenBoard)
                if isOwner { Button("Invite teammates…", action: onInvite).accessibilityIdentifier(AXID.doneInvite) }
                Spacer()
            }
            Spacer()
        }
        .padding(24)
        .task { await model.checkPostInstall() }
        .sheet(isPresented: Binding(get: { steps != nil }, set: { presented in
            guard !presented else { return }
            steps = nil
            // The row's real state changes outside the app (Chrome, a
            // download) -- only the sheet's dismissal tells us to look again.
            Task { await readiness.recheckAll() }
        })) {
            if let steps { StepsSheet(title: steps.title, steps: steps.steps) }
        }
        .sheet(item: $model.skipTarget) { _ in
            SkipConfirmSheet(model: model)
        }
        // .contain: without it, the plain HStack's buttons (Open the board,
        // Invite teammates…) report THIS screen-level identifier instead of
        // their own -- same fix as InstallScreen's stepRow and ChecklistScreen.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.doneScreen)
    }

    private var headlineSymbol: String {
        if !model.blockedRows.isEmpty { return "exclamationmark.triangle" }
        return model.stillToDoRows.isEmpty ? "checkmark.seal.fill" : "checkmark.seal"
    }
    private var headlineTint: Color {
        if !model.blockedRows.isEmpty { return .yellow }
        return model.stillToDoRows.isEmpty ? .green : .accentColor
    }

    private func show(_ row: PlanRow) {
        guard let action = row.action else { return }
        if action.type == .openURL {
            // Mirrors RowActionDispatcher's own rejection: an unsupported
            // scheme does nothing rather than presenting a title with no steps.
            guard let raw = action.url, let url = URL(string: raw), url.scheme?.hasPrefix("http") == true else { return }
            NSWorkspace.shared.open(url)
            Task { await readiness.recheckAll() }
            return
        }
        steps = (title: row.title, steps: action.steps ?? [])
    }

    private var verifySummary: String {
        let verify = install.steps.first { $0.id == "verify" }
        let n = install.steps.filter { $0.state == .done }.count
        return verify?.detail.map { "\($0) · \(n) steps done" } ?? "\(n) steps done"
    }

    /// Stub mode never opens a real browser tab -- there's no real board to
    /// show, and a UI test driving this button shouldn't launch one.
    private func openBoard() {
        guard !BundleFlavor.isStubActive else {
            TrayLog.info("open board skipped (stub mode)")
            return
        }
        NSWorkspace.shared.open(URL(string: "https://board.mattstack")!)
    }
}

/// Confirms a Skip for now with the cost stated. Buttons are driven by
/// their wording from the VM walkthrough, so the labels are the contract.
struct SkipConfirmSheet: View {
    @ObservedObject var model: DoneModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(FinishGate.skipSheetTitle).font(.headline)
            Text(FinishGate.skipSheetBody).fixedSize(horizontal: false, vertical: true)
            if let e = model.skipError {
                Text(e).font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.doneSkipConfirmError)
            }
            HStack {
                Spacer()
                Button(FinishGate.skipSheetCancel) { model.cancelSkip() }
                    .keyboardShortcut(.cancelAction)
                    .disabled(model.isSkipping)
                    .accessibilityIdentifier(AXID.doneSkipConfirmCancel)
                Button(FinishGate.skipSheetConfirm, role: .destructive) { Task { await model.confirmSkip() } }
                    .disabled(model.isSkipping)
                    .accessibilityIdentifier(AXID.doneSkipConfirmSkip)
            }
        }
        .padding(20).frame(width: 440)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.doneSkipConfirm)
    }
}
```

`rt-tray/Tests/stub-rt/stub.ts`: add `finishBlockedBy: []` beside `requiredMissing` in the plan envelope.

- [ ] **Step 9: Run the checks to verify they pass**

Run: `swift test --package-path rt-tray 2>&1 | tail -30`
Expected: build green for every target, all checks pass (`MattstackCoreTests` wraps `allChecks`).

- [ ] **Step 10: Commit**

```bash
git add rt-tray/Sources-core rt-tray/Sources/AccessibilityIDs.swift rt-tray/Sources/Setup rt-tray/Tests/MattstackCoreChecks rt-tray/Tests/stub-rt/stub.ts
git commit -m "app: gate Finish and window close on finishBlockedBy, Skip for now sheet

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Settings: the Fast Browser pane with Un-skip

**Files:**
- Create: `rt-tray/Sources/Settings/FastBrowserPane.swift`
- Modify: `rt-tray/Sources/Settings/SettingsView.swift`, `rt-tray/Sources/Settings/SettingsWindowController.swift` (`SettingsPane.fastBrowser`, `SettingsEnvironment.waivers`)
- Modify: `rt-tray/Sources/Setup/SetupCoordinator.swift` (build the client)
- Modify: `rt-tray/Sources/AccessibilityIDs.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/SettingsChecks.swift` (pane enum coverage if a check enumerates panes; otherwise none: the logic is `WaiverClient`, checked in Task 5)

**Interfaces:**
- Consumes: `WaiverClient.unwaive`, `PlanRow.isWaived`, `ReadinessModel.row(_:)`.

- [ ] **Step 1: Look for a pane-enumerating check**

Run: `grep -n "SettingsPane\|settingsTab" rt-tray/Tests/MattstackCoreChecks/*.swift rt-tray/Tests/mattstackUITests/*.swift`
If a check or UI test enumerates the tabs, add `fastBrowser` to its expectation first so it fails, then implement.

- [ ] **Step 2: Implement**

`SettingsWindowController.swift`: `enum SettingsPane: String, CaseIterable { case general, permissions, fastBrowser, team, uninstall }`; add `let waivers: WaiverClient` to `SettingsEnvironment` after `team`.

`SetupCoordinator.swift`, in `showSettings`: pass `waivers: WaiverClient(rt: rt, readiness: readiness)` into `SettingsEnvironment`.

`SettingsView.swift`: after the Permissions tab:

```swift
            FastBrowserPane(env: env)
                .tabItem { Label("Fast Browser", systemImage: "globe").accessibilityIdentifier(AXID.settingsTab(SettingsPane.fastBrowser.rawValue)) }
                .tag(SettingsPane.fastBrowser)
```

`AccessibilityIDs.swift`, in `// Settings`:

```swift
    static let settingsFastBrowserRow = "settings.fastBrowser.row"
    static let settingsFastBrowserRowStatus = "settings.fastBrowser.row.status"
    static let settingsFastBrowserRowAction = "settings.fastBrowser.row.action"
    static let settingsFastBrowserSkipped = "settings.fastBrowser.skipped"
    static let settingsFastBrowserUnskip = "settings.fastBrowser.unskip"
    static let settingsFastBrowserError = "settings.fastBrowser.error"
```

Create `rt-tray/Sources/Settings/FastBrowserPane.swift`:

```swift
import SwiftUI
import MattstackCore

/// The one Settings surface for the finish gate: the extension row as the
/// checklist shows it, and the way back from a Skip for now.
struct FastBrowserPane: View {
    let env: SettingsEnvironment
    @ObservedObject private var readiness: ReadinessModel
    @State private var steps: (title: String, steps: [String])?
    @State private var busy = false
    @State private var error: String?

    private static let rowId = "tool.fast-browser-extension"

    init(env: SettingsEnvironment) { self.env = env; self.readiness = env.readiness }

    var body: some View {
        Form {
            Section("Chrome extension") {
                if let row = readiness.row(Self.rowId) {
                    RowView(row: row, isChecking: readiness.checkingRowIds.contains(row.id), rowID: AXID.settingsFastBrowserRow,
                            actionID: AXID.settingsFastBrowserRowAction, statusID: AXID.settingsFastBrowserRowStatus) { show(row) }
                    if row.isWaived {
                        HStack {
                            Text("Skipped on this Mac").font(.caption).accessibilityIdentifier(AXID.settingsFastBrowserSkipped)
                            Spacer()
                            Button(busy ? "Un-skipping…" : "Un-skip") { unskip() }
                                .disabled(busy)
                                .accessibilityIdentifier(AXID.settingsFastBrowserUnskip)
                        }
                    }
                } else if let e = readiness.lastError {
                    Text("Couldn't read the checklist: \(e)").font(.caption).foregroundStyle(.red)
                } else {
                    Text(readiness.isLoading ? "Checking…" : "No extension row in this checklist.").foregroundStyle(.secondary)
                }
                if let error {
                    Text(error).font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.settingsFastBrowserError)
                }
            }
        }
        .formStyle(.grouped)
        .task { await readiness.load() }
        .sheet(isPresented: Binding(get: { steps != nil }, set: { presented in
            guard !presented else { return }
            steps = nil
            Task { await readiness.recheckAll() }
        })) {
            if let steps { StepsSheet(title: steps.title, steps: steps.steps) }
        }
    }

    private func show(_ row: PlanRow) {
        guard let action = row.action, action.type == .steps else { return }
        steps = (title: row.title, steps: action.steps ?? [])
    }

    private func unskip() {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            error = await env.waivers.unwaive(Self.rowId)
        }
    }
}
```

- [ ] **Step 3: Build and run the checks**

Run: `swift build --package-path rt-tray && swift test --package-path rt-tray 2>&1 | tail -15`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add rt-tray/Sources/Settings rt-tray/Sources/Setup/SetupCoordinator.swift rt-tray/Sources/AccessibilityIDs.swift rt-tray/Tests
git commit -m "settings: Fast Browser pane with Un-skip for a waived extension

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: VM walkthrough: drive Skip for now, assert the machine store

**Files:**
- Modify: `rt-tray/vm/run/guest/ax.sh` (`ax_enabled`, `ax_wait_enabled`, `ax_wait_text`, `ax_click_sheet_button`)
- Modify: `rt-tray/vm/run/guest/drive-setup.sh` (`screen_done`)
- Modify: `rt-tray/vm/run/guest/assert-installed.sh` (finish gate assertion)
- Modify: `rt-tray/vm/check-vm-scripts.sh` (offline checks for the new helpers and grep gates)

Do NOT run the VM. `bash rt-tray/vm/check-vm-scripts.sh` is the gate.

- [ ] **Step 1: Add the failing offline checks**

Append to `rt-tray/vm/check-vm-scripts.sh` after the `ax_set_field escapes...` line:

```bash
t "ax finish-gate helpers source + fail clean against no app" env GUEST_RUN=/tmp/vmcheck-ax AX_APP=definitely-not-running bash -c 'source run/guest/ax.sh && ! ax_enabled x >/dev/null 2>&1 && ! ax_wait_enabled x 1 && ! ax_wait_text "Skip the Fast Browser extension?" 1 && ! ax_click_sheet_button "Skip for now" && ! grep -qi "script error\|Expected \|syntax error" "$AX_LOG"'
t "drive-setup.sh drives Skip for now by its wording"   bash -c 'grep -q "ax_click_sheet_button \"Skip for now\"" run/guest/drive-setup.sh && grep -q "Skip the Fast Browser extension?" run/guest/drive-setup.sh'
t "drive-setup.sh records the finish-gate outcome"      bash -c 'grep -q "finish-gate.txt" run/guest/drive-setup.sh && grep -q "finish-gate.txt" run/guest/assert-installed.sh'
t "assert-installed.sh asserts setup.waived"            bash -c 'grep -q "rt settings get setup.waived --json" run/guest/assert-installed.sh'
```

Run: `bash rt-tray/vm/check-vm-scripts.sh`
Expected: the four new lines FAIL, everything else ok.

- [ ] **Step 2: ax.sh helpers**

Append to `rt-tray/vm/run/guest/ax.sh` after `ax_wait_status_not`:

```bash
ax_enabled() {  # <axid> → true|false
  local id; id=$(ax_esc "$1")
  ax_osa "$AX_WALK_AS
    tell application \"System Events\" to tell process \"$AX_APP\"
      set r to my walk(window 1, \"$id\")
      if r is missing value then error \"axid not found: $id\"
      return (enabled of r) as text
    end tell" 2>/dev/null
}

ax_wait_enabled() {  # <axid> <timeout-s>
  local deadline=$((SECONDS + ${2:-30})) s
  while [ "$SECONDS" -lt "$deadline" ]; do
    s=$(ax_enabled "$1" || true)
    [ "$s" = true ] && { ax_log "$1 enabled"; return 0; }
    sleep 1
  done
  ax_log "$1 still '${s:-?}' (wanted enabled)"; return 1
}

# Every static text under every sheet of window 1, then (a sheet some OS
# builds expose as its own window) under every other window, one per line.
# Walked recursively for the same reason ax_dump_ids is.
ax_texts() {
  ax_osa "
using terms from application \"System Events\"
  on walkTexts(el, acc)
    try
      if (class of el) is static text then set end of acc to (value of el as text)
    end try
    try
      repeat with c in UI elements of el
        my walkTexts(c, acc)
      end repeat
    end try
  end walkTexts
end using terms from
tell application \"System Events\" to tell process \"$AX_APP\"
  set acc to {}
  if exists window 1 then
    repeat with s in (every sheet of window 1)
      my walkTexts(s, acc)
    end repeat
  end if
  repeat with w in (every window)
    my walkTexts(w, acc)
  end repeat
  set AppleScript's text item delimiters to linefeed
  return acc as text
end tell" 2>/dev/null
}

ax_wait_text() {  # <exact text> <timeout-s>
  local deadline=$((SECONDS + ${2:-10}))
  while [ "$SECONDS" -lt "$deadline" ]; do
    ax_texts | grep -qxF -- "$1" && { ax_log "text on screen: $1"; return 0; }
    sleep 1
  done
  ax_log "text never appeared: $1"; return 1
}

# Clicks a button by its wording inside the front sheet, the way the trust
# prompt is driven; window 1's own buttons are never candidates, so a row
# button with the same title as the sheet's confirm cannot take the click.
ax_click_sheet_button() {  # <name>
  local nm; nm=$(ax_esc "$1")
  ax_osa "
using terms from application \"System Events\"
  on findButton(el, wanted)
    try
      if (class of el) is button and (name of el as text) is wanted then return el
    end try
    try
      repeat with c in UI elements of el
        set r to my findButton(c, wanted)
        if r is not missing value then return r
      end repeat
    end try
    return missing value
  end findButton
end using terms from
tell application \"System Events\" to tell process \"$AX_APP\"
  set frontmost to true
  set r to missing value
  repeat with s in (every sheet of window 1)
    if r is missing value then set r to my findButton(s, \"$nm\")
  end repeat
  if r is missing value then error \"sheet button not found: $nm\"
  click r
end tell" >/dev/null || return 1
  ax_log "clicked sheet button '$1'"
}
```

- [ ] **Step 3: drive-setup.sh**

Replace `screen_done`:

```bash
screen_done() {
  ax_wait_screen done 10 || ax_fail "setup.done.screen did not appear"
  ax_shot 05-done
  # The Fast Browser extension gates Finish on a Mac with Chrome and no
  # extension loaded. A guest without Chrome reports the row skipped and the
  # gate open, so the skip path is driven only when the gate is closed; the
  # outcome is recorded for assert-installed.sh either way.
  if ax_find setup.done.beforeYouFinish >/dev/null 2>&1; then
    ax_find setup.done.beforeYouFinish.tool.fast-browser-extension >/dev/null 2>&1 || ax_fail "Before you finish is shown without the extension row"
    [ "$(ax_enabled setup.done.continue || true)" = false ] || ax_fail "Finish is enabled while Before you finish lists a row"
    ax_click setup.done.skip.tool.fast-browser-extension
    ax_wait_text "Skip the Fast Browser extension?" 10 || ax_fail "skip confirm sheet did not appear"
    ax_wait_text "Without the Fast Browser extension, agents cannot capture screenshots or annotate evidence from your browser. You can load it later from Settings." 5 || ax_fail "skip confirm sheet body is not the pinned copy"
    ax_shot 05-skip-confirm
    ax_click_sheet_button "Skip for now" || ax_fail "could not click Skip for now in the sheet"
    ax_wait_enabled setup.done.continue 30 || ax_fail "Finish did not enable after Skip for now"
    ax_find setup.done.beforeYouFinish >/dev/null 2>&1 && ax_fail "Before you finish is still shown after Skip for now"
    ax_find setup.done.stillToDo.tool.fast-browser-extension >/dev/null 2>&1 || ax_fail "the skipped row did not move to Still to do"
    ax_shot 05-skipped
    echo skipped > "$GUEST_RUN/logs/finish-gate.txt"
  else
    [ "$(ax_enabled setup.done.continue || true)" = true ] || ax_fail "Finish is disabled with no Before you finish section"
    echo open > "$GUEST_RUN/logs/finish-gate.txt"
  fi
  ax_click setup.done.continue
}
```

- [ ] **Step 4: assert-installed.sh**

Add before the `# mattstack.appPath (V3)` block:

```bash
# The finish gate: drive-setup.sh records whether it had to skip the Fast
# Browser extension on the Done screen. Skipped means the machine store must
# hold the id (and only through rt, never a hand edit); open means nothing was
# waived. `rt settings get --json` is the one undecorated read of the store.
GATE=$(cat "$LOGS/finish-gate.txt" 2>/dev/null || echo "")
WAIVED=$(rt settings get setup.waived --json 2>/dev/null)
case "$GATE" in
  skipped)
    case "$WAIVED" in
      *tool.fast-browser-extension*) ok "setup.waived holds tool.fast-browser-extension after Skip for now";;
      *) bad "Skip for now was confirmed but setup.waived does not hold the id: $WAIVED";;
    esac;;
  open)
    case "$WAIVED" in
      *tool.fast-browser-extension*) bad "nothing was skipped on the Done screen but setup.waived holds the id: $WAIVED";;
      *) ok "setup.waived is empty (the gate never closed)";;
    esac;;
  *) [ "$HEADLESS" = 1 ] && ok "finish gate not driven (headless)" || bad "no finish-gate.txt from drive-setup.sh";;
esac
```

- [ ] **Step 5: Run the offline gate**

Run: `bash rt-tray/vm/check-vm-scripts.sh`
Expected: `all vm checks ok`.

- [ ] **Step 6: Commit**

```bash
git add rt-tray/vm/run/guest/ax.sh rt-tray/vm/run/guest/drive-setup.sh rt-tray/vm/run/guest/assert-installed.sh rt-tray/vm/check-vm-scripts.sh
git commit -m "vm: drive Skip for now on Done and assert setup.waived

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Final gates

- [ ] `git fetch origin && git merge origin/main` if main moved; resolve, rerun everything below.
- [ ] `bun run test:all`
- [ ] `bunx tsc --noEmit`
- [ ] `bun run docs:check`
- [ ] `bun run picker:check`
- [ ] `bash scripts/repo-purity.sh`
- [ ] `swift test --package-path rt-tray`
- [ ] `bash rt-tray/vm/check-vm-scripts.sh`
- [ ] `git log origin/main..HEAD --format=%B | grep -P '[\x{2014}\x{2013}]'` returns nothing; `git diff origin/main...HEAD | grep -P '^\+.*[\x{2014}\x{2013}]'` returns nothing (existing lines that already carry them are not this plan's).
- [ ] Final report in `.superpowers/sdd/2026-09-11-fast-browser-finish-gate/progress.md`.
