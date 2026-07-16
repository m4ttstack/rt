// src/session.test.ts
import { test, expect } from "bun:test";
import { signToken, verifyToken, cookieHeader, parseCookie, COOKIE_NAME } from "./session.ts";

const SECRET = "a".repeat(64);

test("a freshly signed token verifies", () => {
  const t = signToken("nihongo", 3, SECRET);
  expect(verifyToken(t, "nihongo", 3, SECRET)).toBe(true);
});

test("wrong secret fails", () => {
  const t = signToken("nihongo", 3, SECRET);
  expect(verifyToken(t, "nihongo", 3, "b".repeat(64))).toBe(false);
});

test("stale passwordVersion fails (password was changed)", () => {
  const t = signToken("nihongo", 3, SECRET);
  expect(verifyToken(t, "nihongo", 4, SECRET)).toBe(false);
});

test("token for another app fails", () => {
  const t = signToken("nihongo", 3, SECRET);
  expect(verifyToken(t, "secret-app", 3, SECRET)).toBe(false);
});

test("undefined / malformed token fails without throwing", () => {
  expect(verifyToken(undefined, "nihongo", 3, SECRET)).toBe(false);
  expect(verifyToken("garbage", "nihongo", 3, SECRET)).toBe(false);
  expect(verifyToken("a.b.c.d", "nihongo", 3, SECRET)).toBe(false);
});

test("cookieHeader sets host-only secure attributes", () => {
  const h = cookieHeader("tok");
  expect(h).toContain(`${COOKIE_NAME}=tok`);
  expect(h).toContain("HttpOnly");
  expect(h).toContain("Secure");
  expect(h).toContain("SameSite=Lax");
  expect(h).not.toContain("Domain");
});

test("parseCookie extracts the named cookie from a Cookie header", () => {
  expect(parseCookie(`foo=1; ${COOKIE_NAME}=xyz; bar=2`, COOKIE_NAME)).toBe("xyz");
  expect(parseCookie(null, COOKIE_NAME)).toBeUndefined();
  expect(parseCookie("foo=1", COOKIE_NAME)).toBeUndefined();
});
