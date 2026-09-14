# Credential Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daemon sweep that validates integration credentials on a schedule, warns before expiry, and surfaces results through notifications and a CLI verb.

**Architecture:** A new `lib/credential-health/` module houses the sweep logic and DB helpers. The sweep runs every 6h via `scheduleSweep` in the daemon, writes results to a `credential_health` table in state.db, and fires notifications through `notifyEnabled` on status transitions. Expiry probes are added directly to `IntegrationDef` for github and gitlab. An `rt accounts` CLI verb prints the health table and optionally triggers a recheck.

**Tech Stack:** Bun, SQLite (state.db), existing validator/notifier/events-bus infrastructure

**Spec:** `docs/superpowers/specs/2026-09-14-credential-health-design.md`

## Global Constraints

- SCHEMA_VERSION 12 (claimed in #rt); `IF NOT EXISTS` only in V12_SCHEMA
- No em dashes (`U+2014`) or en dashes (`U+2013`) in any added line
- TS CLI is UI-free: no ink, react, JSX, `.tsx`
- `bun build --compile` needs a `lib/module-registry.ts` entry for new command modules
- Leaf verbs with a required positional must declare `omitBehavior`; `rt accounts` has none (listing case), declare `omitBehavior: "list"`
- Tests never call real services; use `fakeProbes` and recorded responses
- Never sync-exec on the daemon thread
- Commit after each task

---

## File Structure

**New files:**
- `lib/credential-health/db.ts` ... read/write helpers for the `credential_health` table
- `lib/credential-health/sweep.ts` ... core sweep logic, transition detection, notification
- `lib/credential-health/__tests__/db.test.ts`
- `lib/credential-health/__tests__/sweep.test.ts`
- `commands/accounts.ts` ... `rt accounts` CLI verb
- `commands/__tests__/accounts.test.ts`

**Modified files:**
- `lib/state/db.ts` ... V12_SCHEMA + SCHEMA_VERSION bump
- `lib/setup/integrations.ts` ... add `expiry?` to IntegrationDef, implement for github/gitlab
- `lib/setup/__tests__/expiry-probes.test.ts` ... new test file for expiry probes
- `lib/notifier.ts` ... add `credential_health` to NOTIFICATION_TYPES
- `lib/daemon.ts` ... register `accounts-sweep`, add `accounts-recheck` handler
- `lib/command-tree-def.ts` ... add `accounts` node
- `lib/module-registry.ts` ... register `commands/accounts.ts`

---

### Task 1: Schema + DB Helpers

**Files:**
- Modify: `lib/state/db.ts`
- Create: `lib/credential-health/db.ts`
- Test: `lib/credential-health/__tests__/db.test.ts`

**Interfaces:**
- Consumes: nothing (foundational)
- Produces:
  ```ts
  interface CredentialHealthRow {
    integration: string;
    status: "ready" | "invalid" | "error";
    detail: string;
    expiresAt: string | null;
    checkedAt: number;
    lastNotifiedAt: number | null;
    lastNotifiedKind: "dead" | "expiring" | null;
  }
  function readCredentialHealth(db: Database, integration: string): CredentialHealthRow | null
  function readAllCredentialHealth(db: Database): CredentialHealthRow[]
  function writeCredentialHealth(db: Database, row: CredentialHealthRow): void
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/credential-health/__tests__/db.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { describe, test, expect, beforeEach } from "bun:test";
import {
  readCredentialHealth,
  readAllCredentialHealth,
  writeCredentialHealth,
  type CredentialHealthRow,
} from "../db.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS credential_health (
  integration        TEXT PRIMARY KEY,
  status             TEXT NOT NULL,
  detail             TEXT NOT NULL DEFAULT '',
  expires_at         TEXT,
  checked_at         INTEGER NOT NULL,
  last_notified_at   INTEGER,
  last_notified_kind TEXT
);
`;

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
});

describe("readCredentialHealth", () => {
  test("returns null when no row exists", () => {
    expect(readCredentialHealth(db, "github")).toBeNull();
  });

  test("returns the row after a write", () => {
    const row: CredentialHealthRow = {
      integration: "github",
      status: "ready",
      detail: "ok",
      expiresAt: "2026-12-01",
      checkedAt: 1000,
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    };
    writeCredentialHealth(db, row);
    expect(readCredentialHealth(db, "github")).toEqual(row);
  });

  test("upserts on same integration", () => {
    writeCredentialHealth(db, {
      integration: "gitlab",
      status: "ready",
      detail: "ok",
      expiresAt: null,
      checkedAt: 1000,
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    });
    writeCredentialHealth(db, {
      integration: "gitlab",
      status: "invalid",
      detail: "401 Unauthorized",
      expiresAt: null,
      checkedAt: 2000,
      lastNotifiedAt: 2000,
      lastNotifiedKind: "dead",
    });
    const row = readCredentialHealth(db, "gitlab");
    expect(row?.status).toBe("invalid");
    expect(row?.checkedAt).toBe(2000);
  });
});

describe("readAllCredentialHealth", () => {
  test("returns empty array on empty table", () => {
    expect(readAllCredentialHealth(db)).toEqual([]);
  });

  test("returns all rows ordered by integration", () => {
    writeCredentialHealth(db, {
      integration: "gitlab",
      status: "ready",
      detail: "ok",
      expiresAt: null,
      checkedAt: 1000,
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    });
    writeCredentialHealth(db, {
      integration: "github",
      status: "invalid",
      detail: "expired",
      expiresAt: null,
      checkedAt: 1000,
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    });
    const rows = readAllCredentialHealth(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].integration).toBe("github");
    expect(rows[1].integration).toBe("gitlab");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/credential-health/__tests__/db.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Add V12_SCHEMA and bump SCHEMA_VERSION**

In `lib/state/db.ts`, add after the last `V*_SCHEMA` constant (V9_SCHEMA):

```ts
const V12_SCHEMA = `
CREATE TABLE IF NOT EXISTS credential_health (
  integration        TEXT PRIMARY KEY,
  status             TEXT NOT NULL,
  detail             TEXT NOT NULL DEFAULT '',
  expires_at         TEXT,
  checked_at         INTEGER NOT NULL,
  last_notified_at   INTEGER,
  last_notified_kind TEXT
);
`;
```

Add `V12_SCHEMA` to the `SCHEMAS` array:

```ts
const SCHEMAS = [V1_SCHEMA, V2_SCHEMA, V3_SCHEMA, V4_SCHEMA, V6_SCHEMA, V7_SCHEMA, V8_SCHEMA, V9_SCHEMA, V12_SCHEMA];
```

Bump `SCHEMA_VERSION`:

```ts
export const SCHEMA_VERSION = 12;
```

Update the version comment to include `+ v12`.

- [ ] **Step 4: Write db.ts**

Create `lib/credential-health/db.ts`:

```ts
import type { Database } from "bun:sqlite";

export interface CredentialHealthRow {
  integration: string;
  status: "ready" | "invalid" | "error";
  detail: string;
  expiresAt: string | null;
  checkedAt: number;
  lastNotifiedAt: number | null;
  lastNotifiedKind: "dead" | "expiring" | null;
}

export function readCredentialHealth(
  db: Database,
  integration: string,
): CredentialHealthRow | null {
  const raw = db
    .query("SELECT * FROM credential_health WHERE integration = ?")
    .get(integration) as Record<string, unknown> | null;
  if (!raw) return null;
  return mapRow(raw);
}

export function readAllCredentialHealth(db: Database): CredentialHealthRow[] {
  const rows = db
    .query("SELECT * FROM credential_health ORDER BY integration")
    .all() as Record<string, unknown>[];
  return rows.map(mapRow);
}

export function writeCredentialHealth(
  db: Database,
  row: CredentialHealthRow,
): void {
  db.query(`
    INSERT OR REPLACE INTO credential_health
      (integration, status, detail, expires_at, checked_at, last_notified_at, last_notified_kind)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).run(
    row.integration,
    row.status,
    row.detail,
    row.expiresAt,
    row.checkedAt,
    row.lastNotifiedAt,
    row.lastNotifiedKind,
  );
}

function mapRow(raw: Record<string, unknown>): CredentialHealthRow {
  return {
    integration: raw.integration as string,
    status: raw.status as CredentialHealthRow["status"],
    detail: (raw.detail as string) ?? "",
    expiresAt: (raw.expires_at as string) ?? null,
    checkedAt: raw.checked_at as number,
    lastNotifiedAt: (raw.last_notified_at as number) ?? null,
    lastNotifiedKind: (raw.last_notified_kind as CredentialHealthRow["lastNotifiedKind"]) ?? null,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test lib/credential-health/__tests__/db.test.ts`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add lib/credential-health/db.ts lib/credential-health/__tests__/db.test.ts lib/state/db.ts
git commit -m "add credential_health table (V12) and DB helpers"
```

---

### Task 2: Expiry Probes

**Files:**
- Modify: `lib/setup/integrations.ts`
- Create: `lib/setup/__tests__/expiry-probes.test.ts`

**Interfaces:**
- Consumes: `IntegrationDef`, `Probes` (from `lib/setup/probes.ts`), `ValidateCtx`
- Produces: `IntegrationDef.expiry` optional field on `github` and `gitlab` entries

- [ ] **Step 1: Write the failing tests**

Create `lib/setup/__tests__/expiry-probes.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { INTEGRATIONS } from "../integrations.ts";
import type { ValidateCtx } from "../integrations.ts";

const baseCtx: ValidateCtx = {
  host: null,
  team: { slug: "test", remote: null },
};

describe("github expiry probe", () => {
  const def = INTEGRATIONS.github;

  test("reads expiry from response header", async () => {
    const p = fakeProbes({
      fetch: async (url: string) => ({
        status: 200,
        headers: new Headers({
          "github-authentication-token-expiration": "2026-12-01 00:00:00 UTC",
        }),
        json: async () => ({ login: "test" }),
        text: async () => "",
      }),
    });
    const result = await def.expiry!(p, "ghp_test", baseCtx);
    expect(result).toEqual({ expiresAt: "2026-12-01" });
  });

  test("absent header means no expiry", async () => {
    const p = fakeProbes({
      fetch: async () => ({
        status: 200,
        headers: new Headers(),
        json: async () => ({ login: "test" }),
        text: async () => "",
      }),
    });
    const result = await def.expiry!(p, "ghp_test", baseCtx);
    expect(result).toEqual({ expiresAt: null });
  });

  test("non-200 returns null (cannot determine)", async () => {
    const p = fakeProbes({
      fetch: async () => ({
        status: 401,
        headers: new Headers(),
        json: async () => ({}),
        text: async () => "Unauthorized",
      }),
    });
    const result = await def.expiry!(p, "ghp_test", baseCtx);
    expect(result).toBeNull();
  });
});

describe("gitlab expiry probe", () => {
  const def = INTEGRATIONS.gitlab;

  test("reads expires_at from /personal_access_tokens/self", async () => {
    const p = fakeProbes({
      fetch: async (url: string) => {
        if (url.includes("personal_access_tokens/self")) {
          return {
            status: 200,
            headers: new Headers(),
            json: async () => ({ expires_at: "2026-12-01", active: true }),
            text: async () => "",
          };
        }
        return { status: 200, headers: new Headers(), json: async () => ({}), text: async () => "" };
      },
    });
    const result = await def.expiry!(p, "glpat-test", { ...baseCtx, host: "gitlab.com" });
    expect(result).toEqual({ expiresAt: "2026-12-01" });
  });

  test("null expires_at means no expiry", async () => {
    const p = fakeProbes({
      fetch: async (url: string) => {
        if (url.includes("personal_access_tokens/self")) {
          return {
            status: 200,
            headers: new Headers(),
            json: async () => ({ expires_at: null, active: true }),
            text: async () => "",
          };
        }
        return { status: 200, headers: new Headers(), json: async () => ({}), text: async () => "" };
      },
    });
    const result = await def.expiry!(p, "glpat-test", { ...baseCtx, host: "gitlab.com" });
    expect(result).toEqual({ expiresAt: null });
  });

  test("403 returns null (insufficient scope, not invalid)", async () => {
    const p = fakeProbes({
      fetch: async (url: string) => {
        if (url.includes("personal_access_tokens/self")) {
          return { status: 403, headers: new Headers(), json: async () => ({}), text: async () => "Forbidden" };
        }
        return { status: 200, headers: new Headers(), json: async () => ({}), text: async () => "" };
      },
    });
    const result = await def.expiry!(p, "glpat-test", { ...baseCtx, host: "gitlab.com" });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/setup/__tests__/expiry-probes.test.ts`
Expected: FAIL (expiry is undefined on the integration defs)

- [ ] **Step 3: Add `expiry?` to IntegrationDef and implement**

In `lib/setup/integrations.ts`, add to the `IntegrationDef` interface:

```ts
export interface IntegrationDef {
  // ... existing fields
  expiry?: (
    p: Probes,
    token: string,
    ctx: ValidateCtx,
  ) => Promise<{ expiresAt: string | null } | null>;
}
```

Add the github expiry implementation (before the `INTEGRATIONS` const, or inline in the `github` entry):

```ts
async function githubExpiry(
  p: Probes,
  token: string,
  ctx: ValidateCtx,
): Promise<{ expiresAt: string | null } | null> {
  const host = ctx.host || "api.github.com";
  const res = await p.fetch(`https://${host}/user`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (res.status !== 200) return null;
  const header = res.headers.get("github-authentication-token-expiration");
  if (!header) return { expiresAt: null };
  const parsed = new Date(header);
  if (isNaN(parsed.getTime())) return null;
  return { expiresAt: parsed.toISOString().slice(0, 10) };
}
```

Add the gitlab expiry implementation:

```ts
async function gitlabExpiry(
  p: Probes,
  token: string,
  ctx: ValidateCtx,
): Promise<{ expiresAt: string | null } | null> {
  const host = ctx.host || "gitlab.com";
  const res = await p.fetch(`https://${host}/api/v4/personal_access_tokens/self`, {
    headers: { "PRIVATE-TOKEN": token },
  });
  if (res.status === 403 || res.status !== 200) return null;
  const body = (await res.json()) as { expires_at?: string | null };
  return { expiresAt: body.expires_at ?? null };
}
```

Wire into the INTEGRATIONS entries:

```ts
github: {
  // ... existing fields
  expiry: githubExpiry,
},
gitlab: {
  // ... existing fields
  expiry: gitlabExpiry,
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/setup/__tests__/expiry-probes.test.ts`
Expected: all PASS

- [ ] **Step 5: Verify existing tests still pass**

Run: `bun test lib/setup/__tests__/validators-accounts.test.ts`
Expected: all PASS (the new field is optional, existing tests are unaffected)

- [ ] **Step 6: Commit**

```bash
git add lib/setup/integrations.ts lib/setup/__tests__/expiry-probes.test.ts
git commit -m "add expiry probes to IntegrationDef for github and gitlab"
```

---

### Task 3: Sweep Engine

**Files:**
- Create: `lib/credential-health/sweep.ts`
- Create: `lib/credential-health/__tests__/sweep.test.ts`
- Modify: `lib/notifier.ts`

**Interfaces:**
- Consumes:
  - `readCredentialHealth(db, id)`, `writeCredentialHealth(db, row)` from `lib/credential-health/db.ts`
  - `IntegrationDef.validate(p, token, ctx)` returns `ValidateResult { status, detail, scopesSeen }`
  - `IntegrationDef.expiry?(p, token, ctx)` returns `{ expiresAt: string | null } | null`
- Produces:
  ```ts
  interface IntegrationTarget {
    id: string;
    def: IntegrationDef;
    token: string;
    ctx: ValidateCtx;
  }

  interface SweepDeps {
    db: Database;
    targets: () => Promise<IntegrationTarget[]>;
    probes: Probes;
    notifyEnabled: (category: string, title: string, message: string, url?: string) => void;
    emitEvent: (topic: string, payload: Record<string, unknown>) => void;
    now: () => number;
    log: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
  }

  function runAccountsSweep(deps: SweepDeps): Promise<void>
  function daysUntil(dateStr: string, nowMs: number): number
  ```

- [ ] **Step 1: Add credential_health to NOTIFICATION_TYPES**

In `lib/notifier.ts`, add to the `NOTIFICATION_TYPES` array:

```ts
{ key: "credential_health", label: "Credential health", description: "When an integration token is rejected or nearing expiry" },
```

- [ ] **Step 2: Write the failing test (ready to invalid transition)**

Create `lib/credential-health/__tests__/sweep.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { describe, test, expect, beforeEach } from "bun:test";
import { runAccountsSweep, daysUntil, type SweepDeps, type IntegrationTarget } from "../sweep.ts";
import { writeCredentialHealth, readCredentialHealth } from "../db.ts";
import type { IntegrationDef, ValidateCtx, ValidateResult } from "../../setup/integrations.ts";
import type { Probes } from "../../setup/probes.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS credential_health (
  integration        TEXT PRIMARY KEY,
  status             TEXT NOT NULL,
  detail             TEXT NOT NULL DEFAULT '',
  expires_at         TEXT,
  checked_at         INTEGER NOT NULL,
  last_notified_at   INTEGER,
  last_notified_kind TEXT
);
`;

const BASE_CTX: ValidateCtx = { host: null, team: { slug: "test", remote: null } };

function makeDef(overrides: {
  validate?: ValidateResult;
  expiresAt?: string | null;
} = {}): IntegrationDef {
  return {
    id: "gitlab" as any,
    title: "GitLab",
    why: () => "test",
    fields: [],
    secret: { domain: "rt", key: "gitlab-token" },
    validate: async () => overrides.validate ?? { status: "ready", detail: "ok", scopesSeen: [] },
    expiry: overrides.expiresAt !== undefined
      ? async () => ({ expiresAt: overrides.expiresAt ?? null })
      : undefined,
  };
}

function makeTarget(overrides: {
  id?: string;
  validate?: ValidateResult;
  expiresAt?: string | null;
  title?: string;
} = {}): IntegrationTarget {
  const def = makeDef(overrides);
  if (overrides.title) (def as any).title = overrides.title;
  if (overrides.id) (def as any).id = overrides.id;
  return { id: overrides.id ?? "gitlab", def, token: "glpat-test", ctx: BASE_CTX };
}

interface Collected {
  notifications: { category: string; title: string; message: string; url?: string }[];
  events: { topic: string; payload: Record<string, unknown> }[];
}

function makeDeps(
  db: Database,
  targets: IntegrationTarget[],
  nowMs: number = Date.now(),
): SweepDeps & Collected {
  const collected: Collected = { notifications: [], events: [] };
  return {
    ...collected,
    db,
    targets: async () => targets,
    probes: {} as Probes,
    notifyEnabled: (category, title, message, url) =>
      collected.notifications.push({ category, title, message, url }),
    emitEvent: (topic, payload) => collected.events.push({ topic, payload }),
    now: () => nowMs,
    log: { info() {}, warn() {} },
  };
}

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
});

describe("notification transitions", () => {
  test("ready to invalid: notifies once (dead)", async () => {
    writeCredentialHealth(db, {
      integration: "gitlab", status: "ready", detail: "ok",
      expiresAt: null, checkedAt: 500, lastNotifiedAt: null, lastNotifiedKind: null,
    });
    const target = makeTarget({ validate: { status: "invalid", detail: "401 Unauthorized", scopesSeen: [] } });
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);

    expect(deps.notifications).toHaveLength(1);
    expect(deps.notifications[0].category).toBe("credential_health");
    expect(deps.notifications[0].title).toBe("GitLab token rejected");
    expect(deps.notifications[0].message).toContain("401 Unauthorized");

    const row = readCredentialHealth(db, "gitlab");
    expect(row!.status).toBe("invalid");
    expect(row!.lastNotifiedKind).toBe("dead");
    expect(row!.lastNotifiedAt).toBe(1000);
  });

  test("invalid to invalid within 24h: does not re-notify", async () => {
    const now = 100_000;
    writeCredentialHealth(db, {
      integration: "gitlab", status: "invalid", detail: "401",
      expiresAt: null, checkedAt: 50_000,
      lastNotifiedAt: now - 12 * 3600_000, lastNotifiedKind: "dead",
    });
    const target = makeTarget({ validate: { status: "invalid", detail: "401", scopesSeen: [] } });
    const deps = makeDeps(db, [target], now);
    await runAccountsSweep(deps);
    expect(deps.notifications).toHaveLength(0);
  });

  test("invalid to invalid after 24h: re-notifies", async () => {
    const now = 100_000;
    writeCredentialHealth(db, {
      integration: "gitlab", status: "invalid", detail: "401",
      expiresAt: null, checkedAt: 50_000,
      lastNotifiedAt: now - 25 * 3600_000, lastNotifiedKind: "dead",
    });
    const target = makeTarget({ validate: { status: "invalid", detail: "401", scopesSeen: [] } });
    const deps = makeDeps(db, [target], now);
    await runAccountsSweep(deps);
    expect(deps.notifications).toHaveLength(1);
  });

  test("invalid to ready: clears notification state, no notify", async () => {
    writeCredentialHealth(db, {
      integration: "gitlab", status: "invalid", detail: "401",
      expiresAt: null, checkedAt: 500,
      lastNotifiedAt: 500, lastNotifiedKind: "dead",
    });
    const target = makeTarget({ validate: { status: "ready", detail: "ok", scopesSeen: [] } });
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);

    expect(deps.notifications).toHaveLength(0);
    const row = readCredentialHealth(db, "gitlab");
    expect(row!.status).toBe("ready");
    expect(row!.lastNotifiedAt).toBeNull();
    expect(row!.lastNotifiedKind).toBeNull();
  });

  test("error status: never notifies", async () => {
    const target = makeTarget({ validate: { status: "error", detail: "timeout", scopesSeen: [] } });
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);
    expect(deps.notifications).toHaveLength(0);
    const row = readCredentialHealth(db, "gitlab");
    expect(row!.status).toBe("error");
  });

  test("ready + expiring within 7 days: notifies", async () => {
    const now = Date.now();
    const in3Days = new Date(now + 3 * 86_400_000).toISOString().slice(0, 10);
    const target = makeTarget({
      id: "github", title: "GitHub",
      validate: { status: "ready", detail: "ok", scopesSeen: [] },
      expiresAt: in3Days,
    });
    const deps = makeDeps(db, [target], now);
    await runAccountsSweep(deps);

    expect(deps.notifications).toHaveLength(1);
    expect(deps.notifications[0].title).toMatch(/GitHub token expires in 3 day/);
  });

  test("ready + expiring + notified < 24h ago: skips", async () => {
    const now = Date.now();
    const in3Days = new Date(now + 3 * 86_400_000).toISOString().slice(0, 10);
    writeCredentialHealth(db, {
      integration: "github", status: "ready", detail: "ok",
      expiresAt: in3Days, checkedAt: now - 3600_000,
      lastNotifiedAt: now - 12 * 3600_000, lastNotifiedKind: "expiring",
    });
    const target = makeTarget({
      id: "github", validate: { status: "ready", detail: "ok", scopesSeen: [] },
      expiresAt: in3Days,
    });
    const deps = makeDeps(db, [target], now);
    await runAccountsSweep(deps);
    expect(deps.notifications).toHaveLength(0);
  });

  test("ready + expiry beyond 7 days: does not notify", async () => {
    const now = Date.now();
    const in30Days = new Date(now + 30 * 86_400_000).toISOString().slice(0, 10);
    const target = makeTarget({
      validate: { status: "ready", detail: "ok", scopesSeen: [] },
      expiresAt: in30Days,
    });
    const deps = makeDeps(db, [target], now);
    await runAccountsSweep(deps);
    expect(deps.notifications).toHaveLength(0);
  });

  test("first check, no previous row, status ready: no notify", async () => {
    const target = makeTarget({ validate: { status: "ready", detail: "ok", scopesSeen: [] } });
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);
    expect(deps.notifications).toHaveLength(0);
  });

  test("first check, no previous row, status invalid: notifies", async () => {
    const target = makeTarget({ validate: { status: "invalid", detail: "401", scopesSeen: [] } });
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);
    expect(deps.notifications).toHaveLength(1);
  });
});

describe("events bus emission", () => {
  test("emits credential/health on dead transition", async () => {
    const target = makeTarget({ validate: { status: "invalid", detail: "401", scopesSeen: [] } });
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);
    expect(deps.events).toHaveLength(1);
    expect(deps.events[0].topic).toBe("credential/health");
    expect(deps.events[0].payload).toMatchObject({ integration: "gitlab", transition: "dead" });
  });

  test("emits recovered on invalid to ready", async () => {
    writeCredentialHealth(db, {
      integration: "gitlab", status: "invalid", detail: "401",
      expiresAt: null, checkedAt: 500, lastNotifiedAt: 500, lastNotifiedKind: "dead",
    });
    const target = makeTarget({ validate: { status: "ready", detail: "ok", scopesSeen: [] } });
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);
    const recovery = deps.events.find((e) => e.payload.transition === "recovered");
    expect(recovery).toBeTruthy();
  });

  test("does not emit on error", async () => {
    const target = makeTarget({ validate: { status: "error", detail: "timeout", scopesSeen: [] } });
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);
    expect(deps.events).toHaveLength(0);
  });
});

describe("error isolation", () => {
  test("one integration throwing does not abort the sweep", async () => {
    const badDef = makeDef();
    badDef.validate = async () => { throw new Error("network failure"); };
    const targets: IntegrationTarget[] = [
      { id: "gitlab", def: badDef, token: "tok", ctx: BASE_CTX },
      makeTarget({ id: "github", title: "GitHub", validate: { status: "ready", detail: "ok", scopesSeen: [] } }),
    ];
    const deps = makeDeps(db, targets, 1000);
    await runAccountsSweep(deps);
    const gitlab = readCredentialHealth(db, "gitlab");
    expect(gitlab!.status).toBe("error");
    const github = readCredentialHealth(db, "github");
    expect(github!.status).toBe("ready");
  });
});

describe("daysUntil", () => {
  test("3 days from now", () => {
    const now = new Date("2026-09-14T12:00:00Z").getTime();
    expect(daysUntil("2026-09-17", now)).toBe(3);
  });

  test("same day is 0", () => {
    const now = new Date("2026-09-14T12:00:00Z").getTime();
    expect(daysUntil("2026-09-14", now)).toBe(0);
  });

  test("past date is 0", () => {
    const now = new Date("2026-09-14T12:00:00Z").getTime();
    expect(daysUntil("2026-09-10", now)).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test lib/credential-health/__tests__/sweep.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 4: Implement sweep.ts**

Create `lib/credential-health/sweep.ts`:

```ts
import type { Database } from "bun:sqlite";
import type { IntegrationDef, ValidateCtx } from "../setup/integrations.ts";
import type { Probes } from "../setup/probes.ts";
import { readCredentialHealth, writeCredentialHealth } from "./db.ts";

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const WARNING_DAYS = 7;

export interface IntegrationTarget {
  id: string;
  def: IntegrationDef;
  token: string;
  ctx: ValidateCtx;
}

export interface SweepDeps {
  db: Database;
  targets: () => Promise<IntegrationTarget[]>;
  probes: Probes;
  notifyEnabled: (category: string, title: string, message: string, url?: string) => void;
  emitEvent: (topic: string, payload: Record<string, unknown>) => void;
  now: () => number;
  log: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
}

export function daysUntil(dateStr: string, nowMs: number): number {
  const target = new Date(dateStr).getTime();
  return Math.max(0, Math.ceil((target - nowMs) / (24 * 60 * 60 * 1000)));
}

export async function runAccountsSweep(deps: SweepDeps): Promise<void> {
  const { db, probes, now: getNow, log } = deps;
  let targets: IntegrationTarget[];
  try {
    targets = await deps.targets();
  } catch (err) {
    log.warn("accounts-sweep: failed to resolve targets", { err });
    return;
  }

  for (const { id, def, token, ctx } of targets) {
    try {
      await checkOne(deps, id, def, token, ctx, probes, db, getNow());
    } catch (err) {
      log.warn(`accounts-sweep: ${id} threw`, { err });
      const now = getNow();
      writeCredentialHealth(db, {
        integration: id,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
        expiresAt: null,
        checkedAt: now,
        lastNotifiedAt: null,
        lastNotifiedKind: null,
      });
    }
  }
}

async function checkOne(
  deps: SweepDeps,
  id: string,
  def: IntegrationDef,
  token: string,
  ctx: ValidateCtx,
  probes: Probes,
  db: Database,
  now: number,
): Promise<void> {
  const result = await def.validate(probes, token, ctx);
  const { status, detail } = result;

  let expiresAt: string | null = null;
  if (def.expiry && status === "ready" && token) {
    try {
      const exp = await def.expiry(probes, token, ctx);
      expiresAt = exp?.expiresAt ?? null;
    } catch {
      // expiry probe failure is not a health issue
    }
  }

  const prev = readCredentialHealth(db, id);

  let notifyKind: "dead" | "expiring" | null = null;

  if (status === "invalid") {
    const wasInvalid = prev?.status === "invalid";
    const recentlyNotified =
      wasInvalid && prev.lastNotifiedAt != null && now - prev.lastNotifiedAt < TWENTY_FOUR_HOURS;
    if (!recentlyNotified) notifyKind = "dead";
  } else if (status === "ready" && expiresAt) {
    const days = daysUntil(expiresAt, now);
    if (days <= WARNING_DAYS && days > 0) {
      const recentlyNotified =
        prev?.lastNotifiedKind === "expiring" &&
        prev.lastNotifiedAt != null &&
        now - prev.lastNotifiedAt < TWENTY_FOUR_HOURS;
      if (!recentlyNotified) notifyKind = "expiring";
    }
  }

  let lastNotifiedAt = prev?.lastNotifiedAt ?? null;
  let lastNotifiedKind = prev?.lastNotifiedKind ?? null;

  if (status === "ready" && prev?.status === "invalid") {
    lastNotifiedAt = null;
    lastNotifiedKind = null;
  }
  if (notifyKind) {
    lastNotifiedAt = now;
    lastNotifiedKind = notifyKind;
  }

  writeCredentialHealth(db, {
    integration: id,
    status,
    detail,
    expiresAt,
    checkedAt: now,
    lastNotifiedAt,
    lastNotifiedKind,
  });

  if (notifyKind === "dead") {
    deps.notifyEnabled(
      "credential_health",
      `${def.title} token rejected`,
      `${detail}. Reconnect in Settings.`,
    );
    deps.emitEvent("credential/health", {
      integration: id, status, detail, transition: "dead",
    });
  } else if (notifyKind === "expiring") {
    const days = daysUntil(expiresAt!, now);
    deps.notifyEnabled(
      "credential_health",
      `${def.title} token expires in ${days} day${days === 1 ? "" : "s"}`,
      `Expires ${expiresAt}. Reconnect in Settings.`,
    );
    deps.emitEvent("credential/health", {
      integration: id, status, expiresAt, transition: "expiring", daysLeft: days,
    });
  }

  if (status === "ready" && prev?.status === "invalid") {
    deps.emitEvent("credential/health", {
      integration: id, status, transition: "recovered",
    });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test lib/credential-health/__tests__/sweep.test.ts`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add lib/credential-health/sweep.ts lib/credential-health/__tests__/sweep.test.ts lib/notifier.ts
git commit -m "add credential-health sweep engine with transition notifications"
```

---

### Task 4: Daemon Registration + Recheck Handler

**Files:**
- Modify: `lib/daemon.ts`

**Interfaces:**
- Consumes: `runAccountsSweep(deps)` from `lib/credential-health/sweep.ts`; `INTEGRATIONS` from `lib/setup/integrations.ts`; `readSecret` from `lib/secrets/store.ts`; `createRealProbes` from `lib/setup/probes.ts`; `scheduleSweep` (already imported in daemon.ts)
- Produces: `accounts-sweep` registered sweep; `accounts-recheck` daemon IPC handler

**Implementation notes:** This task wires the sweep into the daemon's background-subsystems phase. The daemon already has access to `eventsBus`, `getStateDb("daemon")`, and the `emit`/`broadcast` helpers. The sweep also needs secrets, probes, and integration target resolution.

- [ ] **Step 1: Identify the wiring point**

Read `lib/daemon.ts` around the "background-subsystems" phase (line ~693). Find where `sweepHandles.push(scheduleSweep(...))` calls cluster. The new sweep goes after `state-backup`.

- [ ] **Step 2: Add imports**

At the top of `lib/daemon.ts`, add:

```ts
import { runAccountsSweep, type SweepDeps, type IntegrationTarget } from "./credential-health/sweep.ts";
import { INTEGRATIONS, type ValidateCtx } from "./setup/integrations.ts";
import { createRealProbes } from "./setup/probes.ts";
import { readSecret, createRealSecretsExecSeam } from "./secrets/store.ts";
```

Check the actual export names in `lib/secrets/store.ts` for the seam constructor. It might be `createRealSecretsExecSeam()` or similar. The goal is to get a `SecretsSeams` value the sweep can use to read secrets.

- [ ] **Step 3: Wire the sweep deps and register**

Inside the background-subsystems phase, after the last `sweepHandles.push(...)`:

```ts
const accountsProbes = createRealProbes();
const secretsSeams = createRealSecretsExecSeam();

const accountsSweepFn = async () => {
  const db = getStateDb("daemon");
  const targets: IntegrationTarget[] = [];
  for (const [id, def] of Object.entries(INTEGRATIONS)) {
    if (!def.secret) continue;
    const token = await readSecret(secretsSeams, def.secret.domain, def.secret.key);
    if (!token) continue;
    const ctx: ValidateCtx = { host: null, team: { slug: "", remote: null } };
    targets.push({ id, def, token, ctx });
  }

  await runAccountsSweep({
    db,
    targets: async () => targets,
    probes: accountsProbes,
    notifyEnabled: (category, title, message, url) => {
      const { notifyEnabled: ne } = require("./notifier.ts");
      ne(category, title, message, url);
    },
    emitEvent: (topic, payload) => {
      const emittedAt = Date.now();
      const eventId = eventsBus.emitAt(topic, payload, emittedAt);
      emit("event", { id: eventId, topic, payload, emittedAt });
    },
    now: () => Date.now(),
    log: log.childLogger("accounts-sweep"),
  });
};

sweepHandles.push(
  scheduleSweep("accounts-sweep", accountsSweepFn, { bootDelayMs: 90_000, intervalMs: 6 * 60 * 60 * 1000 }, log),
);
```

**Important:** The `notifyEnabled` import path above is illustrative. Check how `lib/notifier.ts` exports `notifyEnabled` (it is a free function via `getDefaultNotifier()`). Import it at the top of `lib/daemon.ts` (check if already imported for other notification uses) rather than using `require` at call time. Also adapt the `ValidateCtx` construction: search for how other daemon code resolves the host for gitlab/switchboard integrations (check if `ctxFor` from `lib/setup/validators/accounts.ts` is appropriate, or build a minimal ctx from user settings). The baseline `{ host: null }` works for GitHub; GitLab and switchboard need the user-confirmed host from settings or overrides.

- [ ] **Step 4: Add the accounts-recheck IPC handler**

In the daemon's command handler registration (search for where `handleCommand` routes are defined, likely in `lib/daemon/command-router.ts` or inline in `lib/daemon.ts`), add:

```ts
"accounts-recheck": async () => {
  await accountsSweepFn();
  return { ok: true };
},
```

This lets the CLI trigger a sweep cycle via `p.daemon({ verb: "accounts-recheck" })`.

- [ ] **Step 5: Verify the daemon compiles**

Run: `bunx tsc --noEmit`
Expected: clean (no type errors)

- [ ] **Step 6: Commit**

```bash
git add lib/daemon.ts
git commit -m "register accounts-sweep in daemon, add accounts-recheck handler"
```

If the handler registration is in a separate file (e.g. `lib/daemon/command-router.ts` or a handlers file), add that file to the commit too.

---

### Task 5: `rt accounts` Command

**Files:**
- Create: `commands/accounts.ts`
- Create: `commands/__tests__/accounts.test.ts`
- Modify: `lib/command-tree-def.ts`
- Modify: `lib/module-registry.ts`

**Interfaces:**
- Consumes: `readAllCredentialHealth(db)` from `lib/credential-health/db.ts`; `getStateDb("cli")` from `lib/state/index.ts`; `Probes.daemon()` for `--recheck`

- [ ] **Step 1: Write the failing test**

Create `commands/__tests__/accounts.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { describe, test, expect, beforeEach } from "bun:test";
import { formatAccountsJson } from "../accounts.ts";
import { writeCredentialHealth } from "../../lib/credential-health/db.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS credential_health (
  integration        TEXT PRIMARY KEY,
  status             TEXT NOT NULL,
  detail             TEXT NOT NULL DEFAULT '',
  expires_at         TEXT,
  checked_at         INTEGER NOT NULL,
  last_notified_at   INTEGER,
  last_notified_kind TEXT
);
`;

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
});

describe("formatAccountsJson", () => {
  test("returns empty array when no rows", () => {
    const result = formatAccountsJson(db);
    expect(result).toEqual({ ok: true, accounts: [] });
  });

  test("returns all rows with correct shape", () => {
    writeCredentialHealth(db, {
      integration: "github", status: "ready", detail: "ok",
      expiresAt: "2026-12-01", checkedAt: 1000,
      lastNotifiedAt: null, lastNotifiedKind: null,
    });
    writeCredentialHealth(db, {
      integration: "gitlab", status: "invalid", detail: "401",
      expiresAt: null, checkedAt: 2000,
      lastNotifiedAt: 2000, lastNotifiedKind: "dead",
    });
    const result = formatAccountsJson(db);
    expect(result.ok).toBe(true);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0]).toMatchObject({
      integration: "github",
      status: "ready",
      expiresAt: "2026-12-01",
    });
    expect(result.accounts[1]).toMatchObject({
      integration: "gitlab",
      status: "invalid",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test commands/__tests__/accounts.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement accounts.ts**

Create `commands/accounts.ts`:

```ts
import type { Database } from "bun:sqlite";
import { readAllCredentialHealth, type CredentialHealthRow } from "../lib/credential-health/db.ts";

export function formatAccountsJson(db: Database): {
  ok: boolean;
  accounts: Array<{
    integration: string;
    status: string;
    detail: string;
    expiresAt: string | null;
    checkedAt: number;
  }>;
} {
  const rows = readAllCredentialHealth(db);
  return {
    ok: true,
    accounts: rows.map((r) => ({
      integration: r.integration,
      status: r.status,
      detail: r.detail,
      expiresAt: r.expiresAt,
      checkedAt: r.checkedAt,
    })),
  };
}

function formatHuman(rows: CredentialHealthRow[], now: number): string {
  if (rows.length === 0) return "No credential health data yet. Run: rt accounts --recheck";
  const lines: string[] = [];
  const pad = (s: string, n: number) => s.padEnd(n);
  lines.push(
    `${pad("Integration", 16)} ${pad("Status", 10)} ${pad("Expiry", 14)} ${pad("Checked", 16)} Detail`,
  );
  lines.push("-".repeat(80));
  for (const r of rows) {
    const ago = humanAgo(now - r.checkedAt);
    const expiry = r.expiresAt ?? "-";
    lines.push(
      `${pad(r.integration, 16)} ${pad(r.status, 10)} ${pad(expiry, 14)} ${pad(ago + " ago", 16)} ${r.detail}`,
    );
  }
  return lines.join("\n");
}

function humanAgo(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export async function run(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const recheck = args.includes("--recheck");

  const { getStateDb } = await import("../lib/state/index.ts");

  if (recheck) {
    const { createRealProbes } = await import("../lib/setup/probes.ts");
    const p = createRealProbes();
    try {
      const res = await p.daemon({ verb: "accounts-recheck" });
      if (!json) {
        if (res && typeof res === "object" && "ok" in res && res.ok) {
          console.log("Recheck complete.");
        } else {
          console.error("Recheck failed. Is the daemon running?");
        }
      }
    } catch {
      if (!json) console.error("Recheck failed. Is the daemon running?");
    }
  }

  const db = getStateDb("cli");
  if (json) {
    console.log(JSON.stringify(formatAccountsJson(db)));
  } else {
    const rows = readAllCredentialHealth(db);
    console.log(formatHuman(rows, Date.now()));
  }
}
```

**Note:** Check the exact `p.daemon(...)` calling convention. The `Probes` interface has a `daemon` method; verify its signature in `lib/setup/probes.ts`. If the daemon IPC is reached differently from a CLI command (e.g., a direct socket call), adapt accordingly. Search for how existing CLI commands communicate with the daemon (e.g., `rt chat` commands calling daemon verbs).

- [ ] **Step 4: Add command tree entry**

In `lib/command-tree-def.ts`, add a top-level entry:

```ts
accounts: {
  description: "Show integration credential health",
  module: "./commands/accounts.ts",
  omitBehavior: "list",
  args: [
    { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Output as JSON" },
    { name: "Recheck", flag: "--recheck", type: "boolean", default: false, hint: "Force a sweep cycle before listing" },
  ],
},
```

- [ ] **Step 5: Add module registry entry**

In `lib/module-registry.ts`, add to `MODULE_REGISTRY`:

```ts
"./commands/accounts.ts": () => import("../commands/accounts.ts"),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test commands/__tests__/accounts.test.ts`
Expected: all PASS

- [ ] **Step 7: Run picker conformance**

Run: `bun run picker:check`
Expected: 0 violations (the new `accounts` command has `omitBehavior: "list"` and no required positionals)

- [ ] **Step 8: Commit**

```bash
git add commands/accounts.ts commands/__tests__/accounts.test.ts lib/command-tree-def.ts lib/module-registry.ts
git commit -m "add rt accounts command for credential health listing"
```

---

### Task 6: Checklist Integration

**Files:**
- Modify: `lib/setup/validators/accounts.ts`
- Test: `lib/setup/__tests__/validators-accounts.test.ts`

**Interfaces:**
- Consumes: `readCredentialHealth(db, id)` from `lib/credential-health/db.ts`; `getStateDb("cli")` from `lib/state/index.ts`

- [ ] **Step 1: Write the failing test for expiry display**

Add to `lib/setup/__tests__/validators-accounts.test.ts`:

```ts
import { readCredentialHealth, writeCredentialHealth } from "../../credential-health/db.ts";

describe("accountRows - credential_health integration", () => {
  test("shows expiry in detail when within 7 days and status is ready", async () => {
    // Seed credential_health with a near-expiry result
    const db = getStateDb("cli"); // or however tests access the DB
    writeCredentialHealth(db, {
      integration: "github",
      status: "ready",
      detail: "ok",
      expiresAt: "2026-12-01",
      checkedAt: Date.now(),
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    });

    const p = fakeProbes({
      fetch: async () => ({
        status: 200,
        headers: new Headers(),
        json: async () => ({ login: "test", id: 1 }),
        text: async () => "",
      }),
    });
    const team = baseTeam({ forge: { provider: "github", org: "test" } });
    const row = await pickRow(
      accountRows(p, team, [], fakeSecrets({ "rt.github-token": "ghp_test" }), null),
      "account.github",
    );
    expect(row.status).toBe("ready");
    // The detail should mention the expiry
    expect(row.detail).toContain("expires");
  });

  test("falls back to cached credential_health when validate errors", async () => {
    const db = getStateDb("cli");
    writeCredentialHealth(db, {
      integration: "gitlab",
      status: "ready",
      detail: "ok",
      expiresAt: null,
      checkedAt: Date.now() - 4 * 3600_000,
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    });

    const p = fakeProbes({
      fetch: async () => ({
        status: 0, headers: new Headers(), json: async () => ({}), text: async () => "",
      }),
    });
    const team = baseTeam({ forge: { provider: "gitlab", host: "gitlab.com" } });
    const row = await pickRow(
      accountRows(p, team, [], fakeSecrets({ "rt.gitlab-token": "glpat-test" }), null, { gitlab: "gitlab.com" }),
      "account.gitlab",
    );
    // Should show cached result instead of bare error
    expect(row.detail).toContain("last checked");
  });
});
```

**Note:** These tests are sketches. The implementer must adapt them to the exact test infrastructure in `lib/setup/__tests__/validators-accounts.test.ts`: use the existing `baseTeam()`, `fakeSecrets()`, `pickRow()` helpers, and verify the DB is accessible in the test environment. The test HOME isolation (bunfig preload) means `getStateDb` points to a temp dir; seed the credential_health table there.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/setup/__tests__/validators-accounts.test.ts`
Expected: new tests FAIL (no expiry in detail, no fallback logic)

- [ ] **Step 3: Implement expiry display in account rows**

In `lib/setup/validators/accounts.ts`, modify the row-building logic (inside `accountRowFor` or the specific per-integration builders like `genericRow`/`githubRow`) to check `credential_health` for a near expiry:

After computing the row's status and before returning, add:

```ts
import { readCredentialHealth } from "../../credential-health/db.ts";
import { getStateDb } from "../../state/index.ts";
import { daysUntil } from "../../credential-health/sweep.ts";

// Inside the row builder, after validation succeeds (status "ready"):
try {
  const db = getStateDb("cli");
  const health = readCredentialHealth(db, id);
  if (health?.expiresAt && health.status === "ready") {
    const days = daysUntil(health.expiresAt, Date.now());
    if (days <= 7 && days > 0) {
      detail = `${detail} (expires in ${days} day${days === 1 ? "" : "s"}, ${health.expiresAt})`;
    }
  }
} catch {
  // DB unavailable; do not degrade the row
}
```

The exact insertion point depends on the row builder structure. The implementer should add this after the validate call returns `"ready"`, augmenting the `detail` string.

- [ ] **Step 4: Implement fallback to cached health on error**

In the same file, when a validate call returns `"error"` (or throws), before building the error row:

```ts
// When validate returned "error" or threw:
try {
  const db = getStateDb("cli");
  const health = readCredentialHealth(db, id);
  if (health && health.status !== "error") {
    const ago = humanCheckedAgo(Date.now() - health.checkedAt);
    detail = `last checked ${ago} ago: ${health.status}`;
    // Keep the row status as the cached status, not "error"
  }
} catch {
  // DB unavailable; show the original error
}
```

Add a helper for human-readable "ago" formatting (or import from accounts.ts if exported):

```ts
function humanCheckedAgo(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
```

The exact integration depends on how `accountRowFor` dispatches. The fallback should apply to all integration types, so it belongs in `accountRowForSafe` (the try/catch wrapper) or in the shared path after `def.validate` returns.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test lib/setup/__tests__/validators-accounts.test.ts`
Expected: all PASS (existing + new tests)

- [ ] **Step 6: Commit**

```bash
git add lib/setup/validators/accounts.ts lib/setup/__tests__/validators-accounts.test.ts
git commit -m "checklist rows show credential expiry and fall back to cached health"
```

---

### Task 7: Docs Regeneration + Final Verification

**Files:**
- Regenerate: `website/docs/` (generated command reference)

**Interfaces:**
- Consumes: all prior tasks

- [ ] **Step 1: Regenerate docs**

Run the docs generation command (check `package.json` for the script name):
```bash
bun run docs:generate
```
If no `docs:generate` script exists, check what `docs:check` validates against and run the corresponding generator.

- [ ] **Step 2: Run docs:check**

Run: `bun run docs:check`
Expected: in sync (or fix any remaining drift)

- [ ] **Step 3: Run picker:check**

Run: `bun run picker:check`
Expected: 0 violations

- [ ] **Step 4: Run full test suite**

Run: `bun run test:all`
Expected: all green (unit + e2e)

- [ ] **Step 5: Run type check**

Run: `bunx tsc --noEmit`
Expected: clean

- [ ] **Step 6: Run repo purity**

Run: `bash scripts/repo-purity.sh`
Expected: ok

- [ ] **Step 7: Check for em/en dashes**

Run:
```bash
git diff main --unified=0 | grep -P '[\x{2013}\x{2014}]' || echo "clean"
```
Expected: "clean"

- [ ] **Step 8: Commit docs if changed**

```bash
git add website/docs/
git commit -m "regenerate command reference for rt accounts"
```
