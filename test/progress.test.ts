import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAll } from "../server/pipeline/fetch.js";
import { withWindow } from "../server/leaderboard.js";
import type { Env } from "../server/config/index.js";
import type { RefreshProgress } from "../shared/types.js";
import { WINDOW } from "./fixtures.js";

const ENV: Env = { baseUrl: "https://gl.example", token: "tkn" };
afterEach(() => vi.unstubAllGlobals());

describe("withWindow", () => {
  it("stamps the window onto each progress event", () => {
    const seen: RefreshProgress[] = [];
    const wrapped = withWindow("prior", (p) => seen.push(p));
    wrapped!({ phase: "mrs-detail", label: "Fetching MR details", done: 2, total: 5 });
    expect(seen).toEqual([
      { phase: "mrs-detail", label: "Fetching MR details", done: 2, total: 5, window: "prior" },
    ]);
  });

  it("returns undefined when no reporter is given", () => {
    expect(withWindow("current", undefined)).toBeUndefined();
  });
});

describe("fetchAll progress emission", () => {
  it("emits the users and mrs-list phases", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/api/graphql")) {
        return new Response(
          JSON.stringify({ data: { project: { mergeRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
          { status: 200 },
        );
      }
      return new Response("[]", { status: 200 }); // REST /users etc.
    });
    const phases = new Set<string>();
    await fetchAll({
      env: ENV,
      scope: { type: "projects", projectPaths: ["org/app"] },
      window: WINDOW,
      users: ["alice"],
      concurrency: 2,
      onProgress: (p) => phases.add(p.phase),
    });
    expect(phases.has("users")).toBe(true);
    expect(phases.has("mrs-list")).toBe(true);
  });
});
