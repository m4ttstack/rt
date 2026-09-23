import { describe, expect, test } from "bun:test";
import type { ExplainRow, SettingDef } from "@mattstack/rt-client";
import { effectiveFromRows } from "../server.ts";

const def = (over: Partial<SettingDef>): SettingDef =>
  ({ key: "k", type: "string", scopes: ["user", "machine"], merge: "replace", description: "", ...over }) as SettingDef;
const row = (scope: string, value?: unknown, extra: Partial<ExplainRow> = {}): ExplainRow =>
  ({ scope, file: scope === "default" ? null : `/stores/${scope}.jsonc`, present: value !== undefined, ...(value !== undefined ? { value } : {}), ...extra }) as ExplainRow;

describe("effectiveFromRows", () => {
  test("the strongest present layer wins over a registry default", () => {
    const d = def({ default: "info" });
    const eff = effectiveFromRows(d, [row("default", "info"), row("team"), row("user"), row("machine", "debug")]);
    expect(eff).toEqual({ scope: "machine", file: "/stores/machine.jsonc", value: "debug" });
  });

  test("machine beats user when both are set", () => {
    const eff = effectiveFromRows(def({}), [row("default"), row("team"), row("user", "a"), row("machine", "b")]);
    expect(eff.scope).toBe("machine");
    expect(eff.value).toBe("b");
  });

  test("a shadowed strongest layer is skipped", () => {
    const eff = effectiveFromRows(def({}), [row("user", "a"), row("machine", "b", { shadowed: "teamLocked" } as Partial<ExplainRow>)]);
    expect(eff.scope).toBe("user");
  });

  test("an invalid strongest layer reports invalid and no value", () => {
    const eff = effectiveFromRows(def({}), [row("user", "a"), row("machine", 3, { invalid: "expected string" } as Partial<ExplainRow>)]);
    expect(eff).toEqual({ scope: "machine", file: "/stores/machine.jsonc", invalid: "expected string" });
  });

  test("a deep-merged object reports the merged value, arrays replacing", () => {
    const d = def({ type: "object", merge: "deep", default: { a: 1, b: { c: 1 }, list: [1, 2] } });
    const eff = effectiveFromRows(d, [
      row("default", { a: 1, b: { c: 1 }, list: [1, 2] }),
      row("team"),
      row("user", { list: [9] }),
      row("machine", { b: { d: 2 } }),
    ]);
    expect(eff.scope).toBe("machine");
    expect(eff.value).toEqual({ a: 1, b: { c: 1, d: 2 }, list: [9] });
  });

  test("a deep-merged object skips an invalid middle layer", () => {
    const d = def({ type: "object", merge: "deep" });
    const eff = effectiveFromRows(d, [row("user", { a: "bad" }, { invalid: "nope" } as Partial<ExplainRow>), row("machine", { b: 2 })]);
    expect(eff.value).toEqual({ b: 2 });
  });

  test("a deep-merged object reports the store layers alone as authored", () => {
    const d = def({ type: "object", merge: "deep", default: { enabled: true, sweep: false } });
    const eff = effectiveFromRows(d, [row("default", { enabled: true, sweep: false }), row("team"), row("user"), row("machine", { enabled: false })]);
    expect(eff.value).toEqual({ enabled: false, sweep: false });
    expect(eff.authored).toEqual({ enabled: false });
  });

  test("a deep-merged object with only its default carries no authored", () => {
    const d = def({ type: "object", merge: "deep", default: { enabled: true } });
    const eff = effectiveFromRows(d, [row("default", { enabled: true }), row("user"), row("machine")]);
    expect(eff.value).toEqual({ enabled: true });
    expect("authored" in eff).toBe(false);
  });

  test("authored overlays every store layer weakest to strongest", () => {
    const d = def({ type: "object", merge: "deep", default: { c: 3 } });
    const eff = effectiveFromRows(d, [row("default", { c: 3 }), row("user", { a: 1 }), row("machine", { b: 2 })]);
    expect(eff.authored).toEqual({ a: 1, b: 2 });
  });

  test("a deep-merged secret carries no authored", () => {
    const d = def({ type: "object", merge: "deep", secret: true });
    const eff = effectiveFromRows(d, [row("user", { a: 1 })]);
    expect("authored" in eff).toBe(false);
  });

  test("secrets never carry a value", () => {
    const eff = effectiveFromRows(def({ secret: true }), [row("user", "s3cret")]);
    expect(eff).toEqual({ scope: "user", file: "/stores/user.jsonc" });
  });

  test("no present row falls back to the def's default, then to null", () => {
    expect(effectiveFromRows(def({ default: 5 }), [row("user")])).toEqual({ scope: "default", file: null, value: 5 });
    expect(effectiveFromRows(def({}), [row("user")])).toEqual({ scope: null, file: null });
  });
});
