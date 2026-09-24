import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

describe("createGitClient", () => {
  it("returns a client bound to the directory", async () => {
    const sb = await makeSandbox();
    try {
      const client = createGitClient(sb.dir);
      expect(client.dir).toBe(sb.dir);
      expect(typeof client.snapshot).toBe("function");
      expect(typeof client.diffFile).toBe("function");
      expect(typeof client.branches).toBe("function");
      expect(typeof client.tags).toBe("function");
      expect(typeof client.log).toBe("function");
      expect(typeof client.stashes).toBe("function");
      expect(typeof client.fetchState).toBe("function");
      expect(typeof client.appendIgnoreRule).toBe("function");
      expect(typeof client.appendIgnoreFile).toBe("function");
      expect(typeof client.discardChanges).toBe("function");
      expect(typeof client.desktopStashes).toBe("function");
      expect(typeof client.lastDesktopStashEntryForBranch).toBe("function");
      expect(typeof client.createDesktopStashEntry).toBe("function");
      expect(typeof client.dropDesktopStashEntry).toBe("function");
      expect(typeof client.popStashEntry).toBe("function");
      expect(typeof client.stashedFiles).toBe("function");
    } finally {
      await sb.cleanup();
    }
  });
});
