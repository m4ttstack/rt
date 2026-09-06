// test/e2e.smoke.test.ts
//
// Real launchd, real HTTP, throwaway everything else. Gated behind
// LOCAL_E2E=1 -- this loads an actual macOS LaunchAgent via real launchctl,
// so it must never run as part of the default suite (`bun test core src`)
// and must only ever be run attended (`bun run test:e2e`).
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";

if (process.env.LOCAL_E2E !== "1") {
  test.skip("e2e smoke (set LOCAL_E2E=1)", () => {});
} else {
  const dir = mkdtempSync(join(tmpdir(), "local-e2e-"));
  process.env.LOCAL_STATE_DIR = dir;
  process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
  process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
  process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
  process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
  // deck.platform reads through rt-client, which resolves HOME at call time (not overridable
  // via a LOCAL_*_PATH var) -- must be faked here too, or this test touches the real ~/.mattstack.
  process.env.HOME = dir;
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, "[]");

  const NAME = `e2e-smoke-${Date.now()}`;
  const LABEL = `com.mattstack.deck.${NAME}`;
  const appDir = join(dir, "app");

  test("register -> serve -> override -> unregister with real launchd", async () => {
    const { startApi } = await import("../src/api/server.ts");
    const { LaunchdManager } = await import("../src/services/launchd.ts");
    const { FakeEdgeProxy } = await import("../src/edge/portless.ts");
    const { FakeTunnelDriver } = await import("../src/edge/tunnel.ts");

    const PORT = 18979;
    const deps = {
      manager: new LaunchdManager(), edge: new FakeEdgeProxy(), tunnel: new FakeTunnelDriver(),
      port: PORT, canaryPort: PORT + 1,
      freshness: () => "unknown" as const, autoHeal: () => null, onRouteWrite: () => {},
    };
    const server = startApi(deps);
    try {
      // A real one-file app for launchd to supervise.
      const { mkdirSync } = await import("fs");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, "server.ts"),
        `Bun.serve({ port: Number(process.env.PORT), hostname: "127.0.0.1", fetch: () => new Response("smoke-ok") });`);

      const bunBin = process.execPath; // the bun running this test
      const reg = await fetch(`http://127.0.0.1:${PORT}/api/v1/apps`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: NAME, command: [bunBin, "server.ts"], workingDirectory: appDir }),
      });
      expect(reg.status).toBe(201);
      const { record } = (await reg.json()) as { record: { port: number } };
      expect(existsSync(join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`))).toBe(true);

      // serve: launchd starts it; poll the allocated port
      let up = false;
      for (let i = 0; i < 30 && !up; i++) {
        await new Promise((r) => setTimeout(r, 500));
        up = await fetch(`http://127.0.0.1:${record.port}/`).then((r) => r.ok).catch(() => false);
      }
      expect(up).toBe(true);

      // override: routes file (faked portless) repoints; the write discipline is core's
      writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!,
        JSON.stringify([{ hostname: `${NAME}.localhost`, port: record.port, pid: 0 }]));
      const ov = await fetch(`http://127.0.0.1:${PORT}/api/v1/apps/${NAME}/override`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ devPort: 19555 }),
      });
      expect(ov.status).toBe(200);
      const routes = JSON.parse(await Bun.file(process.env.LOCAL_APPS_ROUTES_PATH!).text());
      expect(routes[0].port).toBe(19555);

      // unregister: service gone from launchd and disk
      const del = await fetch(`http://127.0.0.1:${PORT}/api/v1/apps/${NAME}`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect(existsSync(join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`))).toBe(false);
    } finally {
      // Belt and braces: never leave a smoke agent behind, even on failure.
      Bun.spawnSync(["launchctl", "unload", join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`)]);
      rmSync(join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`), { force: true });
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
}
