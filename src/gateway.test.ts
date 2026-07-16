import { test, expect } from "bun:test";
import { decide, appFromHost } from "./gateway.ts";
import { signToken } from "./session.ts";

const SECRET = "a".repeat(64);

test("appFromHost strips port and known suffixes", () => {
  expect(appFromHost("nihongo.m4tthew.dev")).toBe("nihongo");
  expect(appFromHost("nihongo.m4tthew.dev:7950")).toBe("nihongo");
  expect(appFromHost("nihongo.localhost")).toBe("nihongo");
});

test("unknown route → no-route", () => {
  const d = decide({ app: "x", port: undefined, published: true, passwordVersion: 0, secret: SECRET });
  expect(d.kind).toBe("no-route");
});

test("unpublished → not-published even with a valid route", () => {
  const d = decide({ app: "x", port: 8080, published: false, passwordVersion: 0, secret: SECRET });
  expect(d.kind).toBe("not-published");
});

test("published, no password → proxy", () => {
  const d = decide({ app: "x", port: 8080, published: true, passwordVersion: 0, secret: SECRET });
  expect(d).toEqual({ kind: "proxy", app: "x", port: 8080 });
});

test("password set, no cookie → needs-login", () => {
  const d = decide({ app: "x", port: 8080, published: true, passwordHash: "$2b$hash", passwordVersion: 1, secret: SECRET });
  expect(d.kind).toBe("needs-login");
});

test("password set, valid cookie → proxy", () => {
  const cookie = signToken("x", 1, SECRET);
  const d = decide({ app: "x", port: 8080, published: true, passwordHash: "$2b$hash", passwordVersion: 1, cookie, secret: SECRET });
  expect(d).toEqual({ kind: "proxy", app: "x", port: 8080 });
});

test("password set, stale cookie (version bumped) → needs-login", () => {
  const cookie = signToken("x", 1, SECRET);
  const d = decide({ app: "x", port: 8080, published: true, passwordHash: "$2b$hash", passwordVersion: 2, cookie, secret: SECRET });
  expect(d.kind).toBe("needs-login");
});
