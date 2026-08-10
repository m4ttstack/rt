import { test, expect } from "bun:test";
import { authorizeStructural } from "./lifecycle.ts";

test("user caller may remove a user record", () => {
  expect(authorizeStructural({ name: "a", managedBy: "user" }, "user", false)).toEqual({ ok: true });
});

test("user caller on an rt-managed record gets the spec's exact 409", () => {
  const v = authorizeStructural({ name: "gitq", managedBy: "rt" }, "user", false);
  expect(v.ok).toBe(false);
  if (!v.ok) {
    expect(v.status).toBe(409);
    expect(v.body.managedBy).toBe("rt");
    expect(v.body.message).toBe("Managed by mattstack — `rt uninstall gitq`");
    expect(v.body.escapeHatch).toBe("?force=true");
  }
});

test("rt caller on a user record gets the symmetric refusal", () => {
  const v = authorizeStructural({ name: "myapp", managedBy: "user" }, "rt", false);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.body.message).toContain("Managed by user");
});

test("the registrar itself passes; force is the escape hatch for everyone", () => {
  expect(authorizeStructural({ name: "gitq", managedBy: "rt" }, "rt", false).ok).toBe(true);
  expect(authorizeStructural({ name: "gitq", managedBy: "rt" }, "user", true).ok).toBe(true);
});

test("Local's own record is 409-gated to `lcl uninstall`", () => {
  const v = authorizeStructural({ name: "local", managedBy: "local" }, "user", false);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.body.message).toBe("This is Local itself: `lcl uninstall`");
});
