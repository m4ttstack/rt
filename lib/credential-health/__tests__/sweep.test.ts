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
    expect(deps.notifications[0]!.category).toBe("credential_health");
    expect(deps.notifications[0]!.title).toBe("GitLab token rejected");
    expect(deps.notifications[0]!.message).toContain("401 Unauthorized");

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
    expect(deps.notifications[0]!.title).toMatch(/GitHub token expires in 3 day/);
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
    expect(deps.events[0]!.topic).toBe("credential/health");
    expect(deps.events[0]!.payload).toMatchObject({ integration: "gitlab", transition: "dead" });
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
    // No previous row for gitlab, so error is written as-is
    const gitlab = readCredentialHealth(db, "gitlab");
    expect(gitlab!.status).toBe("error");
    const github = readCredentialHealth(db, "github");
    expect(github!.status).toBe("ready");
  });
});

describe("error preserves previous determinate state (Fix 1)", () => {
  test("error preserves previous ready state", async () => {
    writeCredentialHealth(db, {
      integration: "gitlab", status: "ready", detail: "gitlab token valid",
      expiresAt: null, checkedAt: 500, lastNotifiedAt: null, lastNotifiedKind: null,
    });
    const target = makeTarget({ validate: { status: "error", detail: "timeout", scopesSeen: [] } });
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);
    const row = readCredentialHealth(db, "gitlab");
    expect(row!.status).toBe("ready");
    expect(row!.detail).toBe("gitlab token valid");
    expect(row!.checkedAt).toBe(1000);
  });

  test("error preserves previous invalid state with notification fields", async () => {
    writeCredentialHealth(db, {
      integration: "gitlab", status: "invalid", detail: "401 Unauthorized",
      expiresAt: null, checkedAt: 500, lastNotifiedAt: 400, lastNotifiedKind: "dead",
    });
    const target = makeTarget({ validate: { status: "error", detail: "timeout", scopesSeen: [] } });
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);
    const row = readCredentialHealth(db, "gitlab");
    expect(row!.status).toBe("invalid");
    expect(row!.detail).toBe("401 Unauthorized");
    expect(row!.lastNotifiedAt).toBe(400);
    expect(row!.lastNotifiedKind).toBe("dead");
    expect(row!.checkedAt).toBe(1000);
  });

  test("error on first check (no previous row) records error", async () => {
    const target = makeTarget({ validate: { status: "error", detail: "timeout", scopesSeen: [] } });
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);
    const row = readCredentialHealth(db, "gitlab");
    expect(row!.status).toBe("error");
    expect(row!.detail).toBe("timeout");
  });

  test("outer catch preserves previous ready state", async () => {
    writeCredentialHealth(db, {
      integration: "gitlab", status: "ready", detail: "gitlab token valid",
      expiresAt: "2026-12-01", checkedAt: 500, lastNotifiedAt: null, lastNotifiedKind: null,
    });
    const badDef = makeDef();
    badDef.validate = async () => { throw new Error("network failure"); };
    const targets: IntegrationTarget[] = [
      { id: "gitlab", def: badDef, token: "tok", ctx: BASE_CTX },
    ];
    const deps = makeDeps(db, targets, 1000);
    await runAccountsSweep(deps);
    const row = readCredentialHealth(db, "gitlab");
    expect(row!.status).toBe("ready");
    expect(row!.detail).toBe("gitlab token valid");
    expect(row!.expiresAt).toBe("2026-12-01");
    expect(row!.checkedAt).toBe(1000);
  });
});

describe("expiry null collapse (Fix 2)", () => {
  test("indeterminate expiry (null) preserves previous known expiry", async () => {
    writeCredentialHealth(db, {
      integration: "gitlab", status: "ready", detail: "ok",
      expiresAt: "2026-12-01", checkedAt: 500, lastNotifiedAt: null, lastNotifiedKind: null,
    });
    const def = makeDef({ validate: { status: "ready", detail: "ok", scopesSeen: [] } });
    // expiry probe returns null (indeterminate, e.g. 403)
    def.expiry = async () => null;
    const target: IntegrationTarget = { id: "gitlab", def, token: "tok", ctx: BASE_CTX };
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);
    const row = readCredentialHealth(db, "gitlab");
    expect(row!.expiresAt).toBe("2026-12-01");
  });

  test("determinate no-expiry ({expiresAt: null}) clears previous expiry", async () => {
    writeCredentialHealth(db, {
      integration: "gitlab", status: "ready", detail: "ok",
      expiresAt: "2026-12-01", checkedAt: 500, lastNotifiedAt: null, lastNotifiedKind: null,
    });
    const target = makeTarget({
      validate: { status: "ready", detail: "ok", scopesSeen: [] },
      expiresAt: null,
    });
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);
    const row = readCredentialHealth(db, "gitlab");
    expect(row!.expiresAt).toBeNull();
  });

  test("expiry probe throw preserves previous known expiry", async () => {
    writeCredentialHealth(db, {
      integration: "gitlab", status: "ready", detail: "ok",
      expiresAt: "2026-12-01", checkedAt: 500, lastNotifiedAt: null, lastNotifiedKind: null,
    });
    const def = makeDef({ validate: { status: "ready", detail: "ok", scopesSeen: [] } });
    def.expiry = async () => { throw new Error("403 forbidden"); };
    const target: IntegrationTarget = { id: "gitlab", def, token: "tok", ctx: BASE_CTX };
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);
    const row = readCredentialHealth(db, "gitlab");
    expect(row!.expiresAt).toBe("2026-12-01");
  });
});

describe("reconcile removed credentials (Fix 4)", () => {
  test("health rows for integrations that lost their credential are deleted", async () => {
    // Seed a health row for gitlab, but don't include it in targets
    writeCredentialHealth(db, {
      integration: "gitlab", status: "ready", detail: "ok",
      expiresAt: null, checkedAt: 500, lastNotifiedAt: null, lastNotifiedKind: null,
    });
    // Only github in targets
    const target = makeTarget({
      id: "github", title: "GitHub",
      validate: { status: "ready", detail: "ok", scopesSeen: [] },
    });
    const deps = makeDeps(db, [target], 1000);
    await runAccountsSweep(deps);
    const gitlab = readCredentialHealth(db, "gitlab");
    expect(gitlab).toBeNull();
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
