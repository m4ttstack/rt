import { describe, expect, test } from "bun:test";
import { moveValue } from "../move.ts";

function fakeApi(setErr: string | null = null, unsetErr: string | null = null) {
  const calls: string[] = [];
  return {
    calls,
    api: {
      set: async (scope: string, value: unknown) => { calls.push(`set ${scope} ${JSON.stringify(value)}`); return setErr; },
      unset: async (scope: string) => { calls.push(`unset ${scope}`); return unsetErr; },
    },
  };
}

describe("moveValue", () => {
  test("writes the authored value to the target, then clears the source", async () => {
    const f = fakeApi();
    expect(await moveValue(f.api, "user", "machine", { present: true, value: 3 })).toBeNull();
    expect(f.calls).toEqual(["set machine 3", "unset user"]);
  });

  test("a failed set stops before touching the source", async () => {
    const f = fakeApi("rt: refused");
    expect(await moveValue(f.api, "user", "machine", { present: true, value: 3 })).toBe("rt: refused");
    expect(f.calls).toEqual(["set machine 3"]);
  });

  test("a failed unset says the old layer still holds a value", async () => {
    const f = fakeApi(null, "rt: locked");
    expect(await moveValue(f.api, "user", "machine", { present: true, value: 3 })).toBe(
      "moved to machine, but user still holds a value: rt: locked",
    );
  });

  test("refuses when the source layer holds nothing, writing nothing", async () => {
    const f = fakeApi();
    expect(await moveValue(f.api, "user", "machine", { present: false })).toBe("user holds no value to move");
    expect(f.calls).toEqual([]);
  });

  test("refuses a move onto the same scope", async () => {
    const f = fakeApi();
    expect(await moveValue(f.api, "user", "user", { present: true, value: 1 })).toBe("already in user");
    expect(f.calls).toEqual([]);
  });
});
