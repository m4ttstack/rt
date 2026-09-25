import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  CACHED_BUNDLE_NAME,
  CLEAN_DIFF_HASH,
  findCachedBuild,
  readBundleIdentity,
  sameBuild,
  snapshotTree,
  treeIdentity,
  type CacheSeams,
} from "../dev-app-cache.ts";

const SHA = "a".repeat(40);
const ok = (stdout = "") => Promise.resolve({ stdout, stderr: "", exitCode: 0 });
const fail = () => Promise.resolve({ stdout: "", stderr: "nope", exitCode: 1 });

interface Fake {
  diff?: string;
  tracked?: string[];
  deleted?: string[];
  untracked?: string[];
  files?: Record<string, string>;
  links?: Record<string, string>;
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
    readLink: (p) => f.links?.[p] ?? null,
    exec: (argv) => {
      const cmd = argv.join(" ");
      calls.push(cmd);
      if (f.failCmd && cmd.startsWith(f.failCmd)) return fail();
      if (cmd === "git rev-parse HEAD") return ok(`${SHA}\n`);
      if (cmd.startsWith("git diff HEAD")) return ok(f.diff ?? "");
      const listing = (paths: string[] | undefined) => ok((paths ?? []).map((p) => `${p}\0`).join(""));
      if (cmd === "git ls-files -z --others --exclude-standard") return listing(f.untracked);
      if (cmd === "git ls-files -z --cached") return listing(f.tracked);
      if (cmd === "git ls-files -z --deleted") return listing(f.deleted);
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
  test("a clean tree is its path, full HEAD sha, the fixed clean hash, and the version it builds as", async () => {
    const id = await treeIdentity(fakeSeams(), "/src/tree", "v2.11.0");
    expect(id).toEqual({ tree: "/src/tree", sha: SHA, diffHash: CLEAN_DIFF_HASH, version: "v2.11.0" });
  });

  test("the tracked diff against HEAD changes the hash, and the same diff hashes the same", async () => {
    const a = await treeIdentity(fakeSeams({ diff: "diff --git a/x b/x\n+1\n" }), "/src/tree", "v2.11.0");
    const b = await treeIdentity(fakeSeams({ diff: "diff --git a/x b/x\n+2\n" }), "/src/tree", "v2.11.0");
    const again = await treeIdentity(fakeSeams({ diff: "diff --git a/x b/x\n+1\n" }), "/src/tree", "v2.11.0");
    expect(a!.diffHash).not.toBe(CLEAN_DIFF_HASH);
    expect(a!.diffHash).not.toBe(b!.diffHash);
    expect(a!.diffHash).toBe(again!.diffHash);
  });

  test("the diff is taken against HEAD with binary content and no external or textconv drivers", async () => {
    const seams = fakeSeams();
    await treeIdentity(seams, "/src/tree", "v2.11.0");
    const diff = seams.calls.find((c) => c.startsWith("git diff HEAD"))!;
    for (const flag of ["--binary", "--no-color", "--no-ext-diff", "--no-textconv"]) expect(diff).toContain(flag);
  });

  test("untracked files count by path and content, whatever order git lists them in", async () => {
    const files = { "/src/tree/new.ts": "one", "/src/tree/b.ts": "two" };
    const base = await treeIdentity(fakeSeams({ untracked: ["new.ts", "b.ts"], files }), "/src/tree", "v2.11.0");
    const reordered = await treeIdentity(fakeSeams({ untracked: ["b.ts", "new.ts"], files }), "/src/tree", "v2.11.0");
    const edited = await treeIdentity(
      fakeSeams({ untracked: ["new.ts", "b.ts"], files: { ...files, "/src/tree/new.ts": "changed" } }),
      "/src/tree",
      "v2.11.0",
    );
    const renamed = await treeIdentity(
      fakeSeams({ untracked: ["renamed.ts", "b.ts"], files: { "/src/tree/renamed.ts": "one", "/src/tree/b.ts": "two" } }),
      "/src/tree",
      "v2.11.0",
    );
    expect(base!.diffHash).not.toBe(CLEAN_DIFF_HASH);
    expect(reordered!.diffHash).toBe(base!.diffHash);
    expect(edited!.diffHash).not.toBe(base!.diffHash);
    expect(renamed!.diffHash).not.toBe(base!.diffHash);
  });

  test("an unreadable untracked file still counts, so it never passes for a clean tree", async () => {
    const id = await treeIdentity(fakeSeams({ untracked: ["locked.ts"] }), "/src/tree", "v2.11.0");
    expect(id!.diffHash).not.toBe(CLEAN_DIFF_HASH);
  });

  test("an untracked symlink counts by its target, the way the copy carries it", async () => {
    const at = (target: string) =>
      treeIdentity(
        fakeSeams({ untracked: ["link"], links: { "/src/tree/link": target }, files: { "/src/tree/link": "same" } }),
        "/src/tree",
        "v2.11.0",
      );
    expect((await at("a/one"))!.diffHash).not.toBe((await at("a/two"))!.diffHash);
    expect((await at("a/one"))!.diffHash).toBe((await at("a/one"))!.diffHash);
  });

  test("an untracked nested repo makes the tree uncacheable instead of hashing to a constant", async () => {
    const snap = await snapshotTree(fakeSeams({ untracked: ["nested-repo/"] }), "/src/tree", "v2.11.0");
    expect(snap!.identity).toBeNull();
    expect(snap!.uncacheable).toContain("nested-repo/");
    expect(snap!.files).toContain("nested-repo/");
  });

  test("the copy list is the tracked files still on disk plus the untracked ones the key hashes", async () => {
    const snap = await snapshotTree(
      fakeSeams({ tracked: ["a.ts", "gone.ts", "b/c.ts"], deleted: ["gone.ts"], untracked: ["new.ts"], files: { "/src/tree/new.ts": "x" } }),
      "/src/tree",
      "v2.11.0",
    );
    expect(snap!.files).toEqual(["a.ts", "b/c.ts", "new.ts"]);
    expect(snap!.uncacheable).toBeNull();
  });

  test("a tree git cannot list has no snapshot at all", async () => {
    expect(await snapshotTree(fakeSeams({ failCmd: "git ls-files -z --cached" }), "/src/tree", "v2.11.0")).toBeNull();
  });

  test("any git failure means no identity rather than a guessed one", async () => {
    for (const failCmd of ["git rev-parse HEAD", "git diff HEAD", "git ls-files"]) {
      expect(await treeIdentity(fakeSeams({ failCmd }), "/src/tree", "v2.11.0")).toBeNull();
    }
  });
});

describe("bundle identity and the cache", () => {
  const key = {
    MSBuildTree: "/src/tree",
    MSBuildSha: SHA,
    MSBuildDiffHash: CLEAN_DIFF_HASH,
    MSBuildVersion: "v2.11.0",
    MSBuildStamp: "s1",
  };

  test("a bundle's identity and stamp are read from its Info.plist", async () => {
    const seams = fakeSeams({ plists: { "/A.app": key } });
    expect(await readBundleIdentity(seams, "/A.app")).toEqual({
      tree: "/src/tree",
      sha: SHA,
      diffHash: CLEAN_DIFF_HASH,
      version: "v2.11.0",
      stamp: "s1",
    });
  });

  test("a bundle missing any identity key has no identity", async () => {
    const { MSBuildDiffHash: _, ...partial } = key;
    expect(await readBundleIdentity(fakeSeams({ plists: { "/A.app": partial } }), "/A.app")).toBeNull();
    const { MSBuildVersion: __, ...noVersion } = key;
    expect(await readBundleIdentity(fakeSeams({ plists: { "/A.app": noVersion } }), "/A.app")).toBeNull();
    expect(await readBundleIdentity(fakeSeams(), "/Missing.app")).toBeNull();
  });

  test("two builds are the same only when tree, sha, diff hash and version all match", () => {
    const a = { tree: "/t", sha: SHA, diffHash: "h", version: "v1" };
    expect(sameBuild(a, { ...a })).toBe(true);
    expect(sameBuild(a, { ...a, tree: "/u" })).toBe(false);
    expect(sameBuild(a, { ...a, sha: "b".repeat(40) })).toBe(false);
    expect(sameBuild(a, { ...a, diffHash: "g" })).toBe(false);
    expect(sameBuild(a, { ...a, version: "v2" })).toBe(false);
  });

  test("the cache lookup finds the entry whose bundle matches and skips in-flight dot entries", async () => {
    const builds = "/h/builds";
    const seams = fakeSeams({
      dirs: { [builds]: [".incoming-1", "other", "match"] },
      plists: {
        [`${builds}/.incoming-1/bundle`]: key,
        [`${builds}/other/bundle`]: { ...key, MSBuildSha: "b".repeat(40) },
        [`${builds}/match/bundle`]: { ...key, MSBuildStamp: "cached stamp" },
      },
    });
    const hit = await findCachedBuild(seams, builds, { tree: "/src/tree", sha: SHA, diffHash: CLEAN_DIFF_HASH, version: "v2.11.0" });
    expect(hit).toEqual({ bundle: `${builds}/match/bundle`, stamp: "cached stamp" });
    expect(seams.calls.some((c) => c.includes(".incoming-1"))).toBe(false);
    expect(await findCachedBuild(seams, builds, { tree: "/src/tree", sha: SHA, diffHash: "dirty", version: "v2.11.0" })).toBeNull();
  });
});

describe.skipIf(process.platform !== "darwin")("a cached bundle's signature", () => {
  test("survives being kept as a plain folder and cloned back to an .app", () => {
    const dir = mkdtempSync(join(tmpdir(), "dev-app-sig-"));
    try {
      const app = join(dir, "Probe.app");
      mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
      copyFileSync("/usr/bin/true", join(app, "Contents/MacOS/Probe"));
      writeFileSync(
        join(app, "Contents/Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Probe</string><key>CFBundleIdentifier</key><string>test.dev-app-cache.probe</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
      );
      const run = (argv: string[]) => Bun.spawnSync(argv, { stdout: "ignore", stderr: "ignore" }).exitCode;
      expect(run(["codesign", "--force", "--sign", "-", app])).toBe(0);
      const kept = join(dir, "entry", CACHED_BUNDLE_NAME);
      mkdirSync(join(dir, "entry"));
      renameSync(app, kept);
      const staged = join(dir, "incoming", "mattstack-dev.app");
      mkdirSync(join(dir, "incoming"));
      expect(run(["cp", "-cR", kept, staged])).toBe(0);
      expect(run(["codesign", "--verify", "--strict", staged])).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
