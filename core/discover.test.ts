import { test, expect } from "bun:test";
import { nextFreePort, bareName, dedupeRoutes, type LaunchdService, type PortlessRoute } from "./discover.ts";

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

test("bareName strips any configured TLD labels, greedily from the right", () => {
  const tlds = ["localhost", "mattstack"];
  expect(bareName("board.localhost", tlds)).toBe("board");
  expect(bareName("board.mattstack", tlds)).toBe("board");
  expect(bareName("board.mattstack.localhost", tlds)).toBe("board");
  expect(bareName("deck.mattstack", tlds)).toBe("deck");
  // a dotted app name whose labels are not TLDs survives
  expect(bareName("deck.mattstack.localhost", ["localhost"])).toBe("deck.mattstack");
});

test("dedupeRoutes collapses one app's multi-TLD entries to a single row", () => {
  const routes = [
    { hostname: "board.localhost", port: 11997 },
    { hostname: "board.mattstack", port: 11997 },
    { hostname: "board.mattstack.localhost", port: 11997 },
    { hostname: "apps.localhost", port: 7940 },
  ];
  const out = dedupeRoutes(routes, ["localhost", "mattstack"]);
  expect(out).toEqual([
    { hostname: "board.localhost", port: 11997 },
    { hostname: "apps.localhost", port: 7940 },
  ]);
});

test("dedupeRoutes prefers .localhost regardless of on-disk order", () => {
  // routes.json's on-disk order is portless's to control, not Deck's - if a
  // non-.localhost variant happens to be written first, dedupe must still
  // keep the .localhost variant so the board always shows/probes the port a
  // dev-port override actually repoints.
  const routes = [
    { hostname: "board.mattstack", port: 1 },
    { hostname: "board.localhost", port: 1 },
  ];
  const out = dedupeRoutes(routes, ["localhost", "mattstack"]);
  expect(out).toEqual([{ hostname: "board.localhost", port: 1 }]);
});

import { servicePrefixes, shortLabel } from "./discover.ts";

test("servicePrefixes is the product prefix plus grandfathered ones", () => {
  expect(servicePrefixes([])).toEqual(["com.mattstack.deck."]);
  expect(servicePrefixes(["com.example.legacy."])).toEqual([
    "com.mattstack.deck.", "com.example.legacy.",
  ]);
});

test("shortLabel strips whichever prefix matches", () => {
  const prefixes = servicePrefixes(["com.example.legacy."]);
  expect(shortLabel("com.mattstack.deck.myapp", prefixes)).toBe("myapp");
  expect(shortLabel("com.example.legacy.boxscore", prefixes)).toBe("boxscore");
  expect(shortLabel("com.mattstack.deck", prefixes)).toBe("deck");
});
