import { describe, expect, test } from "bun:test";
import type { getSetting } from "@mattstack/rt-client";
import { loadReReviewConfig } from "../triage/config.ts";

type GetSettingFn = typeof getSetting;

function fakeResolve(values: Record<string, unknown>): GetSettingFn {
  return (<T,>(key: string) => ({ value: values[key] as T, provenance: [] })) as GetSettingFn;
}

function throwingResolve(): GetSettingFn {
  return (() => {
    throw new Error("unknown settings key: board.reReview");
  }) as GetSettingFn;
}

describe("loadReReviewConfig", () => {
  test("an owned board.reReview { enabled: false } turns the latch off", () => {
    expect(loadReReviewConfig(fakeResolve({ "board.reReview": { enabled: false } }))).toEqual({ enabled: false });
  });

  test("an owned board.reReview { enabled: true } turns it on", () => {
    expect(loadReReviewConfig(fakeResolve({ "board.reReview": { enabled: true } }))).toEqual({ enabled: true });
  });

  test("an unset key defaults to enabled: a fresh teammate gets the latch without opting in", () => {
    expect(loadReReviewConfig(fakeResolve({}))).toEqual({ enabled: true });
  });

  test("a resolver throw (key not yet registered in rt-client) degrades to enabled, never crashes", () => {
    expect(loadReReviewConfig(throwingResolve())).toEqual({ enabled: true });
  });

  test("a malformed value names the settings key, not config.json", () => {
    expect(() => loadReReviewConfig(fakeResolve({ "board.reReview": { enabled: "yes" } }))).toThrow(
      /settings key "board.reReview".*enabled.*boolean/,
    );
  });
});
