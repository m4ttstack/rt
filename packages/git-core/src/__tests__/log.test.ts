import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

describe("log", () => {
  it("returns entries newest-first with parents and body", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("a.txt", "2\n");
      await sb.git(["add", "-A"]);
      await sb.git(["commit", "-m", "second", "-m", "body line one\nbody line two"]);
      const log = await createGitClient(sb.dir).log();
      expect(log.length).toBe(2);
      expect(log[0]!.subject).toBe("second");
      expect(log[0]!.body).toContain("body line two");
      expect(log[0]!.parents.length).toBe(1);
      expect(log[1]!.subject).toBe("first");
      expect(log[1]!.parents).toEqual([]);
      expect(log[0]!.authorEmail).toBe("test@example.com");
      expect(log[0]!.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await sb.cleanup();
    }
  });

  it("maxCount and file filter", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("touch a");
      await sb.write("b.txt", "1\n");
      await sb.commitAll("touch b");
      await sb.write("a.txt", "2\n");
      await sb.commitAll("touch a again");
      const client = createGitClient(sb.dir);
      expect((await client.log({ maxCount: 1 })).length).toBe(1);
      const onlyA = await client.log({ file: "a.txt" });
      expect(onlyA.map((e) => e.subject)).toEqual(["touch a again", "touch a"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("empty repo returns []", async () => {
    const sb = await makeSandbox();
    try {
      expect(await createGitClient(sb.dir).log()).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("a body containing simple-git's default record separator round-trips intact", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.git(["add", "-A"]);
      const body = `line one \xF2 line two`;
      await sb.git(["commit", "-m", "subject", "-m", body]);
      const log = await createGitClient(sb.dir).log();
      expect(log[0]!.body).toBe(body);
    } finally {
      await sb.cleanup();
    }
  });
});
