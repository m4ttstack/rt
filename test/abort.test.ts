import { afterEach, describe, expect, it, vi } from "vitest";
import { restGetOne } from "../server/gitlab/rest.js";
import { gqlRequest } from "../server/gitlab/graphql.js";
import { resolveLinearTickets } from "../server/linear/fetch.js";
import { mr } from "./fixtures.js";
import type { Env } from "../server/config/index.js";
import type { LeaderboardWarning } from "../shared/types.js";

const ENV: Env = { baseUrl: "https://gl.example", token: "tkn" };
afterEach(() => vi.unstubAllGlobals());

const mergedMr = mr({
  iid: 1,
  authorUsername: "alice",
  title: "Fix ACME-123 bug",
  mergedAt: "2026-05-10T00:00:00.000Z",
  additions: 10,
  deletions: 5,
});

describe("abort signal threading", () => {
  it("forwards a signal to fetch for REST that the caller's abort still trips", async () => {
    const inits: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      inits.push(init);
      return new Response("[]", { status: 200 });
    });
    const c = new AbortController();
    await restGetOne(ENV, "/users", { username: "x" }, c.signal);

    // Not the caller's signal itself: each attempt combines it with that attempt's deadline,
    // so a stalled socket ends without waiting on the job-level abort. Cancellation must
    // still reach fetch through the composite.
    const passed = inits[0]?.signal;
    expect(passed).toBeDefined();
    expect(passed!.aborted).toBe(false);
    c.abort();
    expect(passed!.aborted).toBe(true);
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

  it("propagates an AbortError from resolveLinearTickets instead of swallowing it", async () => {
    vi.stubGlobal("fetch", async () => {
      const e = new Error("aborted"); e.name = "AbortError"; throw e;
    });
    const warnings: LeaderboardWarning[] = [];
    const c = new AbortController();

    await expect(
      resolveLinearTickets("lin_key", [mergedMr], warnings, c.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    // Cancellation must not degrade to a warning + [].
    expect(warnings).toEqual([]);
  });
});
