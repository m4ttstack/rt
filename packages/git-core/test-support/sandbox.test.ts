import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { makeSandbox } from "./sandbox.ts";

describe("sandbox factory", () => {
  it("creates an initialized repo on main under tmpdir", async () => {
    const sb = await makeSandbox();
    try {
      expect(sb.dir.startsWith(tmpdir())).toBe(true);
      const branch = await sb.git(["branch", "--show-current"]);
      expect(branch.trim()).toBe("main");
    } finally {
      await sb.cleanup();
    }
  });

  it("write + commitAll produces a commit", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "hello\n");
      await sb.commitAll("first");
      const subject = await sb.git(["log", "-1", "--format=%s"]);
      expect(subject.trim()).toBe("first");
    } finally {
      await sb.cleanup();
    }
  });

  it("addBareRemote wires origin and push works", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "hello\n");
      await sb.commitAll("first");
      await sb.addBareRemote();
      await sb.git(["push", "-u", "origin", "main"]);
      const upstream = await sb.git(["rev-parse", "--abbrev-ref", "main@{upstream}"]);
      expect(upstream.trim()).toBe("origin/main");
    } finally {
      await sb.cleanup();
    }
  });
});
