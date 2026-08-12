import { describe, expect, test } from "bun:test";
import { createInvite, joinSwitchboard, listPeerBoards } from "../peer/onboard.ts";

const fakeFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  (async (u: RequestInfo | URL, i?: RequestInit) => handler(String(u), i)) as unknown as typeof fetch;

describe("createInvite", () => {
  test("composes the one-paste string from switchboard.url + returned code", async () => {
    const f = fakeFetch((url, init) => {
      expect(url).toBe("https://sb.example.app/invites");
      expect(init?.headers).toMatchObject({ authorization: "Bearer admintok" });
      return Response.json({ code: "a".repeat(32), username: "grace", expiresAt: 1 }, { status: 201 });
    });
    const r = await createInvite("grace", { url: "https://sb.example.app", adminToken: "admintok", fetchFn: f });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ invite: `https://sb.example.app/invite/${"a".repeat(32)}` });
  });
  test("passes relay errors through as plain text; network becomes 502", async () => {
    const f = fakeFetch(() => new Response("unauthorized", { status: 401 }));
    expect(await createInvite("g", { url: "https://x", adminToken: "t", fetchFn: f })).toEqual({ status: 401, body: "unauthorized" });
    const dead = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    const r = await createInvite("g", { url: "https://x", adminToken: "t", fetchFn: dead });
    expect(r.status).toBe(502);
  });
});

describe("joinSwitchboard", () => {
  const goodFetch = fakeFetch(() => Response.json({ username: "grace", token: "tok" }));

  test("fails fast before any network when defaultMember is unset or all", async () => {
    let fetched = 0;
    const f = fakeFetch(() => (fetched++, Response.json({})));
    for (const dm of ["", "all"]) {
      const r = await joinSwitchboard("https://x/invite/" + "a".repeat(32), { defaultMember: dm, persist: () => {}, startPeering: () => {}, fetchFn: f });
      expect(r.status).toBe(400);
      expect(r.body).toContain("username");
    }
    expect(fetched).toBe(0);
  });

  test("unparseable invite is 400 with the parse message", async () => {
    const r = await joinSwitchboard("garbage", { defaultMember: "grace", persist: () => {}, startPeering: () => {}, fetchFn: goodFetch });
    expect(r.status).toBe(400);
  });

  test("happy path: persists then starts peering, in that order", async () => {
    const calls: string[] = [];
    const r = await joinSwitchboard("https://sb.example.app/invite/" + "a".repeat(32), {
      defaultMember: "Grace",   // canonicalized before redeem
      persist: (url, token) => calls.push(`persist:${url}:${token}`),
      startPeering: (url, token) => calls.push(`start:${url}:${token}`),
      fetchFn: fakeFetch((url, init) => {
        expect(JSON.parse(String(init?.body)).username).toBe("grace");
        return Response.json({ username: "grace", token: "tok" });
      }),
    });
    expect(r.status).toBe(200);
    expect(calls).toEqual(["persist:https://sb.example.app:tok", "start:https://sb.example.app:tok"]);
  });

  test("mismatch surfaces the relay body verbatim as 409 and persists nothing", async () => {
    const f = fakeFetch(() => new Response("this invite is for a different board handle", { status: 409 }));
    let persisted = false;
    const r = await joinSwitchboard("https://x/invite/" + "a".repeat(32), { defaultMember: "bob", persist: () => { persisted = true; }, startPeering: () => {}, fetchFn: f });
    expect(r.status).toBe(409);
    expect(r.body).toContain("different board handle");
    expect(persisted).toBe(false);
  });

  test("persist failure after redeem answers 500 with the re-invite recovery copy", async () => {
    const r = await joinSwitchboard("https://x/invite/" + "a".repeat(32), {
      defaultMember: "grace",
      persist: () => { throw new Error("disk"); },
      startPeering: () => { throw new Error("must not be called"); },
      fetchFn: goodFetch,
    });
    expect(r.status).toBe(500);
    expect(r.body).toContain("re-invite");
  });
});

describe("listPeerBoards", () => {
  test("proxies GET /boards with the admin bearer", async () => {
    const f = fakeFetch((url, init) => {
      expect(url).toBe("https://x/boards");
      expect(init?.headers).toMatchObject({ authorization: "Bearer t" });
      return Response.json({ boards: [{ username: "grace", createdAt: 1 }] });
    });
    const r = await listPeerBoards({ url: "https://x", adminToken: "t", fetchFn: f });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).boards.length).toBe(1);
  });
});
