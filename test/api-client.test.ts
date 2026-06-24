import { afterEach, describe, expect, it, vi } from "vitest";
import { buildQuery, startRefresh, pollRefresh, cancelRefresh } from "../web/src/api.js";

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("builds query strings with the cacheOnly + refresh flags", () => {
    expect(buildQuery({ range: "30d", cacheOnly: true }).toString()).toBe("range=30d&cacheOnly=1");
    expect(buildQuery({ range: "7d", refresh: true, trend: true }).toString()).toBe("range=7d&refresh=1&trend=1");
  });

  it("POSTs to /api/refresh and returns the status", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return new Response(JSON.stringify({ jobId: "abc", status: "running", progress: null }), { status: 200 });
    });
    const res = await startRefresh({ range: "30d" });
    expect(res.jobId).toBe("abc");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/api/refresh?range=30d");
  });

  it("polls GET /api/refresh/:id", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toBe("/api/refresh/abc");
      return new Response(JSON.stringify({ jobId: "abc", status: "done", progress: null }), { status: 200 });
    });
    expect((await pollRefresh("abc")).status).toBe("done");
  });

  it("cancels via POST /api/refresh/:id/cancel", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { calls.push(url); return new Response("{}", { status: 200 }); });
    await cancelRefresh("abc");
    expect(calls[0]).toBe("/api/refresh/abc/cancel");
  });
});
