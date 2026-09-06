// src/registry/allocate.test.ts
import { test, expect } from "bun:test";
import { allocatePort } from "./allocate.ts";
import type { AppRecord } from "./records.ts";

const rec = (name: string, port: number): AppRecord => ({
  name, managedBy: "user", port, kind: "external", createdAt: "2026-08-10T00:00:00Z",
});

test("starts at 11000 with nothing taken", () => {
  expect(allocatePort([], [], [])).toBe(11000);
});

test("skips ports held by registry records, routes, and launchd services", () => {
  const routes = [{ hostname: "a.localhost", port: 11000 }];
  const services = [{ port: 11001 } as any];
  const records = [rec("b", 11002)];
  expect(allocatePort(records, routes, services)).toBe(11003);
});

test("a registry record outside the range does not confuse allocation", () => {
  expect(allocatePort([rec("mattari", 4101)], [], [])).toBe(11000);
});
