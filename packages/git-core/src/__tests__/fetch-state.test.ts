import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

describe("fetchState", () => {
  it("null before any fetch", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      const state = await createGitClient(sb.dir).fetchState();
      expect(state.lastFetchedAt).toBeNull();
    } finally {
      await sb.cleanup();
    }
  });

  it("a recent ISO 8601 string after fetching from a bare remote", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.addBareRemote();
      await sb.git(["push", "-u", "origin", "main"]);
      await sb.git(["fetch", "origin"]);
      const state = await createGitClient(sb.dir).fetchState();
      expect(state.lastFetchedAt).not.toBeNull();
      expect(state.lastFetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Date.now() - new Date(state.lastFetchedAt!).getTime()).toBeLessThan(60_000);
    } finally {
      await sb.cleanup();
    }
  });

  it("null after a fetch that failed, though git left a FETCH_HEAD behind", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.git(["fetch", "--quiet", "origin"]).catch(() => {});
      expect(await Bun.file(`${sb.dir}/.git/FETCH_HEAD`).exists()).toBe(true);
      const state = await createGitClient(sb.dir).fetchState();
      expect(state.lastFetchedAt).toBeNull();
    } finally {
      await sb.cleanup();
    }
  });
});
