import { afterEach, describe, expect, it, vi } from "vitest";
import { restGetOne } from "../server/gitlab/rest.js";
import { gqlRequest } from "../server/gitlab/graphql.js";
import { fetchLinearIssues } from "../server/linear/fetch.js";
import type { Env } from "../server/env.js";
import type { LeaderboardWarning, TimeWindow } from "../shared/types.js";

const ENV: Env = { baseUrl: "https://gl.example", token: "tkn", port: 0 };
const WINDOW: TimeWindow = {
  start: "2026-05-01T00:00:00.000Z",
  end: "2026-06-01T00:00:00.000Z",
  key: "30d",
};
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

  it("propagates an AbortError from fetchLinearIssues instead of swallowing it", async () => {
    const inits: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      inits.push(init);
      const e = new Error("aborted"); e.name = "AbortError"; throw e;
    });
    const warnings: LeaderboardWarning[] = [];
    const c = new AbortController();
    const options = { apiKey: "lin_key", emailByUser: { alice: "alice@example.com" } };

    await expect(
      fetchLinearIssues(options, WINDOW, warnings, c.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    // Cancellation must not degrade to a warning + [].
    expect(warnings).toEqual([]);
    // The client forwards the signal into fetch.
    expect(inits[0]?.signal).toBe(c.signal);
  });
});
