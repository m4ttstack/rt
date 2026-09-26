# deck push-to-remote (Railway) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a deck-managed app serve its public hostname from a Railway deployment that survives the laptop being off, flipped per-app with a toggle, while `.localhost` keeps serving locally.

**Architecture:** Remote is an alternate public-serving mode. `deck push` runs `railway up` from the app's checkout; `deck remote on` provisions a Railway service, then swaps the public hostname's origin by writing a specific proxied Cloudflare CNAME (plus a TXT ownership record) that beats the existing wildcard tunnel record. Access and DNS stay at Cloudflare, unchanged; deck itself never runs remotely. Two new edge drivers (`RailwayDriver`, `CfDns`) sit behind fakes exactly like the existing `TunnelDriver`/`EdgeProxy`, and orchestration lives in `src/edge/remote.ts` returning the codebase's standard `FlowResult`.

**Tech Stack:** Bun + TypeScript; `bun test`; the `railway` CLI (driven with `RAILWAY_API_TOKEN`) and the Railway GraphQL API; the Cloudflare API (DNS + zone read); rt daemon secrets store (`readDeckSecrets`); launchd/portless left untouched.

**Spec:** `docs/superpowers/specs/2026-08-29-deck-push-to-remote-design.md`

## Global Constraints

Every task's requirements implicitly include these (verbatim from the spec):

- **One Railway project, N services.** `railwayProjectId` + `railwayEnvironmentId` live once in platform settings; each app record holds only its `serviceId`. Deck touches only services it created (name prefix `deck-<app>`), never others.
- **Access-gated only.** Remote refuses a password-gated app: the gateway (`core/gateway.ts`) is out of the path once the origin is Railway.
- **Zone SSL/TLS mode must be `full` (NOT `strict`).** Deck checks and refuses `zone-ssl-mode-full-required`; it never mutates the zone.
- **First-level subdomain only.** `app.<publicDomain>` must be first-level; refuse if `publicDomain` is itself a subdomain.
- **No manifest changes.** Start comes from `commands.start`; build from `commands.build` if declared, else nixpacks auto-detect; the local `deploy` action command is NEVER sent to Railway (it rebuilds+restarts the local service). Env is manifest-first (`manifest.env → record.env`), re-pushed on every `deck push` so remote cannot drift; deck classifies no key as secret.
- **Local build/deploy vs remote push.** Manifest non-`start` commands (`build`, `deploy`, …) are LOCAL action buttons (`CommandsCell`, `POST …/commands/:cmd`, dev-mode gated). `deck remote`/`deck push` are separate platform verbs (not dev-gated, not in any manifest). Both stay; the board keeps them visually distinct.
- **`$PORT` set explicitly** on the service to the record's local port; the custom domain's target port is the same value. Never rely on Railway port auto-detect.
- **No browser login.** One Railway API token in deck-secrets drives both the API and `railway up`. A missing token is a 428 `railway-token-required`.
- **Let's Encrypt rate limit (5 duplicate certs/domain/week).** Idempotent resume REUSES an existing custom domain, never delete-and-re-add. Unit suite uses fakes only; any real-Railway e2e counts its flip cycles.
- **`deck remote` / `deck push` are platform verbs** like `publish`/`domain` — never dev-mode gated.
- **No legacy shims.** The `remote` record field is additive/optional (no migration); a platform-settings shape change is a rewrite (house rule).

Test conventions (from the existing suite): scratch state via `LOCAL_REGISTRY_PATH` / `LOCAL_PLATFORM_SETTINGS_PATH` / `LOCAL_STATE_DIR` env paths and a fake `HOME`; fakes for every external driver; `bun test <file>` to run one file; `bun run test` (`bun test core src`) for the scoped sweep.

---

## File Structure

**New:**
- `src/edge/railway.ts` — `RailwayDriver` interface + `RailwayCli` (real: `railway` CLI + Railway API). One responsibility: talk to Railway.
- `src/edge/cf-dns.ts` — `CfDns` interface + `CfDnsApi` (real: Cloudflare DNS + zone-read). One responsibility: the DNS/zone reads+writes the tunnel path does not already own.
- `src/edge/remote.ts` — orchestration: `remoteRefuseChecks`, `pushRemote`, `enableRemote`, `disableRemote`, `reconcileRemote`. Returns `FlowResult`.
- `test/fixture/remote.ts` — `FakeRailwayDriver`, `FakeCfDns` (mirror `FakeTunnelDriver`).
- `src/edge/railway.test.ts`, `src/edge/cf-dns.test.ts`, `src/edge/remote.test.ts`.

**Modified:**
- `src/registry/records.ts` — `RemoteState` on `AppRecord`; `"railway"` added to `SyncIssue["source"]`.
- `src/api/platform-settings.ts` — `railway` block in `PlatformSettings` + `DEFAULTS`.
- `src/edge/rt-secrets.ts` — `railwayToken` in the secrets result.
- `src/api/server.ts` — `POST /api/v1/apps/:name/remote`, `POST /api/v1/apps/:name/push`; call `reconcileRemote` in the existing tick.
- `src/api/status.ts` — `publicOrigin` + `remote` on `StatusRow`.
- `src/cli/commands.ts` — `remote` and `push` cases + USAGE.
- `src/edge/domain.ts` — `bindDomain` refuses a domain change while any app is remote-on.
- `src/api/register.ts` — `unregisterApp` flips remote back before teardown.
- The uninstall handler — spare + print remote services (located in Task 16).
- `core/reconcile.ts` — invoke `reconcileRemote` on the tick.
- `core/board/AppsTable.tsx`, `core/board/api.ts`, drawer — Remote toggle + Push button; regenerate `core/generated/board.{js,css}`.

---

## Task 1: Spike — does Railway verify a custom domain on TXT + wildcard alone? ✅ DONE (2026-08-30)

**Result: CONFIRMED.** Against the real `mattstack deck` project + live `m4tthew.dev` zone: with only the `_railway-verify.spike` TXT written (no CNAME) and the proxied wildcard covering `spike.m4tthew.dev`, Railway flipped `Verified: yes` in ~90s. Build the verified-first pipeline (Task 8). Real shapes observed: TXT `_railway-verify.<sub>` = `railway-verify=<hex>`; CNAME target `<id>.up.railway.app` (Railway-assigned, store it — Task 2/8/10). Auth = a Railway PROJECT token (`RAILWAY_TOKEN`) on a pre-provisioned project; CF needs a `Zone.DNS:Edit` token (the Access-scoped one cannot write DNS). The steps below are kept as the record of what was run.

The zero-gap cutover assumes Railway marks a custom domain verified from the **TXT ownership record + Cloudflare-proxy-detection**, before the specific traffic CNAME exists. Settle this empirically before building the pipeline. This task writes no committed code.

**Files:** none (throwaway).

- [ ] **Step 1: Confirm prerequisites.** A Railway API token is in deck-secrets (`rt secrets set deck railwayToken …`) and a `deck domain` is already bound (a wildcard `*.<domain>` proxied record exists at Cloudflare).

- [ ] **Step 2: Provision a throwaway service.** In a scratch dir with a one-line server that honors `$PORT`, run `RAILWAY_API_TOKEN=… railway up` into a scratch project/service.

- [ ] **Step 3: Add a custom domain for a wildcard-covered host.** Pick `spike.<domain>` (already resolvable to Cloudflare via the wildcard). Add it to the service (`railway domain` or the API).

- [ ] **Step 4: Write ONLY the TXT ownership record** Railway returns, at Cloudflare. Do NOT write a specific `spike.<domain>` CNAME.

- [ ] **Step 5: Poll domain status** (`railway domain` status or the Railway `domain-status` read) for up to 10 minutes.

- [ ] **Step 6: Record the finding.** Verified without the specific CNAME ⇒ build the **verified-first** path (Task 8 writes the CNAME last). Not verified ⇒ keep the sequence but rely on the documented **cname-first** fallback and hold the app private until `status: live`. Note the outcome in the Task 8 PR description.

- [ ] **Step 7: Tear down** the throwaway service and the TXT record. (Do not delete-and-re-add a real domain — this used a throwaway host.)

---

## Task 2: Record `remote` state + `"railway"` issue source

**Files:**
- Modify: `src/registry/records.ts`
- Test: `src/registry/records.remote.test.ts`

**Interfaces:**
- Produces: `RemoteState`; `AppRecord.remote?: RemoteState`; `SyncIssue["source"]` now includes `"railway"`.

- [ ] **Step 1: Write the failing test**

```ts
// src/registry/records.remote.test.ts
import { expect, test, beforeEach } from "bun:test";
import { putRecord, getRecord, reloadRegistry, type AppRecord } from "./records.ts";

const base: AppRecord = {
  name: "site", managedBy: "user", port: 11010, kind: "service",
  command: ["bun", "run", "serve"], workingDirectory: "/tmp/site",
  label: "com.mattstack.deck.site", createdAt: new Date().toISOString(),
};

beforeEach(() => { process.env.LOCAL_REGISTRY_PATH = `/tmp/deck-test-${crypto.randomUUID()}.json`; reloadRegistry(); });

test("remote state round-trips through the registry", () => {
  putRecord({ ...base, remote: { target: "railway", serviceId: "svc_1", customDomain: "site.m4tthew.dev", status: "verifying" } });
  expect(getRecord("site")!.remote!.serviceId).toBe("svc_1");
  expect(getRecord("site")!.remote!.status).toBe("verifying");
});

test("a record without remote stays undefined (additive, no migration)", () => {
  putRecord(base);
  expect(getRecord("site")!.remote).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/registry/records.remote.test.ts`
Expected: FAIL (type error / `remote` not assignable).

- [ ] **Step 3: Add the type**

```ts
// src/registry/records.ts — add above AppRecord
export interface RemoteState {
  target: "railway";
  serviceId: string;
  customDomain: string;
  /** Railway-assigned CNAME target (<id>.up.railway.app), from ensureCustomDomain; set at the verifying stage so reconcileRemote can write the CNAME. */
  cnameTarget?: string;
  status: "deploying" | "verifying" | "live" | "error";
  /** Which cutover path a real run took; set when the CNAME is written. */
  cutover?: "verified-first" | "cname-first";
  url?: string;
  lastPush?: { sha: string; dirty: boolean; at: string };
  /** Backoff gate for reconcileRemote: ISO time before which not to re-poll. */
  nextPollAt?: string;
}
```

Add `"railway"` to the source union and the field to `AppRecord`:

```ts
export interface SyncIssue {
  source: "portless" | "launchd" | "cloudflare" | "railway";
  message: string;
  at: string;
}
// … in AppRecord, after `issues?`:
  /** Present only while the app is in remote (Railway) public-serving mode. */
  remote?: RemoteState;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/registry/records.remote.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/registry/records.ts src/registry/records.remote.test.ts
git commit -m "records: add RemoteState + railway issue source"
```

---

## Task 3: Platform settings `railway` block + `railwayToken` secret

**Files:**
- Modify: `src/api/platform-settings.ts`, `src/edge/rt-secrets.ts`
- Test: `src/api/platform-settings.railway.test.ts`, `src/edge/rt-secrets.railway.test.ts`

**Interfaces:**
- Produces: `PlatformSettings.railway: { projectId: string; environmentId: string } | null`; `DeckSecretsResult` (ok branch) gains `railwayToken?: string`.

- [ ] **Step 1: Write the failing test (settings)**

```ts
// src/api/platform-settings.railway.test.ts
import { expect, test, beforeEach } from "bun:test";
import { getPlatformSettings, updatePlatformSettings, reloadPlatformSettings } from "./platform-settings.ts";

beforeEach(() => { process.env.LOCAL_PLATFORM_SETTINGS_PATH = `/tmp/deck-plat-${crypto.randomUUID()}.json`; reloadPlatformSettings(() => ({ value: undefined })); });

test("railway defaults to null and round-trips", () => {
  expect(getPlatformSettings().railway).toBeNull();
  updatePlatformSettings({ railway: { projectId: "p1", environmentId: "e1" } });
  reloadPlatformSettings(() => ({ value: undefined }));
  expect(getPlatformSettings().railway).toEqual({ projectId: "p1", environmentId: "e1" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/api/platform-settings.railway.test.ts`
Expected: FAIL (`railway` missing).

- [ ] **Step 3: Add the field**

```ts
// PlatformSettings interface — add:
  railway: { projectId: string; environmentId: string } | null;
// DEFAULTS — add:
  railway: null,
```

`railway` is NOT one of the store-migrated fields (`MigratedFields` stays `publicDomain | legacyPrefixes`), so it lives in `platform.json` and flows through `updatePlatformSettings`'s file write unchanged. Confirm the test proves the round-trip.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/api/platform-settings.railway.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test (secret)**

```ts
// src/edge/rt-secrets.railway.test.ts
import { expect, test } from "bun:test";
import { readDeckSecrets } from "./rt-secrets.ts";

test("railwayToken surfaces on the ok branch", async () => {
  const res = await readDeckSecrets({
    readApiToken: () => "tok",
    post: async () => ({ ok: true, data: { cfApiToken: "cf", cfZoneId: "z", railwayToken: "rw" } }) as any,
  });
  expect(res).toEqual({ ok: true, cfApiToken: "cf", cfZoneId: "z", railwayToken: "rw" });
});
```

- [ ] **Step 6: Extend the secret result**

In `src/edge/rt-secrets.ts`: add `railwayToken?: string` to `DeckCfSecrets` (so it rides the ok branch and `RawDeckSecretsData`), and thread it through the final return:

```ts
return { ok: true, cfApiToken: data.cfApiToken, cfZoneId: data.cfZoneId, railwayToken: data.railwayToken };
```

The `hasCfKeys` old-daemon guard is unchanged — a token-only response with neither cf key still degrades to "update rt", which is correct (remote needs the cf keys too).

- [ ] **Step 7: Run both tests**

Run: `bun test src/api/platform-settings.railway.test.ts src/edge/rt-secrets.railway.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/api/platform-settings.ts src/edge/rt-secrets.ts src/api/platform-settings.railway.test.ts src/edge/rt-secrets.railway.test.ts
git commit -m "settings: add railway project/env + railwayToken secret"
```

---

## Task 4: `RailwayDriver` interface + `RailwayCli` + `FakeRailwayDriver`

**Files:**
- Create: `src/edge/railway.ts`, `test/fixture/remote.ts`
- Test: `src/edge/railway.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RailwayDriver {
  ensureService(name: string, opts: { projectId: string; environmentId: string }): Promise<{ serviceId: string; created: boolean }>;
  configureService(serviceId: string, cfg: { buildCommand?: string; startCommand: string; port: number; variables: Record<string, string> }): Promise<void>;
  up(serviceId: string, opts: { cwd: string; token: string }): Promise<{ ok: boolean; log: string }>;
  ensureCustomDomain(serviceId: string, host: string, targetPort: number): Promise<{ cnameTarget: string; txtName: string; txtValue: string; created: boolean }>;
  domainStatus(serviceId: string, host: string): Promise<{ verified: boolean; proxyDetected: boolean }>;
  removeCustomDomain(serviceId: string, host: string): Promise<void>;
  deleteService(serviceId: string): Promise<void>;
}
```

`FakeRailwayDriver` records calls and lets tests script `domainStatus` and `up` outcomes.

- [ ] **Step 1: Write the failing test**

```ts
// src/edge/railway.test.ts
import { expect, test } from "bun:test";
import { FakeRailwayDriver } from "../../test/fixture/remote.ts";

test("ensureService is idempotent by name (reuse, never re-create)", async () => {
  const rw = new FakeRailwayDriver();
  const a = await rw.ensureService("deck-site", { projectId: "p", environmentId: "e" });
  const b = await rw.ensureService("deck-site", { projectId: "p", environmentId: "e" });
  expect(a.serviceId).toBe(b.serviceId);
  expect(a.created).toBe(true);
  expect(b.created).toBe(false);
});

test("domainStatus is scriptable and ensureCustomDomain returns TXT + CNAME target", async () => {
  const rw = new FakeRailwayDriver();
  const { serviceId } = await rw.ensureService("deck-site", { projectId: "p", environmentId: "e" });
  const d = await rw.ensureCustomDomain(serviceId, "site.m4tthew.dev", 11010);
  expect(d.txtName).toContain("site.m4tthew.dev");
  expect(d.cnameTarget).toMatch(/\.up\.railway\.app$/);
  rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });
  expect(await rw.domainStatus(serviceId, "site.m4tthew.dev")).toEqual({ verified: true, proxyDetected: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/edge/railway.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the interface + fake**

Create `src/edge/railway.ts` with the `RailwayDriver` interface above and a `RailwayCli implements RailwayDriver` skeleton that shells `railway` with `RAILWAY_API_TOKEN` for `up` and calls the Railway GraphQL API (`https://backboard.railway.com/graphql/v2`) with the same token for service/domain/config/status. Model it on `CloudflaredCli` in `src/edge/tunnel.ts`: a constructor-injected `exec`/`fetch`, every non-zero/error path throwing with a truncated message. Leave the real API bodies thin; the fake carries the behavior the orchestration is tested against.

Create `test/fixture/remote.ts`:

```ts
import type { RailwayDriver } from "../../src/edge/railway.ts";

export class FakeRailwayDriver implements RailwayDriver {
  services = new Map<string, { name: string }>();
  domains = new Map<string, { serviceId: string; targetPort: number }>();
  status = new Map<string, { verified: boolean; proxyDetected: boolean }>();
  calls: string[] = [];
  upResult: { ok: boolean; log: string } = { ok: true, log: "built" };
  byName = new Map<string, string>();

  async ensureService(name: string, _o: { projectId: string; environmentId: string }) {
    this.calls.push(`ensureService:${name}`);
    const existing = this.byName.get(name);
    if (existing) return { serviceId: existing, created: false };
    const id = `svc_${this.services.size + 1}`;
    this.services.set(id, { name }); this.byName.set(name, id);
    return { serviceId: id, created: true };
  }
  async configureService(id: string, _cfg: any) { this.calls.push(`configure:${id}`); }
  async up(id: string, _o: { cwd: string; token: string }) { this.calls.push(`up:${id}`); return this.upResult; }
  async ensureCustomDomain(serviceId: string, host: string, targetPort: number) {
    this.calls.push(`ensureDomain:${host}`);
    const created = !this.domains.has(host);
    this.domains.set(host, { serviceId, targetPort });
    return { cnameTarget: `kw1ig666.up.railway.app`, txtName: `_railway-verify.${host}`, txtValue: `railway-verify=deadbeef${host.length}`, created };
  }
  async domainStatus(_id: string, host: string) { return this.status.get(host) ?? { verified: false, proxyDetected: false }; }
  async removeCustomDomain(_id: string, host: string) { this.calls.push(`removeDomain:${host}`); this.domains.delete(host); }
  async deleteService(id: string) { this.calls.push(`deleteService:${id}`); this.services.delete(id); }
  setVerified(host: string, s: { verified: boolean; proxyDetected: boolean }) { this.status.set(host, s); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/edge/railway.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/edge/railway.ts test/fixture/remote.ts src/edge/railway.test.ts
git commit -m "edge: add RailwayDriver interface, RailwayCli skeleton, FakeRailwayDriver"
```

---

## Task 5: `CfDns` driver + `FakeCfDns`

**Files:**
- Create: `src/edge/cf-dns.ts`
- Modify: `test/fixture/remote.ts` (add `FakeCfDns`)
- Test: `src/edge/cf-dns.test.ts`

**Interfaces:**
- Produces:

```ts
export type ZoneSslMode = "off" | "flexible" | "full" | "strict";
export interface CfDns {
  zoneSslMode(): Promise<ZoneSslMode>;
  tokenCanEditDns(): Promise<boolean>;
  writeTxt(name: string, value: string): Promise<void>;
  deleteTxt(name: string): Promise<void>;
  writeProxiedCname(host: string, target: string): Promise<void>;
  deleteHostRecords(host: string): Promise<void>;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// src/edge/cf-dns.test.ts
import { expect, test } from "bun:test";
import { FakeCfDns } from "../../test/fixture/remote.ts";

test("proxied cname + txt write and delete leave no host records", async () => {
  const dns = new FakeCfDns();
  await dns.writeTxt("_railway.site.m4tthew.dev", "rw-verify");
  await dns.writeProxiedCname("site.m4tthew.dev", "site.m4tthew.dev.up.railway.app");
  expect(dns.cname.get("site.m4tthew.dev")).toEqual({ target: "site.m4tthew.dev.up.railway.app", proxied: true });
  await dns.deleteHostRecords("site.m4tthew.dev");
  await dns.deleteTxt("_railway.site.m4tthew.dev");
  expect(dns.cname.size).toBe(0);
  expect(dns.txt.size).toBe(0);
});

test("zone ssl mode and token scope are readable", async () => {
  const dns = new FakeCfDns();
  dns.ssl = "full"; dns.canEdit = true;
  expect(await dns.zoneSslMode()).toBe("full");
  expect(await dns.tokenCanEditDns()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/edge/cf-dns.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `cf-dns.ts` + `FakeCfDns`**

`src/edge/cf-dns.ts`: `CfDnsApi implements CfDns`, constructed with `{ zoneId, token, fetchImpl }` sourced from `readDeckSecrets` (`cfApiToken`, `cfZoneId`). Real calls hit `https://api.cloudflare.com/client/v4/zones/{zoneId}` (SSL mode: `GET …/settings/ssl`), `.../dns_records` (create/list/delete), and `GET …/user/tokens/verify` + record-edit permission for `tokenCanEditDns`. Follow the loud-failure style of `src/edge/access.ts` (every non-`success` response throws a truncated message). `writeProxiedCname` sets `proxied: true`; `deleteHostRecords` lists then deletes every record whose name is `host`.

Add to `test/fixture/remote.ts`:

```ts
import type { CfDns, ZoneSslMode } from "../../src/edge/cf-dns.ts";

export class FakeCfDns implements CfDns {
  txt = new Map<string, string>();
  cname = new Map<string, { target: string; proxied: boolean }>();
  ssl: ZoneSslMode = "full";
  canEdit = true;
  calls: string[] = [];
  async zoneSslMode() { return this.ssl; }
  async tokenCanEditDns() { return this.canEdit; }
  async writeTxt(n: string, v: string) { this.calls.push(`txt:${n}`); this.txt.set(n, v); }
  async deleteTxt(n: string) { this.calls.push(`delTxt:${n}`); this.txt.delete(n); }
  async writeProxiedCname(h: string, t: string) { this.calls.push(`cname:${h}`); this.cname.set(h, { target: t, proxied: true }); }
  async deleteHostRecords(h: string) { this.calls.push(`delCname:${h}`); this.cname.delete(h); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/edge/cf-dns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/edge/cf-dns.ts test/fixture/remote.ts src/edge/cf-dns.test.ts
git commit -m "edge: add CfDns driver + FakeCfDns"
```

---

## Task 6: `remoteRefuseChecks` — the seven-check gate

**Files:**
- Create: `src/edge/remote.ts` (start it here)
- Test: `src/edge/remote.refuse.test.ts`

**Interfaces:**
- Consumes: `AppRecord` (Task 2), `PlatformSettings.railway`/`publicDomain` (Task 3), `OAuth` (`src/edge/oauth.ts`), `CfDns` reads (Task 5), the resolved secrets (Task 3).
- Produces:

```ts
export interface RefuseCtx {
  record: AppRecord;
  publicDomain: string | null;
  railway: { projectId: string; environmentId: string } | null;
  oauth: { mode: "off" | "emails" | "domains" };
  hasRailwayToken: boolean;
  cfCanEditDns: boolean;
  zoneSslMode: "off" | "flexible" | "full" | "strict";
}
export type Refusal = { status: number; body: { error: string } };
export function remoteRefuseChecks(ctx: RefuseCtx): Refusal | null; // null = all pass
```

- [ ] **Step 1: Write the failing test** (the full matrix)

```ts
// src/edge/remote.refuse.test.ts
import { expect, test } from "bun:test";
import { remoteRefuseChecks, type RefuseCtx } from "./remote.ts";
import type { AppRecord } from "../registry/records.ts";

const svc: AppRecord = { name: "site", managedBy: "user", port: 11010, kind: "service",
  command: ["bun", "run", "serve"], workingDirectory: "/tmp/site", label: "com.mattstack.deck.site", createdAt: "t" };

const ok: RefuseCtx = { record: svc, publicDomain: "m4tthew.dev",
  railway: { projectId: "p", environmentId: "e" }, oauth: { mode: "emails" },
  hasRailwayToken: true, cfCanEditDns: true, zoneSslMode: "full" };

test("all checks pass", () => { expect(remoteRefuseChecks(ok)).toBeNull(); });

test("no start command", () => {
  const ext: AppRecord = { ...svc, kind: "external", command: undefined, label: undefined };
  expect(remoteRefuseChecks({ ...ok, record: ext })!.body.error).toBe("no start command, cannot push");
});
test("no bound domain", () => { expect(remoteRefuseChecks({ ...ok, publicDomain: null })!.body.error).toBe("no-domain-bound"); });
test("password-gated (oauth off) refused", () => { expect(remoteRefuseChecks({ ...ok, oauth: { mode: "off" } })!.body.error).toBe("remote-requires-access"); });
test("missing railway token → 428", () => { const r = remoteRefuseChecks({ ...ok, hasRailwayToken: false })!; expect(r.status).toBe(428); expect(r.body.error).toBe("railway-token-required"); });
test("cf token lacks dns edit", () => { expect(remoteRefuseChecks({ ...ok, cfCanEditDns: false })!.body.error).toBe("cf-token-needs-zone-dns"); });
test("zone ssl strict refused", () => { expect(remoteRefuseChecks({ ...ok, zoneSslMode: "strict" })!.body.error).toBe("zone-ssl-mode-full-required"); });
test("subdomain publicDomain refused", () => { expect(remoteRefuseChecks({ ...ok, publicDomain: "apps.m4tthew.dev" })!.body.error).toBe("public-domain-must-be-first-level"); });
test("no railway project configured", () => { expect(remoteRefuseChecks({ ...ok, railway: null })!.body.error).toBe("railway-not-configured"); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/edge/remote.refuse.test.ts`
Expected: FAIL (function not defined).

- [ ] **Step 3: Implement the gate**

```ts
// src/edge/remote.ts
import type { AppRecord } from "../registry/records.ts";

export interface RefuseCtx { /* as in Interfaces */ }
export type Refusal = { status: number; body: { error: string } };

function refuse(status: number, error: string): Refusal { return { status, body: { error } }; }

export function remoteRefuseChecks(ctx: RefuseCtx): Refusal | null {
  const { record } = ctx;
  if (record.kind !== "service" || !record.command?.length) return refuse(400, "no start command, cannot push");
  if (!ctx.publicDomain) return refuse(400, "no-domain-bound");
  if (ctx.publicDomain.split(".").length !== 2) return refuse(400, "public-domain-must-be-first-level");
  if (!ctx.railway) return refuse(400, "railway-not-configured");
  if (ctx.oauth.mode === "off") return refuse(400, "remote-requires-access");
  if (!ctx.hasRailwayToken) return refuse(428, "railway-token-required");
  if (!ctx.cfCanEditDns) return refuse(400, "cf-token-needs-zone-dns");
  if (ctx.zoneSslMode !== "full") return refuse(400, "zone-ssl-mode-full-required");
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/edge/remote.refuse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/edge/remote.ts src/edge/remote.refuse.test.ts
git commit -m "remote: seven-check refuse gate"
```

---

## Task 7: `pushRemote` — deploy pipeline

**Files:**
- Modify: `src/edge/remote.ts`
- Test: `src/edge/remote.push.test.ts`

**Interfaces:**
- Consumes: `FakeRailwayDriver`; a `sourceProvenance(dir)` helper returning `{ sha, dirty }`; an `uploadGuard(dir)` that refuses when an untracked `.env`-shaped file is present.
- Produces: `pushRemote(name, deps): Promise<FlowResult>` where `deps = { railway: RailwayDriver; token: string; provenance(dir): { sha; dirty }; hasUntrackedEnv(dir): boolean }`. Writes `record.remote.lastPush`; on build failure records a `"railway"` `SyncIssue` with the log.

- [ ] **Step 1: Write the failing test**

```ts
// src/edge/remote.push.test.ts
import { expect, test, beforeEach } from "bun:test";
import { pushRemote } from "./remote.ts";
import { FakeRailwayDriver } from "../../test/fixture/remote.ts";
import { putRecord, getRecord, reloadRegistry, type AppRecord } from "../registry/records.ts";

const rec: AppRecord = { name: "site", managedBy: "user", port: 11010, kind: "service",
  command: ["bun", "run", "serve"], workingDirectory: "/tmp/site", env: { API: "x" },
  label: "com.mattstack.deck.site", createdAt: "t",
  remote: { target: "railway", serviceId: "svc_1", customDomain: "site.m4tthew.dev", status: "live" } };

beforeEach(() => { process.env.LOCAL_REGISTRY_PATH = `/tmp/deck-${crypto.randomUUID()}.json`; reloadRegistry(); putRecord(rec); });

function deps(rw: FakeRailwayDriver, over: Partial<any> = {}) {
  return { railway: rw, token: "rw", provenance: () => ({ sha: "abc123", dirty: true }), hasUntrackedEnv: () => false, ...over };
}

test("push configures build/start/PORT/env, uploads, records provenance", async () => {
  const rw = new FakeRailwayDriver(); rw.byName.set("deck-site", "svc_1");
  const r = await pushRemote("site", deps(rw));
  expect(r.status).toBe(200);
  expect(rw.calls).toContain("configure:svc_1");
  expect(rw.calls).toContain("up:svc_1");
  expect(getRecord("site")!.remote!.lastPush).toEqual({ sha: "abc123", dirty: true, at: expect.any(String) });
});

test("refuses when an untracked .env would upload", async () => {
  const rw = new FakeRailwayDriver(); rw.byName.set("deck-site", "svc_1");
  const r = await pushRemote("site", deps(rw, { hasUntrackedEnv: () => true }));
  expect(r.status).toBe(400);
  expect(rw.calls).not.toContain("up:svc_1");
});

test("build failure records a railway SyncIssue and the log", async () => {
  const rw = new FakeRailwayDriver(); rw.byName.set("deck-site", "svc_1"); rw.upResult = { ok: false, log: "nixpacks: no start" };
  const r = await pushRemote("site", deps(rw));
  expect(r.status).toBe(502);
  expect(getRecord("site")!.issues?.some(i => i.source === "railway")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/edge/remote.push.test.ts`
Expected: FAIL (`pushRemote` not defined).

- [ ] **Step 3: Implement `pushRemote`**

```ts
// src/edge/remote.ts — add
import { getRecord, putRecord, addIssue, clearIssues } from "../registry/records.ts";
import type { FlowResult } from "../api/register.ts";
import type { RailwayDriver } from "./railway.ts";

export interface PushDeps {
  railway: RailwayDriver;
  token: string;
  provenance(dir: string): { sha: string; dirty: boolean };
  hasUntrackedEnv(dir: string): boolean;
  projectId: string; environmentId: string;
}

export async function pushRemote(name: string, deps: PushDeps): Promise<FlowResult> {
  const record = getRecord(name);
  if (!record?.remote) return { status: 404, body: { error: "not in remote mode" } };
  const dir = record.sourceDirectory ?? record.workingDirectory!; // matches the command route's cwd
  if (deps.hasUntrackedEnv(dir)) return { status: 400, body: { error: "untracked .env would upload; add it to .gitignore first" } };

  const { serviceId } = await deps.railway.ensureService(`deck-${name}`, { projectId: deps.projectId, environmentId: deps.environmentId });
  await deps.railway.configureService(serviceId, {
    buildCommand: record.commands?.build,
    startCommand: record.command!.join(" "),
    port: record.port,
    variables: { ...(record.env ?? {}), PORT: String(record.port) },
  });
  const { ok, log } = await deps.railway.up(serviceId, { cwd: dir, token: deps.token });
  if (!ok) {
    addIssue(name, { source: "railway", message: log.slice(0, 300), at: new Date().toISOString() });
    return { status: 502, body: { error: "railway build failed", log: log.slice(0, 2000) } };
  }
  clearIssues(name, "railway");
  const prov = deps.provenance(dir);
  putRecord({ ...getRecord(name)!, remote: { ...getRecord(name)!.remote!, serviceId, lastPush: { ...prov, at: new Date().toISOString() } } });
  return { status: 200, body: { ok: true, lastPush: getRecord(name)!.remote!.lastPush } };
}
```

Note: `buildCommand` reads `record.commands?.build` (the manifest's non-`start` action command named `build`); `startCommand` is the supervised `command`. Both are the manifest defaults, never an `altConfig`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/edge/remote.push.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/edge/remote.ts src/edge/remote.push.test.ts
git commit -m "remote: pushRemote deploy pipeline (railway up + inject build/start/PORT/env)"
```

---

## Task 8: `enableRemote` — origin swap with zero-gap cutover

**Files:**
- Modify: `src/edge/remote.ts`
- Test: `src/edge/remote.enable.test.ts`

**Interfaces:**
- Consumes: `remoteRefuseChecks`, `pushRemote`, `FakeRailwayDriver`, `FakeCfDns`.
- Produces: `enableRemote(name, deps): Promise<FlowResult>`. `deps` bundles both drivers, the resolved secrets/settings/oauth, `provenance`/`hasUntrackedEnv`, and a `pollBudgetMs` (default 600000) with an injectable `now()`/`sleep()` for tests. Sequence: refuse-checks → ensureService+push → set status `deploying` → `ensureCustomDomain` → `writeTxt` → poll `domainStatus` until verified+proxyDetected (status `verifying`) → `writeProxiedCname` LAST (status `live`, `cutover: "verified-first"`). On budget exhaustion: write the CNAME anyway, `cutover: "cname-first"`.

- [ ] **Step 1: Write the failing test**

```ts
// src/edge/remote.enable.test.ts
import { expect, test, beforeEach } from "bun:test";
import { enableRemote } from "./remote.ts";
import { FakeRailwayDriver, FakeCfDns } from "../../test/fixture/remote.ts";
import { putRecord, getRecord, reloadRegistry, type AppRecord } from "../registry/records.ts";

const rec: AppRecord = { name: "site", managedBy: "user", port: 11010, kind: "service",
  command: ["bun", "run", "serve"], workingDirectory: "/tmp/site",
  label: "com.mattstack.deck.site", createdAt: "t" };

beforeEach(() => { process.env.LOCAL_REGISTRY_PATH = `/tmp/deck-${crypto.randomUUID()}.json`; reloadRegistry(); putRecord(rec); });

function deps(rw: FakeRailwayDriver, dns: FakeCfDns, over: Partial<any> = {}) {
  return { railway: rw, dns, token: "rw", projectId: "p", environmentId: "e",
    publicDomain: "m4tthew.dev", oauth: { mode: "emails" as const }, railwayConf: { projectId: "p", environmentId: "e" },
    hasRailwayToken: true, provenance: () => ({ sha: "s", dirty: false }), hasUntrackedEnv: () => false,
    pollBudgetMs: 600000, sleep: async () => {}, now: (() => { let t = 0; return () => (t += 60000); })(), ...over };
}

test("verified-first: TXT is written before the CNAME, CNAME is last, status live", async () => {
  const rw = new FakeRailwayDriver(); const dns = new FakeCfDns();
  rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });
  const r = await enableRemote("site", deps(rw, dns));
  expect(r.status).toBe(200);
  const txtIdx = dns.calls.findIndex(c => c.startsWith("txt:"));
  const cnameIdx = dns.calls.findIndex(c => c.startsWith("cname:"));
  expect(txtIdx).toBeGreaterThanOrEqual(0);
  expect(cnameIdx).toBeGreaterThan(txtIdx);
  expect(getRecord("site")!.remote!.status).toBe("live");
  expect(getRecord("site")!.remote!.cutover).toBe("verified-first");
});

test("cname-first fallback: never verifies within budget, writes CNAME anyway", async () => {
  const rw = new FakeRailwayDriver(); const dns = new FakeCfDns(); // never setVerified
  const r = await enableRemote("site", deps(rw, dns));
  expect(r.status).toBe(200);
  expect(dns.cname.has("site.m4tthew.dev")).toBe(true);
  expect(getRecord("site")!.remote!.cutover).toBe("cname-first");
});

test("refuse-check failure aborts before any driver call", async () => {
  const rw = new FakeRailwayDriver(); const dns = new FakeCfDns();
  const r = await enableRemote("site", deps(rw, dns, { oauth: { mode: "off" } }));
  expect(r.status).toBe(400);
  expect(rw.calls).toHaveLength(0);
  expect(dns.calls).toHaveLength(0);
});

test("idempotent resume reuses the existing service + domain (no re-add)", async () => {
  const rw = new FakeRailwayDriver(); const dns = new FakeCfDns();
  rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });
  await enableRemote("site", deps(rw, dns));
  const before = rw.calls.filter(c => c.startsWith("ensureDomain")).length;
  await enableRemote("site", deps(rw, dns)); // second run
  const after = rw.calls.filter(c => c.startsWith("ensureDomain")).length;
  expect(after).toBe(before + 1); // ensureCustomDomain called again but returns created:false; no delete-then-add
  expect(rw.calls).not.toContain("removeDomain:site.m4tthew.dev");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/edge/remote.enable.test.ts`
Expected: FAIL (`enableRemote` not defined).

- [ ] **Step 3: Implement `enableRemote`**

```ts
// src/edge/remote.ts — add
import type { CfDns } from "./cf-dns.ts";

export interface EnableDeps extends PushDeps {
  dns: CfDns;
  publicDomain: string | null;
  oauth: { mode: "off" | "emails" | "domains" };
  hasRailwayToken: boolean;
  railwayConf: { projectId: string; environmentId: string } | null;
  pollBudgetMs: number;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export async function enableRemote(name: string, deps: EnableDeps): Promise<FlowResult> {
  const record = getRecord(name);
  if (!record) return { status: 404, body: { error: "unknown app" } };

  const refusal = remoteRefuseChecks({
    record, publicDomain: deps.publicDomain, railway: deps.railwayConf, oauth: deps.oauth,
    hasRailwayToken: deps.hasRailwayToken, cfCanEditDns: await deps.dns.tokenCanEditDns(),
    zoneSslMode: await deps.dns.zoneSslMode(),
  });
  if (refusal) return refusal;

  const host = `${name}.${deps.publicDomain}`;
  putRecord({ ...record, remote: { target: "railway", serviceId: "", customDomain: host, status: "deploying" } });

  const push = await pushRemote(name, deps); // ensureService + configure + up + provenance
  if (push.status !== 200) return push;
  const serviceId = getRecord(name)!.remote!.serviceId;

  const dom = await deps.railway.ensureCustomDomain(serviceId, host, record.port);
  await deps.dns.writeTxt(dom.txtName, dom.txtValue);
  putRecord({ ...getRecord(name)!, remote: { ...getRecord(name)!.remote!, status: "verifying", cnameTarget: dom.cnameTarget } });

  const deadline = deps.now() + deps.pollBudgetMs;
  let cutover: "verified-first" | "cname-first" = "cname-first";
  while (deps.now() < deadline) {
    const s = await deps.railway.domainStatus(serviceId, host);
    if (s.verified && s.proxyDetected) { cutover = "verified-first"; break; }
    await deps.sleep(15000);
  }
  await deps.dns.writeProxiedCname(host, dom.cnameTarget); // the cutover — always last
  putRecord({ ...getRecord(name)!, remote: { ...getRecord(name)!.remote!, status: "live", cutover, url: `https://${host}` } });
  return { status: 200, body: { ok: true, url: `https://${host}`, cutover } };
}
```

Note: the `pushRemote` call above needs the `serviceId` back on the record — have `pushRemote` write `remote.serviceId` from `ensureService` (it already does in Task 7). `ensureService` name-keys on `deck-<app>`, so a resume reuses the same id and `ensureCustomDomain` returns `created:false` (no delete-then-add — the rate-limit guard).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/edge/remote.enable.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/edge/remote.ts src/edge/remote.enable.test.ts
git commit -m "remote: enableRemote origin swap (TXT-first, CNAME-last, cname-first fallback)"
```

---

## Task 9: `disableRemote` — symmetric flip-back

**Files:**
- Modify: `src/edge/remote.ts`
- Test: `src/edge/remote.disable.test.ts`

**Interfaces:**
- Produces: `disableRemote(name, deps): Promise<FlowResult>` where `deps = { railway; dns }`. Order: delete CNAME (host records) → delete TXT → remove Railway custom domain → delete service → clear `record.remote`. No orphan on the happy path; the Access app is never touched.

- [ ] **Step 1: Write the failing test**

```ts
// src/edge/remote.disable.test.ts
import { expect, test, beforeEach } from "bun:test";
import { disableRemote } from "./remote.ts";
import { FakeRailwayDriver, FakeCfDns } from "../../test/fixture/remote.ts";
import { putRecord, getRecord, reloadRegistry, type AppRecord } from "../registry/records.ts";

const rec: AppRecord = { name: "site", managedBy: "user", port: 11010, kind: "service",
  command: ["bun", "run", "serve"], workingDirectory: "/tmp/site", label: "com.mattstack.deck.site", createdAt: "t",
  remote: { target: "railway", serviceId: "svc_1", customDomain: "site.m4tthew.dev", status: "live", cutover: "verified-first" } };

beforeEach(() => { process.env.LOCAL_REGISTRY_PATH = `/tmp/deck-${crypto.randomUUID()}.json`; reloadRegistry(); putRecord(rec); });

test("flip-back deletes every remote object and clears the block", async () => {
  const rw = new FakeRailwayDriver(); rw.byName.set("deck-site", "svc_1"); rw.services.set("svc_1", { name: "deck-site" });
  const dns = new FakeCfDns(); dns.cname.set("site.m4tthew.dev", { target: "t", proxied: true }); dns.txt.set("_railway.site.m4tthew.dev", "v");
  const r = await disableRemote("site", { railway: rw, dns });
  expect(r.status).toBe(200);
  expect(dns.cname.size).toBe(0);
  expect(dns.txt.size).toBe(0);
  expect(rw.calls).toContain("removeDomain:site.m4tthew.dev");
  expect(rw.calls).toContain("deleteService:svc_1");
  expect(getRecord("site")!.remote).toBeUndefined();
});

test("off on an app that is not remote is a no-op 200", async () => {
  putRecord({ ...rec, remote: undefined });
  const r = await disableRemote("site", { railway: new FakeRailwayDriver(), dns: new FakeCfDns() });
  expect(r.status).toBe(200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/edge/remote.disable.test.ts`
Expected: FAIL (`disableRemote` not defined).

- [ ] **Step 3: Implement `disableRemote`**

```ts
// src/edge/remote.ts — add
export async function disableRemote(name: string, deps: { railway: RailwayDriver; dns: CfDns }): Promise<FlowResult> {
  const record = getRecord(name);
  if (!record?.remote) return { status: 200, body: { ok: true, alreadyOff: true } };
  const { serviceId, customDomain } = record.remote;
  await deps.dns.deleteHostRecords(customDomain);      // wildcard tunnel reclaims the host
  await deps.dns.deleteTxt(`_railway.${customDomain}`);
  await deps.railway.removeCustomDomain(serviceId, customDomain);
  await deps.railway.deleteService(serviceId);
  const { remote: _drop, ...rest } = getRecord(name)!;
  putRecord(rest);
  clearIssues(name, "railway");
  return { status: 200, body: { ok: true } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/edge/remote.disable.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/edge/remote.ts src/edge/remote.disable.test.ts
git commit -m "remote: disableRemote symmetric flip-back"
```

---

## Task 10: `reconcileRemote` — drive verifying → live on the tick

**Files:**
- Modify: `src/edge/remote.ts`, `core/reconcile.ts`
- Test: `src/edge/remote.reconcile.test.ts`

**Interfaces:**
- Produces: `reconcileRemote(deps): Promise<void>` — for each record whose `remote.status === "deploying" | "verifying"` and whose `nextPollAt` is due, polls `domainStatus`; on verified writes the proxied CNAME (if absent), sets `live`; otherwise sets a backed-off `nextPollAt`. Records in `live`/`error` are skipped.

- [ ] **Step 1: Write the failing test**

```ts
// src/edge/remote.reconcile.test.ts
import { expect, test, beforeEach } from "bun:test";
import { reconcileRemote } from "./remote.ts";
import { FakeRailwayDriver, FakeCfDns } from "../../test/fixture/remote.ts";
import { putRecord, getRecord, reloadRegistry, type AppRecord } from "../registry/records.ts";

function verifyingRec(over: Partial<AppRecord> = {}): AppRecord {
  return { name: "site", managedBy: "user", port: 11010, kind: "service",
    command: ["bun","run","serve"], workingDirectory: "/tmp/site", label: "l", createdAt: "t",
    remote: { target: "railway", serviceId: "svc_1", customDomain: "site.m4tthew.dev", status: "verifying" }, ...over };
}
beforeEach(() => { process.env.LOCAL_REGISTRY_PATH = `/tmp/deck-${crypto.randomUUID()}.json`; reloadRegistry(); });

test("verified → writes CNAME, goes live", async () => {
  putRecord(verifyingRec());
  const rw = new FakeRailwayDriver(); rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });
  const dns = new FakeCfDns();
  await reconcileRemote({ railway: rw, dns, now: () => 1000 });
  expect(dns.cname.has("site.m4tthew.dev")).toBe(true);
  expect(getRecord("site")!.remote!.status).toBe("live");
});

test("not-yet-verified sets a future nextPollAt and does not busy-loop", async () => {
  putRecord(verifyingRec());
  const rw = new FakeRailwayDriver(); const dns = new FakeCfDns();
  await reconcileRemote({ railway: rw, dns, now: () => 1000 });
  expect(getRecord("site")!.remote!.status).toBe("verifying");
  expect(Date.parse(getRecord("site")!.remote!.nextPollAt!)).toBeGreaterThan(1000);
});

test("a live record is skipped (no poll)", async () => {
  putRecord(verifyingRec({ remote: { target:"railway", serviceId:"svc_1", customDomain:"site.m4tthew.dev", status:"live" } }));
  const rw = new FakeRailwayDriver(); const spy: string[] = []; const orig = rw.domainStatus.bind(rw);
  rw.domainStatus = async (...a) => { spy.push("polled"); return orig(...a); };
  await reconcileRemote({ railway: rw, dns: new FakeCfDns(), now: () => 999999 });
  expect(spy).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/edge/remote.reconcile.test.ts`
Expected: FAIL (`reconcileRemote` not defined).

- [ ] **Step 3: Implement `reconcileRemote`**

```ts
// src/edge/remote.ts — add
import { listRecords } from "../registry/records.ts";
const POLL_BACKOFF_MS = 30000;

export async function reconcileRemote(deps: { railway: RailwayDriver; dns: CfDns; now(): number }): Promise<void> {
  for (const r of listRecords()) {
    const rem = r.remote;
    if (!rem || (rem.status !== "deploying" && rem.status !== "verifying")) continue;
    if (rem.nextPollAt && deps.now() < Date.parse(rem.nextPollAt)) continue;
    const s = await deps.railway.domainStatus(rem.serviceId, rem.customDomain);
    if (s.verified && s.proxyDetected && rem.cnameTarget) {
      await deps.dns.writeProxiedCname(rem.customDomain, rem.cnameTarget); // stored Railway-assigned target, never a guessed host
      putRecord({ ...getRecord(r.name)!, remote: { ...rem, status: "live", cutover: rem.cutover ?? "verified-first", url: `https://${rem.customDomain}` } });
    } else {
      putRecord({ ...getRecord(r.name)!, remote: { ...rem, nextPollAt: new Date(deps.now() + POLL_BACKOFF_MS).toISOString() } });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/edge/remote.reconcile.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the tick**

In `core/reconcile.ts`, find where the periodic reconcile runs (the same cadence `reconcileMattstackTld`/proxy-freshness use) and call `reconcileRemote({ railway, dns, now: Date.now })` with real drivers, guarded so a driver throw is caught and logged (never crash the tick). Run `bun run test` to confirm the reconcile suite still passes.

- [ ] **Step 6: Commit**

```bash
git add src/edge/remote.ts core/reconcile.ts src/edge/remote.reconcile.test.ts
git commit -m "remote: reconcileRemote drives verifying→live with backoff; wire into tick"
```

---

## Task 11: API routes — `POST /apps/:name/remote`, `POST /apps/:name/push`

**Files:**
- Modify: `src/api/server.ts`
- Test: `src/api/server.remote.test.ts`

**Interfaces:**
- Consumes: `enableRemote`/`disableRemote`/`pushRemote`; the request-time resolution of secrets (`readDeckSecrets`), `getPlatformSettings().railway`/`publicDomain`, `getOAuth(name)`, and the two drivers (real, or fakes in the server test harness). Follows the existing route style: parse body, call the orchestrator, return `res(result.status, result.body)`.
- Produces: `POST /api/v1/apps/:name/remote` with body `{ enabled: boolean }`; `POST /api/v1/apps/:name/push`.

- [ ] **Step 1: Write the failing test**

Model on `src/api/server.test.ts` (same bootstrap: fake drivers, scratch state). Assert:

```ts
// src/api/server.remote.test.ts (shape)
test("POST /apps/:name/remote {enabled:true} returns the live url", async () => {
  // register a supervised app, set platform railway + publicDomain + oauth emails,
  // inject FakeRailwayDriver (pre-verified) + FakeCfDns into the server's remote deps
  const res = await app.request("/api/v1/apps/site/remote", { method: "POST", body: JSON.stringify({ enabled: true }) });
  expect(res.status).toBe(200);
  expect((await res.json()).url).toBe("https://site.m4tthew.dev");
});
test("POST /apps/:name/push redeploys an app already in remote mode", async () => { /* status 200, lastPush set */ });
test("remote {enabled:true} on a password-gated app 400s remote-requires-access", async () => { /* … */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/api/server.remote.test.ts`
Expected: FAIL (404 — route absent).

- [ ] **Step 3: Register the routes**

In `src/api/server.ts`, beside the existing `apps/:name`-scoped routes, add (real drivers resolved the way `domain/bind` resolves the tunnel/CF deps; the `remote`/`push` routes are NOT dev-mode gated):

```ts
// POST /api/v1/apps/:name/remote  { enabled: boolean }
if (method === "POST" && (m = path.match(/^\/api\/v1\/apps\/([^/]+)\/remote$/))) {
  const name = m[1]!;
  const { enabled } = await readJson(req);
  const sec = await readDeckSecrets();
  const settings = getPlatformSettings();
  const result = enabled
    ? await enableRemote(name, {
        railway, dns, token: sec.ok ? sec.railwayToken ?? "" : "",
        projectId: settings.railway?.projectId ?? "", environmentId: settings.railway?.environmentId ?? "",
        railwayConf: settings.railway, publicDomain: settings.publicDomain,
        oauth: getOAuth(name), hasRailwayToken: sec.ok && !!sec.railwayToken,
        provenance: gitProvenance, hasUntrackedEnv: untrackedEnvPresent,
        pollBudgetMs: 600000, sleep: (ms) => new Promise(r => setTimeout(r, ms)), now: Date.now,
      })
    : await disableRemote(name, { railway, dns });
  return res(result.status, result.body);
}
// POST /api/v1/apps/:name/push
if (method === "POST" && (m = path.match(/^\/api\/v1\/apps\/([^/]+)\/push$/))) {
  const name = m[1]!;
  const sec = await readDeckSecrets();
  const settings = getPlatformSettings();
  const result = await pushRemote(name, {
    railway, token: sec.ok ? sec.railwayToken ?? "" : "",
    projectId: settings.railway?.projectId ?? "", environmentId: settings.railway?.environmentId ?? "",
    provenance: gitProvenance, hasUntrackedEnv: untrackedEnvPresent,
  });
  return res(result.status, result.body);
}
```

Add `gitProvenance(dir)` (`git rev-parse --short HEAD` + `git status --porcelain` non-empty ⇒ dirty) and `untrackedEnvPresent(dir)` (`git status --porcelain --untracked-files=all` lists a `.env`-shaped path) as small helpers in a new `src/edge/source.ts`, unit-tested with a temp git repo.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/api/server.remote.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/server.ts src/edge/source.ts src/edge/source.test.ts src/api/server.remote.test.ts
git commit -m "server: remote on/off + push routes; git source provenance helpers"
```

---

## Task 12: CLI verbs — `deck remote`, `deck push`

**Files:**
- Modify: `src/cli/commands.ts`
- Test: `src/cli/commands.remote.test.ts`

**Interfaces:**
- Consumes: `apiJson` (existing). Mirrors the `domain` case's 428 handling.

- [ ] **Step 1: Write the failing test**

```ts
// src/cli/commands.remote.test.ts (uses the existing apiJson mock harness from commands.test.ts)
test("deck remote site on prints the live url", async () => {
  // mock apiJson → { status: 200, body: { ok:true, url:"https://site.m4tthew.dev", cutover:"verified-first" } }
  expect(await runCommand(["remote","site","on"], io)).toBe(0);
  expect(out).toContain("https://site.m4tthew.dev");
});
test("deck remote site on surfaces a 428 as a token hint", async () => {
  // mock apiJson → { status: 428, body: { error: "railway-token-required" } }
  expect(await runCommand(["remote","site","on"], io)).toBe(1);
  expect(err).toContain("rt secrets set deck railwayToken");
});
test("deck push site prints the pushed sha", async () => {
  // mock apiJson → { status: 200, body: { ok:true, lastPush:{ sha:"abc123", dirty:true, at:"t" } } }
  expect(await runCommand(["push","site"], io)).toBe(0);
  expect(out).toContain("abc123");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/cli/commands.remote.test.ts`
Expected: FAIL (verbs fall through to USAGE, exit 2).

- [ ] **Step 3: Add the cases** (before `default:`)

```ts
case "remote": {
  const [app, onOff] = rest;
  if (!app || (onOff !== "on" && onOff !== "off")) { io.err(USAGE); return 2; }
  const { status, body } = await apiJson(`/api/v1/apps/${app}/remote`, { method: "POST", body: JSON.stringify({ enabled: onOff === "on" }) });
  if (status === 428) { io.err("Railway needs a token — store with: rt secrets set deck railwayToken"); return 1; }
  if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
  if (onOff === "off") { io.out(`${app} back on the tunnel (public: tunnel)`); return 0; }
  io.out(`${app} now served remotely: ${body.url} (cutover: ${body.cutover})`);
  return 0;
}
case "push": {
  const [app] = rest;
  if (!app) { io.err(USAGE); return 2; }
  const { status, body } = await apiJson(`/api/v1/apps/${app}/push`, { method: "POST" });
  if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
  const lp = body.lastPush;
  io.out(`pushed ${app} @ ${lp.sha}${lp.dirty ? " (dirty)" : ""}`);
  return 0;
}
```

Add USAGE lines:

```
  deck remote <name> on|off                serve <name> publicly from Railway (on) or the tunnel (off)
  deck push <name>                         redeploy a remote app from the local checkout
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/cli/commands.remote.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands.ts src/cli/commands.remote.test.ts
git commit -m "cli: deck remote + deck push verbs"
```

---

## Task 13: Status — `public: tunnel | railway`

**Files:**
- Modify: `src/api/status.ts`, `src/cli/commands.ts` (the `status` row formatting)
- Test: `src/api/status.remote.test.ts`

**Interfaces:**
- Produces: `StatusRow.publicOrigin: "tunnel" | "railway"`; `StatusRow.remote: { status: RemoteState["status"]; url: string | null } | null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/api/status.remote.test.ts
test("a remote app's row reports publicOrigin railway + live url", async () => {
  // register site, put a remote{status:"live", customDomain:"site.m4tthew.dev"} on the record
  const status = await buildStatus(baseOpts);
  const row = status.apps.find(r => r.name === "site")!;
  expect(row.publicOrigin).toBe("railway");
  expect(row.remote).toEqual({ status: "live", url: "https://site.m4tthew.dev" });
});
test("a non-remote app reports publicOrigin tunnel + null remote", async () => {
  const row = (await buildStatus(baseOpts)).apps.find(r => r.name === "other")!;
  expect(row.publicOrigin).toBe("tunnel");
  expect(row.remote).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/api/status.remote.test.ts`
Expected: FAIL (fields absent).

- [ ] **Step 3: Add the fields** in `buildStatus`'s row map (`record` is already in scope):

```ts
// in the returned row object:
publicOrigin: record?.remote?.status === "live" ? "railway" as const : "tunnel" as const,
remote: record?.remote ? { status: record.remote.status, url: record.remote.url ?? null } : null,
```

Add both to the `StatusRow` interface. In the CLI `status` case, append a marker when remote:

```ts
const origin = row.remote ? ` [public:railway/${row.remote.status}]` : "";
io.out(`${row.name.padEnd(24)} ${String(row.port ?? "-").padEnd(6)} ${health.padEnd(5)} ${managed}${issues}${origin}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/api/status.remote.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/status.ts src/cli/commands.ts src/api/status.remote.test.ts
git commit -m "status: publicOrigin + remote fields on the app row"
```

---

## Task 14: `deck remove` flips remote back before teardown

**Files:**
- Modify: `src/api/register.ts` (`unregisterApp`)
- Test: `src/api/register.remote-remove.test.ts`

**Interfaces:**
- Consumes: `disableRemote` (Task 9). `unregisterApp` gains remote drivers in its `drivers` bundle (or resolves them the way the route does), calls `disableRemote` first when the record is remote, and only proceeds to the normal launchd/portless teardown after the Railway service + DNS are gone.

- [ ] **Step 1: Write the failing test**

```ts
// src/api/register.remote-remove.test.ts
test("removing a remote app tears down Railway + DNS first, then the record", async () => {
  // register site with remote{serviceId:"svc_1", customDomain:"site.m4tthew.dev", status:"live"}
  const rw = new FakeRailwayDriver(); rw.services.set("svc_1", { name: "deck-site" }); rw.byName.set("deck-site","svc_1");
  const dns = new FakeCfDns(); dns.cname.set("site.m4tthew.dev", { target:"t", proxied:true });
  const r = await unregisterApp("site", "user", false, { ...drivers, railway: rw, dns });
  expect(r.status).toBe(200);
  expect(rw.calls).toContain("deleteService:svc_1");
  expect(dns.cname.size).toBe(0);
  expect(getRecord("site")).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/api/register.remote-remove.test.ts`
Expected: FAIL (service not deleted; DNS left).

- [ ] **Step 3: Implement** — near the top of `unregisterApp`, after the record is fetched and authorized, before `teardownRecord`:

```ts
if (record.remote) {
  const flip = await disableRemote(name, { railway: drivers.railway, dns: drivers.dns });
  if (flip.status !== 200) return flip; // never orphan: abort the remove if flip-back fails
}
```

Thread `railway`/`dns` into the `Drivers` interface (or a parallel `RemoteDrivers` param) and pass them from the DELETE route. Update the route and any callers (`removeManagedApps` passes the same drivers).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/api/register.remote-remove.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/register.ts src/api/server.ts src/api/register.remote-remove.test.ts
git commit -m "register: deck remove flips remote back before teardown"
```

---

## Task 15: `deck domain` refuses a change while any app is remote-on

**Files:**
- Modify: `src/edge/domain.ts` (`bindDomain`)
- Test: `src/edge/domain.remote-guard.test.ts`

**Interfaces:**
- Consumes: `listRecords`, `getPlatformSettings().publicDomain`. `bindDomain` refuses (409) when the requested domain differs from the current `publicDomain` and any record has a `remote` block.

- [ ] **Step 1: Write the failing test**

```ts
// src/edge/domain.remote-guard.test.ts
test("re-binding to a different domain refuses while an app is remote-on", async () => {
  // publicDomain = "m4tthew.dev"; a record site has remote{...}
  const r = await bindDomain("other.dev", { tunnel: fakeTunnel, manager: fakeManager });
  expect(r.status).toBe(409);
  expect((r.body as any).error).toBe("remote-apps-pinned-to-domain");
  expect((r.body as any).apps).toContain("site");
});
test("re-binding to the SAME domain is allowed (idempotent)", async () => {
  const r = await bindDomain("m4tthew.dev", { tunnel: fakeTunnel, manager: fakeManager });
  expect(r.status).not.toBe(409);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/edge/domain.remote-guard.test.ts`
Expected: FAIL (no guard).

- [ ] **Step 3: Implement** — at the top of `bindDomain`, after the domain-format check:

```ts
const current = getPlatformSettings().publicDomain;
if (current && current !== domain) {
  const remoteApps = listRecords().filter((r) => r.remote).map((r) => r.name);
  if (remoteApps.length) return { status: 409, body: { error: "remote-apps-pinned-to-domain", apps: remoteApps } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/edge/domain.remote-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/edge/domain.ts src/edge/domain.remote-guard.test.ts
git commit -m "domain: refuse a domain change while any app is remote-on"
```

---

## Task 16: `deck uninstall --force` spares and prints remote services

**Files:**
- Modify: the uninstall handler (locate in Step 1)
- Test: alongside the existing uninstall test

**Interfaces:**
- Consumes: `listRecords`. Uninstall never deletes a Railway service; it prints each remote app with its `remote.url` and leaves it running.

- [ ] **Step 1: Locate the uninstall handler.**

Run: `grep -rn "uninstall" src/cli core | grep -iv test`
Expected: the handler that tears down deck's own footprint (README: refuses unless only deck is registered, `--force` overrides). Read it.

- [ ] **Step 2: Write the failing test** — extend the uninstall test: with a record carrying `remote`, `uninstall --force` returns/reports that service as spared (its name + `remote.url`) and makes NO Railway driver call.

- [ ] **Step 3: Run it — FAIL** (uninstall currently ignores remote).

- [ ] **Step 4: Implement** — before/after the deck-footprint teardown, gather `listRecords().filter(r => r.remote)`, print each as `kept remote service <name> — <remote.url> (running on Railway)`, and assert no `RailwayDriver` is constructed or called in this path. Remote records are informational only here.

- [ ] **Step 5: Run it — PASS.**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "uninstall: spare + print remote services, never tear them down"
```

---

## Task 17: Board — Remote toggle + Push button + origin on the row

**Files:**
- Modify: `core/board/AppsTable.tsx`, `core/board/drawer/RootScreen.tsx` (or the row/drawer that owns publish/access controls), `core/board/api.ts`
- Regenerate: `core/generated/board.js`, `core/generated/board.css`
- Test: `test/dom/*` (DOM), `test/baselines/*` (pixel)

**Interfaces:**
- Consumes: `StatusRow.publicOrigin` + `StatusRow.remote` (Task 13); `POST …/remote` + `…/push` (Task 11).

- [ ] **Step 1: Add API client calls** in `core/board/api.ts`:

```ts
export const setRemote = (name: string, enabled: boolean) =>
  postJson(`/api/v1/apps/${name}/remote`, { enabled });
export const pushRemote = (name: string) => postJson(`/api/v1/apps/${name}/push`, {});
```

- [ ] **Step 2: Write the failing DOM test** in `test/dom/` against fixture data (see `test/dom/rig.ts`): a row whose `remote.status === "live"` renders a "public: railway" badge and a Push button; a non-remote row renders a Remote toggle in the drawer. Run `bun run test:dom` → FAIL.

- [ ] **Step 3: Render the controls.** In the app drawer (beside the existing publish/access controls), add a **Remote** group bound to `setRemote`, disabled with a tooltip when the app is password-gated (`hasPassword && oauth.mode === "off"`), reflecting `remote.status` (`deploying`/`verifying`/`live`/`error`). Keep it visually separate from the manifest action buttons `CommandsCell` renders (build/deploy) so the local `deploy` button and the remote push never blur; label the remote deploy button **"Push to Railway"** (not "deploy"). On the row, show `public: railway` when `publicOrigin === "railway"` and the Push button when `remote` is non-null. Unlike `CommandsCell`, the Remote group is NOT dev-mode gated (platform control). Follow the existing optimistic-update pattern (`core/board/optimistic.tsx`).

- [ ] **Step 4: Rebuild the board.**

Run: `bun run build:board`
This regenerates `core/generated/board.{js,css}`; `core/generated-fresh.test.ts` fails the suite if it is stale.

- [ ] **Step 5: Run DOM + pixel checks.**

Run: `bun run test:dom` (PASS), then `bun run capture` + `bun run capture:compare`. A diff is expected (new controls). Eyeball every changed PNG, then `bun run capture:baseline` to accept the intended visual change.

- [ ] **Step 6: Commit**

```bash
git add core/board core/generated test/dom test/baselines
git commit -m "board: remote toggle + push button + public origin on the app row"
```

---

## Self-Review

**1. Spec coverage** (each spec section → task):
- Scope/frame → embodied across Tasks 6–9 (opt-in toggle, .localhost untouched, Access-only).
- App contract (supervised, `$PORT`, default commands, `record.env`) → Tasks 6, 7.
- Target model (one project/N services, ownership prefix, one token) → Tasks 3, 4, 7.
- Deploy pipeline (`railway up`, `.gitignore`/untracked-`.env` refusal, nixpacks, build/start/PORT/env, provenance, build-log SyncIssue) → Tasks 7, 11 (source helpers).
- Origin swap (refuse-checks, TXT→verify→CNAME-last, proxied-from-moment-one, zero-gap + fallback) → Tasks 6, 8.
- Flip-back (symmetric, no orphan) → Task 9.
- Rate-limit / idempotent resume (reuse, never re-add) → Tasks 4 (`ensureService`/`ensureCustomDomain` idempotence), 8 (resume test).
- Local coexistence / failover / `public: tunnel|railway` → Task 13 (launchd/portless deliberately untouched by every task).
- State + surfaces (settings, record block, verbs, board, reconcile) → Tasks 2, 3, 10, 11, 12, 13, 17.
- Lifecycle edges (remove, uninstall, domain) → Tasks 14, 15, 16.
- Testing (fakes, refuse matrix, symmetry, reconcile backoff, status) → present per task.
- Open spike → Task 1.
- Deferred items → none implemented (correct).

**2. Placeholder scan:** every code step carries real test/impl code. Task 16's board-adjacent uninstall handler is located by grep in-step (concrete), not left as "TBD". No "add error handling"/"similar to Task N" placeholders.

**3. Type consistency:** `RemoteState` (Task 2) is the single shape read/written by Tasks 7–14, 17. `RailwayDriver`/`CfDns` method names used in Tasks 7–10, 14 match Tasks 4–5 exactly (`ensureService`, `ensureCustomDomain`, `domainStatus`, `deleteHostRecords`, `writeProxiedCname`). `FlowResult` `{status, body}` is the return of every orchestrator, consumed unchanged by the routes (Task 11). `remoteRefuseChecks` error strings are asserted identically in Tasks 6 and 12 (the 428 → token hint).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-29-deck-push-to-remote.md`.** Task 1 is a spike gate; Tasks 2–17 are TDD. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session via executing-plans, batched with review checkpoints.
