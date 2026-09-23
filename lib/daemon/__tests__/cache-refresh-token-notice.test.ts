import { describe, expect, test } from "bun:test";
import { createMissingTokenNotice } from "../cache-refresh.ts";

function recorder() {
  const lines: Array<{ fields: Record<string, unknown>; msg: string }> = [];
  return { lines, log: { info: (fields: Record<string, unknown>, msg: string) => lines.push({ fields, msg }) } };
}

describe("createMissingTokenNotice", () => {
  test("logs a repo's missing token once across cycles", () => {
    const r = recorder();
    const note = createMissingTokenNotice(r.log);
    note("repo-a", { forge: "github", token: null });
    note("repo-a", { forge: "github", token: null });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.fields).toEqual({ repo: "repo-a", forge: "github" });
    expect(r.lines[0]!.msg).toContain("rt setup github connect");
  });

  test("each repo gets its own line", () => {
    const r = recorder();
    const note = createMissingTokenNotice(r.log);
    note("repo-a", { forge: "github", token: null });
    note("repo-b", { forge: "gitlab", token: null });
    expect(r.lines.map((l) => l.fields.repo)).toEqual(["repo-a", "repo-b"]);
  });

  test("a token arriving re-arms the notice for a later loss", () => {
    const r = recorder();
    const note = createMissingTokenNotice(r.log);
    note("repo-a", { forge: "github", token: null });
    note("repo-a", { forge: "github", token: "ghp" });
    note("repo-a", { forge: "github", token: null });
    expect(r.lines).toHaveLength(2);
  });

  test("a remote on neither forge never logs", () => {
    const r = recorder();
    createMissingTokenNotice(r.log)("repo-a", null);
    expect(r.lines).toHaveLength(0);
  });
});
