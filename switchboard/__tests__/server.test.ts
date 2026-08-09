import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SwitchboardStore } from "../store.ts";
import { makeFetchHandler } from "../server.ts";

const ADMIN = "admin-secret";

function setup() {
  const store = new SwitchboardStore(new Database(":memory:"));
  const handler = makeFetchHandler(store, ADMIN, () => 1000);
  const call = (path: string, opts: { method?: string; token?: string; body?: unknown } = {}) =>
    handler(new Request(`http://x${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        "content-type": "application/json",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }));
  return { store, call };
}

const draft = (id: string, to: string) => ({ id, to, type: "review-state", sentAt: 1, payload: {} });

describe("switchboard http", () => {
  test("healthz is open", async () => {
    const { call } = setup();
    expect((await call("/healthz")).status).toBe(200);
  });
  test("board registration needs the admin token", async () => {
    const { call } = setup();
    expect((await call("/boards", { token: "nope", body: { username: "ada" } })).status).toBe(401);
    const res = await call("/boards", { token: ADMIN, body: { username: "Ada" } });
    expect(res.status).toBe(201);
    const { username, token } = await res.json() as { username: string; token: string };
    expect(username).toBe("ada");
    expect(token.length).toBeGreaterThan(20);
  });
  test("publish → inbox → ack round trip", async () => {
    const { call } = setup();
    const ada = (await (await call("/boards", { token: ADMIN, body: { username: "ada" } })).json() as { token: string }).token;
    const grace = (await (await call("/boards", { token: ADMIN, body: { username: "grace" } })).json() as { token: string }).token;
    const pub = await call("/envelopes", { token: ada, body: draft("e1", "grace") });
    expect(pub.status).toBe(201);
    const inbox = await (await call("/inbox", { token: grace })).json() as { envelopes: Array<{ id: string; from: string; receivedAt: number }> };
    expect(inbox.envelopes.map((e) => e.id)).toEqual(["e1"]);
    expect(inbox.envelopes[0]!.from).toBe("ada");
    expect(inbox.envelopes[0]!.receivedAt).toBe(1000);
    const ack = await call("/inbox/ack", { token: grace, body: { ids: ["e1"] } });
    expect((await ack.json() as { acked: number }).acked).toBe(1);
    expect(((await (await call("/inbox", { token: grace })).json()) as { envelopes: unknown[] }).envelopes.length).toBe(0);
  });
  test("unknown recipient → 422", async () => {
    const { call } = setup();
    const ada = (await (await call("/boards", { token: ADMIN, body: { username: "ada" } })).json() as { token: string }).token;
    const res = await call("/envelopes", { token: ada, body: draft("e1", "nobody") });
    expect(res.status).toBe(422);
    expect((await res.json() as { error: string }).error).toBe("unknown-recipient");
  });
  test("board endpoints reject a missing/bad token", async () => {
    const { call } = setup();
    expect((await call("/inbox")).status).toBe(401);
    expect((await call("/envelopes", { token: "bad", body: draft("e", "x") })).status).toBe(401);
  });
  test("bad publish body → 400", async () => {
    const { call } = setup();
    const ada = (await (await call("/boards", { token: ADMIN, body: { username: "ada" } })).json() as { token: string }).token;
    expect((await call("/envelopes", { token: ada, body: { nope: 1 } })).status).toBe(400);
  });
});
