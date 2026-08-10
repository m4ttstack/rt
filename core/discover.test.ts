import { test, expect } from "bun:test";
import { nextFreePort, type LaunchdService, type PortlessRoute } from "./discover.ts";

const route = (port: number): PortlessRoute => ({ hostname: `a${port}.localhost`, port });
const svc = (port: number | null): LaunchdService => ({
  label: "x", plistPath: "", program: [], workingDirectory: null,
  stderrPath: null, port, pid: null, lastExitStatus: null,
});

test("returns range start when nothing is used", () => {
  expect(nextFreePort([], [])).toBe(11000);
});

test("skips ports taken by routes", () => {
  expect(nextFreePort([route(11000)], [])).toBe(11001);
});

test("skips ports taken by launchd services", () => {
  expect(nextFreePort([], [svc(11000), svc(11001)])).toBe(11002);
});

test("ignores ports outside the range", () => {
  expect(nextFreePort([route(8080)], [svc(null)])).toBe(11000);
});
