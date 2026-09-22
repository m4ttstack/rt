import { describe, expect, test } from "bun:test";
import { classifySyncError, readSyncHealth, recordSyncFailure, recordSyncSuccess } from "../project-sync-health.ts";
import type { ProjectSyncErrorKind } from "../../../packages/rt-client/src/commands.ts";

describe("classifySyncError", () => {
  test.each<[string, ProjectSyncErrorKind]>([
    ["GraphQL request failed: 500 Internal Server Error", "server-error"],
    ["GraphQL request failed: 502 Bad Gateway", "server-error"],
    ["GraphQL request failed: 429 Too Many Requests", "rate-limited"],
    ["fetchMergeRequests: HTTP 429 for /projects/1/merge_requests", "rate-limited"],
    ["GraphQL request failed: 401 Unauthorized", "auth"],
    ["fetchProject: HTTP 403 for g/p", "auth"],
    ["GraphQL errors: Timeout on PageInfo.endCursor; Timeout on MergeRequestConnection.nodes", "timeout"],
    ["The operation timed out.", "timeout"],
    ["GraphQL request failed: 404 Not Found", "other"],
    ["socket hang up", "other"],
  ])("%s -> %s", (message, kind) => {
    expect(classifySyncError(message)).toBe(kind);
  });

  test("a number inside a timeout's field list is not read as a status", () => {
    expect(classifySyncError("GraphQL errors: Timeout on MergeRequest.id 500")).toBe("timeout");
  });
});

describe("sync health", () => {
  test("a failure is recorded with its kind, message and since", () => {
    recordSyncFailure("health:a", new Error("GraphQL request failed: 500 Internal Server Error"), 1_000);
    expect(readSyncHealth("health:a")).toEqual({
      since: 1_000,
      lastAt: 1_000,
      kind: "server-error",
      message: "GraphQL request failed: 500 Internal Server Error",
    });
  });

  test("consecutive failures keep since and advance lastAt and kind", () => {
    recordSyncFailure("health:b", new Error("GraphQL request failed: 500 Internal Server Error"), 1_000);
    recordSyncFailure("health:b", new Error("GraphQL errors: Timeout on MergeRequest.id"), 2_000);
    expect(readSyncHealth("health:b")).toMatchObject({ since: 1_000, lastAt: 2_000, kind: "timeout" });
  });

  test("a success clears the record, and the next failure starts a new run", () => {
    recordSyncFailure("health:c", new Error("socket hang up"), 1_000);
    recordSyncSuccess("health:c");
    expect(readSyncHealth("health:c")).toBeUndefined();
    recordSyncFailure("health:c", new Error("socket hang up"), 5_000);
    expect(readSyncHealth("health:c")?.since).toBe(5_000);
  });

  test("the message is capped at 200 chars but classified from the full text", () => {
    recordSyncFailure("health:d", new Error(`${"x".repeat(250)} fetchX: HTTP 429 for /p`), 1_000);
    const rec = readSyncHealth("health:d")!;
    expect(rec.message).toHaveLength(200);
    expect(rec.kind).toBe("rate-limited");
  });

  test("a non-Error rejection is recorded by its string form", () => {
    recordSyncFailure("health:e", "gitlab down", 1_000);
    expect(readSyncHealth("health:e")?.message).toBe("gitlab down");
  });

  test("repos are tracked independently", () => {
    recordSyncFailure("health:f1", new Error("socket hang up"), 1_000);
    expect(readSyncHealth("health:f2")).toBeUndefined();
    recordSyncSuccess("health:f2");
    expect(readSyncHealth("health:f1")).toBeDefined();
  });
});
