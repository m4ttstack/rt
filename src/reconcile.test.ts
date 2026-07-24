import { test, expect } from "bun:test";
import { overridesToReassert } from "./reconcile.ts";

const aligned = [
  { hostname: "boxscore.localhost", port: 5173, pid: 0 },
  { hostname: "prisma7.localhost", port: 8083, pid: 0 },
];

test("no drift produces no re-assertions", () => {
  expect(overridesToReassert(aligned, { boxscore: { devPort: 5173, basePort: 8787 } })).toEqual([]);
});

test("a drifted route is re-asserted to devPort", () => {
  const drifted = [{ hostname: "boxscore.localhost", port: 8787, pid: 0 }];
  expect(
    overridesToReassert(drifted, { boxscore: { devPort: 5173, basePort: 8787 } }),
  ).toEqual([{ hostname: "boxscore", devPort: 5173 }]);
});

test("apps without an override are never touched", () => {
  expect(overridesToReassert(aligned, {})).toEqual([]);
});

test("an override for an app with no route is skipped", () => {
  expect(overridesToReassert(aligned, { ghost: { devPort: 9000, basePort: 8000 } })).toEqual([]);
});
