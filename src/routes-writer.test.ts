import { test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "la-routes-"));
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
const routesPath = process.env.LOCAL_APPS_ROUTES_PATH;

const { setRoutePort } = await import("./routes-writer.ts");

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

test("no-op returns false when the entry is absent", () => {
  expect(setRoutePort("ghost", 5173)).toBe(false);
  expect(JSON.parse(readFileSync(routesPath, "utf8"))).toHaveLength(2);
});
