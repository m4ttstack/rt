import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const REPO = join(import.meta.dir, "..", "..");
const SCRIPT = join(REPO, "scripts", "fetch-deps.sh");

let work: string;
let depsRoot: string;

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

function runScript(lockPath: string): { code: number; out: string } {
  try {
    const out = execFileSync("bash", [SCRIPT, "arm64"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, RT_DEPS_LOCK: lockPath, RT_DEPS_ROOT: depsRoot, RT_DEPS_CACHE: join(work, "cache") },
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}

/** A tarball whose root dir builds `<name>` from a Makefile target of the same name, the way upstream zstd's does. */
function sourceTarball(name: string, dir: string, makefile: string): { tgz: string; sha: string } {
  const stage = join(work, `stage-${name}`, dir);
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, `${name}.c`), `#include <stdio.h>\nint main(void){puts("${name} 1.0.0");return 0;}\n`);
  writeFileSync(join(stage, "Makefile"), makefile);
  const tgz = join(work, `${dir}.tar.gz`);
  execFileSync("tar", ["czf", tgz, "-C", join(work, `stage-${name}`), dir]);
  const sha = execFileSync("shasum", ["-a", "256", tgz], { encoding: "utf8" }).split(" ")[0]!;
  return { tgz, sha };
}

function lockFor(name: string, tgz: string, sha: string, extract: string): string {
  const lockPath = join(work, `${name}.lock`);
  writeFileSync(lockPath, JSON.stringify({
    schema: 1, arch: "arm64",
    tools: [{
      name, version: "1.0.0", license: "MIT",
      url: `file://${tgz}`, sha256: sha,
      archive: "make-src", extract,
      bundlePath: `Contents/Helpers/${name}`, exec: [`Contents/Helpers/${name}`],
      exposeByDefault: false, entitlements: "none", status: "bundled", kind: "helper",
    }],
  }));
  return lockPath;
}

let toolcLock: string;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "fetch-make-src-"));
  depsRoot = join(work, "deps");
  // One tarball for both toolc cases: a regenerated one hashes differently
  // (mtimes), and the skip case is exactly about the sha stamp matching.
  const { tgz, sha } = sourceTarball("toolc", "toolc-1.0.0", "toolc: toolc.c\n\tcc -o $@ $<\n");
  toolcLock = lockFor("toolc", tgz, sha, "toolc-1.0.0");
});

test("make-src: builds the tool from its source dir and lands a runnable binary", () => {
  const res = runScript(toolcLock);
  expect(res.code, res.out).toBe(0);
  const bin = join(depsRoot, "arm64", "toolc");
  expect(existsSync(bin)).toBe(true);
  expect(execFileSync(bin, { encoding: "utf8" }).trim()).toBe("toolc 1.0.0");
  expect(existsSync(join(depsRoot, "arm64", "toolc.sha256"))).toBe(true);
});

test("make-src: an unchanged run is a skip", () => {
  const res = runScript(toolcLock);
  expect(res.code, res.out).toBe(0);
  expect(res.out).toContain("already unpacked");
});

test("make-src: a tarball missing the extract dir fails loudly", () => {
  const { tgz, sha } = sourceTarball("toold", "toold-1.0.0", "toold: toold.c\n\tcc -o $@ $<\n");
  const res = runScript(lockFor("toold", tgz, sha, "toold-9.9.9"));
  expect(res.code).not.toBe(0);
  expect(res.out).toContain("archive no longer contains toold-9.9.9");
});

// The whole reason zstd is compiled rather than taken from a bottle: a binary
// that links anything outside /usr/lib or /System dies on a Mac that lacks it.
test("make-src: a build whose binary links outside the system libraries is refused", () => {
  const dylibSrc = join(work, "libextra.c");
  writeFileSync(dylibSrc, "int extra(void){return 1;}\n");
  const dylib = join(work, "libextra.dylib");
  execFileSync("cc", ["-dynamiclib", "-o", dylib, dylibSrc, "-install_name", dylib]);
  const makefile = `toole: toole.c\n\tcc -o $@ $< ${dylib}\n`;
  const stage = join(work, "stage-toole", "toole-1.0.0");
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "toole.c"), "int extra(void);\nint main(void){return extra()-1;}\n");
  writeFileSync(join(stage, "Makefile"), makefile);
  const tgz = join(work, "toole-1.0.0.tar.gz");
  execFileSync("tar", ["czf", tgz, "-C", join(work, "stage-toole"), "toole-1.0.0"]);
  const sha = execFileSync("shasum", ["-a", "256", tgz], { encoding: "utf8" }).split(" ")[0]!;
  const res = runScript(lockFor("toole", tgz, sha, "toole-1.0.0"));
  expect(res.code).not.toBe(0);
  expect(res.out).toContain("links outside the system libraries");
  expect(existsSync(join(depsRoot, "arm64", "toole"))).toBe(false);
});
