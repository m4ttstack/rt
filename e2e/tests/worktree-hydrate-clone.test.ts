import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createTestHome, rt } from "../harness.ts";

let home: { path: string; cleanup: () => void };
beforeAll(() => { home = createTestHome(); });
afterAll(() => home.cleanup());

describe("rt worktree hydrate-clone", () => {
  test("usage exits 2 and prints nothing on stdout", async () => {
    const res = await rt(["worktree", "hydrate-clone"], { home: home.path });
    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain("usage: rt worktree hydrate-clone <src> <dst>");
  });

  test("clones a directory and exits 0", async () => {
    const src = join(home.path, "src");
    mkdirSync(join(src, "n"), { recursive: true });
    writeFileSync(join(src, "n", "f.txt"), "ok\n");
    const res = await rt(["worktree", "hydrate-clone", src, join(home.path, "dst")], { home: home.path });
    expect(res.exitCode).toBe(0);
    expect(existsSync(join(home.path, "dst", "n", "f.txt"))).toBe(true);
  });

  test("existing destination exits 5", async () => {
    mkdirSync(join(home.path, "s2"));
    mkdirSync(join(home.path, "d2"));
    const res = await rt(["worktree", "hydrate-clone", join(home.path, "s2"), join(home.path, "d2")], { home: home.path });
    expect(res.exitCode).toBe(5);
    expect(res.stderr).toMatch(/clonefile: /);
  });
});
