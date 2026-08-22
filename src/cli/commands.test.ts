import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-cli-"));
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
// deck.platform reads through rt-client, which resolves HOME at call time (not overridable
// via a LOCAL_*_PATH var) -- must be faked here too, or this test touches the real ~/.mattstack.
process.env.HOME = dir;
writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, "[]");

const { startApi } = await import("../api/server.ts");
const { writeApiInfo } = await import("../api/state.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { FakeTunnelDriver } = await import("../edge/tunnel.ts");
const { runCommand } = await import("./commands.ts");

const PORT = 18971;
let server: ReturnType<typeof startApi>;
beforeAll(() => {
  server = startApi({
    manager: new FakeServiceManager(), edge: new FakeEdgeProxy(), tunnel: new FakeTunnelDriver(),
    // Scratch cloudflaredDir with no cert.pem: the domain verb's bind step
    // deterministically 428s here regardless of this machine's ~/.cloudflared.
    cloudflaredDir: dir,
    port: PORT, canaryPort: PORT + 1,
    freshness: () => "unknown", autoHeal: () => null, onRouteWrite: () => {},
  });
  writeApiInfo(PORT);
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });

function io() {
  const lines: string[] = [];
  return { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s), lines };
}

test("add + status + remove round-trip", async () => {
  const a = io();
  expect(await runCommand(["add", "t-cli", "--port", "4999"], a)).toBe(0);
  const s = io();
  expect(await runCommand(["status"], s)).toBe(0);
  expect(s.lines.join("\n")).toContain("t-cli");
  const r = io();
  expect(await runCommand(["remove", "t-cli"], r)).toBe(0);
});

test("remove on a managed record prints the escape hatch and exits 1", async () => {
  const a = io();
  await runCommand(["add", "t-rt", "--port", "4998"], a); // user record...
  // ...flip it to rt via the API to simulate a manager registration
  await fetch(`http://127.0.0.1:${PORT}/api/v1/apps/t-rt?force=true`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:${PORT}/api/v1/apps`, {
    method: "POST", headers: { "content-type": "application/json", "x-local-caller": "rt" },
    body: JSON.stringify({ name: "t-rt", staticPort: 4998 }),
  });
  const r = io();
  expect(await runCommand(["remove", "t-rt"], r)).toBe(1);
  expect(r.lines.join("\n")).toContain("Managed by mattstack");
  const f = io();
  expect(await runCommand(["remove", "t-rt", "--force"], f)).toBe(0);
});

test("restart --managed / remove --managed only touch non-user records", async () => {
  const a = io();
  await runCommand(["add", "t-managed", "--cmd", "sleep 1", "--dir", dir], a);
  // Flip it to rt-managed the same way the "escape hatch" test above does.
  await fetch(`http://127.0.0.1:${PORT}/api/v1/apps/t-managed?force=true`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:${PORT}/api/v1/apps`, {
    method: "POST", headers: { "content-type": "application/json", "x-local-caller": "rt" },
    body: JSON.stringify({ name: "t-managed", command: ["sleep", "1"], workingDirectory: dir }),
  });
  const b = io();
  await runCommand(["add", "t-user-only", "--port", "4997"], b);

  const restarted = io();
  expect(await runCommand(["restart", "--managed"], restarted)).toBe(0);
  expect(restarted.lines.join("\n")).toContain("restarted t-managed");
  expect(restarted.lines.join("\n")).not.toContain("t-user-only");

  const removed = io();
  expect(await runCommand(["remove", "--managed"], removed)).toBe(0);
  expect(removed.lines.join("\n")).toContain("removed t-managed");

  const s = io();
  await runCommand(["status"], s);
  expect(s.lines.join("\n")).not.toContain("t-managed");
  expect(s.lines.join("\n")).toContain("t-user-only");

  await runCommand(["remove", "t-user-only"], io());
});

test("unknown verb exits 2 with usage", async () => {
  const x = io();
  expect(await runCommand(["frobnicate"], x)).toBe(2);
  expect(x.lines.join("\n")).toContain("usage");
});

test("usage text invokes the binary as deck (the shell-reserved-word rename), never local", async () => {
  const x = io();
  expect(await runCommand(["help"], x)).toBe(0);
  const out = x.lines.join("\n");
  expect(out).toContain("deck status");
  expect(out).toContain("deck migrate --convert");
  expect(out).not.toMatch(/\blocal (status|add|remove|restart|logs|override|publish|password|access|domain|migrate|serve|setup|uninstall|update|version)\b/);
});

test("version prints the deck-prefixed version string", async () => {
  const x = io();
  expect(await runCommand(["version"], x)).toBe(0);
  expect(x.lines.join("\n")).toMatch(/^deck \d+\.\d+\.\d+$/);
});

test("domain verb no longer prompts for or persists a CF token; it points at rt secrets set instead", async () => {
  const promptFn = () => { throw new Error("domain must not prompt for a CF token anymore"); };
  const d = io();
  // Bind itself 428s (no cert.pem in this scratch env) — exit 1 is expected;
  // what this test pins is the CLI's own behavior before the bind attempt.
  expect(await runCommand(["domain", "example.dev"], d, promptFn)).toBe(1);
  const out = d.lines.join("\n");
  expect(out).toContain("rt secrets set deck cfApiToken");
  expect(out).toContain("rt secrets set deck cfZoneId");
  expect(out).toContain("--stdin");
  const settingsRaw = await (await fetch(`http://127.0.0.1:${PORT}/api/v1/settings`)).text();
  expect(settingsRaw).not.toContain("hasCfToken");
});

test("PUT /api/v1/settings rejects a CF secret in the payload with a directed message naming both keys, not a silent drop", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/v1/settings`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cfApiToken: "should-be-rejected" }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { message?: string };
  expect(body.message).toContain("rt secrets set deck cfApiToken");
  expect(body.message).toContain("rt secrets set deck cfZoneId");
});

test("migrate --convert posts convert:true and prints the convert-shaped report", async () => {
  const m = io();
  expect(await runCommand(["migrate", "--convert"], m)).toBe(0);
  const out = m.lines.join("\n");
  expect(out).toContain("converted:");
  expect(out).toContain("rolled back:");
  expect(out).toContain("skipped:");
});

test("migrate without --convert still prints the adopt-shaped report", async () => {
  const m = io();
  expect(await runCommand(["migrate"], m)).toBe(0);
  const out = m.lines.join("\n");
  expect(out).toContain("adopted:");
  expect(out).toContain("skipped:");
  expect(out).not.toContain("converted:");
});

test("deck access off succeeds against a registered app", async () => {
  const a = io();
  expect(await runCommand(["add", "t-access-off", "--port", "4997"], a)).toBe(0);
  const x = io();
  const code = await runCommand(["access", "t-access-off", "off"], x);
  expect(x.lines.join("\n")).toContain("google sign-in off");
  expect(code).toBe(0);
});

// Deliberately independent of both file position and whatever platform
// settings other test files (or an earlier test in this one) have left in
// the shared getPlatformSettings() cache: this asserts on the SHAPE of the
// failure, not on one specific Cloudflare error string. A malformed payload
// fails client-side validation in the API (parseOAuth) with exactly one of
// these 400-shaped `error` messages, always via `body.error` with no
// `body.message`. A well-formed payload instead always reaches syncOAuth,
// which always sets `body.message` (400s never do), regardless of which
// Cloudflare precondition it then trips over. Asserting "not a 400 message"
// therefore still catches the bug that matters (a wrong mode name, wrong
// field name, or empty list) without pinning a specific 502 string that
// depends on ambient Cloudflare settings state.
const malformedPayloadMessages = [
  "invalid body",
  "unknown mode",
  "emails must be a non-empty list of valid addresses",
  "domains must be a non-empty list of valid domains",
];

test("deck access emails and domains reach the API with a well-formed payload", async () => {
  const a = io();
  expect(await runCommand(["add", "t-access-on", "--port", "4996"], a)).toBe(0);

  const e = io();
  const emailsCode = await runCommand(["access", "t-access-on", "emails", "a@x.dev,b@y.dev"], e);
  expect(emailsCode).toBe(1);
  expect(malformedPayloadMessages).not.toContain(e.lines.join("\n"));

  const d = io();
  const domainsCode = await runCommand(["access", "t-access-on", "domains", "corp.com,other.dev"], d);
  expect(domainsCode).toBe(1);
  expect(malformedPayloadMessages).not.toContain(d.lines.join("\n"));
});

test("deck access rejects a mode it does not know without calling the API", async () => {
  const x = io();
  // No such app is registered, so a 404 ("unknown app") would prove the CLI
  // reached the API; the usage text instead proves it never left the CLI.
  const code = await runCommand(["access", "no-such-app", "only-me", "--email", "m@x.dev"], x);
  expect(code).toBe(2);
  const out = x.lines.join("\n");
  expect(out).toContain("usage");
  expect(out).not.toContain("unknown app");
});

test("deck access rejects a missing or blank value without calling the API", async () => {
  const x = io();
  // Same no-such-app trick: if this ever reached the API it would 404 with
  // "unknown app" rather than the client-side "needs a comma-separated
  // list" message, so seeing the latter (and not the former) proves the
  // empty-list guard fired before any network call.
  const code = await runCommand(["access", "no-such-app-2", "emails", "   "], x);
  expect(code).toBe(2);
  const out = x.lines.join("\n");
  expect(out).toContain("emails needs a comma-separated list");
  expect(out).not.toContain("unknown app");
});

test("no running platform gives a clear error", async () => {
  const savedInfo = process.env.LOCAL_STATE_DIR;
  const emptyDir = mkdtempSync(join(tmpdir(), "local-cli-noserve-"));
  process.env.LOCAL_STATE_DIR = emptyDir;
  const x = io();
  const code = await runCommand(["status"], x);
  process.env.LOCAL_STATE_DIR = savedInfo;
  rmSync(emptyDir, { recursive: true, force: true });
  expect(code).toBe(1);
  expect(x.lines.join("\n")).toContain("deck serve");
});

test("adopt --json: rename + ownership flip, idempotent re-run, frozen error strings", async () => {
  const a = io();
  await runCommand(["add", "t-mrs", "--port", "4901"], a);

  const first = io();
  expect(await runCommand(["adopt", "t-mrs", "--as", "t-board", "--json"], first)).toBe(0);
  const body = JSON.parse(first.lines.join("\n"));
  expect(body.adopted).toBe(true);
  expect(body.changed).toBe(true);
  expect(body.app).toMatchObject({ name: "t-board", previousName: "t-mrs", managedBy: "rt" });
  expect(body.hostnames).toEqual(["t-board.mattstack", "t-board.localhost"]);

  const rerun = io();
  expect(await runCommand(["adopt", "t-mrs", "--as", "t-board", "--json"], rerun)).toBe(0);
  expect(JSON.parse(rerun.lines.join("\n")).changed).toBe(false);

  const ghost = io();
  expect(await runCommand(["adopt", "t-ghost", "--json"], ghost)).toBe(1);
  expect(JSON.parse(ghost.lines.join("\n"))).toEqual({ adopted: false, error: "unknown app" });
});

test("adopt without --json prints a human line; a missing name is usage", async () => {
  const a = io();
  await runCommand(["add", "t-plain", "--port", "4902"], a);
  const x = io();
  expect(await runCommand(["adopt", "t-plain"], x)).toBe(0);
  expect(x.lines.join("\n")).toContain("t-plain.mattstack");
  const u = io();
  expect(await runCommand(["adopt"], u)).toBe(2);
});

test("adopt --json against no running platform answers the frozen deck-not-running error on stdout", async () => {
  const savedInfo = process.env.LOCAL_STATE_DIR;
  const emptyDir = mkdtempSync(join(tmpdir(), "local-cli-noserve2-"));
  process.env.LOCAL_STATE_DIR = emptyDir;
  const x = io();
  const code = await runCommand(["adopt", "t-mrs", "--as", "t-board", "--json"], x);
  process.env.LOCAL_STATE_DIR = savedInfo;
  rmSync(emptyDir, { recursive: true, force: true });
  expect(code).toBe(1);
  expect(JSON.parse(x.lines.join("\n"))).toEqual({ adopted: false, error: "deck not running" });
});

test("--version prints the bare semver — the bundle gate matches it against deps.lock verbatim", async () => {
  const x = io();
  expect(await runCommand(["--version"], x)).toBe(0);
  expect(x.lines).toHaveLength(1);
  expect(x.lines[0]).toMatch(/^\d+\.\d+\.\d+$/);
});
