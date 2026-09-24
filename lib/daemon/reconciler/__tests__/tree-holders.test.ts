import { describe, test, expect } from "bun:test";
import { describeHolders, isStaleOrphan, parseEtime, STALE_ORPHAN_MS, treeHolders, type TreeHolder } from "../tree-holders.ts";

const H = 3600_000;

function holder(over: Partial<TreeHolder>): TreeHolder {
  return { pid: 10, ppid: 1, command: "xctest", fullCommand: "/Applications/Xcode.app/Contents/Developer/usr/bin/xctest x", elapsedMs: 13 * H, ...over };
}

describe("parseEtime", () => {
  test.each([
    ["00:05", 5_000],
    ["12:34", (12 * 60 + 34) * 1000],
    ["03:00:00", 3 * H],
    ["02-10:43:49", ((2 * 24 + 10) * 3600 + 43 * 60 + 49) * 1000],
  ])("%s", (raw, ms) => expect(parseEtime(raw)).toBe(ms));

  test("garbage is NaN", () => expect(parseEtime("soon")).toBeNaN());
});

describe("isStaleOrphan", () => {
  test("an old reparented toolchain binary inside an app bundle is stale", () => {
    expect(isStaleOrphan(holder({}))).toBe(true);
  });

  test("a process with a live parent is never an orphan", () => {
    expect(isStaleOrphan(holder({ ppid: 900 }))).toBe(false);
  });

  test("an orphan younger than the threshold is left alone", () => {
    expect(isStaleOrphan(holder({ elapsedMs: STALE_ORPHAN_MS - 1 }))).toBe(false);
  });

  test("an unparseable age is never stale", () => {
    expect(isStaleOrphan(holder({ elapsedMs: NaN }))).toBe(false);
  });

  test.each([
    ["an agent", { command: "claude", fullCommand: "claude --resume" }],
    ["a shell", { command: "zsh", fullCommand: "zsh" }],
    ["a login shell as ps reports it", { command: "-zsh", fullCommand: "-zsh" }],
    ["an editor", { command: "nvim", fullCommand: "nvim ." }],
    ["a GUI app", { command: "Electron", fullCommand: "/Applications/Cursor.app/Contents/MacOS/Cursor" }],
  ])("%s is never stale", (_label, over) => {
    expect(isStaleOrphan(holder(over))).toBe(false);
  });
});

describe("treeHolders", () => {
  test("never lists this process or its parent, even when its cwd is inside the tree", async () => {
    const pids = (await treeHolders(process.cwd())).map((h) => h.pid);
    expect(pids).not.toContain(process.pid);
    expect(pids).not.toContain(process.ppid);
  });
});

describe("describeHolders", () => {
  test("names up to three and counts the rest", () => {
    const hs = [1, 2, 3, 4, 5].map((pid) => holder({ pid, command: `p${pid}` }));
    expect(describeHolders(hs.slice(0, 1))).toBe("pid 1 (p1)");
    expect(describeHolders(hs)).toBe("pid 1 (p1), pid 2 (p2), pid 3 (p3) and 2 more");
  });
});
