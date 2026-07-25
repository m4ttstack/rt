import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "la-canary-"));
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
const routesPath = process.env.LOCAL_APPS_ROUTES_PATH;

const { CANARY_PATH, checkProxyFreshness, interpretProbe, startCanaryListener } =
  await import("./canary.ts");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const routePort = (name: string) =>
  JSON.parse(readFileSync(routesPath, "utf8")).find(
    (r: { hostname: string }) => r.hostname === `${name}.localhost`,
  )?.port;

test("a matching port means the proxy saw the change", () => {
  expect(interpretProbe(7942, 7942)).toBe("fresh");
});

test("the old port answering means the proxy never saw the change", () => {
  expect(interpretProbe(7942, 7940)).toBe("stale");
});

test("an unreachable proxy is inconclusive, never reported as stale", () => {
  // A proxy that is down must not be mistaken for a dead watcher.
  expect(interpretProbe(7942, null)).toBe("unknown");
});

test("the canary listener reports its own port at the identity path", async () => {
  const server = startCanaryListener(0, 1); // port 0: let the OS pick
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}${CANARY_PATH}`);
    expect(await res.text()).toBe(String(server.port));
  } finally {
    server.stop(true);
  }
});

test("the canary listener forwards every other request to the board", async () => {
  const board = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("real board"),
  });
  const canary = startCanaryListener(0, board.port!);
  try {
    const res = await fetch(`http://127.0.0.1:${canary.port}/anything-else`);
    expect(await res.text()).toBe("real board");
  } finally {
    canary.stop(true);
    board.stop(true);
  }
});

test("the check always restores the board's route, even when the probe fails", async () => {
  writeFileSync(
    routesPath,
    JSON.stringify([{ hostname: "apps.localhost", port: 7940, pid: 0 }], null, 2),
  );
  // No proxy is running in the test environment, so the probe cannot answer.
  const state = await checkProxyFreshness({
    app: "apps",
    mainPort: 7940,
    canaryPort: 7942,
    timeoutMs: 800,
  });
  expect(state).toBe("unknown");
  expect(routePort("apps")).toBe(7940); // flipped and put back
});

test("the check is a no-op when the board has no route to flip", async () => {
  writeFileSync(routesPath, JSON.stringify([], null, 2));
  const state = await checkProxyFreshness({
    app: "apps",
    mainPort: 7940,
    canaryPort: 7942,
    timeoutMs: 500,
  });
  expect(state).toBe("unknown");
});
