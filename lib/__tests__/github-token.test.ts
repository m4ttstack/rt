import { beforeEach, describe, expect, test } from "bun:test";
import { createGithubTokenResolver, type GhTokenSeams } from "../github-token.ts";

function seams(results: Array<string | null>, clock = { now: 0 }): GhTokenSeams & { calls: number; clock: { now: number } } {
  const s = {
    calls: 0,
    clock,
    ghToken: async () => {
      s.calls++;
      return results.shift() ?? null;
    },
    now: () => clock.now,
  };
  return s;
}

describe("githubToken", () => {
  let s: ReturnType<typeof seams>;

  beforeEach(() => {
    s = seams(["gho_fromgh"]);
  });

  test("a stored token wins and never asks gh", async () => {
    const resolve = createGithubTokenResolver(s);
    expect(await resolve("ghp_stored")).toEqual({ token: "ghp_stored", source: "stored" });
    expect(s.calls).toBe(0);
  });

  test("no stored token falls back to the gh session", async () => {
    const resolve = createGithubTokenResolver(s);
    expect(await resolve(undefined)).toEqual({ token: "gho_fromgh", source: "gh" });
  });

  test("no stored token and no gh session resolves to null", async () => {
    const resolve = createGithubTokenResolver(seams([null]));
    expect(await resolve(undefined)).toBeNull();
  });

  test("the gh answer is reused within the TTL, including a miss", async () => {
    const miss = seams([null, "gho_later"]);
    const resolve = createGithubTokenResolver(miss);
    await resolve(undefined);
    await resolve(undefined);
    expect(miss.calls).toBe(1);
  });

  test("the gh answer is re-read once the TTL lapses", async () => {
    const clock = { now: 0 };
    const rotating = seams(["gho_old", "gho_new"], clock);
    const resolve = createGithubTokenResolver(rotating);
    expect((await resolve(undefined))?.token).toBe("gho_old");
    clock.now = 11 * 60_000;
    expect((await resolve(undefined))?.token).toBe("gho_new");
    expect(rotating.calls).toBe(2);
  });
});
