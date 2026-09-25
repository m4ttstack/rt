import { describe, expect, test } from "bun:test";
import {
  CLEAN_DIFF_HASH,
  findCachedBuild,
  readBundleIdentity,
  sameBuild,
  treeIdentity,
  type CacheSeams,
} from "../dev-app-cache.ts";

const SHA = "a".repeat(40);
const ok = (stdout = "") => Promise.resolve({ stdout, stderr: "", exitCode: 0 });
const fail = () => Promise.resolve({ stdout: "", stderr: "nope", exitCode: 1 });

interface Fake {
  diff?: string;
  untracked?: string[];
  files?: Record<string, string>;
  plists?: Record<string, Record<string, string>>;
  dirs?: Record<string, string[]>;
  failCmd?: string;
}

function fakeSeams(f: Fake = {}): CacheSeams & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    pathExists: (p) => Object.keys(f.plists ?? {}).some((b) => `${b}/Contents/Info.plist` === p),
    listDir: (p) => f.dirs?.[p] ?? [],
    readBytes: (p) => (f.files?.[p] === undefined ? null : new TextEncoder().encode(f.files[p])),
    exec: (argv) => {
      const cmd = argv.join(" ");
      calls.push(cmd);
      if (f.failCmd && cmd.startsWith(f.failCmd)) return fail();
      if (cmd === "git rev-parse HEAD") return ok(`${SHA}\n`);
      if (cmd.startsWith("git diff HEAD")) return ok(f.diff ?? "");
      if (cmd.startsWith("git ls-files --others")) return ok((f.untracked ?? []).map((p) => `${p}\0`).join(""));
      if (argv[0] === "plutil" && argv[1] === "-extract") {
        const key = argv[2]!;
        const bundle = argv[argv.length - 1]!.replace(/\/Contents\/Info\.plist$/, "");
        const v = f.plists?.[bundle]?.[key];
        return v === undefined ? fail() : ok(`${v}\n`);
      }
      return ok();
    },
  };
}

describe("treeIdentity", () => {
  test("a clean tree is its path, full HEAD sha, and the fixed clean hash", async () => {
    const id = await treeIdentity(fakeSeams(), "/src/tree");
    expect(id).toEqual({ tree: "/src/tree", sha: SHA, diffHash: CLEAN_DIFF_HASH });
  });

  test("the tracked diff against HEAD changes the hash, and the same diff hashes the same", async () => {
    const a = await treeIdentity(fakeSeams({ diff: "diff --git a/x b/x\n+1\n" }), "/src/tree");
    const b = await treeIdentity(fakeSeams({ diff: "diff --git a/x b/x\n+2\n" }), "/src/tree");
    const again = await treeIdentity(fakeSeams({ diff: "diff --git a/x b/x\n+1\n" }), "/src/tree");
    expect(a!.diffHash).not.toBe(CLEAN_DIFF_HASH);
    expect(a!.diffHash).not.toBe(b!.diffHash);
    expect(a!.diffHash).toBe(again!.diffHash);
  });

  test("the diff is taken against HEAD with binary content and no external or textconv drivers", async () => {
    const seams = fakeSeams();
    await treeIdentity(seams, "/src/tree");
    const diff = seams.calls.find((c) => c.startsWith("git diff HEAD"))!;
    for (const flag of ["--binary", "--no-color", "--no-ext-diff", "--no-textconv"]) expect(diff).toContain(flag);
  });

  test("untracked files count by path and content, whatever order git lists them in", async () => {
    const files = { "/src/tree/new.ts": "one", "/src/tree/b.ts": "two" };
    const base = await treeIdentity(fakeSeams({ untracked: ["new.ts", "b.ts"], files }), "/src/tree");
    const reordered = await treeIdentity(fakeSeams({ untracked: ["b.ts", "new.ts"], files }), "/src/tree");
    const edited = await treeIdentity(
      fakeSeams({ untracked: ["new.ts", "b.ts"], files: { ...files, "/src/tree/new.ts": "changed" } }),
      "/src/tree",
    );
    const renamed = await treeIdentity(
      fakeSeams({ untracked: ["renamed.ts", "b.ts"], files: { "/src/tree/renamed.ts": "one", "/src/tree/b.ts": "two" } }),
      "/src/tree",
    );
    expect(base!.diffHash).not.toBe(CLEAN_DIFF_HASH);
    expect(reordered!.diffHash).toBe(base!.diffHash);
    expect(edited!.diffHash).not.toBe(base!.diffHash);
    expect(renamed!.diffHash).not.toBe(base!.diffHash);
  });

  test("an unreadable untracked entry still counts, so it never passes for a clean tree", async () => {
    const id = await treeIdentity(fakeSeams({ untracked: ["nested-repo/"] }), "/src/tree");
    expect(id!.diffHash).not.toBe(CLEAN_DIFF_HASH);
  });

  test("any git failure means no identity rather than a guessed one", async () => {
    for (const failCmd of ["git rev-parse HEAD", "git diff HEAD", "git ls-files"]) {
      expect(await treeIdentity(fakeSeams({ failCmd }), "/src/tree")).toBeNull();
    }
  });
});

describe("bundle identity and the cache", () => {
  const key = { MSBuildTree: "/src/tree", MSBuildSha: SHA, MSBuildDiffHash: CLEAN_DIFF_HASH, MSBuildStamp: "s1" };

  test("a bundle's identity and stamp are read from its Info.plist", async () => {
    const seams = fakeSeams({ plists: { "/A.app": key } });
    expect(await readBundleIdentity(seams, "/A.app")).toEqual({
      tree: "/src/tree",
      sha: SHA,
      diffHash: CLEAN_DIFF_HASH,
      stamp: "s1",
    });
  });

  test("a bundle missing any identity key has no identity", async () => {
    const { MSBuildDiffHash: _, ...partial } = key;
    expect(await readBundleIdentity(fakeSeams({ plists: { "/A.app": partial } }), "/A.app")).toBeNull();
    expect(await readBundleIdentity(fakeSeams(), "/Missing.app")).toBeNull();
  });

  test("two builds are the same only when tree, sha and diff hash all match", () => {
    const a = { tree: "/t", sha: SHA, diffHash: "h" };
    expect(sameBuild(a, { ...a })).toBe(true);
    expect(sameBuild(a, { ...a, tree: "/u" })).toBe(false);
    expect(sameBuild(a, { ...a, sha: "b".repeat(40) })).toBe(false);
    expect(sameBuild(a, { ...a, diffHash: "g" })).toBe(false);
  });

  test("the cache lookup finds the entry whose bundle matches and skips in-flight dot entries", async () => {
    const builds = "/h/builds";
    const seams = fakeSeams({
      dirs: { [builds]: [".incoming-1", "other", "match"] },
      plists: {
        [`${builds}/.incoming-1/mattstack-dev.app`]: key,
        [`${builds}/other/mattstack-dev.app`]: { ...key, MSBuildSha: "b".repeat(40) },
        [`${builds}/match/mattstack-dev.app`]: { ...key, MSBuildStamp: "cached stamp" },
      },
    });
    const hit = await findCachedBuild(seams, builds, { tree: "/src/tree", sha: SHA, diffHash: CLEAN_DIFF_HASH });
    expect(hit).toEqual({ bundle: `${builds}/match/mattstack-dev.app`, stamp: "cached stamp" });
    expect(seams.calls.some((c) => c.includes(".incoming-1"))).toBe(false);
    expect(await findCachedBuild(seams, builds, { tree: "/src/tree", sha: SHA, diffHash: "dirty" })).toBeNull();
  });
});
