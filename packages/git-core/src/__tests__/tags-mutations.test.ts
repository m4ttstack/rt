import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

async function seeded() {
  const sb = await makeSandbox();
  await sb.write("a.txt", "one\n");
  await sb.commitAll("first");
  return sb;
}

describe("tag mutations", () => {
  it("createTag without a message makes a lightweight tag whose targetSha equals sha", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await client.createTag("light");
      const tags = await client.tags();
      const light = tags.find((t) => t.name === "light")!;
      expect(light.annotated).toBe(false);
      expect(light.targetSha).toBe(light.sha);
    } finally {
      await sb.cleanup();
    }
  });

  it("createTag with a message makes an annotated tag whose targetSha is the tagged commit", async () => {
    const sb = await seeded();
    try {
      const commitSha = (await sb.git(["rev-parse", "HEAD"])).trim();
      const client = createGitClient(sb.dir);
      await client.createTag("heavy", { message: "release" });
      const tags = await client.tags();
      const heavy = tags.find((t) => t.name === "heavy")!;
      expect(heavy.annotated).toBe(true);
      expect(heavy.sha).not.toBe(heavy.targetSha);
      expect(heavy.targetSha).toBe(commitSha);
    } finally {
      await sb.cleanup();
    }
  });

  it("createTag with an explicit sha tags an older commit", async () => {
    const sb = await seeded();
    try {
      const firstSha = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.write("a.txt", "two\n");
      await sb.commitAll("second");
      const client = createGitClient(sb.dir);
      await client.createTag("old", { sha: firstSha });
      const tags = await client.tags();
      const old = tags.find((t) => t.name === "old")!;
      expect(old.targetSha).toBe(firstSha);
    } finally {
      await sb.cleanup();
    }
  });

  it("deleteTag removes the tag from tags()", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await client.createTag("temp");
      await client.deleteTag("temp");
      const tags = await client.tags();
      expect(tags.find((t) => t.name === "temp")).toBeUndefined();
    } finally {
      await sb.cleanup();
    }
  });

  it("pushTag pushes the tag to the given remote", async () => {
    const sb = await seeded();
    try {
      await sb.addBareRemote();
      const client = createGitClient(sb.dir);
      await client.createTag("v1");
      await client.pushTag("v1");
      const out = await sb.git(["ls-remote", "--tags", "origin"]);
      expect(out).toContain("refs/tags/v1");
    } finally {
      await sb.cleanup();
    }
  });
});
