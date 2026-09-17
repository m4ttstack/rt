import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

async function seeded() {
  const sb = await makeSandbox();
  await sb.write("a.txt", "one\n");
  await sb.commitAll("first");
  return sb;
}

describe("branches", () => {
  it("lists branches with current flag and sha", async () => {
    const sb = await seeded();
    try {
      await sb.git(["branch", "feature"]);
      const branches = await createGitClient(sb.dir).branches();
      const names = branches.map((b) => b.name).sort();
      expect(names).toEqual(["feature", "main"]);
      const main = branches.find((b) => b.name === "main")!;
      expect(main.current).toBe(true);
      expect(main.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(main.upstream).toBeNull();
    } finally {
      await sb.cleanup();
    }
  });

  it("ahead/behind and upstream after push + local commit", async () => {
    const sb = await seeded();
    try {
      await sb.addBareRemote();
      await sb.git(["push", "-u", "origin", "main"]);
      await sb.write("a.txt", "two\n");
      await sb.commitAll("second");
      const main = (await createGitClient(sb.dir).branches()).find((b) => b.name === "main")!;
      expect(main.upstream).toBe("origin/main");
      expect(main.ahead).toBe(1);
      expect(main.behind).toBe(0);
      expect(main.upstreamGone).toBe(false);
    } finally {
      await sb.cleanup();
    }
  });

  it("upstreamGone when the remote branch is deleted", async () => {
    const sb = await seeded();
    try {
      await sb.addBareRemote();
      await sb.git(["push", "-u", "origin", "main"]);
      await sb.git(["push", "origin", "--delete", "main"]);
      await sb.git(["fetch", "--prune", "origin"]);
      const main = (await createGitClient(sb.dir).branches()).find((b) => b.name === "main")!;
      expect(main.upstreamGone).toBe(true);
      expect(main.ahead).toBeNull();
      expect(main.behind).toBeNull();
    } finally {
      await sb.cleanup();
    }
  });
});

describe("tags", () => {
  it("annotated vs lightweight", async () => {
    const sb = await seeded();
    try {
      await sb.git(["tag", "light"]);
      await sb.git(["tag", "-a", "heavy", "-m", "annotated"]);
      const tags = await createGitClient(sb.dir).tags();
      const byName = new Map(tags.map((t) => [t.name, t]));
      expect(byName.get("light")!.annotated).toBe(false);
      expect(byName.get("heavy")!.annotated).toBe(true);
      expect(byName.get("light")!.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(byName.get("light")!.targetSha).toBe(byName.get("light")!.sha);
      expect(byName.get("heavy")!.targetSha).not.toBe(byName.get("heavy")!.sha);
    } finally {
      await sb.cleanup();
    }
  });
});
