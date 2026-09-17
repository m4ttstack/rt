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

  it("createTag with both a message and an explicit sha lands the annotated tag on that older commit (git tag -a name -m msg sha ordering)", async () => {
    const sb = await seeded();
    try {
      const firstSha = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.write("a.txt", "two\n");
      await sb.commitAll("second");
      const client = createGitClient(sb.dir);
      await client.createTag("annotated-old", { message: "release note", sha: firstSha });
      const tags = await client.tags();
      const tag = tags.find((t) => t.name === "annotated-old")!;
      expect(tag.annotated).toBe(true);
      expect(tag.targetSha).toBe(firstSha);
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

  it("createTag rejects a flag-like name instead of running it as an argument to git tag", async () => {
    const sb = await seeded();
    try {
      await sb.git(["tag", "x"]);
      const client = createGitClient(sb.dir);
      // If unguarded, args become ["-d", "x"] -- git tag -d x deletes x.
      await expect(client.createTag("-d", { sha: "x" })).rejects.toThrow(/-d/);
      const tags = await client.tags();
      expect(tags.map((t) => t.name)).toContain("x");
    } finally {
      await sb.cleanup();
    }
  });

  it("deleteTag rejects a flag-like name", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await expect(client.deleteTag("-d")).rejects.toThrow(/-d/);
    } finally {
      await sb.cleanup();
    }
  });

  it("pushTag rejects a flag-like name", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await expect(client.pushTag("--force")).rejects.toThrow(/--force/);
    } finally {
      await sb.cleanup();
    }
  });

  it("pushTag rejects a flag-like remote instead of running it as an option to git push", async () => {
    const sb = await seeded();
    try {
      await sb.addBareRemote();
      const client = createGitClient(sb.dir);
      await client.createTag("v1");
      // If unguarded, args become ["push", "-o", "refs/tags/v1"] -- "-o"
      // is a valid `git push` flag, so nothing about the tag name signals
      // the mistake and the tag silently never reaches a remote.
      await expect(client.pushTag("v1", "-o")).rejects.toThrow(/-o/);
      const out = await sb.git(["ls-remote", "--tags", "origin"]);
      expect(out).not.toContain("refs/tags/v1");
    } finally {
      await sb.cleanup();
    }
  });

  it("createTag rejects an explicit empty sha instead of silently tagging HEAD", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await expect(client.createTag("empty-sha", { sha: "" })).rejects.toThrow(/sha/);
      const tags = await client.tags();
      expect(tags.find((t) => t.name === "empty-sha")).toBeUndefined();
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
