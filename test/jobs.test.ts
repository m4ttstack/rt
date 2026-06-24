import { afterEach, describe, expect, it } from "vitest";
import { startRefresh, getRefresh, cancelRefresh, toStatusResponse, __resetJobs } from "../server/jobs/refresh.js";
import type { LeaderboardResponse } from "../shared/types.js";
import type { TimeWindow } from "../shared/types.js";

const WINDOW: TimeWindow = { start: "2026-05-01T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z", key: "30d" };
const SELECTION = { range: "30d", trend: false };
const fakeResult = { users: [] } as unknown as LeaderboardResponse;
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => __resetJobs());

describe("refresh job registry", () => {
  it("runs to done and exposes the result + last progress", async () => {
    const job = startRefresh({ window: WINDOW, trend: false, selection: SELECTION }, async ({ onProgress }) => {
      onProgress({ phase: "users", label: "Resolving users", done: 1, total: 2, window: "current" });
      return fakeResult;
    });
    expect(job.status).toBe("running");
    await flush();
    expect(job.status).toBe("done");
    const res = toStatusResponse(job);
    expect(res.result).toBe(fakeResult);
    expect(res.progress?.phase).toBe("users");
  });

  it("returns the same running job on re-entry (re-click is a no-op)", () => {
    const a = startRefresh({ window: WINDOW, trend: false, selection: SELECTION }, () => new Promise(() => {}));
    const b = startRefresh({ window: WINDOW, trend: false, selection: SELECTION }, () => new Promise(() => {}));
    expect(b.id).toBe(a.id);
  });

  it("marks the job cancelled when aborted, with no result", async () => {
    const job = startRefresh({ window: WINDOW, trend: false, selection: SELECTION }, ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const e = new Error("aborted"); e.name = "AbortError"; reject(e);
        });
      }),
    );
    cancelRefresh(job.id);
    await flush();
    expect(job.status).toBe("cancelled");
    expect(job.result).toBeUndefined();
  });

  it("marks the job error on failure and surfaces the message", async () => {
    const job = startRefresh({ window: WINDOW, trend: false, selection: SELECTION }, async () => { throw new Error("boom"); });
    await flush();
    expect(job.status).toBe("error");
    expect(toStatusResponse(job).error).toBe("boom");
    expect(toStatusResponse(job).result).toBeUndefined();
  });

  it("404-style: getRefresh returns null for an unknown id", () => {
    expect(getRefresh("nope")).toBeNull();
  });
});
