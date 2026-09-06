import { expect, test } from "bun:test";
import { remoteRefuseChecks, type RefuseCtx } from "./remote.ts";
import type { AppRecord } from "../registry/records.ts";

const svc: AppRecord = { name: "site", managedBy: "user", port: 11010, kind: "service",
  command: ["bun", "run", "serve"], workingDirectory: "/tmp/site", label: "com.mattstack.deck.site", createdAt: "t" };

const ok: RefuseCtx = { record: svc, publicDomain: "m4tthew.dev",
  railway: { projectId: "p", environmentId: "e" }, oauth: { mode: "emails" },
  hasRailwayToken: true, cfCanEditDns: true, zoneSslMode: "full" };

test("all checks pass", () => { expect(remoteRefuseChecks(ok)).toBeNull(); });

test("no start command", () => {
  const ext: AppRecord = { ...svc, kind: "external", command: undefined, label: undefined };
  expect(remoteRefuseChecks({ ...ok, record: ext })!.body.error).toBe("no start command, cannot push");
});
test("no bound domain", () => { expect(remoteRefuseChecks({ ...ok, publicDomain: null })!.body.error).toBe("no-domain-bound"); });
test("password-gated (oauth off) refused", () => { expect(remoteRefuseChecks({ ...ok, oauth: { mode: "off" } })!.body.error).toBe("remote-requires-access"); });
test("missing railway token → 428", () => { const r = remoteRefuseChecks({ ...ok, hasRailwayToken: false })!; expect(r.status).toBe(428); expect(r.body.error).toBe("railway-token-required"); });
test("cf token lacks dns edit", () => { expect(remoteRefuseChecks({ ...ok, cfCanEditDns: false })!.body.error).toBe("cf-token-needs-zone-dns"); });
test("zone ssl strict refused", () => { expect(remoteRefuseChecks({ ...ok, zoneSslMode: "strict" })!.body.error).toBe("zone-ssl-mode-full-required"); });
test("subdomain publicDomain refused", () => { expect(remoteRefuseChecks({ ...ok, publicDomain: "apps.m4tthew.dev" })!.body.error).toBe("public-domain-must-be-first-level"); });
test("no railway project configured", () => { expect(remoteRefuseChecks({ ...ok, railway: null })!.body.error).toBe("railway-not-configured"); });
