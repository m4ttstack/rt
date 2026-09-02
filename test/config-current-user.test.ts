import { beforeEach, describe, expect, it } from "vitest";
import { __resetCurrentUser, getCurrentUser } from "../server/config/current-user.js";

const okFetch = (body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

beforeEach(() => __resetCurrentUser());

describe("getCurrentUser", () => {
  it("reads /api/v4/user once and caches", async () => {
    let calls = 0;
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      expect(String(url)).toBe("https://gl.example/api/v4/user");
      expect((init?.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBe("tok");
      return new Response(JSON.stringify({ username: "ada", name: "Ada L" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await getCurrentUser("https://gl.example", "tok", f)).toEqual({ username: "ada", name: "Ada L" });
    expect(await getCurrentUser("https://gl.example", "tok", f)).toEqual({ username: "ada", name: "Ada L" });
    expect(calls).toBe(1);
  });

  it("returns null on a non-2xx response and does not cache the failure", async () => {
    const denied = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    expect(await getCurrentUser("https://gl.example", "tok", denied)).toBeNull();
    expect(await getCurrentUser("https://gl.example", "tok", okFetch({ username: "ada", name: null }))).toEqual({ username: "ada", name: null });
  });

  it("returns null under vitest when no fetch is injected", async () => {
    expect(await getCurrentUser("https://gl.example", "tok")).toBeNull();
  });
});
