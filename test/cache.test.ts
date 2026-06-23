import { describe, expect, it } from "vitest";

import { cacheKey, readCache, writeCache } from "../server/cache/store.js";
import type { Scope, TimeWindow } from "../shared/types.js";

const scope: Scope = { type: "group", groupPath: "org/team" };
const win: TimeWindow = { start: "2026-05-01T00:00:00.000Z", end: "2026-05-31T00:00:00.000Z", key: "30d" };

describe("cache store", () => {
  it("key is stable for the same inputs and differs across windows/scopes", () => {
    const k1 = cacheKey(scope, win);
    expect(cacheKey(scope, win)).toBe(k1);
    expect(cacheKey(scope, { ...win, start: "2026-04-01T00:00:00.000Z" })).not.toBe(k1);
    expect(cacheKey({ type: "group", groupPath: "other" }, win)).not.toBe(k1);
  });

  it("produces filesystem-safe keys", () => {
    expect(cacheKey(scope, win)).toMatch(/^[a-z0-9.\-_]+$/i);
  });

  it("round-trips an envelope and returns null on miss", async () => {
    const key = `test-roundtrip-${cacheKey(scope, win)}`;
    await writeCache(key, { hello: "world", n: 42 });
    const got = await readCache<{ hello: string; n: number }>(key);
    expect(got?.data).toEqual({ hello: "world", n: 42 });
    expect(got?.savedAt).toBeTruthy();
    expect(await readCache("definitely-not-a-real-key-xyz")).toBeNull();
  });
});
