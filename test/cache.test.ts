import { mkdir, unlink, utimes, writeFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";

import { CACHE_DIR, cacheKey, readCache, readCoveringCache, writeCache } from "../server/cache/store.js";
import type { Scope, TimeWindow } from "../shared/types.js";

const scope: Scope = { type: "group", groupPath: "org/team" };
const win: TimeWindow = { start: "2026-05-01T00:00:00.000Z", end: "2026-05-31T00:00:00.000Z", key: "30d" };

/** Each covering test gets its own scope so its envelopes can't be seen by another's scan. */
const coveringScope = (name: string): Scope => ({ type: "group", groupPath: `covering-test/${name}` });

const baseWin = (startDay: string, endDay: string): TimeWindow => ({
  start: `${startDay}T00:00:00.000Z`,
  end: `${endDay}T18:00:00.000Z`,
  key: "base90",
});

const written: string[] = [];

async function put(scope: Scope, window: TimeWindow, data: unknown): Promise<string> {
  const key = cacheKey(scope, window);
  await writeCache(key, data);
  written.push(key);
  return key;
}

afterAll(async () => {
  for (const key of written) await unlink(`${CACHE_DIR}/${key}.json`).catch(() => {});
});

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

describe("readCoveringCache", () => {
  it("reuses an envelope the UTC-midnight key roll left behind", async () => {
    const scope = coveringScope("rollover");
    // Written at 14:08 local, before the roll; the key's end day was still 07-24.
    await put(scope, baseWin("2026-04-25", "2026-07-24"), { marker: "pre-roll" });
    // After the roll both ends shift a day, so the exact key misses.
    const target = baseWin("2026-04-26", "2026-07-25");
    expect(await readCache(cacheKey(scope, target))).toBeNull();

    const got = await readCoveringCache<{ marker: string }>(scope, target);
    expect(got?.data.marker).toBe("pre-roll");
  });

  it("rejects an envelope that starts after the target (not a superset)", async () => {
    const scope = coveringScope("narrower");
    await put(scope, baseWin("2026-04-27", "2026-07-25"), { marker: "narrow" });
    expect(await readCoveringCache(scope, baseWin("2026-04-26", "2026-07-25"))).toBeNull();
  });

  it("rejects a covering envelope past the max reuse age", async () => {
    const scope = coveringScope("stale");
    await put(scope, baseWin("2026-04-25", "2026-07-24"), { marker: "stale" });
    const target = baseWin("2026-04-26", "2026-07-25");
    const soon = new Date(Date.now() + 23 * 60 * 60 * 1000);
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);

    expect((await readCoveringCache<{ marker: string }>(scope, target, soon))?.data.marker).toBe("stale");
    expect(await readCoveringCache(scope, target, later)).toBeNull();
  });

  it("prefers the freshest of several covering envelopes", async () => {
    const scope = coveringScope("freshest");
    const older = await put(scope, baseWin("2026-01-20", "2026-07-24"), { marker: "older" });
    await put(scope, baseWin("2026-04-25", "2026-07-24"), { marker: "newer" });
    // Same-millisecond writes would make the ordering a coin flip.
    const back = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(`${CACHE_DIR}/${older}.json`, back, back);

    const got = await readCoveringCache<{ marker: string }>(scope, baseWin("2026-04-26", "2026-07-25"));
    expect(got?.data.marker).toBe("newer");
  });

  it("ignores envelopes belonging to another scope", async () => {
    await put(coveringScope("owner"), baseWin("2026-04-25", "2026-07-24"), { marker: "theirs" });
    const got = await readCoveringCache(coveringScope("stranger"), baseWin("2026-04-26", "2026-07-25"));
    expect(got).toBeNull();
  });

  it("ignores envelopes written by an older schema version", async () => {
    const scope = coveringScope("versioned");
    const key = cacheKey(scope, baseWin("2026-04-25", "2026-07-24"));
    written.push(key);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(
      `${CACHE_DIR}/${key}.json`,
      JSON.stringify({ savedAt: new Date().toISOString(), key, version: 1, data: { marker: "ancient" } }),
      "utf8",
    );

    expect(await readCoveringCache(scope, baseWin("2026-04-26", "2026-07-25"))).toBeNull();
  });
});
