import { afterEach, describe, expect, it, vi } from "vitest";
import { restGetOne } from "../server/gitlab/rest.js";
import { gqlRequest } from "../server/gitlab/graphql.js";
import type { Env } from "../server/env.js";

const ENV: Env = { baseUrl: "https://gl.example", token: "tkn", port: 0 };
afterEach(() => vi.unstubAllGlobals());

describe("abort signal threading", () => {
  it("forwards the signal to fetch for REST", async () => {
    const inits: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      inits.push(init);
      return new Response("[]", { status: 200 });
    });
    const c = new AbortController();
    await restGetOne(ENV, "/users", { username: "x" }, c.signal);
    expect(inits[0]?.signal).toBe(c.signal);
  });

  it("rethrows an AbortError instead of wrapping it (REST)", async () => {
    vi.stubGlobal("fetch", async () => {
      const e = new Error("aborted"); e.name = "AbortError"; throw e;
    });
    await expect(restGetOne(ENV, "/users", {})).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rethrows an AbortError instead of wrapping it (GraphQL)", async () => {
    vi.stubGlobal("fetch", async () => {
      const e = new Error("aborted"); e.name = "AbortError"; throw e;
    });
    await expect(gqlRequest(ENV, "query { x }", {})).rejects.toMatchObject({ name: "AbortError" });
  });
});
