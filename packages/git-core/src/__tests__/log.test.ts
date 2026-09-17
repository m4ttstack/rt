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

  it("a body containing simple-git's old default record separator round-trips intact", async () => {
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

  it("a subject and body containing the old \\x1e splitter round-trip intact", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.git(["add", "-A"]);
      const subject = "subject \x1e with splitter";
      const body = "body \x1e with splitter too";
      await sb.git(["commit", "-m", subject, "-m", body]);
      const log = await createGitClient(sb.dir).log();
      expect(log[0]!.subject).toBe(subject);
      expect(log[0]!.body).toBe(body);
    } finally {
      await sb.cleanup();
    }
  });

  it("multiple commits: sha and parents are unpolluted by the previous record's separator newline", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("a.txt", "2\n");
      await sb.commitAll("second");
      await sb.write("a.txt", "3\n");
      await sb.commitAll("third");
      const log = await createGitClient(sb.dir).log();
      expect(log.map((e) => e.subject)).toEqual(["third", "second", "first"]);
      for (const entry of log) {
        expect(entry.sha).toMatch(/^[0-9a-f]{40}$/);
      }
      expect(log[0]!.parents).toEqual([log[1]!.sha]);
      expect(log[1]!.parents).toEqual([log[2]!.sha]);
      expect(log[2]!.parents).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });
});
