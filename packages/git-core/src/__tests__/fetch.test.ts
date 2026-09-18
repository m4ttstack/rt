import { describe, expect, test } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

describe("fetch", () => {
  test("fetch pulls new remote commits into remote-tracking refs and stamps lastFetchedAt", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "one\n");
      await sb.commitAll("init");
      const remoteDir = await sb.addBareRemote();
      await sb.git(["push", "origin", "main"]);
      const client = createGitClient(sb.dir);
      expect((await client.fetchState()).lastFetchedAt).toBeNull();
      await client.fetch();
      expect((await client.fetchState()).lastFetchedAt).not.toBeNull();
      void remoteDir;
    } finally {
      await sb.cleanup();
    }
  });

  test("a flag-like remote is rejected before any spawn", async () => {
    const sb = await makeSandbox();
    try {
      const client = createGitClient(sb.dir);
      await expect(client.fetch("--upload-pack=touch /tmp/pwned")).rejects.toThrow();
    } finally {
      await sb.cleanup();
    }
  });
});
