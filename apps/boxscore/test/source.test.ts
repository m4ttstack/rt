import { describe, expect, it } from "vitest";
import type {
  FetchMergeRequestIndexOptions,
  FetchMergeRequestMetricsOptions,
  FetchProjectOptions,
  FetchProjectPipelinesOptions,
  FetchUserEventsOptions,
  MergeRequestIndexRow,
  MergeRequestMetrics,
  PipelineSummary,
  UserEvent,
} from "@mattstack/glance";
import type { RequestIO, SourceProvider } from "../src/server/source/provider.js";
import {
  fetchMetrics,
  fetchPipelinesFor,
  fetchProjectRef,
  fetchPushesFor,
  resolveIdentity,
  scanProject,
  toIndexRow,
  toStoredMetrics,
  toStoredPipeline,
  toStoredPushEvent,
} from "../src/server/source/index.js";
import type { TimeWindow } from "../src/shared/types.js";

interface Call {
  method: string;
  args: unknown[];
}

/** A hand-rolled fake, not a mock library: records every call it receives and returns canned glance shapes. */
function makeFakeProvider(overrides: Partial<SourceProvider> = {}) {
  const calls: Call[] = [];

  const provider: SourceProvider = {
    async fetchMergeRequestIndex(options: FetchMergeRequestIndexOptions) {
      calls.push({ method: "fetchMergeRequestIndex", args: [options] });
      return overrides.fetchMergeRequestIndex ? await overrides.fetchMergeRequestIndex(options) : [];
    },
    async fetchMergeRequestMetrics(projectPath: string, mrIid: number, options?: FetchMergeRequestMetricsOptions) {
      calls.push({ method: "fetchMergeRequestMetrics", args: [projectPath, mrIid, options] });
      return overrides.fetchMergeRequestMetrics
        ? await overrides.fetchMergeRequestMetrics(projectPath, mrIid, options)
        : null;
    },
    async fetchProject(projectPath: string, options?: FetchProjectOptions) {
      calls.push({ method: "fetchProject", args: [projectPath, options] });
      return overrides.fetchProject ? await overrides.fetchProject(projectPath, options) : null;
    },
    async fetchProjectPipelines(projectPath: string, options: FetchProjectPipelinesOptions) {
      calls.push({ method: "fetchProjectPipelines", args: [projectPath, options] });
      return overrides.fetchProjectPipelines ? await overrides.fetchProjectPipelines(projectPath, options) : [];
    },
    async fetchUserEvents(userId: string, options: FetchUserEventsOptions) {
      calls.push({ method: "fetchUserEvents", args: [userId, options] });
      return overrides.fetchUserEvents ? await overrides.fetchUserEvents(userId, options) : [];
    },
    async restRequest(method: string, path: string, body?: unknown, op?: string, io?: RequestIO) {
      calls.push({ method: "restRequest", args: [method, path, body, op, io] });
      return overrides.restRequest
        ? await overrides.restRequest(method, path, body, op, io)
        : new Response("[]", { status: 200 });
    },
  };

  return { provider, calls };
}

const window: TimeWindow = { start: "2026-05-01T00:00:00.000Z", end: "2026-05-08T00:00:00.000Z", key: "7d" };

describe("scanProject", () => {
  it("passes projectPaths/updatedAfter/signal and stamps scannedAt on every row", async () => {
    const indexRow: MergeRequestIndexRow = {
      iid: 1,
      projectPath: "g/p",
      title: "t",
      state: "opened",
      createdAt: "2026-05-01T00:00:00Z",
      updatedAt: "2026-05-02T00:00:00Z",
      mergedAt: null,
      authorUsername: "ada",
      sourceBranch: "feature",
      labels: ["bug"],
    };
    const controller = new AbortController();
    const { provider, calls } = makeFakeProvider({
      fetchMergeRequestIndex: async () => [indexRow],
    });

    const rows = await scanProject(provider, "g/p", "2026-05-01T00:00:00Z", { signal: controller.signal });

    expect(calls).toEqual([
      {
        method: "fetchMergeRequestIndex",
        args: [{ projectPaths: ["g/p"], updatedAfter: "2026-05-01T00:00:00Z", signal: controller.signal }],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scannedAt).toBeTruthy();
    expect(typeof rows[0]!.scannedAt).toBe("string");
  });
});

describe("toIndexRow", () => {
  it("maps every field one-to-one", () => {
    const row: MergeRequestIndexRow = {
      iid: 5,
      projectPath: "g/p",
      title: "fix bug",
      state: "merged",
      createdAt: "2026-05-01T00:00:00Z",
      updatedAt: "2026-05-02T00:00:00Z",
      mergedAt: "2026-05-03T00:00:00Z",
      authorUsername: "ada",
      sourceBranch: "fix/bug",
      labels: ["bug", "urgent"],
    };

    expect(toIndexRow(row, "2026-05-04T00:00:00Z")).toEqual({
      projectPath: "g/p",
      iid: 5,
      title: "fix bug",
      state: "merged",
      createdAt: "2026-05-01T00:00:00Z",
      updatedAt: "2026-05-02T00:00:00Z",
      mergedAt: "2026-05-03T00:00:00Z",
      authorUsername: "ada",
      sourceBranch: "fix/bug",
      labels: ["bug", "urgent"],
      scannedAt: "2026-05-04T00:00:00Z",
    });
  });

  it("defaults labels to [] when glance returns none", () => {
    const row = {
      iid: 5,
      projectPath: "g/p",
      title: "fix bug",
      state: "opened",
      createdAt: "2026-05-01T00:00:00Z",
      updatedAt: "2026-05-02T00:00:00Z",
      mergedAt: null,
      authorUsername: null,
      sourceBranch: "fix/bug",
      labels: undefined,
    } as unknown as MergeRequestIndexRow;

    expect(toIndexRow(row, "2026-05-04T00:00:00Z").labels).toEqual([]);
  });
});

describe("toStoredMetrics", () => {
  it("maps notes, diffStats, fileStats, labels, and approvedByUsernames, preserving note order", () => {
    const metrics: MergeRequestMetrics = {
      iid: 5,
      projectPath: "g/p",
      description: "desc",
      diffStats: { additions: 10, deletions: 4, filesChanged: 2 },
      fileStats: [
        { path: "a.ts", additions: 6, deletions: 1 },
        { path: "b.ts", additions: 4, deletions: 3 },
      ],
      labels: ["bug"],
      approvedByUsernames: ["bob", "carol"],
      notes: [
        { authorUsername: "bob", createdAt: "2026-05-01T00:00:00Z", system: false, inline: true },
        { authorUsername: null, createdAt: "2026-05-02T00:00:00Z", system: true, inline: false },
      ],
    };

    expect(toStoredMetrics(metrics)).toEqual({
      projectPath: "g/p",
      iid: 5,
      description: "desc",
      diffStats: { additions: 10, deletions: 4, filesChanged: 2 },
      fileStats: [
        { path: "a.ts", additions: 6, deletions: 1 },
        { path: "b.ts", additions: 4, deletions: 3 },
      ],
      labels: ["bug"],
      approvedByUsernames: ["bob", "carol"],
      notes: [
        { authorUsername: "bob", createdAt: "2026-05-01T00:00:00Z", system: false, inline: true },
        { authorUsername: null, createdAt: "2026-05-02T00:00:00Z", system: true, inline: false },
      ],
    });
  });

  it("maps a null diffStats through as null", () => {
    const metrics: MergeRequestMetrics = {
      iid: 5,
      projectPath: "g/p",
      description: null,
      diffStats: null,
      fileStats: [],
      labels: [],
      approvedByUsernames: [],
      notes: [],
    };

    expect(toStoredMetrics(metrics).diffStats).toBeNull();
  });
});

describe("fetchMetrics", () => {
  it("returns null when glance returns null (MR gone)", async () => {
    const { provider } = makeFakeProvider({ fetchMergeRequestMetrics: async () => null });
    expect(await fetchMetrics(provider, "g/p", 5)).toBeNull();
  });

  it("maps the metrics and forwards signal", async () => {
    const controller = new AbortController();
    const metrics: MergeRequestMetrics = {
      iid: 5,
      projectPath: "g/p",
      description: "desc",
      diffStats: { additions: 1, deletions: 0, filesChanged: 1 },
      fileStats: [],
      labels: [],
      approvedByUsernames: [],
      notes: [],
    };
    const { provider, calls } = makeFakeProvider({ fetchMergeRequestMetrics: async () => metrics });

    const result = await fetchMetrics(provider, "g/p", 5, { signal: controller.signal });

    expect(result?.description).toBe("desc");
    expect(calls).toEqual([
      { method: "fetchMergeRequestMetrics", args: ["g/p", 5, { signal: controller.signal }] },
    ]);
  });
});

describe("fetchPipelinesFor", () => {
  it("passes username/updatedAfter/updatedBefore and maps status through unchanged", async () => {
    const controller = new AbortController();
    const summary: PipelineSummary = {
      id: "gitlab:pipeline:9",
      status: "success",
      createdAt: "2026-05-02T00:00:00Z",
      username: "ada",
    };
    const { provider, calls } = makeFakeProvider({ fetchProjectPipelines: async () => [summary] });

    const rows = await fetchPipelinesFor(provider, "g/p", "ada", window, { signal: controller.signal });

    expect(calls).toEqual([
      {
        method: "fetchProjectPipelines",
        args: [
          "g/p",
          { username: "ada", updatedAfter: window.start, updatedBefore: window.end, signal: controller.signal },
        ],
      },
    ]);
    expect(rows).toEqual([
      { id: "gitlab:pipeline:9", projectPath: "g/p", username: "ada", status: "success", createdAt: "2026-05-02T00:00:00Z" },
    ]);
  });
});

describe("fetchProjectRef", () => {
  it("passes the signal through and returns the provider's project ref verbatim", async () => {
    const controller = new AbortController();
    const { provider, calls } = makeFakeProvider({
      fetchProject: async () => ({ id: "gitlab:42", fullPath: "g/p" }),
    });

    const ref = await fetchProjectRef(provider, "g/p", { signal: controller.signal });

    expect(calls).toEqual([{ method: "fetchProject", args: ["g/p", { signal: controller.signal }] }]);
    expect(ref).toEqual({ id: "gitlab:42", fullPath: "g/p" });
  });

  it("returns null when the provider cannot resolve the project", async () => {
    const { provider } = makeFakeProvider({ fetchProject: async () => null });

    const ref = await fetchProjectRef(provider, "g/missing");

    expect(ref).toBeNull();
  });
});

describe("toStoredPipeline", () => {
  it("stores the scoped pipeline id verbatim", () => {
    const summary: PipelineSummary = {
      id: "gitlab:pipeline:42",
      status: "failed",
      createdAt: "2026-05-02T00:00:00Z",
      username: null,
    };
    expect(toStoredPipeline(summary, "g/p")).toEqual({
      id: "gitlab:pipeline:42",
      projectPath: "g/p",
      username: null,
      status: "failed",
      createdAt: "2026-05-02T00:00:00Z",
    });
  });
});

describe("fetchPushesFor", () => {
  it("passes action: pushed, widened calendar-date bounds, and maps repositoryId", async () => {
    const controller = new AbortController();
    const event: UserEvent = { action: "pushed", createdAt: "2026-05-02T00:00:00Z", repositoryId: "gitlab:42" };
    const { provider, calls } = makeFakeProvider({ fetchUserEvents: async () => [event] });

    const rows = await fetchPushesFor(provider, "gitlab:user:7", "ada", window, { signal: controller.signal });

    expect(calls).toEqual([
      {
        method: "fetchUserEvents",
        args: [
          "gitlab:user:7",
          { action: "pushed", after: "2026-04-30", before: "2026-05-09", signal: controller.signal },
        ],
      },
    ]);
    expect(rows).toEqual([{ username: "ada", createdAt: "2026-05-02T00:00:00Z", repositoryId: "gitlab:42" }]);
  });
});

describe("toStoredPushEvent", () => {
  it("maps createdAt and repositoryId, stamping the given username", () => {
    const event: UserEvent = { action: "pushed", createdAt: "2026-05-02T00:00:00Z", repositoryId: null };
    expect(toStoredPushEvent(event, "ada")).toEqual({
      username: "ada",
      createdAt: "2026-05-02T00:00:00Z",
      repositoryId: null,
    });
  });
});

describe("resolveIdentity", () => {
  it("resolves an exact username match and stamps fetchedAt", async () => {
    const controller = new AbortController();
    const { provider, calls } = makeFakeProvider({
      restRequest: async () =>
        new Response(JSON.stringify([{ id: 7, username: "ada", name: "Ada Lovelace" }]), { status: 200 }),
    });

    const identity = await resolveIdentity(provider, "ada", { signal: controller.signal });

    expect(identity).toEqual({
      username: "ada",
      name: "Ada Lovelace",
      resolved: true,
      userId: 7,
      fetchedAt: identity.fetchedAt,
    });
    expect(typeof identity.fetchedAt).toBe("string");
    expect(calls).toEqual([
      {
        method: "restRequest",
        args: [
          "GET",
          "/users?username=ada",
          undefined,
          "resolveIdentity",
          { signal: controller.signal, retry: true },
        ],
      },
    ]);
  });

  it("marks resolved: false with no throw when the user is not found", async () => {
    const { provider } = makeFakeProvider({
      restRequest: async () => new Response(JSON.stringify([]), { status: 200 }),
    });

    const identity = await resolveIdentity(provider, "ghost");

    expect(identity.resolved).toBe(false);
    expect(identity.userId).toBeNull();
    expect(identity.name).toBeNull();
    expect(identity.username).toBe("ghost");
    expect(typeof identity.fetchedAt).toBe("string");
  });

  it("encodes the username into the query path", async () => {
    const { provider, calls } = makeFakeProvider();
    await resolveIdentity(provider, "a b");
    expect(calls[0]!.args[1]).toBe("/users?username=a%20b");
  });
});
