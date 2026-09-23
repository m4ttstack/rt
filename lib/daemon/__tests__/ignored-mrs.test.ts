import { describe, expect, test } from "bun:test";
import type { PullRequest } from "@mattstack/glance";
import {
  createExcludedTargetsCache,
  expandTargetBranches,
  gitlabBranchSearch,
  isIgnoredMr,
  readIgnoredMrs,
  type IgnoredMrRules,
} from "../ignored-mrs.ts";

const WIRE = "remote:gitlab.com%2Fg%2Fp";
const RULES: IgnoredMrRules = { targetBranches: ["deployments/*", "release/**"], authors: ["deploy-bot"] };

function mr(targetBranch: string, author = "ada"): PullRequest {
  return { iid: 1, targetBranch, author: { username: author } } as unknown as PullRequest;
}

describe("isIgnoredMr", () => {
  test("a target branch matching a glob is ignored", () => {
    expect(isIgnoredMr(mr("deployments/qa"), RULES)).toBe(true);
    expect(isIgnoredMr(mr("release/base/2026.34"), RULES)).toBe(true);
  });

  test("a single-segment glob does not reach into nested branches or the bare prefix", () => {
    expect(isIgnoredMr(mr("deployments/qa/extra"), RULES)).toBe(false);
    expect(isIgnoredMr(mr("deployments"), RULES)).toBe(false);
  });

  test("a listed author is ignored whatever the target", () => {
    expect(isIgnoredMr(mr("main", "deploy-bot"), RULES)).toBe(true);
  });

  test("anything else, and any MR under empty rules, is kept", () => {
    expect(isIgnoredMr(mr("main"), RULES)).toBe(false);
    expect(isIgnoredMr(mr("deployments/qa"), { targetBranches: [], authors: [] })).toBe(false);
  });
});

describe("readIgnoredMrs", () => {
  test("reads the repo's rules with its raw host/path identity", () => {
    const seen: Array<string | null | undefined> = [];
    const rules = readIgnoredMrs(WIRE, (_key, opts) => {
      seen.push(opts?.repoIdentity);
      return { value: { targetBranches: ["deployments/*"], authors: ["deploy-bot"] } };
    });
    expect(seen).toEqual(["gitlab.com/g/p"]);
    expect(rules).toEqual({ targetBranches: ["deployments/*"], authors: ["deploy-bot"] });
  });

  test("drops non-string entries and fills a missing field with nothing", () => {
    const rules = readIgnoredMrs(WIRE, () => ({ value: { targetBranches: ["deployments/*", 7, ""] } }));
    expect(rules).toEqual({ targetBranches: ["deployments/*"], authors: [] });
  });

  test("unset, malformed, unreadable, or a path-kind repo all ignore nothing", () => {
    const none = { targetBranches: [], authors: [] };
    expect(readIgnoredMrs(WIRE, () => ({ value: undefined }))).toEqual(none);
    expect(readIgnoredMrs(WIRE, () => ({ value: ["deployments/*"] }))).toEqual(none);
    expect(readIgnoredMrs(WIRE, () => { throw new Error("bad store"); })).toEqual(none);
    let read = false;
    expect(readIgnoredMrs("path:%2Ftmp%2Frepo", () => { read = true; return { value: {} }; })).toEqual(none);
    expect(read).toBe(false);
  });
});

describe("expandTargetBranches", () => {
  test("searches each glob's literal prefix and keeps only the names the glob matches", async () => {
    const searched: string[] = [];
    const branches: Record<string, string[]> = {
      "deployments/": ["deployments/qa", "deployments/prod", "deployments/qa/old"],
      "release/": ["release/base/2026.34", "release/base/2026.35"],
    };
    const names = await expandTargetBranches(["deployments/*", "release/**"], async (prefix) => {
      searched.push(prefix);
      return branches[prefix] ?? [];
    });
    expect(searched).toEqual(["deployments/", "release/"]);
    expect(names).toEqual(["deployments/prod", "deployments/qa", "release/base/2026.34", "release/base/2026.35"]);
  });

  test("a name with no wildcard is used as-is without a search", async () => {
    let searches = 0;
    expect(await expandTargetBranches(["main", "main"], async () => { searches++; return []; })).toEqual(["main"]);
    expect(searches).toBe(0);
  });
});

describe("gitlabBranchSearch", () => {
  test("pages a starts-with branch search until a short page", async () => {
    const paths: string[] = [];
    const page = (n: number, count: number) => Array.from({ length: count }, (_, i) => ({ name: `deployments/e${n}-${i}` }));
    const search = gitlabBranchSearch({
      restRequest: async (_method: string, path: string) => {
        paths.push(path);
        const n = Number(new URL(path, "https://x").searchParams.get("page"));
        return new Response(JSON.stringify(n === 1 ? page(1, 100) : page(2, 3)));
      },
    } as never, "g/sub/p");
    const names = await search("deployments/");
    expect(names).toHaveLength(103);
    expect(paths).toEqual([
      "/projects/g%2Fsub%2Fp/repository/branches?search=%5Edeployments%2F&per_page=100&page=1",
      "/projects/g%2Fsub%2Fp/repository/branches?search=%5Edeployments%2F&per_page=100&page=2",
    ]);
  });

  test("a failed page throws instead of reading as no branches", async () => {
    const search = gitlabBranchSearch({ restRequest: async () => new Response("nope", { status: 503 }) } as never, "g/p");
    await expect(search("deployments/")).rejects.toThrow("503");
  });
});

describe("createExcludedTargetsCache", () => {
  test("reuses an expansion until it ages out or the globs change", async () => {
    let now = 0;
    let calls = 0;
    const cache = createExcludedTargetsCache({ ttlMs: 1000, now: () => now });
    const search = async () => { calls++; return ["deployments/qa"]; };
    await cache.get("repo", ["deployments/*"], search);
    await cache.get("repo", ["deployments/*"], search);
    expect(calls).toBe(1);
    now = 1001;
    await cache.get("repo", ["deployments/*"], search);
    expect(calls).toBe(2);
    expect(await cache.get("repo", ["deployments/q*"], search)).toEqual(["deployments/qa"]);
    expect(calls).toBe(3);
  });

  test("a failed search excludes nothing this cycle and is retried next time", async () => {
    const cache = createExcludedTargetsCache({ ttlMs: 1000, now: () => 0 });
    expect(await cache.get("repo", ["deployments/*"], async () => { throw new Error("503"); })).toEqual([]);
    expect(await cache.get("repo", ["deployments/*"], async () => ["deployments/qa"])).toEqual(["deployments/qa"]);
  });

  test("no globs means no search", async () => {
    const cache = createExcludedTargetsCache({ ttlMs: 1000, now: () => 0 });
    expect(await cache.get("repo", [], async () => { throw new Error("must not search"); })).toEqual([]);
  });
});
