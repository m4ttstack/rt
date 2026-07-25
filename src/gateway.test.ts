import { test, expect } from "bun:test";
import { decide, appFromHost, publicPort, safeNext } from "./gateway.ts";
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

test("safeNext allows a normal path", () => {
  expect(safeNext("/dashboard")).toBe("/dashboard");
});
test("safeNext rejects protocol-relative //evil.com", () => {
  expect(safeNext("//evil.com")).toBe("/");
});
test("safeNext rejects backslash bypass /\\evil.com", () => {
  expect(safeNext("/\\evil.com")).toBe("/");
});
test("safeNext rejects absolute URLs and null", () => {
  expect(safeNext("http://evil.com")).toBe("/");
  expect(safeNext(null)).toBe("/");
});
test("safeNext rejects CRLF injection", () => {
  expect(safeNext("/foo\r\nSet-Cookie: x=1")).toBe("/");
  expect(safeNext("/foo\nbar")).toBe("/");
});

test("public traffic serves the base port, never a dev-port override", () => {
  // The override repoints routes.json at a dev server for .localhost. Following
  // it publicly serves an unbuilt app whose HMR websocket cannot reach the
  // tunnel, which makes the page reload forever.
  expect(publicPort(4101, { basePort: 11007 })).toBe(11007);
});

test("public traffic uses the route port when there is no override", () => {
  expect(publicPort(11007, undefined)).toBe(11007);
});

test("no route stays undefined, so the gateway still reports no-route", () => {
  expect(publicPort(undefined, undefined)).toBeUndefined();
  expect(decide({ app: "x", port: publicPort(undefined, undefined), published: true, passwordVersion: 0, secret: SECRET }).kind).toBe("no-route");
});
