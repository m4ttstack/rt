import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { useAppRoute } from "./routes";

function atPath(path: string) {
  const { hook } = memoryLocation({ path });
  return ({ children }: { children: ReactNode }) => <Router hook={hook}>{children}</Router>;
}

describe("useAppRoute", () => {
  it("routes /user/:name/:stat to stat when the stat is a known metric key", () => {
    const { result } = renderHook(() => useAppRoute(), { wrapper: atPath("/user/alice/mrsMerged") });
    expect(result.current).toEqual({ name: "stat", username: "alice", stat: "mrsMerged" });
  });

  it("routes /user/:name/:stat to not-found when the stat is not a known metric key", () => {
    const { result } = renderHook(() => useAppRoute(), { wrapper: atPath("/user/alice/not-a-real-metric") });
    expect(result.current).toEqual({ name: "not-found" });
  });

  it("round-trips a percent-encoded username", () => {
    const { result } = renderHook(() => useAppRoute(), { wrapper: atPath("/user/alice%40example.com") });
    expect(result.current).toEqual({ name: "user", username: "alice@example.com" });
  });
});
