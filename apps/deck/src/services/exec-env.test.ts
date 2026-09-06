import { test, expect, describe } from "bun:test";
import { composeServicePath, resolveProgram, stablePathDirs } from "./exec-env.ts";

const HOME = "/home/t";

describe("composeServicePath", () => {
  test("keeps only directories that exist, in precedence order", () => {
    const present = new Set(["/home/t/.local/bin", "/usr/bin", "/bin"]);

    const path = composeServicePath({ home: HOME, exists: (p) => present.has(p) });

    expect(path).toBe("/home/t/.local/bin:/usr/bin:/bin");
  });

  test("puts extras ahead of the stable set", () => {
    const present = new Set(["/opt/shims", "/usr/bin"]);

    const path = composeServicePath({
      home: HOME, extraDirs: ["/opt/shims"], exists: (p) => present.has(p),
    });

    expect(path).toBe("/opt/shims:/usr/bin");
  });

  test("dedupes an extra that is already in the stable set", () => {
    const present = new Set(["/usr/bin", "/bin"]);

    const path = composeServicePath({
      home: HOME, extraDirs: ["/usr/bin"], exists: (p) => present.has(p),
    });

    expect(path).toBe("/usr/bin:/bin");
  });

  test("never contains a per-shell version-manager directory", () => {
    // The failure this module exists to prevent: a shell's PATH carries
    // fnm_multishells/<pid>_<ts>, which is dead once that shell exits.
    const shellPath = "/home/t/.local/state/fnm_multishells/123_456/bin";
    const present = new Set([shellPath, "/usr/bin"]);

    const path = composeServicePath({ home: HOME, exists: (p) => present.has(p) });

    expect(path).not.toContain("fnm_multishells");
    expect(path).toBe("/usr/bin");
  });

  test("puts the bundle's Helpers dir first when running inside mattstack.app", () => {
    const present = new Set(["/App.app/Contents/Helpers", "/home/t/.local/bin", "/usr/bin"]);

    const path = composeServicePath({
      home: HOME, bundleHelpers: "/App.app/Contents/Helpers", exists: (p) => present.has(p),
    });

    expect(path).toBe("/App.app/Contents/Helpers:/home/t/.local/bin:/usr/bin");
  });

  test("omits the bundle Helpers dir outside a bundle (bundleHelpers: null)", () => {
    const present = new Set(["/home/t/.local/bin", "/usr/bin"]);

    const path = composeServicePath({ home: HOME, bundleHelpers: null, exists: (p) => present.has(p) });

    expect(path).not.toContain("Contents/Helpers");
  });

  test("is independent of the calling process's PATH", () => {
    const saved = process.env.PATH;
    try {
      process.env.PATH = "/poisoned/bin";
      const path = composeServicePath({ home: HOME, exists: () => true });
      expect(path).not.toContain("/poisoned/bin");
      expect(path).toBe(stablePathDirs(HOME).join(":"));
    } finally {
      process.env.PATH = saved;
    }
  });
});

describe("resolveProgram", () => {
  const execs = new Set(["/opt/shims/node", "/usr/bin/node"]);
  const isExec = (p: string) => execs.has(p);

  test("resolves a bare name against the path, first match wins", () => {
    expect(resolveProgram("node", "/opt/shims:/usr/bin", isExec)).toBe("/opt/shims/node");
  });

  test("skips directories that do not hold the executable", () => {
    expect(resolveProgram("node", "/nope:/usr/bin", isExec)).toBe("/usr/bin/node");
  });

  test("returns null when a bare name resolves to nothing", () => {
    expect(resolveProgram("ghost", "/opt/shims:/usr/bin", isExec)).toBeNull();
  });

  test("passes an absolute path through untouched", () => {
    expect(resolveProgram("/custom/bin/node", "/usr/bin", isExec)).toBe("/custom/bin/node");
  });

  test("passes an explicitly relative path through untouched", () => {
    expect(resolveProgram("./server", "/usr/bin", isExec)).toBe("./server");
  });

  test("re-resolves to the new location when the interpreter moves", () => {
    // The DECK-57 case: a stored bare name survives the move; a stored
    // absolute manager path would not have.
    const moved = new Set(["/opt/newmgr/shims/node"]);
    expect(resolveProgram("node", "/opt/newmgr/shims:/usr/bin", (p) => moved.has(p)))
      .toBe("/opt/newmgr/shims/node");
  });
});
