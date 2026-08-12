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
  test("empty string value removes an existing key's line", () => {
    const p = tmpEnv("# keep me\nSLACK_TOKEN=stale\nGITLAB_TOKEN=g\n");
    upsertEnvKeys(p, { SLACK_TOKEN: "" });
    const text = readFileSync(p, "utf8");
    expect(text).toContain("# keep me");
    expect(text).toContain("GITLAB_TOKEN=g");
    expect(text).not.toContain("SLACK_TOKEN");
    expect(text).not.toContain("stale");
    expect(readEnvFile(p)).toEqual({ GITLAB_TOKEN: "g" });
  });
  test("empty string value for a key that never existed writes nothing", () => {
    const p = tmpEnv("GITLAB_TOKEN=g\n");
    upsertEnvKeys(p, { SLACK_TOKEN: "" });
    const text = readFileSync(p, "utf8");
    expect(text).not.toContain("SLACK_TOKEN");
    expect(readEnvFile(p)).toEqual({ GITLAB_TOKEN: "g" });
  });
});
