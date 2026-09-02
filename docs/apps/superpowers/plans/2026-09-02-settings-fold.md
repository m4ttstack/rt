# Boxscore Settings Fold (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boxscore reads every setting from rt settings (registry keys under `mattstack.*` and `boxscore.*`) and both secrets from the rt daemon, and its own config.ts / settings.json / .env / settings page are deleted.

**Architecture:** New registry rows land in repo-tools' `rt-client` (published as 0.12.0). In boxscore, a new `server/config/` module is the only code that touches the resolver (fresh `getSetting` per read, fallbacks applied app-side), a secrets module mirrors the board's daemon client (env-first, scope `extension`), and the current user comes from GitLab `/api/v4/user` at boot. A one-time import script moves the legacy values into the stores, then the legacy files, routes, and settings page are deleted. Hard cutover: no fallback to the old files.

**Tech Stack:** TypeScript, Bun (server + rt-client), vitest (boxscore tests), `@mattstack/rt-client` (getSetting/setSetting/rtCommand), Hono.

**Spec:** docs/superpowers/specs/2026-09-02-mattstack-integration-design.md, section 5 (also 3/D2, D3, D6 and 5.7). Conflicts resolve against the spec.

## Global Constraints

- Two repos. Task 1 runs in an rt-provisioned worktree of `repo-tools` (`rt worktree provision`; never hand-rolled `git worktree add`). Tasks 2-7 run in a boxscore worktree branched from `feat/mattstack-integration-spec`.
- No `default` on any `boxscore.*` or `mattstack.roster` registry row. Fallbacks live in boxscore's `server/config/` read.
- `mattstack.integrations` is ONE object key. Writes read the current object, merge, and write the whole object back; a bare `setSetting` would delete the live `slack` and `switchboard` blocks. The live value's `forge.host` is a bare hostname (`gitlab.com`), not a URL.
- Secrets (`gitlabToken`, `linearApiKey`) live in the rt secrets store only, read via `secrets:read` scope `extension`. They are NEVER written to settings stores, and no script or test ever prints a token value (key names only).
- Tests must never read `~/.mattstack`: every store-backed reader carries a test seam, and the default reader throws under vitest (`process.env.VITEST`).
- Boxscore validation: `bun run test` (vitest) and `bun run typecheck` after every task. rt-client validation: `bun test` and `bun run check-types` inside `packages/rt-client`.
- Commit after each task. No em dashes anywhere. Comments only for constraints code cannot show.
- Execution-gated steps (Matt confirms each, at cutover, not during SDD): npm publish of rt-client 0.12.0 (OTP via bw), running the import script, committing/pushing the acme-web team repo, merging either branch.

---

### Task 1: Registry rows and migration-doc table (repo-tools)

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts`
- Modify: `docs/superpowers/specs/2026-08-20-suite-settings-migration.md`
- Modify: `packages/rt-client/package.json` (version 0.11.1 -> 0.12.0)

**Interfaces:**
- Produces: registry keys `mattstack.roster`, `boxscore.hiddenMembers`, `boxscore.projects`, `boxscore.linearDoneStates`, `boxscore.sizeBand`, `boxscore.excludeFilePatterns`, `boxscore.ignoredMrs`, `boxscore.botPatterns`, `boxscore.defaultRange`. Tasks 2-6 and the import script resolve exactly these names.

- [ ] **Step 1: Add the mattstack.roster row**

Directly after the `// --- mattstack (installer-lane) ---` block (before the `// --- claude (installer-lane) ---` comment), insert:

```ts
  // --- mattstack (shared team truth) ---------------------------------------
  {
    key: "mattstack.roster",
    type: "array",
    scopes: ["team"],
    merge: "replace",
    description:
      "The suite-wide team roster: [{username, name?}] GitLab usernames with optional display names. Any suite app that lists people reads this; hiding someone is the app's own overlay (e.g. boxscore.hiddenMembers).",
  },
```

- [ ] **Step 2: Add the boxscore block**

Between the end of the `// --- board (machine) ---` block and the `// --- gitq ---` comment, insert:

```ts
  // --- boxscore -------------------------------------------------------------
  // No `default` on any boxscore row: fallbacks live in boxscore's app-side
  // read (server/config), so an unset key resolves as absent here.
  {
    key: "boxscore.projects",
    type: "array",
    scopes: ["team"],
    merge: "replace",
    description: "GitLab projects boxscore scores, as full paths (\"group/project\").",
  },
  {
    key: "boxscore.linearDoneStates",
    type: "array",
    scopes: ["team"],
    merge: "replace",
    description: "Linear workflow state names that count as done. Empty means the completed and canceled state types.",
  },
  {
    key: "boxscore.sizeBand",
    type: "object",
    scopes: ["team"],
    merge: "deep",
    description: "MR size health band in changed lines: {tooSmall, tooLarge}. At or below tooSmall, or above tooLarge, is outside the healthy band.",
  },
  {
    key: "boxscore.excludeFilePatterns",
    type: "array",
    scopes: ["team"],
    merge: "replace",
    description: "Glob patterns for files excluded from addition/deletion counts (e.g. \"**/*.json\").",
  },
  {
    key: "boxscore.ignoredMrs",
    type: "array",
    scopes: ["team"],
    merge: "replace",
    description: "MRs excluded from all metrics: \"!123\" or \"group/project!123\".",
  },
  {
    key: "boxscore.botPatterns",
    type: "array",
    scopes: ["team"],
    merge: "replace",
    description: "Extra regex sources treated as bot accounts, beyond boxscore's built-in detection.",
  },
  {
    key: "boxscore.hiddenMembers",
    type: "array",
    scopes: ["user"],
    merge: "replace",
    description: "Usernames from mattstack.roster hidden from this developer's leaderboard.",
  },
  {
    key: "boxscore.defaultRange",
    type: "string",
    scopes: ["user"],
    merge: "replace",
    description: "Default comparison window for the API and CLI when none is given: \"7d\", \"30d\", or \"90d\".",
  },
```

- [ ] **Step 3: Point board.members at its successor**

Append one sentence to the existing `board.members` description string (keep the rest verbatim):

```
 The cross-app roster successor is mattstack.roster; this key remains the board's own list until the board adopts it.
```

- [ ] **Step 4: Add the boxscore table to the migration doc**

In `docs/superpowers/specs/2026-08-20-suite-settings-migration.md`, after the `## gitq` section (before `## Installer-lane keys`), insert:

```markdown
## boxscore

| Item | Disposition | Scope |
|---|---|---|
| config.ts users + settings.json users | `mattstack.roster` (suite-wide `[{username, name?}]`) | team |
| config.ts currentUser | DELETE (the token's own user via GitLab `/user`) | |
| config.ts projectPaths | `boxscore.projects` | team |
| config.ts groupPath | DELETE (never used; projects is the only scope) | |
| config.ts sizeBand | `boxscore.sizeBand` | team |
| config.ts defaultRange | `boxscore.defaultRange` | user |
| config.ts concurrency | code constant (6) | |
| settings.json linearTeam | field `linear.teamKey` of `mattstack.integrations` | team |
| settings.json doneStates | `boxscore.linearDoneStates` | team |
| settings.json bots.extraPatterns | `boxscore.botPatterns` | team |
| settings.json excludeFilePatterns | `boxscore.excludeFilePatterns` | team |
| settings.json ignoredMrs | `boxscore.ignoredMrs` | team |
| per-user hides | `boxscore.hiddenMembers` | user |
| .env GITLAB_BASE_URL | field `forge.host` of `mattstack.integrations` | team |
| .env GITLAB_TOKEN / LINEAR_API_KEY | rt secrets domain via `secrets:read` scope extension (`gitlabToken`, `linearApiKey`) | |
| .env PORT | deck's PORT env is authoritative | |
| settings page + /api/settings* routes | DELETE (rt settings is the editor; bot scan survives as `bun server/cli.ts --format bots`) | |
```

- [ ] **Step 5: Bump the version**

In `packages/rt-client/package.json`: `"version": "0.12.0"`. No changelog file exists in this package; the version bump and the registry diff are the record. This publish also carries the MAT-403 audit rows already on main (`chat.viewerUrl` default; `board.rtRepos` removed), which published nothing themselves.

- [ ] **Step 6: Validate**

Run in `packages/rt-client`: `bun test` (registry tests must pass with the new rows) and `bun run check-types`. Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "rt-client: mattstack.roster and boxscore.* registry rows; 0.12.0"
```

---

### Task 2: Boxscore settings reader (`server/config/`)

**Files:**
- Create: `server/config/index.ts`
- Test: `test/config-settings.test.ts`
- Modify: `package.json` (add dependency `"@mattstack/rt-client": "^0.11.1"`, then `bun install`)

**Interfaces:**
- Consumes: registry keys from Task 1 (resolved at runtime; under 0.11.1 the unit tests inject a fake reader so unknown keys never reach the real registry).
- Produces (Tasks 4-6 import these):
  - `readSettings(): BoxscoreSettings`
  - `__setSettingReader(r: SettingReader | null): void` (test seam)
  - `CONCURRENCY = 6`
  - `class ConfigError extends Error` (the 400-surface error, replacing EnvError)
  - types `BoxscoreSettings`, `RosterEntry`, `SettingReader`

- [ ] **Step 1: Write the failing tests**

`test/config-settings.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { __setSettingReader, readSettings } from "../server/config/index.js";

const store = (values: Record<string, unknown>) =>
  __setSettingReader(<T,>(key: string) => values[key] as T | undefined);

afterEach(() => __setSettingReader(null));

describe("readSettings", () => {
  it("maps every key and derives users from roster minus hiddenMembers", () => {
    store({
      "mattstack.roster": [
        { username: "ada", name: "Ada L" },
        { username: "bob" },
        { username: "eve", name: "Eve M" },
      ],
      "boxscore.hiddenMembers": ["eve"],
      "boxscore.projects": ["g/p"],
      "boxscore.linearDoneStates": ["Done"],
      "boxscore.sizeBand": { tooSmall: 5, tooLarge: 300 },
      "boxscore.excludeFilePatterns": ["**/*.json"],
      "boxscore.ignoredMrs": ["g/p!9"],
      "boxscore.botPatterns": ["-bot$"],
      "boxscore.defaultRange": "7d",
      "mattstack.integrations": { forge: { host: "gitlab.example", provider: "gitlab" }, linear: { teamKey: "CV" } },
    });
    const s = readSettings();
    expect(s.users).toEqual(["ada", "bob"]);
    expect(s.roster).toHaveLength(3);
    expect(s.projects).toEqual(["g/p"]);
    expect(s.linearTeam).toBe("CV");
    expect(s.doneStates).toEqual(["Done"]);
    expect(s.sizeBand).toEqual({ tooSmall: 5, tooLarge: 300 });
    expect(s.excludeFilePatterns).toEqual(["**/*.json"]);
    expect(s.ignoredMrs).toEqual(["g/p!9"]);
    expect(s.botPatterns).toEqual(["-bot$"]);
    expect(s.defaultRange).toBe("7d");
    expect(s.baseUrl).toBe("https://gitlab.example");
  });

  it("applies fallbacks when every key is unset", () => {
    store({});
    const s = readSettings();
    expect(s.projects).toEqual([]);
    expect(s.users).toEqual([]);
    expect(s.linearTeam).toBe("");
    expect(s.doneStates).toEqual([]);
    expect(s.sizeBand).toEqual({ tooSmall: 10, tooLarge: 400 });
    expect(s.excludeFilePatterns).toEqual([]);
    expect(s.ignoredMrs).toEqual([]);
    expect(s.botPatterns).toEqual([]);
    expect(s.defaultRange).toBe("30d");
    expect(s.baseUrl).toBe("");
  });

  it("keeps an already-URL forge host as-is and clips a trailing slash", () => {
    store({ "mattstack.integrations": { forge: { host: "https://gl.example/" } } });
    expect(readSettings().baseUrl).toBe("https://gl.example");
  });

  it("reads fresh on every call (no module cache)", () => {
    store({ "boxscore.projects": ["a/b"] });
    expect(readSettings().projects).toEqual(["a/b"]);
    store({ "boxscore.projects": ["c/d"] });
    expect(readSettings().projects).toEqual(["c/d"]);
  });

  it("refuses the store-backed reader under vitest", () => {
    __setSettingReader(null);
    expect(() => readSettings()).toThrow("inject a setting reader");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/config-settings.test.ts`. Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement `server/config/index.ts`**

```ts
import { getSetting } from "@mattstack/rt-client";
import type { RangePreset } from "../../shared/types.js";

/** Politeness cap on concurrent GitLab requests; a code constant since the fold. */
export const CONCURRENCY = 6;

/** Configuration missing or unusable; routes surface it as a 400, not a 500. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export interface RosterEntry {
  username: string;
  name?: string;
}

export interface BoxscoreSettings {
  projects: string[];
  roster: RosterEntry[];
  hiddenMembers: string[];
  /** Roster usernames minus hiddenMembers: the leaderboard's comparison set. */
  users: string[];
  /** "" = Linear unconfigured. */
  linearTeam: string;
  doneStates: string[];
  sizeBand: { tooSmall: number; tooLarge: number };
  excludeFilePatterns: string[];
  ignoredMrs: string[];
  botPatterns: string[];
  defaultRange: RangePreset;
  /** "" = GitLab unconfigured. */
  baseUrl: string;
}

export type SettingReader = <T>(key: string) => T | undefined;

const storeReader: SettingReader = <T,>(key: string): T | undefined =>
  getSetting<T | undefined>(key).value;

let reader: SettingReader | null = null;

/** Test seam. Vitest must inject; the store-backed reader would read the developer's real stores. */
export function __setSettingReader(r: SettingReader | null): void {
  reader = r;
}

function read<T>(key: string): T | undefined {
  if (reader) return reader<T>(key);
  if (process.env.VITEST) throw new Error("tests must inject a setting reader (__setSettingReader)");
  return storeReader<T>(key);
}

interface Integrations {
  forge?: { host?: string };
  linear?: { teamKey?: string };
}

function baseUrlFrom(host: string | undefined): string {
  if (!host) return "";
  const url = /^https?:\/\//.test(host) ? host : `https://${host}`;
  return url.replace(/\/+$/, "");
}

/** Every read resolves the stores fresh; nothing here caches across calls (spec 5.3). */
export function readSettings(): BoxscoreSettings {
  const roster = read<RosterEntry[]>("mattstack.roster") ?? [];
  const hiddenMembers = read<string[]>("boxscore.hiddenMembers") ?? [];
  const hidden = new Set(hiddenMembers);
  const integrations = read<Integrations>("mattstack.integrations") ?? {};
  return {
    projects: read<string[]>("boxscore.projects") ?? [],
    roster,
    hiddenMembers,
    users: roster.filter((m) => !hidden.has(m.username)).map((m) => m.username),
    linearTeam: integrations.linear?.teamKey ?? "",
    doneStates: read<string[]>("boxscore.linearDoneStates") ?? [],
    sizeBand: read<{ tooSmall: number; tooLarge: number }>("boxscore.sizeBand") ?? { tooSmall: 10, tooLarge: 400 },
    excludeFilePatterns: read<string[]>("boxscore.excludeFilePatterns") ?? [],
    ignoredMrs: read<string[]>("boxscore.ignoredMrs") ?? [],
    botPatterns: read<string[]>("boxscore.botPatterns") ?? [],
    defaultRange: read<RangePreset>("boxscore.defaultRange") ?? "30d",
    baseUrl: baseUrlFrom(integrations.forge?.host),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- test/config-settings.test.ts` and `bun run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/config/index.ts test/config-settings.test.ts package.json bun.lock
git commit -m "add server/config: rt-settings reader with fallbacks and test seam"
```

---

### Task 3: Secrets and current-user modules

**Files:**
- Create: `server/config/secrets.ts`
- Create: `server/config/current-user.ts`
- Test: `test/config-secrets.test.ts`, `test/config-current-user.test.ts`

**Interfaces:**
- Produces (Task 4 imports these):
  - `readSecrets(deps?): Promise<SecretsResult>` where `SecretsResult = { gitlabToken?: string; linearApiKey?: string; warning?: string }`
  - `getCurrentUser(baseUrl: string, token: string, fetchImpl?): Promise<CurrentUser | null>` with in-memory cache, `CurrentUser = { username: string; name: string | null }`
  - `__resetCurrentUser(): void` (test seam)

- [ ] **Step 1: Write the failing tests**

`test/config-secrets.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { readSecrets } from "../server/config/secrets.js";

const ENV_KEYS = ["GITLAB_TOKEN", "LINEAR_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("readSecrets", () => {
  it("env vars win without touching the daemon", async () => {
    process.env.GITLAB_TOKEN = "glpat-env";
    process.env.LINEAR_API_KEY = "lin_api_env";
    const post = () => {
      throw new Error("daemon must not be called when env covers both keys");
    };
    const res = await readSecrets({ readApiToken: () => "t", post: post as never });
    expect(res).toEqual({ gitlabToken: "glpat-env", linearApiKey: "lin_api_env" });
  });

  it("fills missing keys from the daemon", async () => {
    process.env.GITLAB_TOKEN = "glpat-env";
    delete process.env.LINEAR_API_KEY;
    const res = await readSecrets({
      readApiToken: () => "t",
      post: async () => ({ ok: true, data: { gitlabToken: "glpat-daemon", linearApiKey: "lin_api_daemon" } }),
    });
    expect(res.gitlabToken).toBe("glpat-env");
    expect(res.linearApiKey).toBe("lin_api_daemon");
    expect(res.warning).toBeUndefined();
  });

  it("degrades to not-configured with one warning when the daemon is unreachable", async () => {
    delete process.env.GITLAB_TOKEN;
    delete process.env.LINEAR_API_KEY;
    const res = await readSecrets({
      readApiToken: () => {
        throw new Error("ENOENT api-token");
      },
      post: async () => ({ ok: true, data: {} }),
    });
    expect(res.gitlabToken).toBeUndefined();
    expect(res.linearApiKey).toBeUndefined();
    expect(res.warning).toContain("rt daemon");
  });

  it("a daemon refusal surfaces as a warning, not a throw", async () => {
    delete process.env.GITLAB_TOKEN;
    const res = await readSecrets({
      readApiToken: () => "t",
      post: async () => ({ ok: false, error: "bad-token" }),
    });
    expect(res.warning).toContain("bad-token");
  });
});
```

`test/config-current-user.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { __resetCurrentUser, getCurrentUser } from "../server/config/current-user.js";

const okFetch = (body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;

beforeEach(() => __resetCurrentUser());

describe("getCurrentUser", () => {
  it("reads /api/v4/user once and caches", async () => {
    let calls = 0;
    const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      expect(String(url)).toBe("https://gl.example/api/v4/user");
      expect((init?.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBe("tok");
      return new Response(JSON.stringify({ username: "ada", name: "Ada L" }), { status: 200 });
    }) as typeof fetch;
    expect(await getCurrentUser("https://gl.example", "tok", f)).toEqual({ username: "ada", name: "Ada L" });
    expect(await getCurrentUser("https://gl.example", "tok", f)).toEqual({ username: "ada", name: "Ada L" });
    expect(calls).toBe(1);
  });

  it("returns null on a non-2xx response and does not cache the failure", async () => {
    const denied = (async () => new Response("", { status: 401 })) as typeof fetch;
    expect(await getCurrentUser("https://gl.example", "tok", denied)).toBeNull();
    expect(await getCurrentUser("https://gl.example", "tok", okFetch({ username: "ada", name: null }))).toEqual({ username: "ada", name: null });
  });

  it("returns null under vitest when no fetch is injected", async () => {
    expect(await getCurrentUser("https://gl.example", "tok")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/config-secrets.test.ts test/config-current-user.test.ts`. Expected: FAIL (modules do not exist).

- [ ] **Step 3: Implement `server/config/secrets.ts`**

Mirror `board/src/board-secrets.ts` (same HOME-at-call-time, api-token path, sock path, unreachable-prefix, unknown-command, and bad-scope handling; read that file for the rationale comments and keep the failure-shape mapping), with these differences:

```ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { rtCommand, type RtResponse } from "@mattstack/rt-client";

interface ExtensionSecrets {
  gitlabToken?: string;
  linearApiKey?: string;
}

export interface SecretsResult {
  gitlabToken?: string;
  linearApiKey?: string;
  /** Present when the daemon path failed; the caller logs it once and runs as not-configured. */
  warning?: string;
}

export interface SecretsDeps {
  readApiToken?: () => string;
  post?: (payload: { token: string; scope: "extension" }) => Promise<RtResponse<ExtensionSecrets>>;
}
```

`readSecrets(deps: SecretsDeps = {}): Promise<SecretsResult>`:
1. `gitlabToken = process.env.GITLAB_TOKEN?.trim() || undefined`, `linearApiKey = process.env.LINEAR_API_KEY?.trim() || undefined`. If both present, return them (no daemon call).
2. Otherwise call the daemon (scope `"extension"`, timeout 15s, sock `~/.mattstack/rt/rt.sock`, api-token `~/.mattstack/rt/api-token`) and fill only the missing keys from `res.data`.
3. Any failure (token file unreadable, transport error, `ok:false`) returns whatever the env provided plus a one-line `warning` string naming the failure shape as the board module does. Never throw; never include a token value in a message.
4. Under `process.env.VITEST` with no `deps.post` injected, skip the daemon entirely and return the env-derived keys with no warning (tests must never reach the real socket).

- [ ] **Step 4: Implement `server/config/current-user.ts`**

```ts
export interface CurrentUser {
  username: string;
  name: string | null;
}

let cached: CurrentUser | null = null;

export function __resetCurrentUser(): void {
  cached = null;
}

/**
 * The token's own user, from GET /api/v4/user; SP4 swaps this to
 * provider.validateToken(). Failure is null: no row is highlighted as "you".
 */
export async function getCurrentUser(
  baseUrl: string,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<CurrentUser | null> {
  if (cached) return cached;
  if (!fetchImpl && process.env.VITEST) return null;
  const f = fetchImpl ?? fetch;
  try {
    const res = await f(`${baseUrl}/api/v4/user`, { headers: { "PRIVATE-TOKEN": token } });
    if (!res.ok) return null;
    const body = (await res.json()) as { username: string; name: string | null };
    cached = { username: body.username, name: body.name ?? null };
    return cached;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test -- test/config-secrets.test.ts test/config-current-user.test.ts` and `bun run typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/config/secrets.ts server/config/current-user.ts test/config-secrets.test.ts test/config-current-user.test.ts
git commit -m "server/config: daemon secrets (scope extension) and current-user lookup"
```

---

### Task 4: Rewire the server off config.ts / env.ts / settings.ts

**Files:**
- Modify: `server/leaderboard.ts`, `server/app.ts`, `server/cli.ts`, `server/index.ts`, `server/pipeline/fetch.ts`, `server/gitlab/rest.ts`, `server/gitlab/graphql.ts`
- Modify: `test/endpoints.test.ts`, `test/progress.test.ts`, `test/detail-persist.test.ts`, `test/http-retry.test.ts`, `test/abort.test.ts` (swap legacy fakes for the Task 2/3 seams)

**Interfaces:**
- Consumes: `readSettings`, `CONCURRENCY`, `ConfigError`, `readSecrets`, `getCurrentUser` from Tasks 2-3.
- Produces: after this task, nothing outside `server/settings.ts`, `server/env.ts`, and the `/api/settings*` routes imports `config.ts`, `getEnv`, or `getSettings`. The `Env` type moves into `server/config/index.ts` as `{ baseUrl, token, linearApiKey? }` (`port` is dropped; only `server/index.ts` used it, and it now reads `PORT` directly); fetchers keep importing the same name (SP4 replaces the fetchers wholesale, so no rename churn now).

- [ ] **Step 1: Move the Env type**

Add to `server/config/index.ts`:

```ts
/** The fetchers' connection envelope; assembled per run from settings + secrets. */
export interface Env {
  baseUrl: string;
  token: string;
  linearApiKey?: string;
}
```

Repoint the `Env` type imports in `server/pipeline/fetch.ts`, `server/gitlab/rest.ts`, `server/gitlab/graphql.ts`, `server/leaderboard.ts`, `server/app.ts` from `../env.js` / `./env.js` to the config module. Delete `port` usages of the type (only `server/index.ts` used it).

- [ ] **Step 2: Assemble the env in leaderboard.ts**

Replace `getEnv()` in `buildLeaderboard` (and any other call site in the file) with:

```ts
async function resolveEnv(): Promise<Env> {
  const s = readSettings();
  if (!s.baseUrl) {
    throw new ConfigError(
      "GitLab is not configured: set the forge host in mattstack.integrations (rt settings).",
    );
  }
  const secrets = await readSecrets();
  if (secrets.warning) console.warn(`[config] ${secrets.warning}`);
  if (!secrets.gitlabToken) {
    throw new ConfigError(
      "GitLab token is not configured: set gitlabToken in the rt secrets store (or GITLAB_TOKEN).",
    );
  }
  return { baseUrl: s.baseUrl, token: secrets.gitlabToken, linearApiKey: secrets.linearApiKey };
}
```

`resolveScope()` becomes settings-driven and projects-only (spec 5.4):

```ts
function resolveScope(): Scope {
  const projects = readSettings().projects;
  if (projects.length === 0) {
    throw new ConfigError("boxscore.projects is empty: add at least one \"group/project\" (rt settings).");
  }
  return { type: "projects", projectPaths: projects };
}
```

Replace every `getSettings()` read with `readSettings()` (users, currentUser, metric options: `linearTeam`, `doneStates`, `sizeBand`, `extraBotPatterns: s.botPatterns`, `excludeFilePatterns`, `ignoredMrs`). Replace `config.concurrency` with `CONCURRENCY`. `ctx.currentUser` comes from `await getCurrentUser(env.baseUrl, env.token)`; on null use `""` and push a warning `{ code: "user_lookup_failed", message: "GitLab /user lookup failed; no row is highlighted as you" }`.

- [ ] **Step 3: app.ts, cli.ts, index.ts**

- `server/app.ts`: replace the `EnvError` import/checks with `ConfigError` (same 400 mapping); replace `config.defaultRange` (lines 27 and 126 area) with `readSettings().defaultRange`; drop the `config` import. Leave the `/api/settings*` routes untouched (Task 6 deletes them wholesale).
- `server/cli.ts`: replace both `config.defaultRange` uses with `readSettings().defaultRange`; drop the `config` import.
- `server/index.ts`: port comes straight from `Number(process.env.PORT ?? 8787)`; drop `getEnv`.

- [ ] **Step 4: Migrate the five test files**

In each listed test file, replace the legacy fakes with the seams:

```ts
import { __setSettingReader } from "../server/config/index.js";

const SETTINGS: Record<string, unknown> = {
  "boxscore.projects": ["acme/acme-web"],
  "mattstack.roster": [{ username: "m4ttheweric", name: "Matthew Goodwin" }],
  "mattstack.integrations": { forge: { host: "gl.example" } },
};
beforeAll(() => __setSettingReader(<T,>(k: string) => SETTINGS[k] as T | undefined));
afterAll(() => __setSettingReader(null));
```

Keep the existing `process.env.GITLAB_TOKEN = "test-token"` lines (the secrets module is env-first, so no daemon is touched). Where a test imported `config` for `projectPaths`, derive the scope from the same literal used in the fake store. Every previous assertion keeps its meaning; only the fake changes.

- [ ] **Step 5: Validate**

Run: `bun run test` and `bun run typecheck`. Expected: full suite green; `grep -rn "from \"../config\|getEnv\|getSettings" server/ --include="*.ts"` shows hits only inside `server/settings.ts`, `server/env.ts`, and the `/api/settings*` route block of `app.ts`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "server reads rt settings and daemon secrets; config.ts/env.ts unreferenced"
```

---

### Task 5: One-time import script

**Files:**
- Create: `scripts/import-legacy-settings.ts`
- Test: `test/import-legacy.test.ts` (pure helpers only)

**Interfaces:**
- Consumes: `getSetting`, `setSetting` from `@mattstack/rt-client`; `rtCommand` for the secrets presence check.
- Produces: exported pure helpers `mergeRoster(board: RosterEntry[], legacyUsernames: string[]): RosterEntry[]` and `mergeIntegrations(current: Integrations, incoming: { host?: string; teamKey?: string }): { merged: Integrations; changed: boolean }`, where the script declares `type Integrations = Record<string, unknown> & { forge?: { host?: string }; linear?: { teamKey?: string } }` so unrelated blocks (slack, switchboard) pass through untouched.

- [ ] **Step 1: Write the failing helper tests**

`test/import-legacy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeIntegrations, mergeRoster } from "../scripts/import-legacy-settings.js";

describe("mergeRoster", () => {
  it("unions by username, board names win, board order first", () => {
    const board = [
      { username: "ada", name: "Ada L" },
      { username: "bob", name: "Bob B" },
    ];
    const merged = mergeRoster(board, ["bob", "eve", "ada"]);
    expect(merged).toEqual([
      { username: "ada", name: "Ada L" },
      { username: "bob", name: "Bob B" },
      { username: "eve" },
    ]);
  });
});

describe("mergeIntegrations", () => {
  it("fills only missing fields and reports no change when both are present", () => {
    const current = { forge: { host: "gitlab.com", provider: "gitlab" }, linear: { teamKey: "CV" }, slack: { appId: "A1" } };
    const { merged, changed } = mergeIntegrations(current, { host: "https://ignored.example", teamKey: "ZZ" });
    expect(changed).toBe(false);
    expect(merged).toEqual(current);
  });

  it("fills a missing linear.teamKey and preserves unrelated blocks", () => {
    const current = { forge: { host: "gitlab.com" }, slack: { appId: "A1" } };
    const { merged, changed } = mergeIntegrations(current, { teamKey: "CV" });
    expect(changed).toBe(true);
    expect(merged).toEqual({ forge: { host: "gitlab.com" }, slack: { appId: "A1" }, linear: { teamKey: "CV" } });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/import-legacy.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the script**

`scripts/import-legacy-settings.ts`, runnable as `bun scripts/import-legacy-settings.ts [--dry-run]` with cwd = a checkout that still holds the legacy files (the runbook runs it from the main boxscore checkout before the fold branch merges; Bun auto-loads that cwd's `.env`):

1. **Load legacy sources.** `const legacy = (await import(join(process.cwd(), "config.ts"))).config` (dynamic import so this script has no compile-time dependency on a file the same branch deletes); `settings.json` via `readFileSync` + JSON.parse from cwd (missing file = fatal: "already imported?"); `GITLAB_BASE_URL` from `process.env` (the only env value consumed).
2. **Compose the writes** (team scope unless noted):
   - `mattstack.roster` = `mergeRoster(getSetting("board.members").value ?? [], settingsJson.users)`
   - `boxscore.projects` = `legacy.projectPaths ?? []`
   - `boxscore.linearDoneStates` = `settingsJson.doneStates`
   - `boxscore.sizeBand` = `settingsJson.sizeBand`
   - `boxscore.excludeFilePatterns` = `settingsJson.excludeFilePatterns`
   - `boxscore.ignoredMrs` = `settingsJson.ignoredMrs`
   - `boxscore.botPatterns` = `settingsJson.bots.extraPatterns`
   - `boxscore.defaultRange` (user scope) = `legacy.defaultRange`
   - `boxscore.hiddenMembers` is NOT written (default: everyone visible; Matt hides people himself).
3. **Integrations** (read-merge-write, never a bare set): read `mattstack.integrations`, `mergeIntegrations(current, { host: GITLAB_BASE_URL, teamKey: settingsJson.linearTeam })`; the helper fills `forge.host` / `linear.teamKey` only when absent (both are expected present already after the 2026-09-02 audit pass); `setSetting("mattstack.integrations", merged, "team")` only when `changed`.
4. **Secrets presence check** (names only, values never printed): `rtCommand("secrets:read", { token, scope: "extension" })`; if `gitlabToken` or `linearApiKey` is absent, exit 1 with instructions naming the missing key and the sops store, and write nothing further.
5. **Write** each composed value with `setSetting(key, value, scope)` (skipped under `--dry-run`, which prints the planned writes instead).
6. **Verify**: read every written key back with `getSetting` and deep-compare; any mismatch = exit 1 naming the key.
7. **Report**: print that team-scope writes landed in the acme-web team repo working copy and need `git commit` + `git push` there, then print the legacy-file removal list (`config.ts settings.json .env .env.example server/settings.ts server/env.ts`) as confirmation of what the fold branch deletes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- test/import-legacy.test.ts` and `bun run typecheck`. Expected: PASS. Do NOT run the script itself (it writes real stores; cutover only).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-legacy-settings.ts test/import-legacy.test.ts
git commit -m "add scripts/import-legacy-settings: one-time move into rt stores"
```

---

### Task 6: Delete the legacy surface

**Files:**
- Delete: `config.ts`, `settings.json`, `.env.example`, `server/settings.ts`, `server/env.ts`, `web/src/components/SettingsPage.tsx` (also `rm .env` locally; it is gitignored)
- Modify: `server/app.ts`, `server/cli.ts`, `server/linear/fetch.ts`, `web/src/App.tsx`, `web/src/api.ts`, `shared/types.ts`, `README.md`
- Test: `test/endpoints.test.ts` (route-absence assertions)

**Interfaces:**
- Consumes: `readSettings` (for the bots subcommand). After this task no file references `AppSettings`, `LinearStateInfo`, `getEnv`, `getSettings`, or `config.ts`.

- [ ] **Step 1: Routes and server files**

In `server/app.ts` delete the four routes `GET /api/settings`, `PUT /api/settings`, `GET /api/settings/linear-states`, `GET /api/settings/suspected-bots`, and the now-unused imports (`getSettings`/`updateSettings`/`getDefaults`, `fetchWorkflowStates`, `scanSuspectedBots`). Delete `server/settings.ts` and `server/env.ts`. In `server/linear/fetch.ts` delete `fetchWorkflowStates` (its only caller was the deleted route); keep everything else.

- [ ] **Step 2: Bot scan becomes a CLI subcommand**

In `server/cli.ts` extend the `--format` union with `"bots"`; when chosen, call `scanSuspectedBots(readSettings().botPatterns)` and print one line per suspect (`username  matched: <pattern>`), or `no suspected bots in the newest cache file`. Update the header usage comment with `bun server/cli.ts --format bots`.

- [ ] **Step 3: Web**

- `web/src/App.tsx`: remove the `SettingsPage` import, the `route.page === "settings"` branch, and the nav control that sets `window.location.hash = "#settings"`.
- `web/src/api.ts`: remove `fetchSettings`, `fetchLinearStates`, `fetchSuspectedBots`, `saveSettings`, and the `AppSettings`/`LinearStateInfo` imports (keep `fetchCacheStats` and `clearCache`; delete the `SuspectedBot` re-export, whose only consumer was the settings page).
- Delete `web/src/components/SettingsPage.tsx`.

- [ ] **Step 4: Shared types**

Delete `AppSettings` and `LinearStateInfo` from `shared/types.ts`. `SuspectedBot`, `CacheStatsResponse`, and everything else stay.

- [ ] **Step 5: Route-absence test**

In `test/endpoints.test.ts` add:

```ts
it("the settings API is gone", async () => {
  expect((await app.request("/api/settings")).status).toBe(404);
  expect((await app.request("/api/settings/linear-states")).status).toBe(404);
});
```

- [ ] **Step 6: README**

Replace the setup section that points at `.env` / `config.ts` / the settings page with: configuration lives in rt settings (`rt settings list | grep boxscore`, plus `mattstack.roster` and `mattstack.integrations`), secrets in the rt secrets store (`gitlabToken`, `linearApiKey`, scope `extension`; `GITLAB_TOKEN`/`LINEAR_API_KEY` env still win for one-off runs), port from deck via `PORT`, bot discovery via `bun server/cli.ts --format bots`.

- [ ] **Step 7: Validate**

Run: `bun run test` and `bun run typecheck`. Expected: green; `grep -rn "AppSettings\|LinearStateInfo\|settings.json\|server/env\|../config.js" server web/src shared test --include="*.ts" --include="*.tsx"` returns only the import script's deliberate cwd-relative reads.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "delete config.ts/settings.json/.env surface, settings page and routes; bots scan moves to the CLI"
```

---

### Task 7: Cache directory and dependency pin

**Files:**
- Modify: `server/cache/store.ts:11`, `package.json`

**Interfaces:**
- Produces: `CACHE_DIR` defaulting to `~/.mattstack/boxscore/cache` (spec D7/7.2: no cwd-relative path remains); `@mattstack/rt-client` pinned `^0.12.0`.

- [ ] **Step 1: Move the default**

```ts
import { homedir } from "node:os";
import { join } from "node:path";

export const CACHE_DIR =
  process.env.BOXSCORE_CACHE_DIR ?? join(process.env.HOME ?? homedir(), ".mattstack", "boxscore", "cache");
```

The `BOXSCORE_CACHE_DIR` override stays (tests use it). The old `.cache/` is disposable; the runbook removes it rather than migrating files.

- [ ] **Step 2: Pin the dependency**

`package.json`: `"@mattstack/rt-client": "^0.12.0"`. Do not run `bun install` here if 0.12.0 is not yet published; the runbook installs after the publish. If it is already published, run `bun install` and commit `bun.lock` too.

- [ ] **Step 3: Validate and commit**

Run: `bun run test` and `bun run typecheck` (both work regardless of the installed rt-client version; tests inject readers). Expected: green.

```bash
git add -A && git commit -m "cache lives under ~/.mattstack/boxscore; rt-client pinned to 0.12.0"
```

---

## Cutover runbook (execution-gated; each step confirmed with Matt)

1. Merge/land the repo-tools branch on main (per repo norms), then publish `@mattstack/rt-client` 0.12.0 (`bun publish` in the package; OTP from bw after Matt unlocks the vault).
2. In the boxscore fold worktree: `bun install` (picks up 0.12.0).
3. From the MAIN boxscore checkout (legacy files still present there): `bun /path/to/worktree/scripts/import-legacy-settings.ts --dry-run`, review, then run without `--dry-run`.
4. Commit and push the acme-web team repo working copy (`~/.mattstack/teams/acme-web`) with the new keys.
5. Merge the boxscore fold branch into `feat/mattstack-integration-spec` (or per Matt), `rm -rf .cache .env settings.json` leftovers in the main checkout after the merge lands.
6. `rt settings explain boxscore.projects` and one `bun server/cli.ts --range 7d` run as the smoke check.
