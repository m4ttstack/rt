import { test, expect } from "bun:test";
import { decide, appFromHost, publicPort, safeNext } from "./gateway.ts";
import { signToken } from "./session.ts";
import { pageNothingHere, pageOffline, pageRateLimited, pageLogin } from "./gateway-pages.tsx";

const SECRET = "a".repeat(64);

// appFromHost gains an explicit suffix argument - the hardcode dies.
test("appFromHost strips port and known suffixes", () => {
  expect(appFromHost("nihongo.example.dev", "example.dev")).toBe("nihongo");
  expect(appFromHost("nihongo.example.dev:7950", "example.dev")).toBe("nihongo");
  expect(appFromHost("nihongo.localhost", null)).toBe("nihongo");
  expect(appFromHost("nihongo.localhost", "example.dev")).toBe("nihongo");
});

test("appFromHost strips any configured TLD", () => {
  expect(appFromHost("foo.mattstack", null, ["localhost", "mattstack"])).toBe("foo");
  expect(appFromHost("foo.localhost", null, ["localhost", "mattstack"])).toBe("foo");
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

test("public traffic serves the base port by default, not a dev-port override", () => {
  // The override repoints routes.json at a dev server for .localhost. Following
  // it publicly serves an unbuilt app whose HMR websocket cannot reach the
  // tunnel, which makes the page reload forever.
  expect(publicPort(4101, { basePort: 11007 })).toBe(11007);
});

test("an app that opted in follows its dev-port override publicly", () => {
  expect(publicPort(4101, { basePort: 11007 }, true)).toBe(4101);
});

test("opting in without an override changes nothing", () => {
  expect(publicPort(11007, undefined, true)).toBe(11007);
});

test("public traffic uses the route port when there is no override", () => {
  expect(publicPort(11007, undefined)).toBe(11007);
});

test("no route stays undefined, so the gateway still reports no-route", () => {
  expect(publicPort(undefined, undefined)).toBeUndefined();
  expect(decide({ app: "x", port: publicPort(undefined, undefined), published: true, passwordVersion: 0, secret: SECRET }).kind).toBe("no-route");
});

// Gateway pages are the zero-JS failure path: no <script> may ever appear on
// any of them, in any state.
test("gateway pages carry no <script> tag", () => {
  expect(pageNothingHere()).not.toContain("<script");
  expect(pageOffline("nihongo")).not.toContain("<script");
  expect(pageRateLimited()).not.toContain("<script");
  expect(pageLogin("nihongo")).not.toContain("<script");
  expect(pageLogin("nihongo", { error: true })).not.toContain("<script");
});

test("gateway pages inline the generated token css", () => {
  expect(pageNothingHere()).toContain("--bg:");
  expect(pageLogin("nihongo")).toContain("--bg:");
});

test("pageLogin escapes an app name carrying markup", () => {
  const html = pageLogin('<b>"x"</b>');
  expect(html).not.toContain("<b>");
  expect(html).not.toContain('"x"</b>');
});

test("pageLogin escapes the hidden next field", () => {
  const html = pageLogin("nihongo", { next: '/x"><script>alert(1)</script>' });
  expect(html).not.toContain("<script>alert(1)</script>");
  // The escaped value still round-trips the intended path.
  expect(html).toContain("&quot;");
});

test("pageLogin's form posts to /__auth and carries the password + hidden next fields", () => {
  const html = pageLogin("nihongo", { next: "/dashboard" });
  expect(html).toContain('method="POST"');
  expect(html).toContain('action="/__auth"');
  expect(html).toContain('type="password"');
  expect(html).toContain("autofocus");
  // React emits the DOM property's own case (autoComplete); HTML attribute
  // matching is case-insensitive, so the check is too.
  expect(html.toLowerCase()).toContain('autocomplete="current-password"');
  expect(html).toContain('type="hidden"');
  expect(html).toContain('name="next"');
  expect(html).toContain('value="/dashboard"');
});

test("pageLogin's error paragraph appears only when opts.error is set", () => {
  expect(pageLogin("nihongo")).not.toContain('class="err"');
  expect(pageLogin("nihongo", { error: true })).toContain('class="err"');
});
