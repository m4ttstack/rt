import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-migrate-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_AGENTS_DIR = join(dir, "agents");
mkdirSync(process.env.LOCAL_AGENTS_DIR, { recursive: true });

const { migrate } = await import("./migrate.ts");
const { getRecord, reloadRegistry } = await import("./records.ts");
const { getPlatformSettings, reloadPlatformSettings } = await import("../api/platform-settings.ts");

const PLIST = (label: string, port: number) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>/usr/bin/true</string></array>
<key>WorkingDirectory</key><string>/tmp</string>
<key>EnvironmentVariables</key><dict><key>PORT</key><string>${port}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>`;

beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  reloadRegistry();
  reloadPlatformSettings();
  writeFileSync(join(process.env.LOCAL_AGENTS_DIR!, "com.matthewgoodwin.boxscore.plist"), PLIST("com.matthewgoodwin.boxscore", 11005));
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, JSON.stringify([
    { hostname: "boxscore.localhost", port: 11005, pid: 0 },
    { hostname: "mattari.localhost", port: 4101, pid: 0 },
  ]));
});

test("adopts a plist-backed app as a grandfathered user service under its OLD label", async () => {
  const result = await migrate({});
  expect(result.adopted).toContain("boxscore");
  const rec = getRecord("boxscore")!;
  expect(rec).toMatchObject({
    managedBy: "user", kind: "service", port: 11005,
    label: "com.matthewgoodwin.boxscore", grandfathered: true,
  });
  // never rewritten: the plist file is untouched (same content)
});

test("adopts a route with no service as an external record", async () => {
  const result = await migrate({});
  expect(result.adopted).toContain("mattari");
  expect(getRecord("mattari")!).toMatchObject({ kind: "external", port: 4101, grandfathered: true });
});

test("records the legacy prefix so discovery keeps seeing the old plists", async () => {
  await migrate({});
  expect(getPlatformSettings().legacyPrefixes).toEqual(["com.matthewgoodwin."]);
});

test("idempotent: a second run skips everything", async () => {
  await migrate({});
  const second = await migrate({});
  expect(second.adopted).toEqual([]);
  expect(second.skipped.sort()).toEqual(["boxscore", "mattari"]);
});

test("never adopts a bootstrap alias sharing Deck's own port under a second name", async () => {
  const { putRecord } = await import("./records.ts");
  // Pre-register Deck's own bootstrap record, exactly as bootstrapSelf() would.
  putRecord({
    name: "deck",
    managedBy: "deck",
    port: 11000,
    kind: "service",
    label: "com.mattstack.deck",
    createdAt: new Date().toISOString(),
  });
  // bootstrapSelf() writes TWO portless aliases at the SAME port when the
  // proxy's TLDs don't include "mattstack": deck.localhost and
  // deck.mattstack.localhost. With tlds=["localhost"], these bareName to
  // DIFFERENT names ("deck" and "deck.mattstack"), so dedupeRoutes does not
  // collapse them - migrate() must skip the second one by port, not adopt it.
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, JSON.stringify([
    { hostname: "deck.localhost", port: 11000, pid: 0 },
    { hostname: "deck.mattstack.localhost", port: 11000, pid: 0 },
    { hostname: "boxscore.localhost", port: 11005, pid: 0 },
    { hostname: "mattari.localhost", port: 4101, pid: 0 },
  ]));

  const result = await migrate({});

  expect(result.skipped).toContain("deck.mattstack");
  expect(result.adopted).not.toContain("deck.mattstack");
  expect(getRecord("deck.mattstack")).toBeUndefined();
});

test("skips any route sharing an already-claimed port, regardless of name", async () => {
  const { putRecord } = await import("./records.ts");
  // An ordinary (non-Deck) app already registered under one name; a second
  // route at the same port is a same-app alternate-access alias, not a new
  // app, so it must be skipped rather than adopted under a second name.
  putRecord({
    name: "widgets",
    managedBy: "user",
    port: 11005,
    kind: "service",
    label: "com.matthewgoodwin.boxscore",
    createdAt: new Date().toISOString(),
  });

  const result = await migrate({});

  expect(result.skipped).toContain("boxscore");
  expect(result.adopted).not.toContain("boxscore");
  expect(getRecord("boxscore")).toBeUndefined();
});

test("does not adopt two routes at the same never-before-claimed port as separate records within one run", async () => {
  // Same structural shape as the Deck-bootstrap-alias hazard, but for an
  // ordinary app: two portless aliases at one port under different bareNames,
  // with NEITHER name having a pre-existing record yet. claimedPorts is
  // seeded from existing records before the loop starts, so it alone would
  // not catch this - it must also be updated as the loop adopts routes, or
  // both aliases get adopted as separate managedBy:"user" records sharing one
  // launchd label (two board rows secretly sharing one launchd service).
  writeFileSync(join(process.env.LOCAL_AGENTS_DIR!, "com.matthewgoodwin.widgets.plist"), PLIST("com.matthewgoodwin.widgets", 9999));
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, JSON.stringify([
    { hostname: "widgets.localhost", port: 9999, pid: 0 },
    { hostname: "widgets.otherapp.localhost", port: 9999, pid: 0 },
  ]));

  const result = await migrate({});

  expect(result.adopted).toEqual(["widgets"]);
  expect(result.skipped).toContain("widgets.otherapp");
  expect(getRecord("widgets")).toMatchObject({ label: "com.matthewgoodwin.widgets", managedBy: "user" });
  expect(getRecord("widgets.otherapp")).toBeUndefined();

  const { listRecords } = await import("./records.ts");
  const sharingLabel = listRecords().filter((r) => r.label === "com.matthewgoodwin.widgets");
  expect(sharingLabel.length).toBe(1);
});

test("writes NOTHING to the plist file or routes.json - adopts in place, never rewrites", async () => {
  const plistPath = join(process.env.LOCAL_AGENTS_DIR!, "com.matthewgoodwin.boxscore.plist");
  const routesPath = process.env.LOCAL_APPS_ROUTES_PATH!;
  const plistBefore = readFileSync(plistPath);
  const routesBefore = readFileSync(routesPath);

  await migrate({});

  expect(readFileSync(plistPath)).toEqual(plistBefore);
  expect(readFileSync(routesPath)).toEqual(routesBefore);
});
