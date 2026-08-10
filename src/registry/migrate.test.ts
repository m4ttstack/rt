import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
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
