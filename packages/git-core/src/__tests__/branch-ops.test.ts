import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

async function seeded() {
  const sb = await makeSandbox();
  await sb.write("a.txt", "one\n");
  await sb.commitAll("first");
  return sb;
}

describe("createBranch", () => {
  it("creates a branch visible in branches() without moving HEAD", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await client.createBranch("feature");
      const branches = await client.branches();
      expect(branches.map((b) => b.name)).toContain("feature");
      const current = branches.find((b) => b.current);
      expect(current?.name).toBe("main");
    } finally {
      await sb.cleanup();
    }
  });

  it("with checkout: true moves HEAD to the new branch", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await client.createBranch("feature", { checkout: true });
      const branches = await client.branches();
      const current = branches.find((b) => b.current);
      expect(current?.name).toBe("feature");
    } finally {
      await sb.cleanup();
    }
  });

  it("with from points the new branch's tip at that sha", async () => {
    const sb = await seeded();
    try {
      const firstSha = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.write("a.txt", "two\n");
      await sb.commitAll("second");

      const client = createGitClient(sb.dir);
      await client.createBranch("feature", { from: firstSha });
      const branches = await client.branches();
      const feature = branches.find((b) => b.name === "feature");
      expect(feature?.sha).toBe(firstSha);
    } finally {
      await sb.cleanup();
    }
  });
});

describe("checkoutBranch", () => {
  it("switches HEAD to an existing branch", async () => {
    const sb = await seeded();
    try {
      await sb.git(["branch", "feature"]);
      const client = createGitClient(sb.dir);
      await client.checkoutBranch("feature");
      const branches = await client.branches();
      const current = branches.find((b) => b.current);
      expect(current?.name).toBe("feature");
    } finally {
      await sb.cleanup();
    }
  });

  it("rejects with the git error text on a conflicting dirty file", async () => {
    const sb = await seeded();
    try {
      await sb.git(["checkout", "-b", "feature"]);
      await sb.write("a.txt", "feature content\n");
      await sb.commitAll("on feature");
      await sb.git(["checkout", "main"]);
      await sb.write("a.txt", "dirty uncommitted change\n");

      const client = createGitClient(sb.dir);
      await expect(client.checkoutBranch("feature")).rejects.toThrow(/checkout/i);
    } finally {
      await sb.cleanup();
    }
  });
});
