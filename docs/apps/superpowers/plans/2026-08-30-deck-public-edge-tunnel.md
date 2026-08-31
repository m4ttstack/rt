# deck public edge (Cloudflare wildcard tunnel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deck the sole owner of its public edge: `deck domain <domain>` creates, configures, DNS-routes, supervises, health-checks and records one wildcard cloudflared tunnel to the local gateway; `deck domain unbind` tears all of it down; the deck self-heals drift on its own timer and the board badge shows real connection health.

**Architecture:** One wildcard tunnel per deck (`*.<domain>` -> `localhost:7950`), identity `{ name, uuid }` recorded in the `deck.platform` settings key next to `publicDomain`. Three seams already exist and are extended, never replaced: `TunnelDriver` (cloudflared CLI; gains `list`/`info`, `delete -f`, loses `routeDns`), `CfDns` (Cloudflare API; `writeProxiedCname` becomes an upsert and gains a `cnameTarget` read), `ServiceManager` (launchd, unchanged). Orchestration lives in `src/edge/domain.ts` (bind/unbind) returning the codebase's `FlowResult`; poll-cadence health reads the connector's pinned local metrics `/ready`; a throttled `reconcileEdge()` rides the existing 5s reconcile tick with its own latch and cadence.

**Tech Stack:** Bun + TypeScript; `bun test`; cloudflared 2026.5.0 (`tunnel create|delete -f|list -o json|info -o json`); Cloudflare DNS API; rt daemon secrets (`readDeckSecrets`: `cfDnsToken`/`cfApiToken` + `cfZoneId`); launchd via the existing `LaunchdManager`.

**Spec:** `docs/superpowers/specs/2026-08-30-deck-public-edge-tunnel-design.md` (Fable-reviewed, Approved)

## Global Constraints

Every task's requirements implicitly include these (from the spec; the constants resolve the spec's open questions):

- **Launchd label is fixed:** `com.mattstack.deck.tunnel` (`TUNNEL_LABEL` in `src/edge/domain.ts`). Detection wiring (`readServices` scanning `com.mattstack.deck.*`) does not change.
- **Tunnel name is minted once and recorded:** `deck-edge-<machine-key>-<6 random base36 chars>`. The random suffix is the uniqueness guarantee; `<machine-key>` is only a readable segment, derived in the deck (`src/edge/machine-key.ts`) by mirroring rt-client's `machineKey()` (the `~/.mattstack/machine-key` override file, else the hostname slug). rt-client is NOT modified.
- **Config is deck-generated and byte-exact** (`renderTunnelConfig`), written to `join(stateDir(), "tunnel.yml")`, with `metrics: 127.0.0.1:7951` pinned in the file only (never on the command line). `EDGE_METRICS_PORT = 7951`.
- **DNS is owned through `CfDns`, never `cloudflared tunnel route dns`.** `writeProxiedCname` MUST upsert (list, then PATCH the existing record or POST a new one). CNAME target is `<uuid>.cfargotunnel.com`, proxied.
- **`TunnelDriver.delete` passes `-f`.** `tunnel info` is called ONLY at bind time (it is a CF API roundtrip); poll-cadence health reads `http://127.0.0.1:7951/ready` (`{"status":200,"readyConnections":N,...}`; a non-200 or `readyConnections 0` means not connected).
- **Bind ordering:** identity `{ tunnel }` is recorded in `deck.platform` immediately after the tunnel is resolved, BEFORE config, DNS, or service install; `publicDomain` is set last.
- **Guards key on REMOTE apps only** (records with `remote` set), never on `published` (which defaults to `true`). Different-domain rebind = unbind-then-bind, 409 `remote-apps-pinned-to-domain` unless `force`. Unbind additionally returns 409 `apps-will-go-offline` (listing non-remote apps) unless `force`; first bind and same-domain rebind are unguarded.
- **Reconcile never runs from the status GET** and never creates a tunnel or DNS from nothing. It runs inside the existing 5s tick with an in-flight latch: local pass at most every 30s (`EDGE_LOCAL_INTERVAL_MS`), CF pass (DNS + `list()`) at most every 10 min (`EDGE_CF_INTERVAL_MS`), 60s backoff after an error. A config rewrite is always followed by a kickstart. A recorded uuid absent from `list()` sets the `tunnelGone` drift flag (the ONLY source of the "re-run `deck domain`" bad state). Reconcile runs only when BOTH `publicDomain` and `tunnel` are recorded.
- **Health widening is additive:** `Health` gains optional `tone`/`detail`/`hint`; app rows never set them; `ok` keeps its meaning so `useBoardState`'s restart detection is unaffected.
- **No live Cloudflare or launchd calls in the suite.** Fakes only (`FakeTunnelDriver`, `FakeCfDns`, `FakeServiceManager`); the real drivers are validated by hand during the migration apply (Task 12, human-gated).
- **Cross-zone rebind, per-app tunnels, Access provisioning and adopting a foreign tunnel are out of scope.**
- **House rules:** no em dashes or en dashes anywhere (code, comments, commit messages); comments only for constraints the code cannot show (no narration, no review/task references); `deck` runs only from `main`, so this branch (`feat/deck-public-edge-tunnel`) merges to main before any deploy.

Test conventions (from the existing suite): scratch state via `LOCAL_REGISTRY_PATH` / `LOCAL_PLATFORM_SETTINGS_PATH` / `LOCAL_STATE_DIR` / `LOCAL_AGENTS_DIR` env paths and a fake `HOME` set BEFORE the dynamic `await import(...)`; a fresh `HOME` per test in `beforeEach` plus `reloadPlatformSettings()`; `bun test <file>` runs one file; `bun run test` (`bun test core src`) is the scoped sweep; `bun run build:board` regenerates `core/generated/board.{js,css}` and the freshness guard (`core/generated-fresh.test.ts`) fails if that is skipped after a `core/board/` edit. The 8 pre-existing `bun run test:dom` failures on main are known and unrelated; do not chase them.

---

## File structure

| File | Responsibility |
|---|---|
| `src/api/platform-settings.ts` (modify) | `tunnel: TunnelIdentity \| null` in `PlatformSettings`, threaded through every seam `railway` uses |
| `src/edge/cf-dns.ts` (modify) + `test/fixture/remote.ts` (modify) | `writeProxiedCname` upsert; new `cnameTarget(host)` read; fake mirrors both |
| `src/edge/tunnel.ts` (modify) | `TunnelDriver` gains `list`/`info`, `delete` (with `-f`), drops `routeDns`; `renderTunnelConfig`/`writeTunnelConfig`; `FakeTunnelDriver` with state |
| `src/edge/machine-key.ts` (create) | `machineKey()`, `randomSuffix()`, `mintTunnelName()` |
| `src/edge/domain.ts` (rewrite) | `bindDomain`, `unbindDomain`, `resolveTunnel`, `tunnelConfigPath`, `credentialsPath`, `tunnelServiceSpec`, `TUNNEL_LABEL` |
| `src/edge/edge-health.ts` (create) | `EDGE_METRICS_PORT`, `readReady`, `edgeState`, `edgeHealthRow`, `tunnelRowHealth`, `describeEdge` |
| `src/edge/edge-reconcile.ts` (create) | `reconcileEdge`, `edgeDrift`, cadence constants, `resetEdgeReconcileForTests` |
| `core/discover.ts` (modify) | `Health` widening |
| `src/api/status.ts` (modify) | tunnel row health populated from the metrics read |
| `core/reconcile.ts` (modify) | `reconcileEdgeTick` on the existing tick |
| `src/api/server.ts` (modify) | `GET /api/v1/domain` (show), `POST /api/v1/domain/bind`, `POST /api/v1/domain/unbind`; DNS driver resolution |
| `src/cli/commands.ts` (modify) | `deck domain` show / bind / unbind, `--force` |
| `src/cli/setup.ts` + `src/main.ts` + `src/api/register.ts` (modify) | `deck uninstall` tears the edge down through `unbindDomain`; `Drivers.tunnel?` |
| `core/board/logic.ts`, `core/board/Board.tsx`, `core/board/drawer/RootScreen.tsx`, `test/fixture/status.json` (modify) | health-driven badge/strip tones; regenerated bundle |
| `README.md` (modify) | `deck domain` verbs |

---

### Task 1: `tunnel` identity in `deck.platform`

**Files:**
- Modify: `src/api/platform-settings.ts`
- Test: `src/api/platform-settings.tunnel.test.ts` (create)

**Interfaces:**
- Produces: `export interface TunnelIdentity { name: string; uuid: string }`; `PlatformSettings.tunnel: TunnelIdentity | null`; `updatePlatformSettings({ tunnel })` round-trips through the machine store.

- [ ] **Step 1: Write the failing test**

Create `src/api/platform-settings.tunnel.test.ts` (mirrors `platform-settings.railway.test.ts`):

```ts
import { expect, test, beforeEach } from "bun:test";
import { getPlatformSettings, updatePlatformSettings, reloadPlatformSettings } from "./platform-settings.ts";

beforeEach(() => {
  process.env.LOCAL_PLATFORM_SETTINGS_PATH = `/tmp/deck-plat-${crypto.randomUUID()}.json`;
  reloadPlatformSettings(() => ({ value: undefined }));
});

test("tunnel defaults to null and round-trips (unowned: via platform.json)", () => {
  expect(getPlatformSettings().tunnel).toBeNull();
  updatePlatformSettings({ tunnel: { name: "deck-edge-mbp-abc123", uuid: "u-1" } }, () => ({ value: undefined }));
  reloadPlatformSettings(() => ({ value: undefined }));
  expect(getPlatformSettings().tunnel).toEqual({ name: "deck-edge-mbp-abc123", uuid: "u-1" });
});

test("tunnel is store-migrated: the deck.platform store wins over the file", () => {
  updatePlatformSettings({ tunnel: { name: "file-name", uuid: "file-uuid" } }, () => ({ value: undefined }));
  reloadPlatformSettings(() => ({ value: { tunnel: { name: "store-name", uuid: "store-uuid" } } }));
  expect(getPlatformSettings().tunnel).toEqual({ name: "store-name", uuid: "store-uuid" });
});

test("tunnel: null clears a recorded identity", () => {
  updatePlatformSettings({ tunnel: { name: "n", uuid: "u" } }, () => ({ value: undefined }));
  updatePlatformSettings({ tunnel: null }, () => ({ value: undefined }));
  reloadPlatformSettings(() => ({ value: undefined }));
  expect(getPlatformSettings().tunnel).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/api/platform-settings.tunnel.test.ts`
Expected: FAIL (type error / `tunnel` undefined rather than null).

- [ ] **Step 3: Thread `tunnel` through every seam**

In `src/api/platform-settings.ts`:

```ts
export interface TunnelIdentity {
  name: string;
  uuid: string;
}

export interface PlatformSettings {
  publicDomain: string | null;
  tlds: string[];
  legacyPrefixes: string[];
  secrets: { cfApiToken?: string; cfZoneId?: string };
  railway: { projectId: string; environmentId: string } | null;
  tunnel: TunnelIdentity | null;
}

const DEFAULTS: PlatformSettings = {
  publicDomain: null, tlds: ["localhost"], legacyPrefixes: [], secrets: {}, railway: null, tunnel: null,
};

type MigratedFields = Pick<PlatformSettings, "publicDomain" | "legacyPrefixes" | "railway" | "tunnel">;
```

In `withPlatformStoreFallback` add:

```ts
    tunnel: store.tunnel !== undefined ? store.tunnel : fileValues.tunnel,
```

In `updatePlatformSettings` change BOTH `setSetting` calls (the store write and the error-revert) to carry `tunnel`:

```ts
      setSetting(STORE_KEY, { publicDomain: cache.publicDomain, legacyPrefixes: cache.legacyPrefixes, railway: cache.railway, tunnel: cache.tunnel }, "machine");
```
```ts
        setSetting(STORE_KEY, { publicDomain: previous.publicDomain, legacyPrefixes: previous.legacyPrefixes, railway: previous.railway, tunnel: previous.tunnel }, "machine");
```

And the file-strip destructure:

```ts
        const { publicDomain: _publicDomain, legacyPrefixes: _legacyPrefixes, railway: _railway, tunnel: _tunnel, ...rest } = cache;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/api/platform-settings.tunnel.test.ts src/api/platform-settings.railway.test.ts src/api/platform-settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/platform-settings.ts src/api/platform-settings.tunnel.test.ts
git commit -m "platform: record the edge tunnel identity in deck.platform"
```

---

### Task 2: `CfDns` upsert + `cnameTarget` read

**Files:**
- Modify: `src/edge/cf-dns.ts`
- Modify: `test/fixture/remote.ts` (`FakeCfDns`)
- Test: `src/edge/cf-dns.test.ts` (append)

**Interfaces:**
- Produces: `CfDns.writeProxiedCname(host, target)` upserts (PATCH existing CNAME by id, else POST); `CfDns.cnameTarget(host): Promise<string | null>` returns the existing CNAME's `content` or null.

- [ ] **Step 1: Write the failing tests**

Append to `src/edge/cf-dns.test.ts`:

```ts
// Cloudflare rejects a CNAME create when a record with that name exists
// (error 81053), so the write must find and PATCH the existing record.
test("writeProxiedCname updates an existing record instead of creating a duplicate", async () => {
  const calls: { method: string; url: string; body: any }[] = [];
  const existing = { id: "rec-1", type: "CNAME", name: "*.example.dev", content: "old.cfargotunnel.com", proxied: true };
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: String(url), body });
    if (method === "GET") return Response.json({ success: true, result: [existing] });
    if (method === "POST") return Response.json({ success: false, errors: [{ code: 81053, message: "already exists" }] });
    return Response.json({ success: true, result: { ...existing, content: body.content } });
  }) as typeof fetch;
  const dns = new CfDnsApi({ zoneId: "z1", token: "t", fetchImpl });
  await dns.writeProxiedCname("*.example.dev", "new.cfargotunnel.com");
  const write = calls.find((c) => c.method !== "GET")!;
  expect(write.method).toBe("PATCH");
  expect(write.url).toContain("/dns_records/rec-1");
  expect(write.body).toEqual({ type: "CNAME", name: "*.example.dev", content: "new.cfargotunnel.com", proxied: true });
});

test("writeProxiedCname creates when no record exists", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(method);
    if (method === "GET") return Response.json({ success: true, result: [] });
    return Response.json({ success: true, result: { id: "rec-2" } });
  }) as typeof fetch;
  const dns = new CfDnsApi({ zoneId: "z1", token: "t", fetchImpl });
  await dns.writeProxiedCname("*.example.dev", "u.cfargotunnel.com");
  expect(calls).toEqual(["GET", "POST"]);
});

test("cnameTarget reads the existing record's content, null when absent", async () => {
  // URLSearchParams leaves `*` unencoded, so match on the parsed param, never on a hand-encoded string.
  const fetchImpl = (async (url: string | URL | Request) =>
    Response.json({ success: true, result: new URL(String(url)).searchParams.get("name") === "*.example.dev" ? [{ id: "r", type: "CNAME", name: "*.example.dev", content: "u.cfargotunnel.com" }] : [] })
  ) as typeof fetch;
  const dns = new CfDnsApi({ zoneId: "z1", token: "t", fetchImpl });
  expect(await dns.cnameTarget("*.example.dev")).toBe("u.cfargotunnel.com");
  expect(await dns.cnameTarget("*.other.dev")).toBeNull();
});

test("FakeCfDns mirrors upsert + cnameTarget", async () => {
  const dns = new FakeCfDns();
  await dns.writeProxiedCname("*.e.dev", "a.cfargotunnel.com");
  await dns.writeProxiedCname("*.e.dev", "b.cfargotunnel.com");
  expect(dns.cname.size).toBe(1);
  expect(await dns.cnameTarget("*.e.dev")).toBe("b.cfargotunnel.com");
  expect(await dns.cnameTarget("*.none.dev")).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/edge/cf-dns.test.ts`
Expected: FAIL (`cnameTarget` missing; upsert test sees POST).

- [ ] **Step 3: Implement upsert + read**

In `src/edge/cf-dns.ts`, add to the interface:

```ts
  cnameTarget(host: string): Promise<string | null>;
```

Replace `writeProxiedCname` and add `cnameTarget` in `CfDnsApi`:

```ts
  async writeProxiedCname(host: string, target: string): Promise<void> {
    const payload = { type: "CNAME", name: host, content: target, proxied: true };
    const existing = (await this.listRecords(host, "CNAME"))[0];
    if (existing) {
      await this.req("PATCH", `${BASE}/zones/${this.zoneId}/dns_records/${existing.id}`, payload);
      return;
    }
    await this.req("POST", `${BASE}/zones/${this.zoneId}/dns_records`, payload);
  }

  async cnameTarget(host: string): Promise<string | null> {
    const existing = (await this.listRecords(host, "CNAME"))[0];
    return existing ? existing.content : null;
  }
```

In `test/fixture/remote.ts` `FakeCfDns` add:

```ts
  async cnameTarget(h: string) { this.calls.push(`readCname:${h}`); return this.cname.get(h)?.target ?? null; }
```

(`writeProxiedCname` in the fake already `Map.set`s, which is upsert semantics.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/edge/cf-dns.test.ts src/edge/remote.enable.test.ts src/edge/remote.disable.test.ts src/edge/remote.push.test.ts`
Expected: PASS (the remote suites use `FakeCfDns` and must stay green).

- [ ] **Step 5: Commit**

```bash
git add src/edge/cf-dns.ts src/edge/cf-dns.test.ts test/fixture/remote.ts
git commit -m "cf-dns: upsert proxied CNAMEs and read a host's CNAME target"
```

---

### Task 3: `TunnelDriver` list/info/delete -f + byte-exact config

**Files:**
- Modify: `src/edge/tunnel.ts`
- Test: `src/edge/tunnel.test.ts` (REWRITE: this file already exists with old-API tests for `routeDns` and the old `writeTunnelConfig` signature; `Write` the complete content below over it, discarding the old tests)

**Interfaces:**
- Produces:
  ```ts
  export interface TunnelDriver {
    create(name: string): Promise<{ uuid: string }>;
    delete(name: string): Promise<void>;
    list(): Promise<Array<{ name: string; uuid: string; connections: number }>>;
    info(name: string): Promise<{ connectors: number }>;
  }
  export function renderTunnelConfig(o: { uuid: string; credentialsFile: string; domain: string; gatewayPort: number; metricsPort: number }): string;
  export function writeTunnelConfig(path: string, o: Parameters<typeof renderTunnelConfig>[0]): void;
  export class FakeTunnelDriver implements TunnelDriver { calls: string[][]; tunnels: Map<string, string>; connectors: number; constructor(credsDir?: string) }
  ```
- `routeDns` is removed from the interface, the CLI class, and the fake.

- [ ] **Step 1: Write the failing tests**

Create `src/edge/tunnel.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CloudflaredCli, FakeTunnelDriver, renderTunnelConfig, writeTunnelConfig } from "./tunnel.ts";

type Call = { argv: string[] };
function cli(responses: Record<string, { code?: number; stdout?: string; stderr?: string }>) {
  const calls: Call[] = [];
  const exec = async (argv: string[]) => {
    calls.push({ argv });
    const key = argv.slice(1, 3).join(" ");
    const r = responses[key] ?? {};
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { driver: new CloudflaredCli(exec), calls };
}

// Shapes observed on cloudflared 2026.5.0: list emits [{id,name,created_at,deleted_at,connections:[...]}],
// info emits {id,name,createdAt,conns:[...]} and takes its flags BEFORE the name argument.
test("list parses tunnel list -o json into name/uuid/connections", async () => {
  const { driver, calls } = cli({
    "tunnel list": { stdout: JSON.stringify([
      { id: "u-1", name: "deck-edge-mbp-abc123", created_at: "x", deleted_at: "0001-01-01T00:00:00Z", connections: [{ id: "c1" }, { id: "c2" }] },
      { id: "u-2", name: "other", created_at: "x", deleted_at: "0001-01-01T00:00:00Z", connections: [] },
    ]) },
  });
  expect(await driver.list()).toEqual([
    { name: "deck-edge-mbp-abc123", uuid: "u-1", connections: 2 },
    { name: "other", uuid: "u-2", connections: 0 },
  ]);
  expect(calls[0]!.argv.slice(1)).toEqual(["tunnel", "list", "-o", "json"]);
});

test("info parses connector count and puts -o json before the name", async () => {
  const { driver, calls } = cli({ "tunnel info": { stdout: JSON.stringify({ id: "u-1", name: "n", conns: [{ id: "a" }, { id: "b" }, { id: "c" }] }) } });
  expect(await driver.info("n")).toEqual({ connectors: 3 });
  expect(calls[0]!.argv.slice(1)).toEqual(["tunnel", "info", "-o", "json", "n"]);
});

test("delete forces, because edge connections linger after the service stops", async () => {
  const { driver, calls } = cli({});
  await driver.delete("n");
  expect(calls[0]!.argv.slice(1)).toEqual(["tunnel", "delete", "-f", "n"]);
});

test("create reads the uuid from stdout or stderr", async () => {
  const { driver } = cli({ "tunnel create": { stderr: "Created tunnel n with id 0f2f1c9e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" } });
  expect(await driver.create("n")).toEqual({ uuid: "0f2f1c9e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" });
});

test("renderTunnelConfig is the exact spec shape with metrics pinned", () => {
  expect(renderTunnelConfig({ uuid: "u-1", credentialsFile: "/c/u-1.json", domain: "example.dev", gatewayPort: 7950, metricsPort: 7951 })).toBe(
`tunnel: u-1
credentials-file: /c/u-1.json
metrics: 127.0.0.1:7951

ingress:
  - hostname: "*.example.dev"
    service: http://localhost:7950
  - service: http_status:404
`);
});

test("writeTunnelConfig creates parent dirs and writes the rendered file", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunnel-cfg-"));
  const path = join(dir, "nested", "tunnel.yml");
  writeTunnelConfig(path, { uuid: "u", credentialsFile: "/c/u.json", domain: "e.dev", gatewayPort: 1, metricsPort: 2 });
  expect(readFileSync(path, "utf8")).toContain("hostname: \"*.e.dev\"");
});

test("FakeTunnelDriver tracks tunnels, mints uuids and writes creds when given a dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunnel-fake-"));
  const fake = new FakeTunnelDriver(dir);
  const { uuid } = await fake.create("n");
  expect(existsSync(join(dir, `${uuid}.json`))).toBe(true);
  expect(await fake.list()).toEqual([{ name: "n", uuid, connections: 0 }]);
  await fake.delete("n");
  expect(await fake.list()).toEqual([]);
  expect(fake.calls).toEqual([["create", "n"], ["list"], ["delete", "n"], ["list"]]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/edge/tunnel.test.ts`
Expected: FAIL (missing exports / old signatures).

- [ ] **Step 3: Rewrite `src/edge/tunnel.ts`**

```ts
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

export interface TunnelDriver {
  create(name: string): Promise<{ uuid: string }>;
  delete(name: string): Promise<void>;
  list(): Promise<Array<{ name: string; uuid: string; connections: number }>>;
  info(name: string): Promise<{ connectors: number }>;
}

type ExecOut = (argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const realExec: ExecOut = async (argv) => {
  const proc = Bun.spawn(argv, { stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
};

function bin(): string {
  return process.env.LOCAL_CLOUDFLARED_BIN ?? "cloudflared";
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

interface ListedTunnel { id: string; name: string; connections?: unknown[] }

export class CloudflaredCli implements TunnelDriver {
  constructor(private exec: ExecOut = realExec) {}

  private async run(args: string[], what: string): Promise<string> {
    const { code, stdout, stderr } = await this.exec([bin(), "tunnel", ...args]);
    if (code !== 0) throw new Error(`cloudflared tunnel ${what} failed: ${(stdout + stderr).slice(0, 300)}`);
    return stdout + stderr;
  }

  async create(name: string): Promise<{ uuid: string }> {
    const out = await this.run(["create", name], `create ${name}`);
    const uuid = out.match(UUID_RE)?.[0];
    if (!uuid) throw new Error("cloudflared did not report a tunnel id");
    return { uuid };
  }

  // Unforced delete fails while edge connections linger after the launchd
  // service is gone, which would strand the tunnel and its credentials.
  async delete(name: string): Promise<void> {
    await this.run(["delete", "-f", name], `delete ${name}`);
  }

  async list(): Promise<Array<{ name: string; uuid: string; connections: number }>> {
    const { code, stdout, stderr } = await this.exec([bin(), "tunnel", "list", "-o", "json"]);
    if (code !== 0) throw new Error(`cloudflared tunnel list failed: ${(stdout + stderr).slice(0, 300)}`);
    const rows = JSON.parse(stdout) as ListedTunnel[];
    return rows.map((r) => ({ name: r.name, uuid: r.id, connections: r.connections?.length ?? 0 }));
  }

  // Flags must precede the name: cloudflared parses `info <name> -o json` as two arguments.
  async info(name: string): Promise<{ connectors: number }> {
    const { code, stdout, stderr } = await this.exec([bin(), "tunnel", "info", "-o", "json", name]);
    if (code !== 0) throw new Error(`cloudflared tunnel info ${name} failed: ${(stdout + stderr).slice(0, 300)}`);
    const t = JSON.parse(stdout) as { conns?: unknown[] };
    return { connectors: t.conns?.length ?? 0 };
  }
}

export interface TunnelConfig {
  uuid: string;
  credentialsFile: string;
  domain: string;
  gatewayPort: number;
  metricsPort: number;
}

export function renderTunnelConfig(o: TunnelConfig): string {
  return `tunnel: ${o.uuid}
credentials-file: ${o.credentialsFile}
metrics: 127.0.0.1:${o.metricsPort}

ingress:
  - hostname: "*.${o.domain}"
    service: http://localhost:${o.gatewayPort}
  - service: http_status:404
`;
}

export function writeTunnelConfig(path: string, o: TunnelConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderTunnelConfig(o));
}

export class FakeTunnelDriver implements TunnelDriver {
  calls: string[][] = [];
  /** name -> uuid, the account-side view `list()` reports. */
  tunnels = new Map<string, string>();
  connectors = 1;
  private seq = 0;
  constructor(private credsDir?: string) {}
  async create(name: string) {
    this.calls.push(["create", name]);
    const uuid = `fake-uuid-${++this.seq}`;
    this.tunnels.set(name, uuid);
    if (this.credsDir) writeFileSync(join(this.credsDir, `${uuid}.json`), "{}");
    return { uuid };
  }
  async delete(name: string) { this.calls.push(["delete", name]); this.tunnels.delete(name); }
  async list() {
    this.calls.push(["list"]);
    return [...this.tunnels].map(([name, uuid]) => ({ name, uuid, connections: 0 }));
  }
  async info(name: string) { this.calls.push(["info", name]); return { connectors: this.connectors }; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/edge/tunnel.test.ts`
Expected: PASS. (`src/edge/domain.test.ts`, `domain.remote-guard.test.ts` and `src/api/server.test.ts` will now FAIL to compile against the old `bindDomain`; that is expected until Task 5/9 rewrite them. Do not run the full sweep at this step.)

- [ ] **Step 5: Commit**

```bash
git add src/edge/tunnel.ts src/edge/tunnel.test.ts
git commit -m "tunnel: list/info/forced delete on the cloudflared driver, byte-exact config renderer"
```

---

### Task 4: machine key + tunnel name minting

**Files:**
- Create: `src/edge/machine-key.ts`
- Test: `src/edge/machine-key.test.ts`

**Interfaces:**
- Produces: `machineKey(): string`; `randomSuffix(len = 6): string`; `mintTunnelName(random = randomSuffix): string` -> `deck-edge-<machineKey>-<suffix>`.

- [ ] **Step 1: Write the failing test**

Create `src/edge/machine-key.test.ts`:

```ts
import { expect, test, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "machine-key-"));
  process.env.HOME = home;
});

const { machineKey, mintTunnelName, randomSuffix } = await import("./machine-key.ts");

test("machineKey honors ~/.mattstack/machine-key when it is a safe segment", () => {
  mkdirSync(join(home, ".mattstack"), { recursive: true });
  writeFileSync(join(home, ".mattstack", "machine-key"), "studio-mac\n");
  expect(machineKey()).toBe("studio-mac");
});

test("machineKey falls back to a hostname slug: lowercase, no .local, safe chars", () => {
  const k = machineKey();
  expect(k).toMatch(/^[a-z0-9-]+$/);
  expect(k.endsWith(".local")).toBe(false);
});

test("randomSuffix is 6 lowercase base36 chars and varies", () => {
  const a = randomSuffix(), b = randomSuffix();
  expect(a).toMatch(/^[a-z0-9]{6}$/);
  expect(a === b).toBe(false);
});

test("mintTunnelName composes the readable key with the injected suffix", () => {
  mkdirSync(join(home, ".mattstack"), { recursive: true });
  writeFileSync(join(home, ".mattstack", "machine-key"), "mbp");
  expect(mintTunnelName(() => "abc123")).toBe("deck-edge-mbp-abc123");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/edge/machine-key.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/edge/machine-key.ts`:

```ts
import { readFileSync } from "fs";
import { join } from "path";
import { homedir, hostname } from "os";
import { randomBytes } from "crypto";

// Mirrors rt-client's settings/paths.ts machineKey(), which is not exported
// from its package index. Only the readable segment of the tunnel name
// depends on it; uniqueness comes from randomSuffix.
export function machineKey(): string {
  try {
    const v = readFileSync(join(homedir(), ".mattstack", "machine-key"), "utf8").trim();
    if (v.length > 0 && v !== "." && v !== ".." && !v.includes("/") && !v.includes("\\")) return v;
  } catch {
    // no override file
  }
  const slug = hostname().toLowerCase().replace(/\.local$/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "default";
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomSuffix(len = 6): string {
  const bytes = randomBytes(len);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function mintTunnelName(random: () => string = randomSuffix): string {
  return `deck-edge-${machineKey()}-${random()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/edge/machine-key.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/edge/machine-key.ts src/edge/machine-key.test.ts
git commit -m "edge: machine key mirror and minted tunnel names"
```

---

### Task 5: `bindDomain` rewrite (lifecycle, guards, tunnel resolution)

**Files:**
- Rewrite: `src/edge/domain.ts`
- Rewrite test: `src/edge/domain.test.ts`
- Modify test: `src/edge/domain.remote-guard.test.ts`
- Create test: `src/edge/domain.bind.test.ts`

**Interfaces:**
- Consumes: Task 1 `TunnelIdentity`; Task 2 `CfDns.writeProxiedCname`/`tokenCanEditDns`; Task 3 `TunnelDriver`, `writeTunnelConfig`; Task 4 `mintTunnelName`.
- Produces:
  ```ts
  export const TUNNEL_LABEL = "com.mattstack.deck.tunnel";
  export const EDGE_METRICS_PORT = 7951;               // re-exported from edge-health in Task 7; define here first
  export interface EdgeDeps { tunnel: TunnelDriver; manager: ServiceManager; dns: CfDns }
  export interface EdgeOpts {
    gatewayPort?: number; cloudflaredDir?: string; force?: boolean; random?: () => string;
    /** Absolute cloudflared path, or null when not installed. Defaults to resolveProgram("cloudflared", composeServicePath()) from src/services/exec-env.ts. Tests inject. */
    resolveBin?: () => string | null;
    /** Pause between bind-time connector polls; tests inject a no-op. */
    sleep?: (ms: number) => Promise<void>;
  }
  export function tunnelConfigPath(): string;          // join(stateDir(), "tunnel.yml")
  export function credentialsPath(cfDir: string, uuid: string): string;
  /** `cloudflaredBin` MUST be absolute: launchd does not search PATH for ProgramArguments[0] (see exec-env.ts); a bare "cloudflared" silently never starts. */
  export function tunnelServiceSpec(o: { configPath: string; cloudflaredBin: string }): ServiceSpec;
  export async function bindDomain(domain: string, deps: EdgeDeps, opts?: EdgeOpts): Promise<FlowResult>;
  export async function unbindDomain(deps: { tunnel: TunnelDriver; manager: ServiceManager; dns: CfDns | null }, opts?: { force?: boolean; cloudflaredDir?: string }): Promise<FlowResult>; // full body lands in this task (Step 5); Task 6 adds its dedicated tests
  ```

- [ ] **Step 1: Rewrite `src/edge/domain.test.ts`**

```ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-domain-"));
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.HOME = dir;

const { bindDomain, tunnelConfigPath, TUNNEL_LABEL } = await import("./domain.ts");
const { FakeTunnelDriver } = await import("./tunnel.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeCfDns } = await import("../../test/fixture/remote.ts");
const { getPlatformSettings, reloadPlatformSettings } = await import("../api/platform-settings.ts");
const { reloadRegistry } = await import("../registry/records.ts");

const CLOUDFLARED = "/opt/homebrew/bin/cloudflared";
let cfDir: string;
let tunnel: InstanceType<typeof FakeTunnelDriver>;
let manager: InstanceType<typeof FakeServiceManager>;
let dns: InstanceType<typeof FakeCfDns>;
const opts = () => ({ cloudflaredDir: cfDir, gatewayPort: 7950, random: () => "abc123", resolveBin: () => CLOUDFLARED, sleep: async () => {} });

beforeEach(() => {
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  rmSync(join(dir, "tunnel.yml"), { force: true });
  process.env.HOME = mkdtempSync(join(tmpdir(), "local-domain-home-"));
  reloadPlatformSettings();
  reloadRegistry();
  cfDir = mkdtempSync(join(tmpdir(), "local-cfdir-"));
  tunnel = new FakeTunnelDriver(cfDir);
  manager = new FakeServiceManager();
  dns = new FakeCfDns();
});

test("refuses a malformed domain", async () => {
  writeFileSync(join(cfDir, "cert.pem"), "x");
  const r = await bindDomain("not a domain", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(400);
});

test("refuses when cloudflared is not installed", async () => {
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, { ...opts(), resolveBin: () => null });
  expect(r.status).toBe(400);
  expect((r.body as any).error).toBe("cloudflared-missing");
});

test("refuses politely until cloudflared login has happened", async () => {
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(428);
  expect((r.body as any).command).toBe("cloudflared tunnel login");
});

test("refuses when the DNS token cannot edit the zone", async () => {
  writeFileSync(join(cfDir, "cert.pem"), "x");
  dns.canEdit = false;
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(400);
  expect((r.body as any).error).toBe("cf-token-needs-zone-dns");
});

test("binds: mints + creates the tunnel, records identity, config, upserts DNS, installs + kickstarts, sets publicDomain", async () => {
  writeFileSync(join(cfDir, "cert.pem"), "x");
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(200);
  expect(tunnel.calls[0]).toEqual(["create", expect.stringMatching(/^deck-edge-[a-z0-9-]+-abc123$/)]);
  const { tunnel: id, publicDomain } = getPlatformSettings();
  expect(id).toEqual({ name: tunnel.calls[0]![1], uuid: "fake-uuid-1" });
  expect(publicDomain).toBe("example.dev");
  expect(readFileSync(tunnelConfigPath(), "utf8")).toContain(`tunnel: fake-uuid-1`);
  expect(readFileSync(tunnelConfigPath(), "utf8")).toContain(`metrics: 127.0.0.1:7951`);
  expect(dns.cname.get("*.example.dev")).toEqual({ target: "fake-uuid-1.cfargotunnel.com", proxied: true });
  const agent = manager.installed.get(TUNNEL_LABEL)!;
  expect(agent.programArguments).toEqual([CLOUDFLARED, "tunnel", "--config", tunnelConfigPath(), "run"]);
  expect(manager.kickstarts).toEqual([TUNNEL_LABEL]);
  expect((r.body as any).connectors).toBe(1);
});

test("bind polls info() until a connector registers, bounded", async () => {
  writeFileSync(join(cfDir, "cert.pem"), "x");
  tunnel.connectors = 0;
  const slept: number[] = [];
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, { ...opts(), sleep: async (ms) => { slept.push(ms); if (slept.length === 2) tunnel.connectors = 2; } });
  expect(r.status).toBe(200);
  expect((r.body as any).connectors).toBe(2);
  expect(tunnel.calls.filter((c) => c[0] === "info")).toHaveLength(3);
  expect(slept).toEqual([3000, 3000]);
});
```

- [ ] **Step 2: Create `src/edge/domain.bind.test.ts` (ordering, idempotency, the three recorded-tunnel branches)**

```ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "domain-bind-"));
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.HOME = dir;

const { bindDomain, TUNNEL_LABEL } = await import("./domain.ts");
const { FakeTunnelDriver } = await import("./tunnel.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeCfDns } = await import("../../test/fixture/remote.ts");
const { getPlatformSettings, reloadPlatformSettings, updatePlatformSettings } = await import("../api/platform-settings.ts");
const { reloadRegistry } = await import("../registry/records.ts");

const CLOUDFLARED = "/opt/homebrew/bin/cloudflared";
let cfDir: string;
let tunnel: InstanceType<typeof FakeTunnelDriver>;
let manager: InstanceType<typeof FakeServiceManager>;
let dns: InstanceType<typeof FakeCfDns>;
const opts = () => ({ cloudflaredDir: cfDir, gatewayPort: 7950, random: () => "abc123", resolveBin: () => CLOUDFLARED, sleep: async () => {} });

beforeEach(() => {
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  rmSync(join(dir, "tunnel.yml"), { force: true });
  process.env.HOME = mkdtempSync(join(tmpdir(), "domain-bind-home-"));
  reloadPlatformSettings();
  reloadRegistry();
  cfDir = mkdtempSync(join(tmpdir(), "domain-bind-cfdir-"));
  writeFileSync(join(cfDir, "cert.pem"), "x");
  tunnel = new FakeTunnelDriver(cfDir);
  manager = new FakeServiceManager();
  dns = new FakeCfDns();
});

test("identity is recorded before DNS or the service are touched", async () => {
  // A DNS failure after tunnel creation must leave the tunnel visible in deck.platform.
  dns.writeProxiedCname = async () => { throw new Error("cf down"); };
  await expect(bindDomain("example.dev", { tunnel, manager, dns }, opts())).rejects.toThrow("cf down");
  expect(getPlatformSettings().tunnel).toEqual({ name: expect.stringContaining("deck-edge-"), uuid: "fake-uuid-1" });
  expect(getPlatformSettings().publicDomain).toBeNull();
  expect(manager.installed.has(TUNNEL_LABEL)).toBe(false);
});

test("same-domain re-run reuses the recorded tunnel (creds present) and repairs a drifted config", async () => {
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  const first = getPlatformSettings().tunnel!;
  writeFileSync(join(dir, "tunnel.yml"), "corrupt");
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(200);
  expect(getPlatformSettings().tunnel).toEqual(first);
  expect(tunnel.calls.filter((c) => c[0] === "create")).toHaveLength(1);
  expect(readFileSync(join(dir, "tunnel.yml"), "utf8")).toContain(`tunnel: ${first.uuid}`);
});

test("recorded tunnel present at Cloudflare but creds missing: delete and recreate under the same name", async () => {
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  const first = getPlatformSettings().tunnel!;
  rmSync(join(cfDir, `${first.uuid}.json`));
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(200);
  expect(tunnel.calls).toContainEqual(["delete", first.name]);
  expect(getPlatformSettings().tunnel).toEqual({ name: first.name, uuid: "fake-uuid-2" });
  expect(dns.cname.get("*.example.dev")!.target).toBe("fake-uuid-2.cfargotunnel.com");
});

test("recorded tunnel absent from list() (deleted remotely): create under the recorded name", async () => {
  updatePlatformSettings({ tunnel: { name: "deck-edge-mbp-zzz999", uuid: "gone-uuid" }, publicDomain: "example.dev" });
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(200);
  expect(tunnel.calls).toContainEqual(["create", "deck-edge-mbp-zzz999"]);
  expect(tunnel.calls).not.toContainEqual(["delete", "deck-edge-mbp-zzz999"]);
  expect(getPlatformSettings().tunnel).toEqual({ name: "deck-edge-mbp-zzz999", uuid: "fake-uuid-1" });
});

test("an existing wildcard record is overwritten, not duplicated", async () => {
  await dns.writeProxiedCname("*.example.dev", "stale.cfargotunnel.com");
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(dns.cname.size).toBe(1);
  expect(dns.cname.get("*.example.dev")!.target).toBe("fake-uuid-1.cfargotunnel.com");
});
```

- [ ] **Step 3: Update `src/edge/domain.remote-guard.test.ts`**

Change the imports/fixtures to the new deps: import `FakeCfDns`, construct `dns = new FakeCfDns()` and `tunnel = new FakeTunnelDriver(cfDir)` in `beforeEach`. **Both existing tests** call `bindDomain(..., { tunnel: fakeTunnel, manager: fakeManager }, { cloudflaredDir: cfDir })` today; update BOTH call sites to `bindDomain(..., { tunnel: fakeTunnel, manager: fakeManager, dns }, { cloudflaredDir: cfDir, resolveBin: () => "/opt/homebrew/bin/cloudflared", sleep: async () => {} })`. This is not optional: `bindDomain` now calls `dns.tokenCanEditDns()` before the different-domain guard, so a call site without `dns` throws before the 409 the test asserts. Keep both tests' assertions, then append:

```ts
test("--force on a different-domain rebind runs unbind-then-bind and leaves no stranded old wildcard", async () => {
  const dns = new FakeCfDns();
  const r0 = await bindDomain("m4tthew.dev", { tunnel: fakeTunnel, manager: fakeManager, dns }, { cloudflaredDir: cfDir, random: () => "abc123", resolveBin: () => "/opt/homebrew/bin/cloudflared", sleep: async () => {} });
  expect(r0.status).toBe(200);
  const first = getPlatformSettings().tunnel!;
  putRecord({ name: "site", managedBy: "user", port: 3000, kind: "service", createdAt: new Date().toISOString(),
    remote: { target: "railway", serviceId: "svc", customDomain: "site.m4tthew.dev", status: "live" } });

  const refused = await bindDomain("other.dev", { tunnel: fakeTunnel, manager: fakeManager, dns }, { cloudflaredDir: cfDir, resolveBin: () => "/opt/homebrew/bin/cloudflared", sleep: async () => {} });
  expect(refused.status).toBe(409);

  const forced = await bindDomain("other.dev", { tunnel: fakeTunnel, manager: fakeManager, dns }, { cloudflaredDir: cfDir, force: true, random: () => "def456", resolveBin: () => "/opt/homebrew/bin/cloudflared", sleep: async () => {} });
  expect(forced.status).toBe(200);
  expect(fakeTunnel.calls).toContainEqual(["delete", first.name]);
  expect(dns.cname.has("*.m4tthew.dev")).toBe(false);
  expect(dns.cname.get("*.other.dev")!.target).toMatch(/cfargotunnel\.com$/);
  expect(getPlatformSettings().publicDomain).toBe("other.dev");
  expect(getPlatformSettings().tunnel!.name).not.toBe(first.name);
});
```

- [ ] **Step 4: Run the three files to verify they fail**

Run: `bun test src/edge/domain.test.ts src/edge/domain.bind.test.ts src/edge/domain.remote-guard.test.ts`
Expected: FAIL (old `bindDomain`).

- [ ] **Step 5: Rewrite `src/edge/domain.ts`**

```ts
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { TunnelDriver } from "./tunnel.ts";
import { renderTunnelConfig, writeTunnelConfig } from "./tunnel.ts";
import type { CfDns } from "./cf-dns.ts";
import { mintTunnelName, randomSuffix } from "./machine-key.ts";
import { LABEL_PREFIX, type ServiceManager, type ServiceSpec } from "../services/manager.ts";
import { composeServicePath, resolveProgram } from "../services/exec-env.ts";
import { getPlatformSettings, updatePlatformSettings, type TunnelIdentity } from "../api/platform-settings.ts";
import { logsDir, stateDir } from "../api/state.ts";
import { listRecords } from "../registry/records.ts";
import { getAppSettings } from "../../core/settings.ts";
import type { FlowResult } from "../api/register.ts";

export const TUNNEL_LABEL = `${LABEL_PREFIX}tunnel`;
export const EDGE_METRICS_PORT = 7951;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const CONNECTOR_POLLS = 5;
const CONNECTOR_POLL_MS = 3000;

export interface EdgeDeps { tunnel: TunnelDriver; manager: ServiceManager; dns: CfDns }
export interface EdgeOpts {
  gatewayPort?: number;
  cloudflaredDir?: string;
  force?: boolean;
  random?: () => string;
  resolveBin?: () => string | null;
  sleep?: (ms: number) => Promise<void>;
}

export function tunnelConfigPath(): string { return join(stateDir(), "tunnel.yml"); }
export function credentialsPath(cfDir: string, uuid: string): string { return join(cfDir, `${uuid}.json`); }
function defaultCfDir(): string { return join(homedir(), ".cloudflared"); }
export function resolveCloudflared(): string | null { return resolveProgram("cloudflared", composeServicePath()); }

// launchd does not search PATH for ProgramArguments[0]; the caller passes an absolute path.
export function tunnelServiceSpec(o: { configPath: string; cloudflaredBin: string }): ServiceSpec {
  return {
    label: TUNNEL_LABEL,
    programArguments: [o.cloudflaredBin, "tunnel", "--config", o.configPath, "run"],
    workingDirectory: stateDir(),
    environment: {},
    stdoutPath: join(logsDir(), "tunnel.out.log"),
    stderrPath: join(logsDir(), "tunnel.err.log"),
  };
}

export function expectedTunnelConfig(o: { uuid: string; domain: string; cfDir: string; gatewayPort: number }): string {
  return renderTunnelConfig({
    uuid: o.uuid, credentialsFile: credentialsPath(o.cfDir, o.uuid), domain: o.domain,
    gatewayPort: o.gatewayPort, metricsPort: EDGE_METRICS_PORT,
  });
}

export async function bindDomain(domain: string, deps: EdgeDeps, opts: EdgeOpts = {}): Promise<FlowResult> {
  if (!DOMAIN_RE.test(domain)) return { status: 400, body: { error: "bad domain" } };
  const cfDir = opts.cloudflaredDir ?? defaultCfDir();
  const bin = (opts.resolveBin ?? resolveCloudflared)();
  if (!bin) return { status: 400, body: { error: "cloudflared-missing", hint: "brew install cloudflared" } };
  // The guided flow checks the operator step; it never performs the browser login.
  if (!existsSync(join(cfDir, "cert.pem"))) {
    return { status: 428, body: { error: "cloudflared-login-required", command: "cloudflared tunnel login" } };
  }
  if (!(await deps.dns.tokenCanEditDns())) {
    return { status: 400, body: { error: "cf-token-needs-zone-dns", hint: "rt secrets set deck cfDnsToken (Zone.DNS:Edit)" } };
  }

  const current = getPlatformSettings().publicDomain;
  if (current && current !== domain) {
    const remoteApps = listRecords().filter((r) => r.remote).map((r) => r.name);
    if (remoteApps.length && !opts.force) return { status: 409, body: { error: "remote-apps-pinned-to-domain", apps: remoteApps } };
    const torn = await unbindDomain(deps, { force: true, cloudflaredDir: cfDir });
    if (torn.status !== 200) return torn;
  }

  const identity = await resolveTunnel(deps.tunnel, cfDir, opts.random ?? randomSuffix);
  updatePlatformSettings({ tunnel: identity });

  const gatewayPort = opts.gatewayPort ?? 7950;
  const configPath = tunnelConfigPath();
  writeTunnelConfig(configPath, {
    uuid: identity.uuid, credentialsFile: credentialsPath(cfDir, identity.uuid), domain, gatewayPort, metricsPort: EDGE_METRICS_PORT,
  });
  await deps.dns.writeProxiedCname(`*.${domain}`, `${identity.uuid}.cfargotunnel.com`);
  await deps.manager.install(tunnelServiceSpec({ configPath, cloudflaredBin: bin }));
  await deps.manager.kickstart(TUNNEL_LABEL);
  updatePlatformSettings({ publicDomain: domain });
  const connectors = await awaitConnector(deps.tunnel, identity.name, opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))));
  return { status: 200, body: { domain, tunnel: identity, connectors } };
}

// Edge registration takes a few seconds after kickstart; a bounded poll keeps a
// healthy bind from reporting zero connectors.
async function awaitConnector(tunnel: TunnelDriver, name: string, sleep: (ms: number) => Promise<void>): Promise<number> {
  let connectors = 0;
  for (let i = 0; i < CONNECTOR_POLLS; i++) {
    ({ connectors } = await tunnel.info(name));
    if (connectors > 0) break;
    if (i < CONNECTOR_POLLS - 1) await sleep(CONNECTOR_POLL_MS);
  }
  return connectors;
}

// Recreating under the recorded name is safe: the minted suffix makes it this
// deck's alone, never another machine's live tunnel.
async function resolveTunnel(tunnel: TunnelDriver, cfDir: string, random: () => string): Promise<TunnelIdentity> {
  const recorded = getPlatformSettings().tunnel;
  if (!recorded) {
    const name = mintTunnelName(random);
    const { uuid } = await tunnel.create(name);
    return { name, uuid };
  }
  const listed = (await tunnel.list()).find((t) => t.name === recorded.name);
  if (!listed) {
    const { uuid } = await tunnel.create(recorded.name);
    return { name: recorded.name, uuid };
  }
  if (existsSync(credentialsPath(cfDir, listed.uuid))) return { name: recorded.name, uuid: listed.uuid };
  await tunnel.delete(recorded.name);
  const { uuid } = await tunnel.create(recorded.name);
  return { name: recorded.name, uuid };
}

export async function unbindDomain(
  deps: { tunnel: TunnelDriver; manager: ServiceManager; dns: CfDns | null },
  opts: { force?: boolean; cloudflaredDir?: string } = {},
): Promise<FlowResult> {
  const { publicDomain, tunnel } = getPlatformSettings();
  if (!publicDomain && !tunnel) return { status: 200, body: { ok: true, alreadyUnbound: true } };
  const records = listRecords();
  const remoteApps = records.filter((r) => r.remote).map((r) => r.name);
  if (remoteApps.length && !opts.force) return { status: 409, body: { error: "remote-apps-pinned-to-domain", apps: remoteApps } };
  const served = records.filter((r) => !r.remote && getAppSettings(r.name).published).map((r) => r.name);
  if (served.length && !opts.force) return { status: 409, body: { error: "apps-will-go-offline", apps: served } };

  const cfDir = opts.cloudflaredDir ?? defaultCfDir();
  await deps.manager.uninstall(TUNNEL_LABEL);
  if (publicDomain && deps.dns) await deps.dns.deleteHostRecords(`*.${publicDomain}`);
  if (tunnel) {
    await deps.tunnel.delete(tunnel.name);
    rmSync(credentialsPath(cfDir, tunnel.uuid), { force: true });
  }
  rmSync(tunnelConfigPath(), { force: true });
  updatePlatformSettings({ publicDomain: null, tunnel: null });
  return { status: 200, body: { ok: true } };
}
```

Implementer note: confirm the published accessor's exact name/shape in `core/settings.ts` (it is the function `status.ts` imports as `getAppSettings`, whose entry carries `published ?? true`). If the accessor differs, use the one `status.ts` uses; the requirement is "published defaults true, read from the app settings store".

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/edge/domain.test.ts src/edge/domain.bind.test.ts src/edge/domain.remote-guard.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/edge/domain.ts src/edge/domain.test.ts src/edge/domain.bind.test.ts src/edge/domain.remote-guard.test.ts
git commit -m "domain: bind resolves + records the edge tunnel, upserts DNS, supervises the connector"
```

---

### Task 6: `unbindDomain` guards and partial-bind tolerance

**Files:**
- Modify: `src/edge/domain.ts` (already carries the body from Task 5; this task verifies it against the spec's matrix and adds nothing structural)
- Test: `src/edge/domain.unbind.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/edge/domain.unbind.test.ts` (same env preamble and `opts()` helper as `domain.bind.test.ts`, with `writeFileSync(join(cfDir, "cert.pem"), "x")` in `beforeEach`; imports it needs beyond that file's: `existsSync` from `fs`, `unbindDomain` and `tunnelConfigPath` from `./domain.ts`, `putRecord` from `../registry/records.ts`):

```ts
test("unbind with nothing bound is a no-op 200", async () => {
  const r = await unbindDomain({ tunnel, manager, dns }, { cloudflaredDir: cfDir });
  expect(r.status).toBe(200);
  expect((r.body as any).alreadyUnbound).toBe(true);
});

test("unbind happy path: uninstall, delete DNS, forced tunnel delete + creds, config, state", async () => {
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  const id = getPlatformSettings().tunnel!;
  const r = await unbindDomain({ tunnel, manager, dns }, { cloudflaredDir: cfDir, force: true });
  expect(r.status).toBe(200);
  expect(manager.installed.has(TUNNEL_LABEL)).toBe(false);
  expect(dns.cname.has("*.example.dev")).toBe(false);
  expect(tunnel.calls).toContainEqual(["delete", id.name]);
  expect(existsSync(join(cfDir, `${id.uuid}.json`))).toBe(false);
  expect(existsSync(tunnelConfigPath())).toBe(false);
  expect(getPlatformSettings()).toMatchObject({ publicDomain: null, tunnel: null });
});

test("unbind refuses while an app is remote, unless forced", async () => {
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  putRecord({ name: "site", managedBy: "user", port: 3000, kind: "service", createdAt: new Date().toISOString(),
    remote: { target: "railway", serviceId: "svc", customDomain: "site.example.dev", status: "live" } });
  const r = await unbindDomain({ tunnel, manager, dns }, { cloudflaredDir: cfDir });
  expect(r.status).toBe(409);
  expect((r.body as any).error).toBe("remote-apps-pinned-to-domain");
  expect((await unbindDomain({ tunnel, manager, dns }, { cloudflaredDir: cfDir, force: true })).status).toBe(200);
});

test("unbind lists tunnel-served apps that will go offline and requires force", async () => {
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  putRecord({ name: "blog", managedBy: "user", port: 3001, kind: "service", createdAt: new Date().toISOString() });
  const r = await unbindDomain({ tunnel, manager, dns }, { cloudflaredDir: cfDir });
  expect(r.status).toBe(409);
  expect((r.body as any)).toEqual({ error: "apps-will-go-offline", apps: ["blog"] });
});

test("unbind tolerates a partial bind (tunnel recorded, no domain): skips DNS, still removes the rest", async () => {
  updatePlatformSettings({ tunnel: { name: "deck-edge-mbp-abc123", uuid: "u-partial" } });
  writeFileSync(join(cfDir, "u-partial.json"), "{}");
  tunnel.tunnels.set("deck-edge-mbp-abc123", "u-partial");
  const r = await unbindDomain({ tunnel, manager, dns }, { cloudflaredDir: cfDir, force: true });
  expect(r.status).toBe(200);
  expect(dns.calls.some((c) => c.startsWith("delCname"))).toBe(false);
  expect(tunnel.calls).toContainEqual(["delete", "deck-edge-mbp-abc123"]);
  expect(existsSync(join(cfDir, "u-partial.json"))).toBe(false);
  expect(getPlatformSettings().tunnel).toBeNull();
});

test("unbind with no DNS driver (secrets unavailable) still removes local + tunnel state", async () => {
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  const r = await unbindDomain({ tunnel, manager, dns: null }, { cloudflaredDir: cfDir, force: true });
  expect(r.status).toBe(200);
  expect(getPlatformSettings().publicDomain).toBeNull();
});
```

- [ ] **Step 2: Run tests**

Run: `bun test src/edge/domain.unbind.test.ts`
Expected: PASS if Task 5's body is complete; FAIL on any branch it misses. Fix `unbindDomain` in `src/edge/domain.ts` until green. (If Task 5 shipped a stub, replace it with the full body shown in Task 5 Step 5.)

- [ ] **Step 3: Commit**

```bash
git add src/edge/domain.ts src/edge/domain.unbind.test.ts
git commit -m "domain: unbind guards on remote apps, lists apps going offline, tolerates a partial bind"
```

---

### Task 7: Edge health (metrics `/ready`) + `Health` widening + status row

**Files:**
- Create: `src/edge/edge-health.ts`
- Modify: `core/discover.ts` (`Health`), `src/api/status.ts` (`BuildStatusOpts.readyFetch`, tunnel row health)
- Test: `src/edge/edge-health.test.ts` (create), `src/api/status.tunnel.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export type EdgeState = "connected" | "disconnected" | "stopped" | "gone";
  export async function readReady(fetchImpl?: typeof fetch, port?: number): Promise<{ up: boolean; readyConnections: number }>;
  export function edgeState(i: { running: boolean; readyConnections: number; tunnelGone: boolean }): EdgeState;
  export function edgeHealthRow(state: EdgeState, readyConnections: number, domain: string | null): Health;
  export async function tunnelRowHealth(d: { running: boolean; tunnelGone: boolean; domain: string | null; fetchImpl?: typeof fetch }): Promise<Health>;
  export async function describeEdge(d: { installed: boolean; running: boolean; tunnelGone: boolean; domain: string | null; fetchImpl?: typeof fetch }): Promise<{ state: EdgeState | "not-installed"; readyConnections: number; detail: string; hint?: string }>;
  ```
- `Health` (core/discover.ts) gains `tone?: "ok" | "warn" | "bad"; detail?: string; hint?: string`.
- Consumes (Task 8 provides at runtime): `edgeDrift().tunnelGone`; until Task 8 lands, `status.ts` imports a placeholder from `edge-reconcile.ts`? No: to keep tasks independent, `status.ts` reads `tunnelGone` through an injectable `opts.edgeDrift?: () => { tunnelGone: boolean }` defaulting to `() => ({ tunnelGone: false })` in this task; Task 8 switches the default to the real getter.

- [ ] **Step 1: Write the failing tests**

Create `src/edge/edge-health.test.ts`:

```ts
import { expect, test } from "bun:test";
import { edgeState, edgeHealthRow, readReady, tunnelRowHealth } from "./edge-health.ts";

const ready = (status: number, n: number) => (async () => Response.json({ status, readyConnections: n, connectorId: "c" }, { status })) as unknown as typeof fetch;
const down = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;

test("readReady: 200 with connections is up; 503 is up but 0; refused is down", async () => {
  expect(await readReady(ready(200, 4), 7951)).toEqual({ up: true, readyConnections: 4 });
  expect(await readReady(ready(503, 0), 7951)).toEqual({ up: true, readyConnections: 0 });
  expect(await readReady(down, 7951)).toEqual({ up: false, readyConnections: 0 });
});

test("edgeState maps the spec table", () => {
  expect(edgeState({ running: true, readyConnections: 2, tunnelGone: false })).toBe("connected");
  expect(edgeState({ running: true, readyConnections: 0, tunnelGone: false })).toBe("disconnected");
  expect(edgeState({ running: false, readyConnections: 0, tunnelGone: false })).toBe("stopped");
  expect(edgeState({ running: true, readyConnections: 4, tunnelGone: true })).toBe("gone");
});

test("edgeHealthRow tones + hint", () => {
  expect(edgeHealthRow("connected", 4, "e.dev")).toMatchObject({ ok: true, tone: "ok", detail: "4 connections" });
  expect(edgeHealthRow("connected", 1, "e.dev").detail).toBe("1 connection");
  expect(edgeHealthRow("disconnected", 0, "e.dev")).toMatchObject({ ok: false, tone: "warn", detail: "not connected to Cloudflare" });
  expect(edgeHealthRow("stopped", 0, "e.dev")).toMatchObject({ ok: false, tone: "bad", detail: "stopped" });
  expect(edgeHealthRow("gone", 0, "e.dev")).toMatchObject({ ok: false, tone: "bad", detail: "tunnel missing at Cloudflare", hint: "re-run deck domain e.dev" });
});

test("tunnelRowHealth skips the metrics read when the process is not running", async () => {
  let called = false;
  const spy = (async () => { called = true; return Response.json({}); }) as unknown as typeof fetch;
  const h = await tunnelRowHealth({ running: false, tunnelGone: false, domain: "e.dev", fetchImpl: spy });
  expect(called).toBe(false);
  expect(h.tone).toBe("bad");
});
```

Create `src/api/status.tunnel.test.ts` (env preamble as in `src/api/status.test.ts`, plus `process.env.LOCAL_AGENTS_DIR = mkdtempSync(...)` BEFORE the import; write a plist named `com.mattstack.deck.tunnel.plist` whose `ProgramArguments` contain `cloudflared`; `launchctl list` will not know the label so `pid` is null, which is the "stopped" state):

```ts
test("the deck tunnel row carries edge health when a domain is bound", async () => {
  updatePlatformSettings({ publicDomain: "e.dev", tunnel: { name: "deck-edge-x-abc123", uuid: "u" } });
  const s = await buildStatus({ port: 1, canaryPort: 2, proxyFreshness: "unknown", autoHeal: null, readyFetch: (async () => Response.json({ status: 200, readyConnections: 3 })) as any });
  const row = s.orphans.find((r) => r.isTunnel)!;
  expect(row.service!.label).toBe("com.mattstack.deck.tunnel");
  expect(row.health).toMatchObject({ tone: "bad", detail: "stopped" });
});

test("no bound domain: the tunnel row keeps health null", async () => {
  const s = await buildStatus({ port: 1, canaryPort: 2, proxyFreshness: "unknown", autoHeal: null });
  expect(s.orphans.find((r) => r.isTunnel)!.health).toBeNull();
});
```

Implementer: the plist body can be produced with `renderPlist(tunnelServiceSpec({ configPath: "/x/tunnel.yml", cloudflaredBin: "/opt/homebrew/bin/cloudflared" }))` from `src/services/plist.ts` and written to `join(process.env.LOCAL_AGENTS_DIR, "com.mattstack.deck.tunnel.plist")`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/edge/edge-health.test.ts src/api/status.tunnel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`core/discover.ts`:

```ts
export interface Health {
  ok: boolean;
  status: number | null;
  ms: number | null;
  /** Edge rows only: a badge tone plus human text. App rows never set these. */
  tone?: "ok" | "warn" | "bad";
  detail?: string;
  hint?: string;
}
```

Create `src/edge/edge-health.ts`:

```ts
import type { Health } from "../../core/discover.ts";
import { EDGE_METRICS_PORT } from "./domain.ts";

export { EDGE_METRICS_PORT };
export type EdgeState = "connected" | "disconnected" | "stopped" | "gone";

// cloudflared answers /ready with 200 while it holds ready connections and 503 with
// readyConnections 0 otherwise; a refused socket means the process is not up.
export async function readReady(fetchImpl: typeof fetch = fetch, port = EDGE_METRICS_PORT): Promise<{ up: boolean; readyConnections: number }> {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(1000) });
    const body = (await res.json().catch(() => ({}))) as { readyConnections?: number };
    return { up: true, readyConnections: body.readyConnections ?? 0 };
  } catch {
    return { up: false, readyConnections: 0 };
  }
}

export function edgeState(i: { running: boolean; readyConnections: number; tunnelGone: boolean }): EdgeState {
  if (i.tunnelGone) return "gone";
  if (!i.running) return "stopped";
  return i.readyConnections >= 1 ? "connected" : "disconnected";
}

export function edgeHealthRow(state: EdgeState, readyConnections: number, domain: string | null): Health {
  const base = { status: null, ms: null };
  switch (state) {
    case "connected":
      return { ...base, ok: true, tone: "ok", detail: `${readyConnections} connection${readyConnections === 1 ? "" : "s"}` };
    case "disconnected":
      return { ...base, ok: false, tone: "warn", detail: "not connected to Cloudflare" };
    case "stopped":
      return { ...base, ok: false, tone: "bad", detail: "stopped" };
    case "gone":
      return { ...base, ok: false, tone: "bad", detail: "tunnel missing at Cloudflare", hint: `re-run deck domain ${domain ?? "<domain>"}` };
  }
}

interface EdgeProbe { running: boolean; tunnelGone: boolean; domain: string | null; fetchImpl?: typeof fetch }

// The metrics read is skipped when the process is down: nothing is listening.
async function probeEdge(d: EdgeProbe): Promise<{ state: EdgeState; readyConnections: number }> {
  const ready = d.running ? await readReady(d.fetchImpl) : { up: false, readyConnections: 0 };
  const state = edgeState({ running: d.running && ready.up, readyConnections: ready.readyConnections, tunnelGone: d.tunnelGone });
  return { state, readyConnections: ready.readyConnections };
}

export async function tunnelRowHealth(d: EdgeProbe): Promise<Health> {
  const { state, readyConnections } = await probeEdge(d);
  return edgeHealthRow(state, readyConnections, d.domain);
}

export async function describeEdge(d: EdgeProbe & { installed: boolean }) {
  if (!d.installed) return { state: "not-installed" as const, readyConnections: 0, detail: "tunnel service not installed" };
  const { state, readyConnections } = await probeEdge(d);
  const row = edgeHealthRow(state, readyConnections, d.domain);
  return { state, readyConnections, detail: row.detail ?? "", hint: row.hint };
}
```

`src/api/status.ts`: add to `BuildStatusOpts`:

```ts
  /** Fake `/ready` fetch for tests; production reads the connector's local metrics endpoint. */
  readyFetch?: typeof fetch;
  /** Drift flags from the edge reconcile loop; tests inject, production reads edgeDrift(). */
  edgeDrift?: () => { tunnelGone: boolean };
```

and in `buildStatus`, before `orphanRows`:

```ts
  const platform = getPlatformSettings();
  const edgeService = orphans.find((s) => s.label === TUNNEL_LABEL);
  const edgeHealth = edgeService && platform.tunnel
    ? await tunnelRowHealth({
        running: edgeService.pid !== null,
        tunnelGone: (opts.edgeDrift ?? (() => ({ tunnelGone: false })))().tunnelGone,
        domain: platform.publicDomain,
        fetchImpl: opts.readyFetch,
      })
    : null;
```

and in the orphan row: `health: s.label === TUNNEL_LABEL ? edgeHealth : null,` with imports `import { TUNNEL_LABEL } from "../edge/domain.ts"; import { tunnelRowHealth } from "../edge/edge-health.ts";`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/edge/edge-health.test.ts src/api/status.tunnel.test.ts src/api/status.test.ts src/api/status.remote.test.ts core/discover.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/discover.ts src/edge/edge-health.ts src/edge/edge-health.test.ts src/api/status.ts src/api/status.tunnel.test.ts
git commit -m "edge: connection health from the connector's metrics endpoint on the tunnel row"
```

---

### Task 8: `reconcileEdge` (own cadence, latch, drift flags) on the reconcile tick

**Files:**
- Create: `src/edge/edge-reconcile.ts`
- Modify: `core/reconcile.ts`, `src/api/status.ts` (default `edgeDrift` to the real getter)
- Test: `src/edge/edge-reconcile.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export const EDGE_LOCAL_INTERVAL_MS = 30_000;
  export const EDGE_CF_INTERVAL_MS = 10 * 60_000;
  export const EDGE_ERROR_BACKOFF_MS = 60_000;
  export interface EdgeReconcileDeps {
    tunnel: TunnelDriver; manager: ServiceManager;
    dns(): Promise<CfDns | null>;                 // null when the rt daemon / secrets are unavailable
    services(): Promise<LaunchdService[]>;         // readServices
    now(): number;
    cloudflaredDir: string; cloudflaredBin: string; gatewayPort: number;
  }
  export function edgeDrift(): { tunnelGone: boolean };
  /** Called after a successful bind/unbind: clears drift flags and makes the next tick run both passes immediately, so a fresh bind is not reported "tunnel missing" for up to EDGE_CF_INTERVAL_MS. */
  export function edgeBindingChanged(): void;
  export function resetEdgeReconcileForTests(): void;   // same as edgeBindingChanged plus inFlight = false
  export async function reconcileEdge(deps: EdgeReconcileDeps): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/edge/edge-reconcile.test.ts` (env preamble as in `domain.bind.test.ts`; bind first with fakes to seed state; `resetEdgeReconcileForTests()` in `beforeEach`; a `clock` object `{ t: 0, now: () => clock.t }`; `services` returns a `LaunchdService` for `TUNNEL_LABEL` with a settable `pid`):

```ts
function deps(over: Partial<EdgeReconcileDeps> = {}): EdgeReconcileDeps {
  return {
    tunnel, manager, dns: async () => dns, now: () => clock.t,
    services: async () => [{ label: TUNNEL_LABEL, plistPath: "", program: ["cloudflared"], workingDirectory: null, stderrPath: null, port: null, pid: running ? 1 : null, lastExitStatus: null }],
    cloudflaredDir: cfDir, cloudflaredBin: CLOUDFLARED, gatewayPort: 7950, ...over,
  };
}

test("no recorded binding is a no-op (no driver calls)", async () => {
  await reconcileEdge(deps());
  expect(tunnel.calls).toEqual([]); expect(dns.calls).toEqual([]);
});

test("a partial bind (tunnel, no domain) is left alone", async () => {
  updatePlatformSettings({ tunnel: { name: "n", uuid: "u" } });
  await reconcileEdge(deps());
  expect(manager.kickstarts).toEqual([]); expect(dns.calls).toEqual([]);
});

test("stopped service is kickstarted; an edited config is rewritten AND kickstarted", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts()); manager.kickstarts.length = 0;
  running = false;
  await reconcileEdge(deps());
  expect(manager.kickstarts).toEqual([TUNNEL_LABEL]);
  running = true; clock.t += EDGE_LOCAL_INTERVAL_MS; manager.kickstarts.length = 0;
  writeFileSync(tunnelConfigPath(), "hand edited");
  await reconcileEdge(deps());
  expect(readFileSync(tunnelConfigPath(), "utf8")).toContain("tunnel: fake-uuid-1");
  expect(manager.kickstarts).toEqual([TUNNEL_LABEL]);
});

test("a missing service is reinstalled", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts());
  manager.installed.clear();
  await reconcileEdge(deps());
  expect(manager.installed.has(TUNNEL_LABEL)).toBe(true);
});

test("local pass is throttled to EDGE_LOCAL_INTERVAL_MS and the CF pass to EDGE_CF_INTERVAL_MS", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts()); tunnel.calls.length = 0; dns.calls.length = 0;
  await reconcileEdge(deps());                       // first tick: local + CF
  expect(tunnel.calls).toEqual([["list"]]);
  expect(dns.calls).toContain("readCname:*.e.dev");
  tunnel.calls.length = 0; dns.calls.length = 0;
  clock.t += 5_000; await reconcileEdge(deps());     // too soon for anything
  expect(tunnel.calls).toEqual([]); expect(dns.calls).toEqual([]);
  clock.t += EDGE_LOCAL_INTERVAL_MS; await reconcileEdge(deps());   // local only
  expect(tunnel.calls).toEqual([]);
  clock.t += EDGE_CF_INTERVAL_MS; await reconcileEdge(deps());      // CF again
  expect(tunnel.calls).toEqual([["list"]]);
});

test("a deleted wildcard record is upserted back; a correct one is left alone", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts()); dns.calls.length = 0;
  dns.cname.delete("*.e.dev");
  await reconcileEdge(deps());
  expect(dns.cname.get("*.e.dev")!.target).toBe("fake-uuid-1.cfargotunnel.com");
  dns.calls.length = 0; clock.t += EDGE_CF_INTERVAL_MS;
  await reconcileEdge(deps());
  expect(dns.calls.some((c) => c.startsWith("cname:"))).toBe(false);
});

test("a tunnel absent from list() flips tunnelGone and is NOT recreated", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts());
  tunnel.tunnels.clear();
  await reconcileEdge(deps());
  expect(edgeDrift().tunnelGone).toBe(true);
  expect(tunnel.calls.filter((c) => c[0] === "create")).toHaveLength(1);
});

test("edgeBindingChanged clears the gone flag and the next tick runs the CF pass at once", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts());
  tunnel.tunnels.clear();
  await reconcileEdge(deps());
  expect(edgeDrift().tunnelGone).toBe(true);
  await bindDomain("e.dev", { tunnel, manager, dns }, opts());   // the operator's re-run recreates it
  edgeBindingChanged();
  expect(edgeDrift().tunnelGone).toBe(false);
  tunnel.calls.length = 0;
  clock.t += 1_000;                                                // well inside both intervals
  await reconcileEdge(deps());
  expect(tunnel.calls).toEqual([["list"]]);
  expect(edgeDrift().tunnelGone).toBe(false);
});

test("dns unavailable (rt daemon down) skips the CF pass without error and retries next time", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts()); tunnel.calls.length = 0;
  await reconcileEdge(deps({ dns: async () => null }));
  expect(tunnel.calls).toEqual([]);
  clock.t += EDGE_LOCAL_INTERVAL_MS;
  await reconcileEdge(deps());
  expect(tunnel.calls).toEqual([["list"]]);
});

test("a throwing pass backs off EDGE_ERROR_BACKOFF_MS and the latch prevents overlap", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts());
  const boom = deps({ services: async () => { throw new Error("launchctl"); } });
  await reconcileEdge(boom);
  clock.t += EDGE_LOCAL_INTERVAL_MS; manager.kickstarts.length = 0; running = false;
  await reconcileEdge(deps());                        // still inside the backoff window
  expect(manager.kickstarts).toEqual([]);
  clock.t += EDGE_ERROR_BACKOFF_MS;
  await reconcileEdge(deps());
  expect(manager.kickstarts).toEqual([TUNNEL_LABEL]);
  let resolveSlow!: () => void;
  const slow = deps({ services: () => new Promise((r) => { resolveSlow = () => r([]); }) });
  clock.t += EDGE_LOCAL_INTERVAL_MS;
  const p = reconcileEdge(slow);
  await reconcileEdge(deps());                        // overlapped call returns immediately
  resolveSlow(); await p;
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/edge/edge-reconcile.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/edge/edge-reconcile.ts`**

```ts
import { existsSync, readFileSync } from "fs";
import type { TunnelDriver } from "./tunnel.ts";
import { writeTunnelConfig } from "./tunnel.ts";
import type { CfDns } from "./cf-dns.ts";
import type { ServiceManager } from "../services/manager.ts";
import type { LaunchdService } from "../../core/discover.ts";
import { getPlatformSettings } from "../api/platform-settings.ts";
import { TUNNEL_LABEL, EDGE_METRICS_PORT, credentialsPath, expectedTunnelConfig, tunnelConfigPath, tunnelServiceSpec } from "./domain.ts";

export const EDGE_LOCAL_INTERVAL_MS = 30_000;
export const EDGE_CF_INTERVAL_MS = 10 * 60_000;
export const EDGE_ERROR_BACKOFF_MS = 60_000;

export interface EdgeReconcileDeps {
  tunnel: TunnelDriver;
  manager: ServiceManager;
  dns(): Promise<CfDns | null>;
  services(): Promise<LaunchdService[]>;
  now(): number;
  cloudflaredDir: string;
  cloudflaredBin: string;
  gatewayPort: number;
}

let inFlight = false;
let nextLocalAt = 0;
let nextCfAt = 0;
let drift = { tunnelGone: false };

export function edgeDrift(): { tunnelGone: boolean } { return drift; }
export function edgeBindingChanged(): void { nextLocalAt = 0; nextCfAt = 0; drift = { tunnelGone: false }; }
export function resetEdgeReconcileForTests(): void { inFlight = false; edgeBindingChanged(); }

// Never creates a tunnel or a DNS record from nothing: only deck domain binds.
export async function reconcileEdge(deps: EdgeReconcileDeps): Promise<void> {
  const { publicDomain, tunnel } = getPlatformSettings();
  if (!publicDomain || !tunnel) { drift = { tunnelGone: false }; return; }
  const now = deps.now();
  if (inFlight || now < nextLocalAt) return;
  inFlight = true;
  try {
    const configPath = tunnelConfigPath();
    const expected = expectedTunnelConfig({ uuid: tunnel.uuid, domain: publicDomain, cfDir: deps.cloudflaredDir, gatewayPort: deps.gatewayPort });
    let restart = false;
    if (!existsSync(configPath) || readFileSync(configPath, "utf8") !== expected) {
      writeTunnelConfig(configPath, { uuid: tunnel.uuid, credentialsFile: credentialsPath(deps.cloudflaredDir, tunnel.uuid), domain: publicDomain, gatewayPort: deps.gatewayPort, metricsPort: EDGE_METRICS_PORT });
      restart = true;
    }
    if (!(await deps.manager.isInstalled(TUNNEL_LABEL))) {
      await deps.manager.install(tunnelServiceSpec({ configPath, cloudflaredBin: deps.cloudflaredBin }));
      restart = true;
    }
    const svc = (await deps.services()).find((s) => s.label === TUNNEL_LABEL);
    if (restart || !svc || svc.pid === null) await deps.manager.kickstart(TUNNEL_LABEL);
    nextLocalAt = now + EDGE_LOCAL_INTERVAL_MS;

    if (now >= nextCfAt) {
      const dns = await deps.dns();
      if (dns) {
        const listed = await deps.tunnel.list();
        drift = { tunnelGone: !listed.some((t) => t.uuid === tunnel.uuid) };
        if (!drift.tunnelGone) {
          const host = `*.${publicDomain}`;
          const target = `${tunnel.uuid}.cfargotunnel.com`;
          if ((await dns.cnameTarget(host)) !== target) await dns.writeProxiedCname(host, target);
        }
        nextCfAt = now + EDGE_CF_INTERVAL_MS;
      }
    }
  } catch (err) {
    nextLocalAt = now + EDGE_ERROR_BACKOFF_MS;
    console.error("edge reconcile failed:", err);
  } finally {
    inFlight = false;
  }
}
```

- [ ] **Step 4: Wire the tick in `core/reconcile.ts`**

```ts
import { reconcileEdge } from "../src/edge/edge-reconcile.ts";
import { CloudflaredCli } from "../src/edge/tunnel.ts";
import { LaunchdManager } from "../src/services/launchd.ts";
import { readServices } from "./discover.ts";
import { homedir } from "os";
import { join } from "path";

// dns is a factory so the rt-daemon secrets read happens only when a CF pass is due.
async function edgeDns() {
  const s = await readDeckSecrets();
  const token = s.ok ? s.cfDnsToken ?? s.cfApiToken : undefined;
  return s.ok && s.cfZoneId && token ? new CfDnsApi({ zoneId: s.cfZoneId, token }) : null;
}

async function reconcileEdgeTick(): Promise<void> {
  const cloudflaredBin = resolveCloudflared();
  if (!cloudflaredBin) return;   // nothing to supervise without the binary; bind reports the install hint
  try {
    await reconcileEdge({
      tunnel: new CloudflaredCli(), manager: new LaunchdManager(), dns: edgeDns, services: () => readServices(),
      now: Date.now, cloudflaredDir: join(homedir(), ".cloudflared"), cloudflaredBin, gatewayPort: 7950,
    });
  } catch (err) {
    console.error("edge reconcile tick failed:", err);
  }
}
```

(`resolveCloudflared` is imported from `../src/edge/domain.ts`; it returns the absolute path launchd needs.)

and append `await reconcileEdgeTick();` at the end of `reconcileOnce()`.

In `src/api/status.ts`, change the `edgeDrift` default to the real getter: `(opts.edgeDrift ?? edgeDrift)()` with `import { edgeDrift } from "../edge/edge-reconcile.ts";`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/edge/edge-reconcile.test.ts core/reconcile.test.ts src/api/status.tunnel.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/edge/edge-reconcile.ts src/edge/edge-reconcile.test.ts core/reconcile.ts src/api/status.ts
git commit -m "edge: self-heal the tunnel service, config and wildcard DNS on a throttled tick"
```

---

### Task 9: API routes, CLI verbs, and `deck uninstall` teardown

**Files:**
- Modify: `src/api/server.ts`, `src/cli/commands.ts`, `src/cli/setup.ts`, `src/main.ts`, `src/api/register.ts` (`Drivers.tunnel?`)
- Modify test: `src/api/server.test.ts` (domain tests)
- Create test: `src/cli/commands.domain.test.ts`

**Interfaces:**
- `GET /api/v1/domain` -> `{ domain: string | null, tunnel: TunnelIdentity | null, partial: boolean, edge: { state, readyConnections, detail, hint? } | null }`
- `POST /api/v1/domain/bind` body `{ domain: string, force?: boolean }` -> `bindDomain` result
- `POST /api/v1/domain/unbind` body `{ force?: boolean }` -> `unbindDomain` result
- Both POSTs answer `400 { error: "cf-secrets-required", hint }` when `readDeckSecrets` yields no zone id or DNS-capable token.
- CLI: `deck domain` (show), `deck domain <domain> [--force]`, `deck domain unbind [--force]`.

- [ ] **Step 1: Update `src/api/server.test.ts`**

Add these to `domainServer`'s `startApi` deps (all three, so the route never reaches the real daemon, Cloudflare, or PATH): `dns: new FakeCfDns()`, `resolveCloudflared: () => "/opt/homebrew/bin/cloudflared"`, and `tunnel: new FakeTunnelDriver(domainCfDir)` (creds files land in the cf dir). The `dns` dep short-circuits `edgeDns`, so no `deckSecrets` stand-in is needed. Replace the domain test with:

```ts
test("domain flow: bind, show reports identity + edge, unbind clears", async () => {
  const domainApi = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${DOMAIN_PORT}${path}`, init);
  const before = await (await domainApi("/api/v1/domain")).json();
  expect(before).toMatchObject({ domain: null, tunnel: null, edge: null });

  writeFileSync(join(domainCfDir, "cert.pem"), "x");
  const bind = await domainApi("/api/v1/domain/bind", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "example.dev" }) });
  expect(bind.status).toBe(200);
  const shown = await (await domainApi("/api/v1/domain")).json();
  expect(shown.domain).toBe("example.dev");
  expect(shown.tunnel.name).toMatch(/^deck-edge-/);
  expect(shown.edge.state).toBe("stopped"); // fake manager installs without a pid

  const refused = await domainApi("/api/v1/domain/unbind", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  expect([200, 409]).toContain(refused.status); // 409 apps-will-go-offline when the suite has records; 200 otherwise
  const unbind = await domainApi("/api/v1/domain/unbind", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: true }) });
  expect(unbind.status).toBe(200);
  expect((await (await domainApi("/api/v1/domain")).json()).domain).toBeNull();
});
```

- [ ] **Step 2: Create `src/cli/commands.domain.test.ts`**

Follow `src/cli/commands.test.ts`'s pattern for the env preamble and for pointing the CLI at a test API on a free port, but enumerate the `startApi` deps explicitly so nothing reaches the real rt daemon or Cloudflare: `dns: new FakeCfDns()`, `tunnel: new FakeTunnelDriver(cfDir)`, `cloudflaredDir: cfDir`, `resolveCloudflared: () => "/opt/homebrew/bin/cloudflared"`, plus the `manager`/`edge`/`freshness`/`autoHeal`/`onRouteWrite` fakes that test already passes. (The `dns` dep short-circuits `edgeDns`, so no `deckSecrets` stand-in is needed.) Then:

```ts
test("deck domain (show) prints no edge bound; bind prints the domain; unbind refuses then forces", async () => {
  const out: string[] = [], err: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
  expect(await runCommand(["domain"], io)).toBe(0);
  expect(out.join("\n")).toContain("no edge bound");
  writeFileSync(join(cfDir, "cert.pem"), "x");
  expect(await runCommand(["domain", "example.dev"], io)).toBe(0);
  expect(out.join("\n")).toContain("bound example.dev");
  expect(await runCommand(["domain"], io)).toBe(0);
  expect(out.join("\n")).toContain("deck-edge-");
  out.length = 0;
  expect(await runCommand(["domain", "unbind", "--force"], io)).toBe(0);
  expect(out.join("\n")).toContain("unbound");
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `bun test src/api/server.test.ts src/cli/commands.domain.test.ts`
Expected: FAIL (routes/verbs missing; `domainServer` compile errors).

- [ ] **Step 4: Implement the routes in `src/api/server.ts`**

Replace the two existing domain routes with:

```ts
        if (pathname === "/api/v1/domain" && req.method === "GET") {
          const s = getPlatformSettings();
          const installed = await deps.manager.isInstalled(TUNNEL_LABEL);
          const svc = (await readServices()).find((x) => x.label === TUNNEL_LABEL);
          const edge = s.tunnel
            ? await describeEdge({ installed, running: !!svc && svc.pid !== null, tunnelGone: edgeDrift().tunnelGone, domain: s.publicDomain, fetchImpl: deps.readyFetch })
            : null;
          return json({ domain: s.publicDomain, tunnel: s.tunnel, partial: !!s.tunnel && !s.publicDomain, edge });
        }
        if (pathname === "/api/v1/domain/bind" && req.method === "POST") {
          const b = await body(req);
          const dns = await edgeDns(deps);
          if (!dns) return json({ error: "cf-secrets-required", hint: "rt secrets set deck cfZoneId / cfDnsToken" }, 400);
          const r = await bindDomain(String(b.domain ?? ""), { tunnel: deps.tunnel, manager: deps.manager, dns }, {
            gatewayPort: 7950, cloudflaredDir: deps.cloudflaredDir, force: b.force === true, resolveBin: deps.resolveCloudflared,
          });
          if (r.status === 200) edgeBindingChanged();
          return json(r.body, r.status);
        }
        if (pathname === "/api/v1/domain/unbind" && req.method === "POST") {
          const b = await body(req);
          const r = await unbindDomain({ tunnel: deps.tunnel, manager: deps.manager, dns: await edgeDns(deps) }, { force: b.force === true, cloudflaredDir: deps.cloudflaredDir });
          if (r.status === 200) edgeBindingChanged();
          return json(r.body, r.status);
        }
```

with a module-level helper and two new optional `ApiDeps` fields:

```ts
/** DNS driver for the edge routes, or null when the deck secrets do not carry a zone id and a DNS-capable token. */
async function edgeDns(deps: ApiDeps): Promise<CfDns | null> {
  if (deps.dns) return deps.dns;
  const s = await readDeckSecrets(deps.deckSecrets);
  const token = s.ok ? s.cfDnsToken ?? s.cfApiToken : undefined;
  return s.ok && s.cfZoneId && token ? new CfDnsApi({ zoneId: s.cfZoneId, token }) : null;
}
```
```ts
  /** Fake `/ready` fetch for tests; production reads the connector's local metrics endpoint. */
  readyFetch?: typeof fetch;
  /** Tests inject an absolute fake path; production resolves cloudflared on the service PATH. */
  resolveCloudflared?: () => string | null;
```

Imports: `bindDomain, unbindDomain, TUNNEL_LABEL` from `../edge/domain.ts`; `describeEdge` from `../edge/edge-health.ts`; `edgeDrift, edgeBindingChanged` from `../edge/edge-reconcile.ts`; `readServices` from `../../core/discover.ts`; `CfDnsApi, type CfDns` from `../edge/cf-dns.ts`. Pass `readyFetch: deps.readyFetch` and `edgeDrift` through `statusOpts` too. The test `domainServer` sets `resolveCloudflared: () => "/opt/homebrew/bin/cloudflared"`.

- [ ] **Step 5: Implement the CLI verb in `src/cli/commands.ts`**

Replace the `case "domain"` body:

```ts
      case "domain": {
        const force = rest.includes("--force");
        const [arg] = rest.filter((a) => a !== "--force");
        if (!arg) {
          const { body } = await apiJson("/api/v1/domain");
          if (!body.tunnel && !body.domain) { io.out("no edge bound. bind one with: deck domain <domain>"); return 0; }
          io.out(`domain: ${body.domain ?? "(none: partial bind, run deck domain <domain> or deck domain unbind)"}`);
          if (body.tunnel) io.out(`tunnel: ${body.tunnel.name} (${body.tunnel.uuid})`);
          if (body.edge) io.out(`edge: ${body.edge.state} (${body.edge.detail})${body.edge.hint ? ` ... ${body.edge.hint}` : ""}`);
          return 0;
        }
        if (arg === "unbind") {
          const { status, body } = await apiJson("/api/v1/domain/unbind", { method: "POST", body: JSON.stringify({ force }) });
          if (status === 409 && body.error === "apps-will-go-offline") {
            io.err(`unbinding takes these apps offline: ${body.apps.join(", ")}`);
            io.err("re-run with --force to confirm.");
            return 1;
          }
          if (status === 409) { io.err(`${body.error}: ${(body.apps ?? []).join(", ")} (re-run with --force)`); return 1; }
          if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
          io.out("unbound: the tunnel, its DNS record and launchd service are gone");
          return 0;
        }
        io.out("DNS writes need a Cloudflare token with Zone.DNS:Edit: rt secrets set deck cfDnsToken (and: rt secrets set deck cfZoneId)");
        const { status, body } = await apiJson("/api/v1/domain/bind", { method: "POST", body: JSON.stringify({ domain: arg, force }) });
        if (status === 428) { io.err(`One step first: run \`${body.command}\`, then re-run this.`); return 1; }
        if (status === 409) { io.err(`${body.error}: ${(body.apps ?? []).join(", ")} (re-run with --force to rebind anyway)`); return 1; }
        if (status !== 200) { io.err(`${body.error ?? `failed (${status})`}${body.hint ? ` (${body.hint})` : ""}`); return 1; }
        const connectors = body.connectors > 0 ? `${body.connectors} connector${body.connectors === 1 ? "" : "s"}` : "connector still starting, check deck domain in a moment";
        io.out(`bound ${body.domain} via ${body.tunnel.name} (${connectors}) ... every published app is now https://<name>.${body.domain}`);
        return 0;
      }
```

Update `USAGE`:

```
  deck domain                              show the bound domain, tunnel identity and edge health
  deck domain <domain> [--force]           bind your own domain (cloudflared wildcard tunnel + DNS)
  deck domain unbind [--force]             tear the edge down (tunnel, DNS record, launchd service)
```

Update the existing domain test in `src/cli/commands.test.ts` ("domain verb no longer prompts for or persists a CF token", around line 122): its output assertions must match the new hint line (assert it contains `rt secrets set deck cfDnsToken` and `cfZoneId`; drop the `cfApiToken` / `--stdin` expectations), and give that test's `startApi` the same explicit deps as Step 2 (`dns: new FakeCfDns()`, `resolveCloudflared: () => "/opt/homebrew/bin/cloudflared"`, a scratch `cloudflaredDir` with NO `cert.pem`) so its "bind deterministically 428s" claim holds regardless of this machine's daemon and PATH.

- [ ] **Step 6: `deck uninstall` teardown**

`src/api/register.ts` `Drivers`: add `tunnel?: TunnelDriver;` (import the type from `../edge/tunnel.ts`).

`src/main.ts` uninstall branch: build `drivers = { manager: new LaunchdManager(), edge: new PortlessCli(), tunnel: new CloudflaredCli(), dns: await uninstallDns() }` where `uninstallDns` mirrors `edgeDns` above (best-effort: returns `undefined` when secrets are unavailable).

`src/cli/setup.ts`: add `import { unbindDomain } from "../edge/domain.ts";` at the top, then in `uninstall`, after the self-record teardown and before the api.json removal:

```ts
  if (drivers.tunnel) {
    try {
      const r = await unbindDomain({ tunnel: drivers.tunnel, manager: drivers.manager, dns: drivers.dns ?? null }, { force: true });
      if (r.status === 200 && !(r.body as { alreadyUnbound?: boolean }).alreadyUnbound) io.out("edge unbound: tunnel, DNS record and launchd service removed");
    } catch {
      // best-effort teardown; uninstall must not get stuck on a driver failure
    }
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test src/api/server.test.ts src/cli/commands.domain.test.ts src/cli/commands.test.ts src/cli/setup.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/api/server.ts src/api/server.test.ts src/cli/commands.ts src/cli/commands.domain.test.ts src/cli/setup.ts src/main.ts src/api/register.ts
git commit -m "deck domain: show/bind/unbind verbs and routes; uninstall tears the edge down"
```

---

### Task 10: Board health tones (badge + tunnel drawer strip)

**Files:**
- Modify: `core/board/logic.ts` (StatusRow health widening), `core/board/Board.tsx` (`TunnelBadge`), `core/board/drawer/RootScreen.tsx` (`TunnelStatusStrip`), `test/fixture/status.json` (tunnel row health)
- Regenerate: `core/generated/board.{js,css}`

- [ ] **Step 1: Widen the board's `StatusRow.health`** in `core/board/logic.ts`:

```ts
  health: { ok: boolean; status: number | null; ms: number | null; tone?: "ok" | "warn" | "bad"; detail?: string; hint?: string } | null;
```

- [ ] **Step 2: `TunnelBadge` reads health when present**

In `core/board/Board.tsx` replace the intent/label derivation:

```ts
  const health = tunnels[0]?.health ?? null;
  const up = tunnels.every((t) => t.service && t.service.pid !== null);
  const intent = restarting ? "warn" : health?.tone ?? (up ? "ok" : "bad");
  const label = restarting ? "restarting…" : health?.detail ?? (up ? "up" : "down");
  const tip = health?.hint ? `${tunnels.map((t) => t.name).join(", ")} · ${health.hint}` : tunnels.map((t) => t.name).join(", ");
```

and use `tip` in the `Tooltip`.

- [ ] **Step 3: `TunnelStatusStrip` does the same** in `core/board/drawer/RootScreen.tsx`:

```ts
  const health = row.health;
  const intent = health?.tone ?? (up ? "ok" : "bad");
  const parts = [health?.detail ?? (up ? "up" : "down")];
  if (row.service && pid !== null) parts.push(`running pid ${pid}`);
  else if (row.service?.lastExitStatus != null) parts.push(`exit ${row.service.lastExitStatus}`);
  if (health?.hint) parts.push(health.hint);
```

(keep the `restarting` early return; use `intent` for the `StatusDot`).

Behavior note, intentional: `core/board/logic.ts` restart detection (`healthy = row.health ? row.health.ok : pid !== null`) now keys the tunnel row on connection state rather than pid, so the "restarting…" spinner persists until the connector is back (still bounded by the existing stuck timeout). That is the correct signal for a tunnel; do not special-case it back to pid.

- [ ] **Step 4: Fixture** `test/fixture/status.json`: on the orphan tunnel row set

```json
      "health": { "ok": true, "status": null, "ms": null, "tone": "ok", "detail": "4 connections" },
```

- [ ] **Step 5: Rebuild + verify**

Run: `bun run build:board && bun test core/generated-fresh.test.ts core/board-assets.test.ts`
Expected: PASS. Then `bun run test:dom 2>&1 | grep -E "^\(fail\)|[0-9]+ pass|[0-9]+ fail"` and confirm the failure list is exactly the 8 pre-existing ones (no new entries).

- [ ] **Step 6: Commit**

```bash
git add core/board/logic.ts core/board/Board.tsx core/board/drawer/RootScreen.tsx test/fixture/status.json core/generated/board.js core/generated/board.css
git commit -m "board: tunnel badge and drawer strip follow real edge health"
```

---

### Task 11: Docs + full sweep

**Files:**
- Modify: `README.md` (line 37 area), `docs/superpowers/specs/2026-08-30-deck-public-edge-tunnel-design.md` (status line)

- [ ] **Step 1: README**

Replace the `deck domain` bullet with:

```md
- your own domain: `deck domain yourdomain.dev` creates and owns a wildcard Cloudflare tunnel (`*.yourdomain.dev` -> the local gateway), writes the DNS record, supervises the connector and records its identity; `deck domain` shows the bound domain, tunnel and live edge health; `deck domain unbind` tears it all down (refuses while apps are served from Railway, warns about apps that go offline; `--force` overrides). Needs `cloudflared` plus a one-time `cloudflared tunnel login`, and `rt secrets set deck cfZoneId` / `cfDnsToken` (Zone.DNS:Edit). Then per-app gates: a password, a Google sign-in list of people or domains, or both
```

- [ ] **Step 2: Spec status** -> `**Status:** Implemented (see docs/superpowers/plans/2026-08-30-deck-public-edge-tunnel.md)`.

- [ ] **Step 3: Full scoped sweep**

Run: `bun run test`
Expected: all green except nothing (the freshness guard included). If `bun run test` reports a failure in a file this plan did not touch, stop and report it rather than editing that file.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-08-30-deck-public-edge-tunnel-design.md
git commit -m "docs: deck domain bind/show/unbind"
```

---

### Task 12: Migration apply on this machine (HUMAN-GATED, not for subagents)

**Not an agentic task.** This touches Matt's live Cloudflare account and launchd. It runs only after the branch is merged to `main`, deployed (`bun run deploy` from `~/Documents/GitHub/deck` on `main`), and Matt says go. Record the outcome in the SDD ledger, not in code.

Facts verified on 2026-08-30 (read-only probes):
- The CF tunnel behind `*.m4tthew.dev` is named **`mr-board`** (id `824c14f0-50cb-491e-8b94-f7ab5bdedf34`); `m4tthew-apps-tunnel` is only the local yml/plist name.
- A stale **`local-edge`** tunnel (id `aedec841-af14-4bec-869d-c6b010896e9b`, 0 connections) from an earlier `deck domain` attempt is also on the account.
- `publicDomain` is already `m4tthew.dev`; `cert.pem` exists; deck secrets carry `cfZoneId` + `cfDnsToken`.

Order (bind first, remove second; the wildcard record flips between two targets that both reach gateway:7950):

1. `deck domain m4tthew.dev` ... expect `bound m4tthew.dev via deck-edge-<key>-<suffix> (N connectors)`. Verify: `curl -sI https://training.m4tthew.dev` is 200, `deck domain` shows `connected`, the board badge is back.
2. `launchctl unload ~/Library/LaunchAgents/com.matthewgoodwin.m4tthew-apps-tunnel.plist && rm ~/Library/LaunchAgents/com.matthewgoodwin.m4tthew-apps-tunnel.plist ~/.cloudflared/m4tthew-apps-tunnel.yml`. Re-verify step 1's curl.
3. Delete the dead `mrs.m4tthew.dev` record (a one-off `CfDnsApi.deleteHostRecords("mrs.m4tthew.dev")` script from the scratchpad using the deck secrets, or the Cloudflare dashboard).
4. `cloudflared tunnel delete -f mr-board` and `cloudflared tunnel delete -f local-edge`; remove their `~/.cloudflared/<id>.json` creds files.
5. Confirm `launchctl list | grep cloudflared` shows only `com.mattstack.deck.tunnel` (the token-run tunnel at pid 1005 belongs to a different product and is out of scope; leave it).

Rollback if step 1 fails after the DNS flip: `cloudflared tunnel route dns --overwrite-dns mr-board '*.m4tthew.dev'` restores the old target while the old launchd service is still running (it is not removed until step 2).
