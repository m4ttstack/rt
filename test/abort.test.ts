import { afterEach, describe, expect, it, vi } from "vitest";
import { restGetOne } from "../server/gitlab/rest.js";
import { gqlRequest } from "../server/gitlab/graphql.js";
import { resolveLinearTickets } from "../server/linear/fetch.js";
import type { NormMr } from "../server/pipeline/model.js";
import type { Env } from "../server/env.js";
import type { LeaderboardWarning } from "../shared/types.js";

const ENV: Env = { baseUrl: "https://gl.example", token: "tkn", port: 0 };
afterEach(() => vi.unstubAllGlobals());

const mergedMr: NormMr = {
  iid: 1,
  projectPath: "org/app",
  authorUsername: "alice",
  state: "merged",
  createdAt: "2026-05-01T00:00:00.000Z",
  preparedAt: null,
  mergedAt: "2026-05-10T00:00:00.000Z",
  sourceBranch: null,
  description: null,
  title: "Fix ACME-123 bug",
  labels: [],
  additions: 10,
  deletions: 5,
  fileCount: 1,
  approvedByUsernames: [],
  notes: [],
  diffStats: [],
};

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
