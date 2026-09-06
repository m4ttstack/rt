import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  test("trims spaces around = and strips one pair of surrounding quotes", () => {
    const p = tmpEnv('A="quoted"\nB = spaced \nC=\'single\'\nD="ragged\n');
    expect(readEnvFile(p)).toEqual({ A: "quoted", B: "spaced", C: "single", D: '"ragged' });
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
  test("replaces a hand-written 'KEY = value' line instead of appending a duplicate", () => {
    const p = tmpEnv("SWITCHBOARD_TOKEN = old\n");
    upsertEnvKeys(p, { SWITCHBOARD_TOKEN: "new" });
    const text = readFileSync(p, "utf8");
    expect(text).not.toContain("old");
    expect(text.match(/SWITCHBOARD_TOKEN/g)?.length).toBe(1);
    expect(readEnvFile(p)).toEqual({ SWITCHBOARD_TOKEN: "new" });
  });
  test("leaves the file owner-only, even over a stale tmp file", () => {
    const p = tmpEnv("A=1\n");
    writeFileSync(p + ".tmp", "junk\n", { mode: 0o666 });
    upsertEnvKeys(p, { A: "2" });
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });
  test("empty string value for a key that never existed writes nothing", () => {
    const p = tmpEnv("GITLAB_TOKEN=g\n");
    upsertEnvKeys(p, { SLACK_TOKEN: "" });
    const text = readFileSync(p, "utf8");
    expect(text).not.toContain("SLACK_TOKEN");
    expect(readEnvFile(p)).toEqual({ GITLAB_TOKEN: "g" });
  });
  test("collapses duplicate lines for the same key to a single replacement", () => {
    const p = tmpEnv("SWITCHBOARD_TOKEN=old1\nSWITCHBOARD_TOKEN=old2\n");
    upsertEnvKeys(p, { SWITCHBOARD_TOKEN: "new" });
    const text = readFileSync(p, "utf8");
    expect(text.match(/SWITCHBOARD_TOKEN/g)?.length).toBe(1);
    expect(text).toContain("SWITCHBOARD_TOKEN=new");
    expect(text).not.toContain("old1");
    expect(text).not.toContain("old2");
    expect(readEnvFile(p)).toEqual({ SWITCHBOARD_TOKEN: "new" });
  });
  test("duplicate lines with an empty-string removal value: no line survives", () => {
    const p = tmpEnv("SWITCHBOARD_TOKEN=old1\nSWITCHBOARD_TOKEN=old2\n");
    upsertEnvKeys(p, { SWITCHBOARD_TOKEN: "" });
    const text = readFileSync(p, "utf8");
    expect(text).not.toContain("SWITCHBOARD_TOKEN");
    expect(readEnvFile(p)).toEqual({});
  });
  test("a line whose key shadows an inherited Object.prototype name is left alone", () => {
    const p = tmpEnv("constructor=keepme\nGITLAB_TOKEN=g\n");
    upsertEnvKeys(p, { GITLAB_TOKEN: "new" });
    const text = readFileSync(p, "utf8");
    expect(text).toContain("constructor=keepme");
    expect(text).toContain("GITLAB_TOKEN=new");
    expect(readEnvFile(p)).toEqual({ constructor: "keepme", GITLAB_TOKEN: "new" });
  });
  test("unrelated lines and comments survive a duplicate collapse elsewhere in the file", () => {
    const p = tmpEnv("# keep me\nSLACK_TOKEN=s\nSWITCHBOARD_TOKEN=old1\nGITLAB_TOKEN=g\nSWITCHBOARD_TOKEN=old2\n");
    upsertEnvKeys(p, { SWITCHBOARD_TOKEN: "new" });
    const text = readFileSync(p, "utf8");
    expect(text).toContain("# keep me");
    expect(text).toContain("SLACK_TOKEN=s");
    expect(text).toContain("GITLAB_TOKEN=g");
    expect(text.match(/SWITCHBOARD_TOKEN/g)?.length).toBe(1);
    expect(text).toContain("SWITCHBOARD_TOKEN=new");
    expect(readEnvFile(p)).toEqual({ SLACK_TOKEN: "s", GITLAB_TOKEN: "g", SWITCHBOARD_TOKEN: "new" });
  });
});
