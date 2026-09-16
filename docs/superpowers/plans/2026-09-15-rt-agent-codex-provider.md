# rt agent: codex provider, --yolo, console defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `codex` provider to `rt agent` alongside `claude`, a `--yolo` permission-bypass flag, provider-scoped settings defaults (so `rt agent start` with no flags picks up the configured agent/model/yolo with zero code changes), and a real "Agent defaults" settings page in console with live model suggestions.

**Architecture:** Split the claude-only `lib/agent-argv.ts` into a small provider-dispatched module (`lib/agent-argv/{types,claude,codex,index}.ts`); thread a resolved `provider` through the daemon's `agent:start` handler the same way `model`/`effort`/`account` already flow from settings; capture codex's self-minted session id after the fact (from its `--json` stream for headless, from herdr's own agent-session reporting for herdr) since codex — unlike claude — never accepts an externally chosen session id. Console gets a new page on its own existing (non-settings-kit) settings API, plus one small new route that surfaces `codex debug models`' live catalog.

**Tech Stack:** Bun/TypeScript (repo-tools daemon + CLI), Hono + React/Mantine via `@mattstack/app-kit` (console), SQLite (`bun:sqlite`).

**Spec:** `docs/superpowers/specs/2026-09-15-rt-agent-codex-provider-design.md`

## Global Constraints

- Every relative import in repo-tools uses an explicit `.ts` extension (no bare directory imports) — matches the existing codebase throughout.
- `V*_SCHEMA` blocks in `lib/state/db.ts` may contain ONLY `IF NOT EXISTS` DDL; a new column is added via a `PRAGMA table_info` guard function, never an unconditional `ALTER TABLE` inside a schema block (this has broken every open of the db before, per `lib/state/db.ts`'s own comments).
- `packages/rt-client`'s `Commands["agent:start"]["payload"]` type AND `agentStart`'s explicit field allowlist in `client.ts` must both list a new field, or it is silently dropped before reaching the daemon (verified: `agentStart` copies only listed keys).
- `rt agent resume` never re-reads settings or re-derives provider/model/effort/account/extraArgs/yolo — it reuses whatever the original `agent:start` recorded, exactly like today's `model`/`effort`/`account` already work. Do not add resume-time overrides for the new fields.
- No settings row in the `agent.*` block gets a `default` except `agent.provider` — unset means "omit the flag," per the block's existing comment.
- Console has no dependency on `@mattstack/settings-kit`. Do not add one; extend console's own `src/server/settings.ts` / `src/app/config/useSettings.ts` instead.

---

## File Map

**repo-tools:**
- `lib/agent-argv.ts` → deleted, replaced by:
  - `lib/agent-argv/types.ts` (new) — shared `AgentProvider`, `AgentInvocation`
  - `lib/agent-argv/claude.ts` (new) — today's content, + yolo flag
  - `lib/agent-argv/codex.ts` (new) — codex argv/pane builders
  - `lib/agent-argv/index.ts` (new) — re-exports + `buildAgentArgv`/`buildAgentPaneCommand` dispatchers
- `lib/__tests__/agent-argv.test.ts` — import path updated
- `lib/__tests__/agent-argv-codex.test.ts` (new)
- `lib/daemon/handlers/agent.ts` — provider resolution, per-provider settings, session-id capture
- `lib/daemon/__tests__/agent-handlers.test.ts` — extended (find via `find lib/daemon -iname '*agent*test*'` if the exact filename differs)
- `lib/agent-herdr.ts` — new `herdrAgentSessionId`
- `lib/state/db.ts` — `addYoloColumnIfMissing`
- `lib/state/agents-store.ts` — `yolo` field/column, `updateAgentSessionId`
- `lib/state/__tests__/agents-store.test.ts` (or wherever its existing tests live — `find lib/state -iname '*agent*test*'`)
- `commands/agent.ts` — `--provider`, `--yolo` flags
- `commands/__tests__/agent.test.ts` — extended
- `packages/rt-client/src/commands.ts` — `AgentRecord.yolo`, `agent:start` payload fields
- `packages/rt-client/src/client.ts` — `agentStart` allowlist

**mattstack-apps/apps/console:**
- `src/server/settings.ts` — `?prefix=` support
- `src/server/agent-models.ts` (new)
- `src/server/routes.ts` — mount `agentModels`
- `src/app/config/useSettings.ts` — `useSettingsPrefix`, `useAgentModels`
- `src/app/settings/AgentDefaultsPage.tsx` (new)
- `src/app/routes.ts` — `settings` route
- `src/app/App.tsx` — rail entry + route wiring

---

### Task 1: Provider-abstraction file split (claude unchanged + `--yolo`)

**Files:**
- Create: `lib/agent-argv/types.ts`
- Create: `lib/agent-argv/claude.ts`
- Create: `lib/agent-argv/index.ts`
- Delete: `lib/agent-argv.ts`
- Modify: `lib/__tests__/agent-argv.test.ts` (import path only, plus new yolo tests)
- Modify: `lib/daemon/handlers/agent.ts:28` (import path only, for this task)
- Modify: `lib/rebase-escalation.ts:17` (import path only)

**Interfaces:**
- Produces: `AgentProvider` (`"claude" | "codex"`), `AgentInvocation` (from `types.ts`); `ClaudeInvocation` (alias of `AgentInvocation`, from `claude.ts`, for backward-compatible imports); `buildClaudeArgv`, `buildPaneCommand`, `resolveClaudeBin`, `resolveCswapBin`, `CROSS_SESSION_INBOUND_SETTINGS`, `isValidSessionUuid`, `shellSingleQuote` — all re-exported unchanged from `index.ts`.

- [ ] **Step 1: Create `lib/agent-argv/types.ts`**

```typescript
export type AgentProvider = "claude" | "codex";

export interface AgentInvocation {
  model?: string;
  effort?: string;
  extraArgs?: string;
  session: { kind: "start"; sessionId: string } | { kind: "resume"; sessionId: string };
  headless: boolean;
  prompt?: string;
  /** Extra environment for the pane shell, exported before the agent head. Values are single-quoted verbatim. */
  env?: Record<string, string>;
  /** Maps to each provider's real bypass flag (see claude.ts / codex.ts). Start-time only -- never re-read on resume. */
  yolo?: boolean;
  /** claude-only: cswap account email. */
  account?: string;
  /** claude-only: reserved chat handle; interactive only, see claude.ts's claudeArgs. */
  name?: string;
  /** claude-only: absolute path to a --settings JSON file. */
  settingsPath?: string;
}
```

- [ ] **Step 2: Create `lib/agent-argv/claude.ts` from today's `lib/agent-argv.ts`**

Copy the full current contents of `lib/agent-argv.ts` into `lib/agent-argv/claude.ts`, then apply these two edits:

Replace the `ClaudeInvocation` interface definition (currently `export interface ClaudeInvocation { ... }`) with:

```typescript
import type { AgentInvocation } from "./types.ts";

export type ClaudeInvocation = AgentInvocation;
```

In `claudeArgs`, add the yolo flag right after the headless block and before the model flag:

```typescript
  const args: string[] = [];
  if (inv.headless) args.push("-p", "--output-format", "json");
  if (inv.yolo) args.push("--dangerously-skip-permissions");
  if (inv.model) args.push("--model", inv.model);
```

Everything else in the file (`resolveClaudeBin`, `resolveCswapBin`, `CROSS_SESSION_INBOUND_SETTINGS`, `UUID_RE`, `isValidSessionUuid`, `shellSingleQuote`, `buildClaudeArgv`, `buildPaneCommand`) is copied verbatim, unchanged. Keep the file's existing header comment (update the first line's path reference from `lib/agent-argv.ts` to `lib/agent-argv/claude.ts`).

- [ ] **Step 3: Delete `lib/agent-argv.ts`**

```bash
git rm lib/agent-argv.ts
```

- [ ] **Step 4: Create `lib/agent-argv/index.ts`**

```typescript
/**
 * lib/agent-argv/index.ts -- barrel + provider dispatch for `rt agent`.
 * lib/daemon/handlers/agent.ts calls buildAgentArgv/buildAgentPaneCommand
 * here instead of reaching into claude.ts or codex.ts directly.
 */
export * from "./types.ts";
export * from "./claude.ts";
export * from "./codex.ts";

import type { AgentInvocation, AgentProvider } from "./types.ts";
import { buildClaudeArgv, buildPaneCommand as buildClaudePaneCommand } from "./claude.ts";
import { buildCodexArgv, buildCodexPaneCommand } from "./codex.ts";

export function buildAgentArgv(
  provider: AgentProvider,
  inv: AgentInvocation,
  bins?: { claude?: string; cswap?: string; codex?: string },
): string[] {
  return provider === "codex" ? buildCodexArgv(inv, bins) : buildClaudeArgv(inv, bins);
}

export function buildAgentPaneCommand(provider: AgentProvider, cwd: string, inv: AgentInvocation): string {
  return provider === "codex" ? buildCodexPaneCommand(cwd, inv) : buildClaudePaneCommand(cwd, inv);
}
```

This references `./codex.ts`, which does not exist yet — that's fine, it's created in Task 2. This task is not independently compilable until Task 2 lands; keep them as one commit if your workflow requires green-at-every-commit (see the note at the end of Task 2).

- [ ] **Step 5: Update import paths in the two other importers**

`lib/daemon/handlers/agent.ts:28` — change:
```typescript
import { buildClaudeArgv, buildPaneCommand, CROSS_SESSION_INBOUND_SETTINGS, type ClaudeInvocation } from "../../agent-argv.ts";
```
to:
```typescript
import { buildClaudeArgv, buildPaneCommand, CROSS_SESSION_INBOUND_SETTINGS, type ClaudeInvocation } from "../../agent-argv/index.ts";
```
(This import gets replaced again in full in Task 6 — this step just keeps the build green in between.)

`lib/rebase-escalation.ts:17` — change:
```typescript
import { buildPaneCommand } from "./agent-argv.ts";
```
to:
```typescript
import { buildPaneCommand } from "./agent-argv/index.ts";
```

- [ ] **Step 6: Update `lib/__tests__/agent-argv.test.ts`'s import and add yolo tests**

Change line 2 from `from "../agent-argv.ts"` to `from "../agent-argv/index.ts"`.

Add, inside the `describe("buildClaudeArgv", ...)` block:

```typescript
  test("yolo maps to --dangerously-skip-permissions", () => {
    const argv = buildClaudeArgv({ yolo: true, session: { kind: "start", sessionId: UUID }, headless: false }, bins);
    expect(argv).toContain("--dangerously-skip-permissions");
  });

  test("no yolo emits no bypass flag", () => {
    const argv = buildClaudeArgv({ session: { kind: "start", sessionId: UUID }, headless: false }, bins);
    expect(argv).not.toContain("--dangerously-skip-permissions");
  });
```

- [ ] **Step 7: Run the whole thing (this task is only complete once Task 2's `codex.ts` also exists)**

Do Task 2 before running tests for Task 1 — `index.ts` won't resolve without `codex.ts`. Combine Steps 1-6 above with Task 2 into one commit if you want a green test run at every commit; otherwise commit Task 1 with `bun build` (not `bun test`) as the verification step here, and run the full suite at the end of Task 2.

- [ ] **Step 8: Commit (after Task 2 lands, see above)**

```bash
git add lib/agent-argv/ lib/__tests__/agent-argv.test.ts lib/daemon/handlers/agent.ts lib/rebase-escalation.ts
git rm lib/agent-argv.ts
git commit -m "agent-argv: split into provider-dispatched module, add claude --yolo"
```

---

### Task 2: Codex argv builder

**Files:**
- Create: `lib/agent-argv/codex.ts`
- Create: `lib/__tests__/agent-argv-codex.test.ts`

**Interfaces:**
- Consumes: `AgentInvocation` (Task 1's `types.ts`), `shellSingleQuote` (Task 1's `claude.ts`)
- Produces: `resolveCodexBin(): string`, `buildCodexArgv(inv: AgentInvocation, bins?: { codex?: string }): string[]`, `buildCodexPaneCommand(cwd: string, inv: AgentInvocation): string`

Confirmed against the installed `codex-cli 0.153.4`'s own `--help` output (`codex exec --help`, `codex exec resume --help`, `codex resume --help`): codex never accepts an externally chosen session id (no `--session-id`; `--name`-at-start is an open, unimplemented feature request, [openai/codex#14482](https://github.com/openai/codex/issues/14482)) — so unlike claude's builder, `inv.session.sessionId` is used only on **resume**, as a positional, never emitted on start.

- [ ] **Step 1: Write `lib/agent-argv/codex.ts`**

```typescript
/**
 * lib/agent-argv/codex.ts -- codex CLI invocation building for `rt agent`.
 *
 * Confirmed against the installed codex-cli 0.153.4's own --help output, not
 * from memory. Usage lines: `codex exec [OPTIONS] [PROMPT]`,
 * `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`, `codex [OPTIONS]
 * [PROMPT]`, `codex resume [OPTIONS] [SESSION_ID] [PROMPT]` -- flags always
 * precede positionals, matching the order this file emits them.
 *
 * codex mints its own session id and never accepts an externally chosen one
 * (see lib/daemon/handlers/agent.ts's session-id capture for how the real id
 * gets learned after the fact), so unlike claude.ts's builder this one never
 * emits inv.session.sessionId on start -- only resume takes it, positionally.
 */

import { homedir } from "os";
import { join } from "path";
import { shellSingleQuote } from "./claude.ts";
import type { AgentInvocation } from "./types.ts";

export function resolveCodexBin(): string {
  return Bun.which("codex") ?? join(process.env.HOME ?? homedir(), ".local", "bin", "codex");
}

/** Flags shared by every codex form (exec, exec resume, interactive, interactive resume). */
function codexFlags(inv: AgentInvocation): string[] {
  const args: string[] = [];
  if (inv.model) args.push("-m", inv.model);
  // codex has no dedicated --effort flag; model_reasoning_effort is a config
  // override (-c key=value), confirmed via `codex exec --help`'s -c examples.
  if (inv.effort) args.push("-c", `model_reasoning_effort=${inv.effort}`);
  if (inv.yolo) args.push("--dangerously-bypass-approvals-and-sandbox");
  if (inv.extraArgs) args.push(...inv.extraArgs.split(/\s+/).filter(Boolean));
  return args;
}

export function buildCodexArgv(inv: AgentInvocation, bins?: { codex?: string }): string[] {
  if (inv.headless && !inv.prompt) {
    throw new Error("headless launch requires a prompt (codex exec with no prompt blocks on stdin)");
  }
  const bin = bins?.codex ?? resolveCodexBin();
  const flags = codexFlags(inv);
  const args = inv.session.kind === "start"
    ? [bin, "exec", "--json", ...flags]
    : [bin, "exec", "resume", ...flags, inv.session.sessionId];
  if (inv.prompt) args.push(inv.prompt);
  return args;
}

export function buildCodexPaneCommand(cwd: string, inv: AgentInvocation): string {
  const flags = codexFlags(inv).map(shellSingleQuote);
  const head = inv.session.kind === "start"
    ? ["codex", ...flags]
    : ["codex", "resume", ...flags, shellSingleQuote(inv.session.sessionId)];
  const tail = inv.prompt ? [shellSingleQuote(inv.prompt)] : [];
  const env = Object.entries(inv.env ?? {}).map(([k, v]) => `${k}=${shellSingleQuote(v)}`);
  return `cd ${shellSingleQuote(cwd)} && ${[...env, ...head, ...tail].join(" ")}`;
}
```

- [ ] **Step 2: Write `lib/__tests__/agent-argv-codex.test.ts`**

```typescript
import { describe, expect, test } from "bun:test";
import { buildCodexArgv, buildCodexPaneCommand } from "../agent-argv/index.ts";

const UUID = "6e225e74-4cb7-4aea-8807-6aa9011d4112";

describe("buildCodexArgv", () => {
  const bins = { codex: "/abs/codex" };

  test("headless start: exec --json, no session id emitted", () => {
    const argv = buildCodexArgv({ session: { kind: "start", sessionId: UUID }, headless: true, prompt: "do it" }, bins);
    expect(argv).toEqual(["/abs/codex", "exec", "--json", "do it"]);
    expect(argv).not.toContain(UUID);
  });

  test("all knobs, headless start", () => {
    const argv = buildCodexArgv({
      model: "gpt-6-astra", effort: "high", yolo: true, extraArgs: "--search",
      session: { kind: "start", sessionId: UUID }, headless: true, prompt: "do it",
    }, bins);
    expect(argv).toEqual([
      "/abs/codex", "exec", "--json",
      "-m", "gpt-6-astra", "-c", "model_reasoning_effort=high",
      "--dangerously-bypass-approvals-and-sandbox", "--search", "do it",
    ]);
  });

  test("headless resume: exec resume <flags> <id> <prompt>", () => {
    const argv = buildCodexArgv({ model: "gpt-6-astra", session: { kind: "resume", sessionId: UUID }, headless: true, prompt: "q" }, bins);
    expect(argv).toEqual(["/abs/codex", "exec", "resume", "-m", "gpt-6-astra", UUID, "q"]);
  });

  test("herdr start has no --json", () => {
    const argv = buildCodexArgv({ session: { kind: "start", sessionId: UUID }, headless: false }, bins);
    expect(argv).not.toContain("--json");
    expect(argv).toEqual(["/abs/codex", "exec"]);
  });

  test("headless without a prompt throws", () => {
    expect(() => buildCodexArgv({ session: { kind: "start", sessionId: UUID }, headless: true }, bins)).toThrow(/prompt/);
  });
});

describe("buildCodexPaneCommand", () => {
  test("start: cd + bare codex + flags + quoted prompt", () => {
    const cmd = buildCodexPaneCommand("/repo dir", {
      model: "gpt-6-astra",
      session: { kind: "start", sessionId: UUID }, headless: false, prompt: "hi 'there'",
    });
    expect(cmd).toBe(`cd '/repo dir' && codex '-m' 'gpt-6-astra' 'hi '\\''there'\\'''`);
  });

  test("resume: codex resume <flags> <quoted id>", () => {
    const cmd = buildCodexPaneCommand("/r", { session: { kind: "resume", sessionId: UUID }, headless: false });
    expect(cmd).toBe(`cd '/r' && codex resume '${UUID}'`);
  });

  test("env assignments precede the codex head", () => {
    const cmd = buildCodexPaneCommand("/w/x", {
      session: { kind: "start", sessionId: UUID },
      headless: false,
      env: { RT_AGENT_ID: "ag-1" },
    });
    expect(cmd).toContain("cd '/w/x' && RT_AGENT_ID='ag-1' codex");
  });

  test("yolo maps to --dangerously-bypass-approvals-and-sandbox", () => {
    const cmd = buildCodexPaneCommand("/r", { yolo: true, session: { kind: "start", sessionId: UUID }, headless: false });
    expect(cmd).toContain("--dangerously-bypass-approvals-and-sandbox");
  });
});
```

- [ ] **Step 3: Run both agent-argv test files**

```bash
bun test lib/__tests__/agent-argv.test.ts lib/__tests__/agent-argv-codex.test.ts
```
Expected: all PASS. (This is also the point where Task 1's `index.ts` becomes resolvable, since `codex.ts` now exists.)

- [ ] **Step 4: Commit**

```bash
git add lib/agent-argv/codex.ts lib/__tests__/agent-argv-codex.test.ts
git commit -m "agent-argv: add codex provider argv/pane-command builders"
```

---

### Task 3: Settings registry — provider-scoped `agent.*` rows

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts:668-698` (the existing "agent (rt agent handoff)" block)

**Interfaces:**
- Produces: registered keys `agent.provider`, `agent.claude.{model,effort,account,extraArgs,yolo}`, `agent.codex.{model,effort,extraArgs,yolo}`.

- [ ] **Step 1: Replace the existing agent block**

Replace lines 668-698 (from `// --- agent (rt agent handoff) ---` through the closing `},` of `agent.extraArgs`) with:

```typescript
  // --- agent (rt agent handoff) --------------------------------------------
  // No defaults on any per-provider row, by design: an unset key means the
  // flag is omitted from the launch entirely (spec "Settings"). agent.provider
  // is the one exception -- it needs a concrete fallback to preserve
  // claude-only behavior with zero code changes for callers who never set it.
  {
    key: "agent.provider",
    type: "string",
    scopes: ["user", "machine"],
    default: "claude",
    merge: "replace",
    description: "Which provider rt agent start uses when --provider is not given: \"claude\" or \"codex\".",
  },
  {
    key: "agent.claude.model",
    type: "string",
    scopes: ["user", "machine"],
    merge: "replace",
    description: "Default --model for claude rt agent launches; unset omits the flag.",
  },
  {
    key: "agent.claude.effort",
    type: "string",
    scopes: ["user", "machine"],
    merge: "replace",
    description: "Default --effort for claude rt agent launches; unset omits the flag.",
  },
  {
    key: "agent.claude.account",
    type: "string",
    scopes: ["user", "machine"],
    merge: "replace",
    description: "cswap account email claude rt agent launches under; unset uses the default claude profile.",
  },
  {
    key: "agent.claude.extraArgs",
    type: "string",
    scopes: ["user", "machine"],
    merge: "replace",
    description: "Opaque extra claude arguments appended to every claude rt agent launch (escape hatch).",
  },
  {
    key: "agent.claude.yolo",
    type: "boolean",
    scopes: ["user", "machine"],
    merge: "replace",
    description: "Default --yolo (--dangerously-skip-permissions) for claude rt agent launches; unset behaves as false.",
  },
  {
    key: "agent.codex.model",
    type: "string",
    scopes: ["user", "machine"],
    merge: "replace",
    description: "Default -m/--model for codex rt agent launches; unset omits the flag.",
  },
  {
    key: "agent.codex.effort",
    type: "string",
    scopes: ["user", "machine"],
    merge: "replace",
    description: "Default reasoning effort for codex rt agent launches, passed as -c model_reasoning_effort=<value>; unset omits the override.",
  },
  {
    key: "agent.codex.extraArgs",
    type: "string",
    scopes: ["user", "machine"],
    merge: "replace",
    description: "Opaque extra codex arguments appended to every codex rt agent launch (escape hatch).",
  },
  {
    key: "agent.codex.yolo",
    type: "boolean",
    scopes: ["user", "machine"],
    merge: "replace",
    description: "Default --yolo (--dangerously-bypass-approvals-and-sandbox) for codex rt agent launches; unset behaves as false. codex has no per-agent account setting (see spec's Non-goals).",
  },
```

- [ ] **Step 2: Find and update any test that hardcodes the old flat keys**

```bash
grep -rln '"agent\.model"\|"agent\.effort"\|"agent\.account"\|"agent\.extraArgs"' --include="*.ts" packages/ lib/ commands/ | grep -v node_modules
```

For each hit outside `lib/daemon/handlers/agent.ts` (which Task 6 rewrites anyway), update the key string to the provider-scoped form (`agent.claude.model` etc.).

- [ ] **Step 3: Run the settings registry tests**

```bash
bun test packages/rt-client/src/settings
```
Expected: PASS (the registry's own type/scope validation tests are generic over rows, so the new rows are covered automatically; if a test enumerates all keys by name, update it here too).

- [ ] **Step 4: Commit**

```bash
git add packages/rt-client/src/settings/registry-defs.ts
git commit -m "settings: replace flat agent.* rows with provider-scoped agent.claude.*/agent.codex.*"
```

---

### Task 4: DB schema (`yolo` column) + `updateAgentSessionId`

**Files:**
- Modify: `lib/state/db.ts`
- Modify: `lib/state/agents-store.ts`
- Test: find the existing agents-store test file first (`find /Users/matt/Documents/GitHub/repo-tools/lib -iname '*agents-store*test*' -o -iname '*agent-record*test*'` — if none exists, create `lib/state/__tests__/agents-store.test.ts` following the sibling test files' `bun:sqlite` in-memory-db setup pattern).

**Interfaces:**
- Produces: `AgentRecord.yolo?: boolean` (in-process type), `updateAgentSessionId(id: string, sessionId: string, db?: Database): void`.

- [ ] **Step 1: Add the column guard in `lib/state/db.ts`**

Add after `addSubjectColumnIfMissing` (around line 382):

```typescript
/** agents.yolo: whether this launch bypassed permission prompts
    (--dangerously-skip-permissions / --dangerously-bypass-approvals-and-sandbox).
    Same conditional-exec rule as `sections`, `archived_at`, `handle`, `quiet`
    and `subject` above. */
function addYoloColumnIfMissing(db: Database): void {
  const columns = db.query("PRAGMA table_info(agents);").all() as { name: string }[];
  if (columns.some((c) => c.name === "yolo")) return;
  db.exec("ALTER TABLE agents ADD COLUMN yolo INTEGER;");
}
```

Add the call alongside the others (around line 575, right after `addSubjectColumnIfMissing(db);`):

```typescript
    addYoloColumnIfMissing(db);
```

- [ ] **Step 2: Update `lib/state/agents-store.ts`**

Add `yolo?: boolean;` to the `AgentRecord` interface, right after `extraArgs?: string;`:

```typescript
  extraArgs?: string; exitCode?: number; resultPath?: string; yolo?: boolean;
```

Add `yolo` to `COLUMNS`:

```typescript
const COLUMNS =
  "id, repo, cwd, provider, surface, session_id, model, effort, account, label, caller, handle, subject, " +
  "pane_id, tab_id, workspace_id, extra_args, exit_code, result_path, yolo, " +
  "created_at, last_resumed_at, finished_at";
```

Add `yolo: number | null;` to `AgentRow`, right after `result_path: string | null;`:

```typescript
  extra_args: string | null; exit_code: number | null; result_path: string | null; yolo: number | null;
```

In `rowToRecord`, add:

```typescript
  if (r.yolo !== null) rec.yolo = r.yolo === 1;
```

In `insertAgent`'s `db.query(INSERT_SQL).run(...)` call, add `rec.yolo === undefined ? null : (rec.yolo ? 1 : 0)` right after `rec.resultPath ?? null,`:

```typescript
      rec.extraArgs ?? null, rec.exitCode ?? null, rec.resultPath ?? null,
      rec.yolo === undefined ? null : (rec.yolo ? 1 : 0),
      rec.createdAt, rec.lastResumedAt ?? null, rec.finishedAt ?? null,
```

Add a new update function, next to `markAgentResumed`:

```typescript
const UPDATE_SESSION_SQL = `UPDATE agents SET session_id = ? WHERE id = ?;`;

/** Overwrites the placeholder session id rt mints before spawning a codex
    launch (codex never accepts one on start -- it mints its own) once the
    real one is captured (see lib/daemon/handlers/agent.ts's session-id
    capture). No-op for claude, which never needs this. */
export function updateAgentSessionId(id: string, sessionId: string, db: Database = getStateDb()): void {
  runCriticalWrite("updateAgentSessionId", () => db.query(UPDATE_SESSION_SQL).run(sessionId, id), { id });
}
```

- [ ] **Step 2b: Write the failing test first**

If an existing agents-store test file was found in the search above, add this test to it (matching its existing in-memory-db setup). If none exists, create `lib/state/__tests__/agents-store.test.ts`:

```typescript
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { getAgent, insertAgent, openStateDb, updateAgentSessionId, type AgentRecord } from "../db.ts"; // adjust import path to wherever openStateDb / runMigrations live if different from db.ts

function freshDb(): Database {
  const db = new Database(":memory:");
  // runMigrations(db); -- call whatever this repo's existing agents-store
  // tests use to stand up the schema in-memory; mirror that setup exactly
  // rather than reinventing it here.
  return db;
}

describe("updateAgentSessionId", () => {
  test("overwrites the stored session id", () => {
    const db = freshDb();
    const rec: AgentRecord = {
      id: "ag-test1", repo: "r", cwd: "/c", provider: "codex", surface: "headless",
      sessionId: "placeholder-uuid", createdAt: Date.now(),
    };
    insertAgent(rec, db);
    updateAgentSessionId("ag-test1", "s_2026-09-15-real", db);
    expect(getAgent("ag-test1", db)?.sessionId).toBe("s_2026-09-15-real");
  });
});

describe("agents.yolo round-trip", () => {
  test("stores and reads back true and false", () => {
    const db = freshDb();
    insertAgent({ id: "ag-y1", repo: "r", cwd: "/c", provider: "claude", surface: "headless", sessionId: "u1", createdAt: Date.now(), yolo: true }, db);
    insertAgent({ id: "ag-y2", repo: "r", cwd: "/c", provider: "claude", surface: "headless", sessionId: "u2", createdAt: Date.now(), yolo: false }, db);
    expect(getAgent("ag-y1", db)?.yolo).toBe(true);
    expect(getAgent("ag-y2", db)?.yolo).toBe(false);
  });

  test("unset yolo reads back undefined", () => {
    const db = freshDb();
    insertAgent({ id: "ag-y3", repo: "r", cwd: "/c", provider: "claude", surface: "headless", sessionId: "u3", createdAt: Date.now() }, db);
    expect(getAgent("ag-y3", db)?.yolo).toBeUndefined();
  });
});
```

Before finalizing this file, find and copy the REAL in-memory-db bootstrap this repo's existing agents-store tests use (there almost certainly is one already, since `insertAgent`/`getAgent` are already unit-tested) instead of the placeholder `freshDb()` above — search `lib/state/__tests__/` or `lib/state/*.test.ts` for the pattern before writing this file.

- [ ] **Step 3: Run the test, confirm it fails first, then passes**

```bash
bun test lib/state
```
Expected before the Step 1/2 code changes: FAIL (`updateAgentSessionId` not exported / `yolo` column missing). After: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/state/db.ts lib/state/agents-store.ts lib/state/__tests__/
git commit -m "state: add agents.yolo column and updateAgentSessionId"
```

---

### Task 5: CLI flags (`--provider`, `--yolo`) + rt-client wiring

**Files:**
- Modify: `commands/agent.ts`
- Modify: `commands/__tests__/agent.test.ts`
- Modify: `packages/rt-client/src/commands.ts:622` (agent:start payload type) and `:354` (AgentRecord)
- Modify: `packages/rt-client/src/client.ts:355-363` (agentStart allowlist)

**Interfaces:**
- Consumes: nothing new from earlier tasks (this task is CLI-payload-shape only; Task 6 wires the daemon side).
- Produces: `StartArgs.provider?: AgentProvider`, `StartArgs.yolo?: boolean` (in `commands/agent.ts`); `Commands["agent:start"]["payload"].provider?: string`, `.yolo?: boolean` (rt-client).

This is a real, independently testable deliverable even before Task 6: `parseStartArgs` producing the right payload shape, and `agentStart` forwarding it, are both verifiable without the daemon handler understanding them yet (the daemon will just ignore the extra fields until Task 6 lands — no crash, since payload fields are read with `payload.provider` optional-chaining throughout, not destructured strictly).

- [ ] **Step 1: `packages/rt-client/src/commands.ts` — add the payload/record fields**

Line 622, change:
```typescript
  "agent:start": { payload: { repo: string; cwd: string; prompt?: string; surface?: AgentSurface; model?: string; effort?: string; account?: string; label?: string; caller?: string; workspace?: string; tab?: string; extraArgs?: string; env?: Record<string, string>; herdrSocket?: string; handle?: string; bg?: boolean; subject?: string }; data: AgentRecord };
```
to:
```typescript
  "agent:start": { payload: { repo: string; cwd: string; prompt?: string; surface?: AgentSurface; provider?: string; model?: string; effort?: string; account?: string; label?: string; caller?: string; workspace?: string; tab?: string; extraArgs?: string; env?: Record<string, string>; herdrSocket?: string; handle?: string; bg?: boolean; subject?: string; yolo?: boolean }; data: AgentRecord };
```

In the `AgentRecord` interface (around line 354), add `yolo?: boolean;` right after `extraArgs?: string; exitCode?: number; resultPath?: string;`:

```typescript
  extraArgs?: string; exitCode?: number; resultPath?: string; yolo?: boolean;
```

- [ ] **Step 2: `packages/rt-client/src/client.ts` — extend `agentStart`'s allowlist**

Change:
```typescript
  for (const k of ["prompt", "surface", "model", "effort", "account", "label", "caller", "workspace", "tab", "extraArgs", "env", "herdrSocket", "handle", "bg", "subject"] as const) {
```
to:
```typescript
  for (const k of ["prompt", "surface", "provider", "model", "effort", "account", "label", "caller", "workspace", "tab", "extraArgs", "env", "herdrSocket", "handle", "bg", "subject", "yolo"] as const) {
```
(`agentResume`'s allowlist is unchanged — provider/yolo are start-only, per Global Constraints.)

- [ ] **Step 3: Rebuild rt-client**

```bash
cd packages/rt-client && bun run build && cd ../..
```
Per this repo's documented footgun (`dist/` goes stale silently for `file:` consumers) — repo-tools' own CLI imports rt-client's `src/` directly so this isn't needed for THIS repo to work, but do it anyway so any other checked-out mattstack app picks up the type change on its next install.

- [ ] **Step 4: `commands/agent.ts` — add the flags**

Add `"--provider"` to `FLAGS_WITH_VALUES` (line 29-32):

```typescript
const FLAGS_WITH_VALUES = new Set([
  "--repo", "--prompt", "--prompt-file", "--surface", "--model", "--effort",
  "--account", "--label", "--caller", "--workspace", "--tab", "--extra-args", "--provider",
]);
```

Extend `StartArgs` (around line 92-96):

```typescript
interface StartArgs {
  prompt?: string; surface?: AgentSurface; model?: string; effort?: string;
  account?: string; label?: string; caller?: string; workspace?: string;
  tab?: string; extraArgs?: string; bg?: boolean; provider?: "claude" | "codex"; yolo?: boolean;
}
```

In `parseStartArgs`, add provider parsing (after the `surface` block) and yolo parsing (alongside the `--bg` check):

```typescript
function parseStartArgs(args: string[]): StartArgs {
  const prompt = flagValue(args, "--prompt");
  const promptFile = flagValue(args, "--prompt-file");
  if (prompt !== undefined && promptFile !== undefined) throw new Error("pass one of --prompt / --prompt-file, not both");
  const out: StartArgs = {};
  const resolved = promptFile !== undefined ? readFileSync(promptFile, "utf8").trim() : prompt;
  if (resolved !== undefined) out.prompt = resolved;
  const surface = parseSurface(flagValue(args, "--surface"));
  if (surface !== undefined) out.surface = surface;
  const provider = flagValue(args, "--provider");
  if (provider !== undefined) {
    if (provider !== "claude" && provider !== "codex") throw new Error(`invalid provider "${provider}": expected claude or codex`);
    out.provider = provider;
  }
  for (const [flag, key] of [
    ["--model", "model"], ["--effort", "effort"], ["--account", "account"],
    ["--label", "label"], ["--caller", "caller"], ["--workspace", "workspace"],
    ["--tab", "tab"], ["--extra-args", "extraArgs"],
  ] as const) {
    const v = flagValue(args, flag);
    if (v !== undefined) out[key] = v;
  }
  if (hasFlag(args, "--bg")) {
    if (surface === "headless") throw new Error("--bg is a herdr-surface option");
    out.bg = true;
  }
  if (hasFlag(args, "--yolo")) out.yolo = true;
  return out;
}
```

Update the usage comment at the top of the file (line 4-8) to mention the new flags:

```typescript
 *   rt agent start  [--repo <path>] [--prompt <text> | --prompt-file <path>]
 *                   [--surface herdr|headless] [--provider claude|codex]
 *                   [--model M] [--effort E] [--yolo]
 *                   [--account A] [--label L] [--caller C]
 *                   [--workspace W] [--tab T] [--extra-args "<tail>"]
 *                   [--bg] [--json]
```

- [ ] **Step 5: Write failing tests in `commands/__tests__/agent.test.ts`**

Add (mirroring the file's existing `parseStartArgs` test style — read the file first to match its exact helper/import conventions):

```typescript
test("parseStartArgs: --provider codex", () => {
  const parsed = __test__.parseStartArgs(["--provider", "codex", "--prompt", "go"]);
  expect(parsed.provider).toBe("codex");
});

test("parseStartArgs: invalid --provider throws", () => {
  expect(() => __test__.parseStartArgs(["--provider", "cursor"])).toThrow(/invalid provider/);
});

test("parseStartArgs: --yolo sets the flag", () => {
  const parsed = __test__.parseStartArgs(["--yolo", "--prompt", "go"]);
  expect(parsed.yolo).toBe(true);
});

test("parseStartArgs: no --yolo leaves it undefined", () => {
  const parsed = __test__.parseStartArgs(["--prompt", "go"]);
  expect(parsed.yolo).toBeUndefined();
});
```

(`commands/agent.ts` already exports `__test__ = { parseStartArgs, parseResumeArgs }` at the bottom of the file — no change needed there.)

- [ ] **Step 6: Run tests**

```bash
bun test commands/__tests__/agent.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add commands/agent.ts commands/__tests__/agent.test.ts packages/rt-client/src/commands.ts packages/rt-client/src/client.ts packages/rt-client/dist
git commit -m "rt agent: add --provider and --yolo flags"
```

---

### Task 6: Daemon handler — provider resolution + dispatch

**Files:**
- Modify: `lib/daemon/handlers/agent.ts`
- Modify: its test file (find via `find lib/daemon -iname '*agent*test*'`)

**Interfaces:**
- Consumes: `buildAgentArgv`, `buildAgentPaneCommand`, `AgentProvider`, `AgentInvocation` (Task 1/2's `lib/agent-argv/index.ts`); `payload.provider`, `payload.yolo` (Task 5's rt-client types — the daemon reads `rawPayload` as `unknown` cast to `Commands["agent:start"]["payload"]`, so this compiles once Task 5 lands); `agent.provider`/`agent.<provider>.*` settings (Task 3).
- Produces: `rec.provider` actually set from the resolved provider (was hardcoded `"claude"`); `rec.yolo`.

- [ ] **Step 1: Update the import**

Change line 28 from:
```typescript
import { buildClaudeArgv, buildPaneCommand, CROSS_SESSION_INBOUND_SETTINGS, type ClaudeInvocation } from "../../agent-argv/index.ts";
```
to:
```typescript
import { buildAgentArgv, buildAgentPaneCommand, CROSS_SESSION_INBOUND_SETTINGS, type AgentInvocation, type AgentProvider } from "../../agent-argv/index.ts";
```

- [ ] **Step 2: Rename `ClaudeInvocation` usages to `AgentInvocation`**

In `launch()`'s signature (around line 186), change:
```typescript
    session: ClaudeInvocation["session"],
```
to:
```typescript
    session: AgentInvocation["session"],
```

And the `inv` construction (around line 199):
```typescript
    const inv: ClaudeInvocation = {
```
to:
```typescript
    const inv: AgentInvocation = {
```

- [ ] **Step 3: Use the resolved provider when building argv/pane command**

In `launch()`, change (around line 237):
```typescript
    const argv = buildClaudeArgv(inv);
```
to:
```typescript
    const argv = buildAgentArgv(rec.provider as AgentProvider, inv);
```

And in the herdr branch (around line 220):
```typescript
        { workspaceLabel, tabLabel, paneCommand: buildPaneCommand(rec.cwd, inv) },
```
to:
```typescript
        { workspaceLabel, tabLabel, paneCommand: buildAgentPaneCommand(rec.provider as AgentProvider, rec.cwd, inv) },
```

(`rec.provider` stays typed as plain `string` on `AgentRecord` — matching the existing convention where the state layer stores it loosely and the daemon handler is the one place that validates and narrows it, same as `payload.surface` already works a few lines above.)

- [ ] **Step 4: Resolve provider from payload/settings, validate it**

In the `"agent:start"` handler, right after the existing surface validation block (around line 266), add:

```typescript
      const providerRaw = payload.provider ?? fromSetting("agent.provider", log) ?? "claude";
      if (providerRaw !== "claude" && providerRaw !== "codex") {
        return { ok: false, error: `invalid provider "${providerRaw}"; must be one of claude, codex` };
      }
      const provider: AgentProvider = providerRaw;
```

- [ ] **Step 5: Reject `account` for codex**

Right after the provider resolution above, before the existing settings-resolution block:

```typescript
      if (payload.account !== undefined && provider === "codex") {
        return { ok: false, error: "codex does not support --account in this version (see spec's Non-goals)" };
      }
```

- [ ] **Step 6: Resolve model/effort/extraArgs/yolo from the provider-scoped settings**

Replace the existing block (around lines 309-316):
```typescript
      const model = payload.model ?? fromSetting("agent.model", log);
      const effort = payload.effort ?? fromSetting("agent.effort", log);
      const account = payload.account ?? fromSetting("agent.account", log);
      const extraArgs = payload.extraArgs ?? fromSetting("agent.extraArgs", log);
      if (model !== undefined) rec.model = model;
      if (effort !== undefined) rec.effort = effort;
      if (account !== undefined) rec.account = account;
      if (extraArgs !== undefined) rec.extraArgs = extraArgs;
```
with:
```typescript
      const model = payload.model ?? fromSetting(`agent.${provider}.model`, log);
      const effort = payload.effort ?? fromSetting(`agent.${provider}.effort`, log);
      const extraArgs = payload.extraArgs ?? fromSetting(`agent.${provider}.extraArgs`, log);
      const yolo = payload.yolo ?? (provider === "claude"
        ? fromSetting("agent.claude.yolo", log) === "true" || fromSetting<boolean>("agent.claude.yolo", log) === true
        : fromSetting<boolean>("agent.codex.yolo", log) === true);
      if (model !== undefined) rec.model = model;
      if (effort !== undefined) rec.effort = effort;
      if (extraArgs !== undefined) rec.extraArgs = extraArgs;
      if (yolo) rec.yolo = true;
      if (provider === "claude") {
        const account = payload.account ?? fromSetting("agent.claude.account", log);
        if (account !== undefined) rec.account = account;
      }
```

`fromSetting`'s existing signature is `fromSetting(key: string, log: Logger): string | undefined` (it calls `getSetting<string>(key).value`) — it is generic over the caller's type parameter via `getSetting<T>`, so update its declaration (a few lines above, around line 63) to accept a type parameter instead of hardcoding `string`:

```typescript
function fromSetting<T = string>(key: string, log: Logger): T | undefined {
  try {
    return getSetting<T>(key).value ?? undefined;
  } catch (err) {
    log.warn({ err, key }, "agent: settings read failed");
    return undefined;
  }
}
```

With that change, simplify the yolo line from Step 6 above to just:
```typescript
      const yolo = payload.yolo ?? fromSetting<boolean>(`agent.${provider}.yolo`, log) ?? false;
```

- [ ] **Step 7: Set `rec.provider` from the resolved value (was hardcoded)**

Change (around line 297):
```typescript
      const rec: AgentRecord = {
        id: newAgentId(),
        repo, cwd, provider: "claude", surface,
        sessionId: crypto.randomUUID(),
        createdAt: Date.now(),
      };
```
to:
```typescript
      const rec: AgentRecord = {
        id: newAgentId(),
        repo, cwd, provider, surface,
        sessionId: crypto.randomUUID(),
        createdAt: Date.now(),
      };
```

(Steps 4-7 must land together — `provider` needs to exist as a local before this object literal, and this is also where the account rejection from Step 5 must run, since it needs `provider` too. Order the whole block: resolve provider → reject account-with-codex → build `rec` → resolve model/effort/extraArgs/yolo/account onto `rec`.)

- [ ] **Step 8: Write the failing tests**

Read the existing test file for `createAgentHandlers` first (`find lib/daemon -iname '*agent*test*'`) to match its exact mock/injection conventions (it already injects `spawnHeadless`, `herdrRunner`, `insertAgentFn`, per `createAgentHandlers`'s options type). Add:

```typescript
test("agent:start defaults provider to claude when unset", async () => {
  const handlers = createAgentHandlers({ db, emitEvent: () => 0, /* ...existing test's other injected deps... */ });
  const res = await handlers["agent:start"]({ repo: "r", cwd: "/c", surface: "headless", prompt: "go" });
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.data.provider).toBe("claude");
});

test("agent:start honors an explicit provider", async () => {
  const handlers = createAgentHandlers({ db, emitEvent: () => 0, /* ... */ });
  const res = await handlers["agent:start"]({ repo: "r", cwd: "/c", surface: "headless", prompt: "go", provider: "codex" });
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.data.provider).toBe("codex");
});

test("agent:start rejects an unknown provider", async () => {
  const handlers = createAgentHandlers({ db, emitEvent: () => 0, /* ... */ });
  const res = await handlers["agent:start"]({ repo: "r", cwd: "/c", surface: "headless", prompt: "go", provider: "cursor" });
  expect(res.ok).toBe(false);
});

test("agent:start rejects account with codex", async () => {
  const handlers = createAgentHandlers({ db, emitEvent: () => 0, /* ... */ });
  const res = await handlers["agent:start"]({ repo: "r", cwd: "/c", surface: "headless", prompt: "go", provider: "codex", account: "a@b.c" });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toMatch(/account/);
});

test("agent:start threads yolo into the recorded agent", async () => {
  const handlers = createAgentHandlers({ db, emitEvent: () => 0, /* ... */ });
  const res = await handlers["agent:start"]({ repo: "r", cwd: "/c", surface: "headless", prompt: "go", yolo: true });
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.data.yolo).toBe(true);
});
```

Fill in `/* ...existing test's other injected deps... */` with whatever the file's other tests already pass (`spawnHeadless`, `insertAgentFn`, etc.) — do not guess at these; copy the exact object shape neighboring tests in the same file already use.

- [ ] **Step 9: Run the daemon handler tests**

```bash
bun test lib/daemon
```
Expected: all PASS, including the pre-existing tests (nothing about claude's default behavior should have changed).

- [ ] **Step 10: Commit**

```bash
git add lib/daemon/handlers/agent.ts lib/daemon/__tests__/
git commit -m "daemon: resolve rt agent provider from payload/settings, dispatch argv per provider"
```

---

### Task 7: Codex session-identity capture (headless + herdr)

**Files:**
- Modify: `lib/daemon/handlers/agent.ts` (the `HeadlessChild` interface, `defaultSpawnHeadless`, `launch()`)
- Modify: `lib/agent-herdr.ts` (new `herdrAgentSessionId`)
- Modify: both handlers' test files

**Interfaces:**
- Consumes: `updateAgentSessionId` (Task 4), `defaultHerdrRunner`/`HerdrRunner` (existing `lib/agent-herdr.ts`)
- Produces: `HeadlessChild.sessionId(): Promise<string | undefined>`; `herdrAgentSessionId(paneId: string, timeoutMs: number, runner?: HerdrRunner): Promise<string | undefined>`

Codex never accepts an externally chosen session id (Task 2's header comment). This task captures the real one it mints, so `rt agent resume` on a codex record targets the right session instead of rt's own placeholder UUID.

- [ ] **Step 1: Extend `HeadlessChild` and `defaultSpawnHeadless` in `lib/daemon/handlers/agent.ts`**

Change the interface (around line 43):
```typescript
export interface HeadlessChild {
  exited: Promise<number>;
  stdout: () => Promise<string>;
}
```
to:
```typescript
export interface HeadlessChild {
  exited: Promise<number>;
  stdout: () => Promise<string>;
  /** Resolves with the provider-minted session id once seen in the stream,
      or undefined if the stream ended without one. Only populated when
      captureSessionId was requested at spawn time (claude never needs this
      -- it mints nothing, rt already chose the id). */
  sessionId: () => Promise<string | undefined>;
}
```

Add a helper above `defaultSpawnHeadless`:

```typescript
/** Scans a codex `--json` event stream for its first session_id, without
    buffering the whole stream (that's `stdout()`'s job, on the other half of
    the tee below). The exact event/field name is confirmed against a real
    codex exec --json run before this ships -- see the spec's Open Items. */
function extractSessionId(stream: ReadableStream<Uint8Array>): Promise<string | undefined> {
  return (async () => {
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let newlineAt: number;
        while ((newlineAt = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineAt);
          buffer = buffer.slice(newlineAt + 1);
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as { session_id?: unknown };
            if (typeof event.session_id === "string" && event.session_id) return event.session_id;
          } catch {
            // Not every line is JSON we care about; keep scanning.
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return undefined;
  })();
}
```

Change `defaultSpawnHeadless` (around line 48):
```typescript
function defaultSpawnHeadless(argv: string[], cwd: string, env: Record<string, string> = {}): HeadlessChild {
  const proc = Bun.spawn(argv as [string, ...string[]], {
    cwd,
    env: { ...process.env, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  return {
    exited: proc.exited,
    stdout: () => new Response(proc.stdout).text(),
  };
}
```
to:
```typescript
function defaultSpawnHeadless(
  argv: string[], cwd: string, env: Record<string, string> = {},
  opts: { captureSessionId?: boolean } = {},
): HeadlessChild {
  const proc = Bun.spawn(argv as [string, ...string[]], {
    cwd,
    env: { ...process.env, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!opts.captureSessionId || !proc.stdout) {
    return {
      exited: proc.exited,
      stdout: () => new Response(proc.stdout).text(),
      sessionId: () => Promise.resolve(undefined),
    };
  }
  const [forText, forId] = proc.stdout.tee();
  const sessionIdPromise = extractSessionId(forId);
  return {
    exited: proc.exited,
    stdout: () => new Response(forText).text(),
    sessionId: () => sessionIdPromise,
  };
}
```

Update `createAgentHandlers`'s `opts.spawnHeadless` type (around line 164):
```typescript
  spawnHeadless?: (argv: string[], cwd: string, env: Record<string, string>) => HeadlessChild;
```
to:
```typescript
  spawnHeadless?: (argv: string[], cwd: string, env: Record<string, string>, opts?: { captureSessionId?: boolean }) => HeadlessChild;
```

- [ ] **Step 2: Wire capture into `launch()`'s headless branch**

Import `updateAgentSessionId`:
```typescript
import { /* ...existing imports..., */ updateAgentSessionId } from "../../state/index.ts";
```
(Add it to whatever the existing `from "../../state/index.ts"` import line already destructures -- do not add a second import line for the same module.)

Change the spawn call (around line 244):
```typescript
    const child = spawnHeadless(argv, rec.cwd, gateEnv);
```
to:
```typescript
    const child = spawnHeadless(argv, rec.cwd, gateEnv, { captureSessionId: rec.provider === "codex" });
    if (rec.provider === "codex") {
      void child.sessionId().then((sid) => {
        if (sid) updateAgentSessionId(rec.id, sid, db);
        else log.warn({ id: rec.id }, "agent: codex headless launch never reported a session id");
      });
    }
```

- [ ] **Step 3: Add `herdrAgentSessionId` to `lib/agent-herdr.ts`**

Add after `herdrAgentWait`:

```typescript
/**
 * Polls herdr's own agent-session report until it surfaces codex's real
 * session id, or the timeout elapses. herdr's per-CLI SessionStart hook
 * (installed by `herdr integration install codex`) reports the id to herdr
 * over its socket the moment codex's interactive session starts; this reads
 * it back via `herdr agent get`. Exact JSON field name confirmed against a
 * real herdr pane before this ships -- see the spec's Open Items.
 */
export async function herdrAgentSessionId(
  paneId: string,
  timeoutMs: number,
  runner: HerdrRunner = defaultHerdrRunner(),
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await runner(["agent", "get", paneId]);
    if (r.exitCode === 0) {
      try {
        const parsed = JSON.parse(r.stdout);
        const sid = parsed?.result?.agentSessionId ?? parsed?.agentSessionId;
        if (typeof sid === "string" && sid) return sid;
      } catch {
        // keep polling -- a transient non-JSON response is not fatal
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
}
```

- [ ] **Step 4: Wire capture into `launch()`'s herdr branch**

Import `herdrAgentSessionId` alongside the existing `lib/agent-herdr.ts` import:
```typescript
import { defaultHerdrRunner, herdrAgentSessionId, launchInWorkspace, type HerdrRunner } from "../../agent-herdr.ts";
```

After the existing herdr success path (around line 231, right after `rec.workspaceId = out.workspaceId;` and before `return { ok: true, data: rec };`):

```typescript
      if (rec.provider === "codex") {
        void herdrAgentSessionId(out.paneId, 15_000).then((sid) => {
          if (sid) updateAgentSessionId(rec.id, sid, db);
          else log.warn({ id: rec.id }, "agent: codex herdr launch never reported a session id (is `herdr integration install codex` set up?)");
        });
      }
```

- [ ] **Step 5: Write failing tests**

In the daemon handler test file:

```typescript
test("headless codex launch captures the real session id from the --json stream", async () => {
  const fakeStdout = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"type":"other"}\n'));
      controller.enqueue(new TextEncoder().encode('{"session_id":"s_real_123"}\n'));
      controller.close();
    },
  });
  const spawnHeadless = (_argv: string[], _cwd: string, _env: Record<string, string>, opts?: { captureSessionId?: boolean }) => {
    const [forText, forId] = fakeStdout.tee();
    return {
      exited: Promise.resolve(0),
      stdout: () => new Response(forText).text(),
      sessionId: opts?.captureSessionId
        ? () => (async () => {
            const reader = forId.pipeThrough(new TextDecoderStream()).getReader();
            let buf = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += value;
            }
            for (const line of buf.split("\n")) {
              try {
                const e = JSON.parse(line) as { session_id?: string };
                if (e.session_id) return e.session_id;
              } catch { /* skip */ }
            }
            return undefined;
          })()
        : () => Promise.resolve(undefined),
    };
  };
  const handlers = createAgentHandlers({ db, emitEvent: () => 0, spawnHeadless, /* ...other injected deps... */ });
  const res = await handlers["agent:start"]({ repo: "r", cwd: "/c", surface: "headless", prompt: "go", provider: "codex" });
  expect(res.ok).toBe(true);
  // Session-id capture runs on a detached promise chain (`void child.sessionId().then(...)`),
  // so give it a tick before asserting the DB row updated.
  await new Promise((r) => setImmediate(r));
  if (res.ok) {
    const updated = getAgent(res.data.id, db);
    expect(updated?.sessionId).toBe("s_real_123");
  }
});
```

In `lib/agent-herdr.ts`'s existing test file, add (mirroring however `herdrAgentWait` is already tested there with a fake `HerdrRunner`):

```typescript
test("herdrAgentSessionId returns the id once herdr reports it", async () => {
  let call = 0;
  const runner: HerdrRunner = async (args) => {
    call += 1;
    if (args[0] === "agent" && args[1] === "get") {
      return call < 2
        ? { stdout: JSON.stringify({ result: {} }), exitCode: 0 }
        : { stdout: JSON.stringify({ result: { agentSessionId: "s_herdr_456" } }), exitCode: 0 };
    }
    throw new Error(`unexpected herdr call: ${args.join(" ")}`);
  };
  const sid = await herdrAgentSessionId("pane-1", 5000, runner);
  expect(sid).toBe("s_herdr_456");
});

test("herdrAgentSessionId gives up at the timeout", async () => {
  const runner: HerdrRunner = async () => ({ stdout: JSON.stringify({ result: {} }), exitCode: 0 });
  const sid = await herdrAgentSessionId("pane-1", 600, runner);
  expect(sid).toBeUndefined();
});
```

- [ ] **Step 6: Run tests**

```bash
bun test lib/daemon lib/__tests__/agent-herdr.test.ts
```
(Adjust the herdr test file path to wherever it actually lives — `find lib -iname '*agent-herdr*test*'`.)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/daemon/handlers/agent.ts lib/agent-herdr.ts lib/daemon/__tests__/ lib/__tests__/
git commit -m "agent: capture codex's real session id (headless --json stream, herdr agent get)"
```

---

### Task 8: Console server — settings prefix filter + `/api/agent/models`

**Files:**
- Modify: `mattstack-apps/apps/console/src/server/settings.ts`
- Create: `mattstack-apps/apps/console/src/server/agent-models.ts`
- Modify: `mattstack-apps/apps/console/src/server/routes.ts`
- Test: create `mattstack-apps/apps/console/src/server/agent-models.test.ts`, extend `settings.test.ts`

**Interfaces:**
- Produces: `GET /api/settings/defs?prefix=<p>` (filters), `GET /api/agent/models?provider=claude|codex`

- [ ] **Step 1: Add `?prefix=` to the existing defs route**

In `src/server/settings.ts`, change:
```typescript
  .get('/api/settings/defs', c =>
    c.json({ defs: allDefs().map(defToWire) }, 200)
  )
```
to:
```typescript
  .get('/api/settings/defs', c => {
    const prefix = c.req.query('prefix') ?? '';
    return c.json({ defs: allDefs().filter(d => d.key.startsWith(prefix)).map(defToWire) }, 200);
  })
```

- [ ] **Step 2: Write `src/server/agent-models.ts`**

```typescript
import { Hono } from 'hono';

export interface AgentModelOption {
  value: string;
  label: string;
}

// No live catalog command exists for claude (verified: no model-list
// subcommand in `claude --help`). Maintained by hand; a stale entry here is
// a documentation debt, not a correctness bug -- these are suggestions, not
// validated choices.
const CLAUDE_MODELS: AgentModelOption[] = [
  { value: 'sonnet', label: 'Sonnet (latest)' },
  { value: 'opus', label: 'Opus (latest)' },
  { value: 'haiku', label: 'Haiku (latest)' },
  { value: 'fable', label: 'Fable (latest)' },
];

interface CodexCatalogModel {
  slug: string;
  display_name: string;
  visibility: string;
}

/** `codex debug models` returns the real, live catalog -- confirmed against
    the installed codex-cli 0.153.4. Filtered to visibility: "list" (the
    user-facing set; "hide" entries are internal/experimental). */
async function codexModels(): Promise<AgentModelOption[]> {
  const proc = Bun.spawn(['codex', 'debug', 'models'], { stdout: 'pipe', stderr: 'ignore' });
  const [text, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) return [];
  const parsed = JSON.parse(text) as { models: CodexCatalogModel[] };
  return parsed.models
    .filter(m => m.visibility === 'list')
    .map(m => ({ value: m.slug, label: m.display_name }));
}

export const agentModels = new Hono().get('/api/agent/models', async c => {
  const provider = c.req.query('provider');
  if (provider === 'claude') return c.json({ models: CLAUDE_MODELS }, 200);
  if (provider === 'codex') {
    try {
      return c.json({ models: await codexModels() }, 200);
    } catch {
      // codex not installed / catalog shape changed: an empty list degrades
      // to free-text entry in the UI rather than a broken page.
      return c.json({ models: [] }, 200);
    }
  }
  return c.json({ error: 'provider must be "claude" or "codex"' }, 400);
});
```

- [ ] **Step 3: Mount it in `src/server/routes.ts`**

```typescript
import { agentModels } from './agent-models';
```
(add alongside the other imports, alphabetically), and:
```typescript
export const routes = new Hono()
  .route('/', runs)
  .route('/', enrich)
  .route('/', panes)
  .route('/', gates)
  .route('/', settings)
  .route('/', agentModels)
  .route('/', mountSkills(new Hono()))
  .route('/', mountEffectiveInputs(new Hono()));
```

- [ ] **Step 4: Write `src/server/agent-models.test.ts`**

Read one of the existing `src/server/*.test.ts` files first (e.g. `settings.test.ts`) to match its exact Hono test-request convention, then write:

```typescript
import { describe, expect, test } from 'vitest'; // match whatever test runner the existing server tests use
import { agentModels } from './agent-models';

describe('GET /api/agent/models', () => {
  test('claude returns the curated list', async () => {
    const res = await agentModels.request('/api/agent/models?provider=claude');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: { value: string }[] };
    expect(body.models.some(m => m.value === 'sonnet')).toBe(true);
  });

  test('unknown provider is a 400', async () => {
    const res = await agentModels.request('/api/agent/models?provider=cursor');
    expect(res.status).toBe(400);
  });
});
```

(The codex branch shells out to the real `codex` binary — skip asserting its exact contents in this test, the same way this repo already treats other binary-shelling routes; a `provider=claude` + `provider=unknown` pair is enough coverage without depending on codex being installed in CI.)

- [ ] **Step 5: Extend `settings.test.ts` for the prefix filter**

Add one test asserting `GET /api/settings/defs?prefix=agent.` returns only keys starting with `agent.` (read the existing file first to match its request-building helper).

- [ ] **Step 6: Run the console server tests**

```bash
cd mattstack-apps/apps/console && bun run test -- src/server/agent-models.test.ts src/server/settings.test.ts
```
(Adjust to whatever this repo's actual test script/command is — check `package.json`'s `scripts.test`.)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/agent-models.ts src/server/agent-models.test.ts src/server/settings.ts src/server/settings.test.ts src/server/routes.ts
git commit -m "console: add agent model catalog route, prefix filter on settings defs"
```

---

### Task 9: Console UI — Agent Defaults settings page

**Files:**
- Modify: `mattstack-apps/apps/console/src/app/config/useSettings.ts`
- Create: `mattstack-apps/apps/console/src/app/settings/AgentDefaultsPage.tsx`
- Create: `mattstack-apps/apps/console/src/app/settings/AgentDefaultsPage.test.tsx`
- Modify: `mattstack-apps/apps/console/src/app/routes.ts`
- Modify: `mattstack-apps/apps/console/src/app/App.tsx`

**Interfaces:**
- Consumes: Task 8's `GET /api/settings/defs?prefix=`, `GET /api/agent/models`
- Produces: `useSettingsPrefix(prefix)`, `useAgentModels(provider)` hooks; `/settings` route; `AgentDefaultsPage` component

- [ ] **Step 1: Add hooks to `src/app/config/useSettings.ts`**

```typescript
export function useSettingsPrefix(prefix: string) {
  return useQuery({
    queryKey: ['settings', 'defs', prefix],
    queryFn: async () => {
      const res = await client.api.settings.defs.$get({ query: { prefix } });
      if (!res.ok) throw new Error(`settings defs failed: ${res.status}`);
      return res.json();
    },
  });
}

export interface AgentModelOption {
  value: string;
  label: string;
}

export function useAgentModels(provider: 'claude' | 'codex') {
  return useQuery({
    queryKey: ['agent', 'models', provider],
    queryFn: async () => {
      const res = await client.api.agent.models.$get({ query: { provider } });
      if (!res.ok) throw new Error(`agent models failed: ${res.status}`);
      return (await res.json()) as { models: AgentModelOption[] };
    },
    // The catalog changes rarely; avoid a live codex spawn on every focus.
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 2: Write `src/app/settings/AgentDefaultsPage.tsx`**

```tsx
import {
  Alert,
  LazyLoader,
  PageShell,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mattstack/app-kit/core';
import { useState } from 'react';

import { PAGE_ROW_HEIGHT } from '../chrome';
import {
  useAgentModels,
  useSettingsPrefix,
  useSetSetting,
} from '../config/useSettings';

type Provider = 'claude' | 'codex';
type Scope = 'user' | 'machine';

interface Def {
  key: string;
  effective: { value: unknown };
}

function stringValue(defs: Def[] | undefined, key: string): string {
  const value = defs?.find(d => d.key === key)?.effective.value;
  return typeof value === 'string' ? value : '';
}

function boolValue(defs: Def[] | undefined, key: string): boolean {
  return defs?.find(d => d.key === key)?.effective.value === true;
}

function ProviderModelField({
  provider,
  value,
  scope,
}: {
  provider: Provider;
  value: string;
  scope: Scope;
}) {
  const key = `agent.${provider}.model`;
  const { data } = useAgentModels(provider);
  const mutation = useSetSetting(key);
  const options = (data?.models ?? []).map(m => ({
    value: m.value,
    label: m.label,
  }));
  return (
    <Select
      label="Model"
      placeholder="provider default"
      data={options}
      value={value || null}
      searchable
      clearable
      onChange={next => mutation.mutate({ value: next ?? undefined, scope })}
    />
  );
}

function AgentDefaultsPageContent() {
  const [scope, setScope] = useState<Scope>('user');
  const { data, error } = useSettingsPrefix('agent.');
  const defs = data?.defs as Def[] | undefined;

  const providerMutation = useSetSetting('agent.provider');
  const provider = (stringValue(defs, 'agent.provider') || 'claude') as Provider;

  const effortMutation = useSetSetting(`agent.${provider}.effort`);
  const accountMutation = useSetSetting('agent.claude.account');
  const extraArgsMutation = useSetSetting(`agent.${provider}.extraArgs`);
  const yoloMutation = useSetSetting(`agent.${provider}.yolo`);

  return (
    <Stack gap="lg" p="lg" data-testid="agent-defaults">
      <Title order={3}>Agent defaults</Title>
      <Text size="sm">
        These apply to every future <code>rt agent start</code> that does not
        pass its own flag.
      </Text>
      {error && <Alert color="red">{(error as Error).message}</Alert>}
      <Select
        label="Write to"
        data={[
          { value: 'user', label: 'this developer (user)' },
          { value: 'machine', label: 'this machine only' },
        ]}
        value={scope}
        allowDeselect={false}
        onChange={v => setScope((v as Scope) ?? 'user')}
      />
      <Select
        label="Default agent"
        data={[
          { value: 'claude', label: 'Claude' },
          { value: 'codex', label: 'Codex' },
        ]}
        value={provider}
        allowDeselect={false}
        onChange={v => providerMutation.mutate({ value: v ?? 'claude', scope })}
      />
      <ProviderModelField
        provider={provider}
        value={stringValue(defs, `agent.${provider}.model`)}
        scope={scope}
      />
      <TextInput
        label="Effort"
        placeholder={
          provider === 'codex' ? 'e.g. medium, high' : 'e.g. low, medium, high'
        }
        defaultValue={stringValue(defs, `agent.${provider}.effort`)}
        onBlur={e =>
          effortMutation.mutate({
            value: e.currentTarget.value || undefined,
            scope,
          })
        }
      />
      {provider === 'claude' && (
        <TextInput
          label="Account"
          placeholder="cswap account email; unset uses the default profile"
          defaultValue={stringValue(defs, 'agent.claude.account')}
          onBlur={e =>
            accountMutation.mutate({
              value: e.currentTarget.value || undefined,
              scope,
            })
          }
        />
      )}
      <TextInput
        label="Extra args"
        placeholder="raw flags appended to every launch"
        defaultValue={stringValue(defs, `agent.${provider}.extraArgs`)}
        onBlur={e =>
          extraArgsMutation.mutate({
            value: e.currentTarget.value || undefined,
            scope,
          })
        }
      />
      <Switch
        label="Bypass permission prompts (--yolo)"
        checked={boolValue(defs, `agent.${provider}.yolo`)}
        onChange={e =>
          yoloMutation.mutate({ value: e.currentTarget.checked, scope })
        }
      />
    </Stack>
  );
}

export function AgentDefaultsPage() {
  return (
    <PageShell
      title="Agent defaults"
      headerHeight={PAGE_ROW_HEIGHT}
      compactHeader
    >
      <LazyLoader>
        <AgentDefaultsPageContent />
      </LazyLoader>
    </PageShell>
  );
}
```

- [ ] **Step 3: Wire the route in `src/app/routes.ts`**

Add to the `AppRoute` union:
```typescript
export type AppRoute =
  | { name: 'board' }
  | { name: 'run'; repo: string; runId: string }
  | { name: 'gate'; id: string }
  | { name: 'search' }
  | { name: 'wiring' }
  | { name: 'settings' }
  | { name: 'config'; key: string }
  | { name: 'not-found' };
```

In `useAppRoute`, add alongside the other `useRoute` calls:
```typescript
  const [isSettings] = useRoute('/settings');
```
and, before the `isConfig` check:
```typescript
  if (isSettings) return { name: 'settings' };
```

- [ ] **Step 4: Wire the rail entry and route content in `src/app/App.tsx`**

```typescript
import { AgentDefaultsPage } from './settings/AgentDefaultsPage';
```
(add alongside the other page imports)

```typescript
type ConsoleSection = 'runs' | 'search' | 'wiring' | 'settings';
```

In `chromeSection`:
```typescript
function chromeSection(route: AppRoute): ConsoleSection | null {
  if (route.name === 'search') return 'search';
  if (route.name === 'wiring') return 'wiring';
  if (route.name === 'settings') return 'settings';
  if (route.name === 'not-found') return null;
  if (route.name === 'config') return null;
  return 'runs';
}
```

In `RouteContent`:
```typescript
    case 'settings':
      return <AgentDefaultsPage />;
```

In the rail (`MattstackShell.Rail`), add after the `WiringRailEntry`:
```tsx
          <RailLink
            icon="settings"
            label="Settings"
            href="/settings"
            active={section === 'settings'}
          />
```
(If `"settings"` is not a valid icon name in this kit's icon registry, the type error will name the valid set — pick the closest one, e.g. `"gear"` or `"sliders"`, and note the substitution in the commit message.)

- [ ] **Step 5: Write `src/app/settings/AgentDefaultsPage.test.tsx`**

Read an existing component test in this app first (e.g. one under `src/app/wiring/__tests__/`) to match its render/mock-fetch conventions, then write a test that:
- Mocks `client.api.settings.defs.$get` to return a small `agent.*` def set (including `agent.provider` effective `"claude"`).
- Mocks `client.api.agent.models.$get` to return two claude models.
- Renders `<AgentDefaultsPage />`.
- Asserts the provider Select shows "Claude" selected and the model Select's options include the mocked models.

- [ ] **Step 6: Run the console test suite**

```bash
cd mattstack-apps/apps/console && bun run test
```
Expected: PASS, no regressions in the rest of console's test suite.

- [ ] **Step 7: Manually verify in the browser**

Start console's dev server (check `package.json`'s `scripts.dev`), navigate to `/settings`, confirm: the rail entry appears and is clickable, switching "Default agent" between Claude/Codex swaps the model suggestions and hides/shows the Account field, and toggling Yolo + blurring a text field actually persists (reload the page and confirm the value survived).

- [ ] **Step 8: Commit**

```bash
git add src/app/config/useSettings.ts src/app/settings/ src/app/routes.ts src/app/App.tsx
git commit -m "console: add Agent Defaults settings page"
```

---

## Self-Review Notes

**Spec coverage:** provider abstraction (Task 1-2), settings keys (Task 3), DB/session-id plumbing (Task 4, 7), CLI + rt-client (Task 5), daemon dispatch (Task 6), console server + UI (Task 8-9) — every section of the spec has a task. The spec's two flagged "Open items" (exact JSON field names for codex's session id) are called out inline in Task 7's code comments and tests, not silently assumed correct.

**Placeholder scan:** the only bracketed placeholders left are `/* ...existing test's other injected deps... */` in Tasks 6-7, which is intentional — those tests must match whatever mock shape the *actual* neighboring tests in that file already use, and guessing that shape here would risk being wrong in a way that's worse than pointing at the real file.

**Type consistency:** `AgentInvocation` (Task 1) is the one shared type threaded through `claude.ts`, `codex.ts` (Task 2), and the daemon handler (Task 6) — no renamed duplicate. `AgentProvider` likewise. `updateAgentSessionId`'s signature (Task 4) matches its two call sites in Task 7 exactly (`id, sid, db`).
