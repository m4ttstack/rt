import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDepsLock } from "../bundle-layout.ts";

const LOCK_PATH = join(import.meta.dir, "..", "..", "rt-tray", "deps.lock");

describe("rt-tray/deps.lock", () => {
  const lock = parseDepsLock(readFileSync(LOCK_PATH, "utf8"));

  test("parses under the schema", () => {
    expect(lock.schema).toBe(1);
    expect(lock.arch).toBe("arm64");
  });
  test("every suite app is bundled; sparkle is a build tool", () => {
    const by = Object.fromEntries(lock.tools.map((t) => [t.name, t]));
    for (const n of ["jq", "gh", "glab", "bun", "node", "fast-browser", "gitq", "age-keygen", "age", "zstd", "git-lfs", "sops", "deck", "board", "console", "chat", "cloudflared", "portless"])
      expect(by[n]?.status).toBe("bundled");
    expect(by["sparkle"]?.kind).toBe("buildtool");
  });
  // State backup shells out to all three; a fresh Mac has none of them and the
  // daemon's launchd PATH never sees brew, so each must ride the bundle as a
  // plain single-file helper the backup code can resolve by name.
  test("the state-backup tools are single-file helpers, not exposed on PATH by default", () => {
    const by = Object.fromEntries(lock.tools.map((t) => [t.name, t]));
    for (const n of ["age", "zstd", "git-lfs"]) {
      expect(by[n]?.kind, n).toBe("helper");
      expect(by[n]?.bundlePath, n).toBe(`Contents/Helpers/${n}`);
      expect(by[n]?.exec, n).toEqual([`Contents/Helpers/${n}`]);
      expect(by[n]?.exposeByDefault, n).toBe(false);
      expect(by[n]?.entitlements, n).toBe("none");
    }
    expect(by["age"]?.license).toBe("BSD-3-Clause");
    expect(by["zstd"]?.license).toBe("BSD-3-Clause");
    expect(by["git-lfs"]?.license).toBe("MIT");
  });
  test("age and age-keygen come out of the same upstream tarball", () => {
    const by = Object.fromEntries(lock.tools.map((t) => [t.name, t]));
    expect(by["age"]?.url).toBe(by["age-keygen"]!.url);
    expect(by["age"]?.sha256).toBe(by["age-keygen"]!.sha256);
    expect(by["age"]?.version).toBe(by["age-keygen"]!.version);
    expect(by["age"]?.extract).toBe("age/age");
  });
  // Upstream publishes no darwin binary and the Homebrew bottle links brew-only
  // dylibs, so zstd is compiled from its sha-pinned release tarball.
  test("zstd builds from the upstream source tarball", () => {
    const zstd = lock.tools.find((t) => t.name === "zstd")!;
    expect(zstd.archive).toBe("make-src");
    expect(zstd.url).toMatch(/^https:\/\/github\.com\/facebook\/zstd\/releases\/download\/v[\d.]+\/zstd-[\d.]+\.tar\.gz$/);
    expect(zstd.extract).toBe(`zstd-${zstd.version}`);
  });
  test("default-exposed set is exactly fast-browser, gitq, deck (rt is exposed by the binary link, not a helper)", () => {
    const exposed = lock.tools.filter((t) => t.exposeByDefault).map((t) => t.name).sort();
    expect(exposed).toEqual(["deck", "fast-browser", "gitq"]);
  });
  test("bun-based helpers declare jit entitlements; Go/C helpers declare none", () => {
    const by = Object.fromEntries(lock.tools.map((t) => [t.name, t]));
    expect(by["bun"]?.entitlements).toBe("jit");
    expect(by["node"]?.entitlements).toBe("jit");
    for (const n of ["jq", "gh", "glab"]) expect(by[n]?.entitlements).toBe("none");
  });
});
