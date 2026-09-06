import { describe, expect, test } from "bun:test";
import { memoizeAsync } from "../memoize-async.ts";

describe("memoizeAsync", () => {
  test("a success is pinned forever, load never runs again", async () => {
    let calls = 0;
    let clock = 0;
    const get = memoizeAsync<string | null>(
      async () => { calls++; return "token"; },
      (v) => v === null,
      { ttlMs: 1000, now: () => clock },
    );
    expect(await get()).toBe("token");
    clock += 10_000_000;
    expect(await get()).toBe("token");
    expect(calls).toBe(1);
  });

  test("a failure is cached only for the TTL, then retried; a later success then pins", async () => {
    let calls = 0;
    let clock = 0;
    const get = memoizeAsync<string | null>(
      async () => { calls++; return calls === 1 ? null : "token"; },
      (v) => v === null,
      { ttlMs: 1000, now: () => clock },
    );

    expect(await get()).toBeNull();
    expect(calls).toBe(1);

    clock += 500; // still within the TTL
    expect(await get()).toBeNull();
    expect(calls).toBe(1); // cached -- load not invoked again

    clock += 600; // now past the TTL (total 1100 > 1000)
    expect(await get()).toBe("token");
    expect(calls).toBe(2);

    clock += 10_000_000; // long past the TTL, but the success above is now pinned
    expect(await get()).toBe("token");
    expect(calls).toBe(2);
  });

  test("concurrent calls while a load is in flight share the one in-flight promise", async () => {
    let calls = 0;
    let resolve!: (v: string | null) => void;
    const get = memoizeAsync<string | null>(
      () => new Promise<string | null>((r) => { calls++; resolve = r; }),
      (v) => v === null,
    );
    const p1 = get();
    const p2 = get();
    resolve("token");
    expect(await p1).toBe("token");
    expect(await p2).toBe("token");
    expect(calls).toBe(1);
  });

  test("a rejected load is not swallowed, and a later call retries after the TTL", async () => {
    let calls = 0;
    let clock = 0;
    const get = memoizeAsync<string | null>(
      async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return "token";
      },
      (v) => v === null,
      { ttlMs: 1000, now: () => clock },
    );
    await expect(get()).rejects.toThrow("boom");
    clock += 1001;
    expect(await get()).toBe("token");
    expect(calls).toBe(2);
  });
});
