import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SwitchboardStore } from "../store.ts";
import { makeFetchHandler } from "../server.ts";

const ADMIN = "admintok";
function handler(store = new SwitchboardStore(new Database(":memory:"))) {
  return { store, fetch: makeFetchHandler(store, ADMIN, () => 5000) };
}
function req(path: string, init: RequestInit = {}) {
  return new Request(`http://sb.test${path}`, init);
}
const asAdmin = { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" };

describe("POST /invites", () => {
  test("201 with code/username/expiresAt for admin", async () => {
    const { fetch } = handler();
    const res = await fetch(req("/invites", { method: "POST", headers: asAdmin, body: JSON.stringify({ username: "Grace" }) }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string; username: string; expiresAt: number };
    expect(body.code).toMatch(/^[0-9a-f]{32}$/);
    expect(body.username).toBe("grace");
    expect(typeof body.expiresAt).toBe("number");
  });

  test("401 without admin bearer, 400 on bad body", async () => {
    const { fetch } = handler();
    expect((await fetch(req("/invites", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await fetch(req("/invites", { method: "POST", headers: asAdmin, body: "{}" }))).status).toBe(400);
  });
});

describe("POST /invites/redeem", () => {
  test("200 happy path returns username + token; second redeem is 410", async () => {
    const { store, fetch } = handler();
    const inv = store.createInvite("grace", 1000);
    const body = JSON.stringify({ code: inv.code, username: "grace" });
    const res = await fetch(req("/invites/redeem", { method: "POST", headers: { "content-type": "application/json" }, body }));
    expect(res.status).toBe(200);
    const out = (await res.json()) as { username: string; token: string };
    expect(store.authBoard(out.token)).toBe("grace");
    const again = await fetch(req("/invites/redeem", { method: "POST", headers: { "content-type": "application/json" }, body }));
    expect(again.status).toBe(410);
  });

  test("409 mismatch does not consume; 404 unknown; 410 expired; bodies never name the bound handle", async () => {
    const { store, fetch } = handler();
    const inv = store.createInvite("grace", 1000);
    const mism = await fetch(req("/invites/redeem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: inv.code, username: "bob" }) }));
    expect(mism.status).toBe(409);
    expect(await mism.text()).not.toContain("grace");
    // still redeemable by the right handle after the mismatch
    const ok = await fetch(req("/invites/redeem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: inv.code, username: "grace" }) }));
    expect(ok.status).toBe(200);
    const unknown = await fetch(req("/invites/redeem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "f".repeat(32), username: "x" }) }));
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("replaced");
    const expInv = store.createInvite("bob", -999_999_999_999);
    const expired = await fetch(req("/invites/redeem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: expInv.code, username: "bob" }) }));
    expect(expired.status).toBe(410);
    expect(await expired.text()).not.toContain("bob");
  });
});

describe("GET /invite/<code>", () => {
  test("static page: 200, no-store, no-referrer, identical for real and fake codes, consumes nothing", async () => {
    const { store, fetch } = handler();
    const inv = store.createInvite("grace", 1000);
    const real = await fetch(req(`/invite/${inv.code}`));
    const fake = await fetch(req(`/invite/${"f".repeat(32)}`));
    expect(real.status).toBe(200);
    expect(real.headers.get("cache-control")).toBe("no-store");
    expect(real.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await real.text()).toBe(await fake.text());
    expect(store.redeemInvite(inv.code, "grace", 2000).ok).toBe(true);
  });
});

describe("GET /boards", () => {
  test("401 non-admin; 200 admin list", async () => {
    const { store, fetch } = handler();
    store.registerBoard("grace");
    expect((await fetch(req("/boards"))).status).toBe(401);
    const res = await fetch(req("/boards", { headers: { authorization: `Bearer ${ADMIN}` } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { boards: Array<{ username: string; createdAt: number }> };
    expect(body.boards.map((b) => b.username)).toEqual(["grace"]);
  });
});
