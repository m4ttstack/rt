import { describe, expect, test } from "bun:test";
import { moveTargetFrom, moveValue } from "../move.ts";

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

  test("a deep move into a stronger layer keeps that layer's own fields winning", async () => {
    const f = fakeApi();
    const target = { present: true, value: { fetchIntervalSec: 60, sweep: true }, outranksSource: true };
    expect(await moveValue(f.api, "user", "machine", { present: true, value: { sweep: false } }, { deep: true, target })).toBeNull();
    expect(f.calls).toEqual(['set machine {"sweep":true,"fetchIntervalSec":60}', "unset user"]);
  });

  test("a deep move into a weaker layer lets the moved fields win", async () => {
    const f = fakeApi();
    const target = { present: true, value: { a: 2, b: 3 }, outranksSource: false };
    expect(await moveValue(f.api, "machine", "user", { present: true, value: { a: 1 } }, { deep: true, target })).toBeNull();
    expect(f.calls).toEqual(['set user {"a":1,"b":3}', "unset machine"]);
  });

  test("a deep move into an empty layer writes the source value alone", async () => {
    const f = fakeApi();
    const target = { present: false, outranksSource: true };
    expect(await moveValue(f.api, "user", "machine", { present: true, value: { a: 1 } }, { deep: true, target })).toBeNull();
    expect(f.calls).toEqual(['set machine {"a":1}', "unset user"]);
  });

  test("refuses a move onto the same scope", async () => {
    const f = fakeApi();
    expect(await moveValue(f.api, "user", "user", { present: true, value: 1 })).toBe("already in user");
    expect(f.calls).toEqual([]);
  });
});

describe("moveTargetFrom", () => {
  const rows = [
    { scope: "default", file: null, present: true, value: { a: 0 } },
    { scope: "user", file: "/u", present: true, value: { a: 1 } },
    { scope: "machine", file: "/m", present: true, value: { b: 2 } },
  ];

  test("a later row outranks an earlier one, since rows arrive weakest first", () => {
    expect(moveTargetFrom(rows, "user", "machine")).toEqual({ present: true, value: { b: 2 }, outranksSource: true });
    expect(moveTargetFrom(rows, "machine", "user")).toEqual({ present: true, value: { a: 1 }, outranksSource: false });
  });

  test("an invalid or absent target row counts as empty", () => {
    const withBad = [rows[1]!, { scope: "machine", file: "/m", present: true, value: { b: "x" }, invalid: "nope" }];
    expect(moveTargetFrom(withBad, "user", "machine").present).toBe(false);
    expect(moveTargetFrom([rows[1]!, { scope: "machine", file: "/m", present: false }], "user", "machine").present).toBe(false);
  });
});
