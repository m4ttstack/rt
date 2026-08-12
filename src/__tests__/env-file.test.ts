import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvFile, upsertEnvKeys } from "../env-file.ts";

function tmpEnv(content?: string): string {
  const p = join(mkdtempSync(join(tmpdir(), "envtest-")), ".env");
  if (content !== undefined) writeFileSync(p, content);
  return p;
}

describe("readEnvFile", () => {
  test("parses KEY=VALUE, skipping comments and blanks", () => {
    const p = tmpEnv("# comment\nA=1\n\nB=two=parts\n");
    expect(readEnvFile(p)).toEqual({ A: "1", B: "two=parts" });
  });
  test("missing file reads as empty", () => {
    expect(readEnvFile(join(tmpdir(), "does-not-exist-xyz", ".env"))).toEqual({});
  });
});

describe("upsertEnvKeys", () => {
  test("updates in place, preserves comments and unrelated lines, appends new keys", () => {
    const p = tmpEnv("# keep me\nGITLAB_TOKEN=old\nSLACK_TOKEN=s\n");
    upsertEnvKeys(p, { GITLAB_TOKEN: "new", SWITCHBOARD_TOKEN: "sb" });
    const text = readFileSync(p, "utf8");
    expect(text).toContain("# keep me");
    expect(text).toContain("GITLAB_TOKEN=new");
    expect(text).toContain("SLACK_TOKEN=s");
    expect(text.trim().endsWith("SWITCHBOARD_TOKEN=sb")).toBe(true);
    expect(text).not.toContain("old");
  });
  test("creates the file when absent", () => {
    const p = join(mkdtempSync(join(tmpdir(), "envtest-")), ".env");
    upsertEnvKeys(p, { A: "1" });
    expect(readEnvFile(p)).toEqual({ A: "1" });
  });
});
