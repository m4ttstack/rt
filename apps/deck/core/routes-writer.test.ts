import { test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "la-routes-"));
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
const routesPath = process.env.LOCAL_APPS_ROUTES_PATH;

const { setRoutePort } = await import("./routes-writer.ts");
const { readRoutes } = await import("./discover.ts");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  writeFileSync(
    routesPath,
    JSON.stringify(
      [
        { hostname: "boxscore.localhost", port: 8787, pid: 0 },
        { hostname: "prisma7.localhost", port: 8083, pid: 0 },
      ],
      null,
      2,
    ),
  );
});

test("changes only the matching entry's port, preserves other fields", () => {
  expect(setRoutePort("boxscore", 5173)).toBe(true);
  const routes = JSON.parse(readFileSync(routesPath, "utf8"));
  expect(routes.find((r) => r.hostname === "boxscore.localhost")).toEqual({
    hostname: "boxscore.localhost",
    port: 5173,
    pid: 0,
  });
  expect(routes.find((r) => r.hostname === "prisma7.localhost")).toEqual({
    hostname: "prisma7.localhost",
    port: 8083,
    pid: 0,
  });
});

test("accepts a full .localhost hostname", () => {
  expect(setRoutePort("boxscore.localhost", 4000)).toBe(true);
  const routes = JSON.parse(readFileSync(routesPath, "utf8"));
  expect(routes.find((r) => r.hostname === "boxscore.localhost").port).toBe(4000);
});

test("the write preserves the file's inode, keeping portless's fs.watch alive", () => {
  // portless watches routes.json by path with fs.watch, which follows the inode.
  // An atomic temp+rename write replaces the inode and permanently deafens the
  // proxy to later route changes, so .localhost silently serves stale ports.
  // If this fails, the writer went back to rename-based writing.
  const before = statSync(routesPath).ino;
  setRoutePort("boxscore", 5173);
  setRoutePort("boxscore", 5174); // repeated writes must keep the same inode
  expect(statSync(routesPath).ino).toBe(before);
});

test("a torn read falls back to the last good routes, never an empty table", () => {
  // In-place writes mean a reader can catch the file half-written. Reporting no
  // routes then would empty the gateway's table and 404 every app.
  expect(readRoutes()).toHaveLength(2);
  writeFileSync(routesPath, '[{"hostname": "boxscore.localh'); // partial write
  expect(readRoutes()).toHaveLength(2);
});

test("the write leaves no temp file behind", () => {
  setRoutePort("boxscore", 5173);
  expect(existsSync(routesPath + ".tmp")).toBe(false);
});

test("no-op returns false when the entry is absent", () => {
  expect(setRoutePort("ghost", 5173)).toBe(false);
  expect(JSON.parse(readFileSync(routesPath, "utf8"))).toHaveLength(2);
});

test("ensureRoute appends a missing hostname once and never duplicates", async () => {
  const path = process.env.LOCAL_APPS_ROUTES_PATH!;
  writeFileSync(path, JSON.stringify([{ hostname: "a.localhost", port: 1, pid: 0 }]));
  const { ensureRoute } = await import("./routes-writer.ts");
  expect(ensureRoute("deck.mattstack", 11007)).toBe(true);
  expect(ensureRoute("deck.mattstack", 11007)).toBe(false);
  const routes = JSON.parse(readFileSync(path, "utf8"));
  expect(routes.map((r: { hostname: string }) => r.hostname)).toEqual(["a.localhost", "deck.mattstack"]);
});
