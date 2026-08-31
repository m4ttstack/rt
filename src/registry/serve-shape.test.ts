import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { bundleBinaryPath, dataDir, readLinkedManifest } from "./serve-shape.ts";
import type { AppRecord } from "./records.ts";

function rec(over: Partial<AppRecord>): AppRecord {
  return { name: "chat", managedBy: "rt", port: 11002, kind: "service", createdAt: "2026-08-31", ...over };
}

test("dataDir derives from name under ~/.mattstack", () => {
  expect(dataDir("chat")).toBe(join(process.env.HOME!, ".mattstack", "chat"));
});

test("bundleBinaryPath: null outside a bundle, null when missing, path when installed", () => {
  expect(bundleBinaryPath("chat", null)).toBeNull();
  const helpers = mkdtempSync(join(tmpdir(), "helpers-"));
  expect(bundleBinaryPath("chat", helpers)).toBeNull();
  writeFileSync(join(helpers, "chat"), "#!/bin/sh\n");
  expect(bundleBinaryPath("chat", helpers)).toBe(join(helpers, "chat"));
});

describe("readLinkedManifest", () => {
  test("unlinked when no dev.workingDirectory", () => {
    expect(readLinkedManifest(rec({})).state).toBe("unlinked");
  });
  test("broken when the dir is gone", () => {
    const r = rec({ dev: { workingDirectory: "/nonexistent/chat" } });
    expect(readLinkedManifest(r).state).toBe("broken");
  });
  test("broken when the manifest is missing or unparseable", () => {
    const dir = mkdtempSync(join(tmpdir(), "link-"));
    expect(readLinkedManifest(rec({ dev: { workingDirectory: dir } })).state).toBe("broken");
    writeFileSync(join(dir, "mattstack.deck.json"), "{not json");
    expect(readLinkedManifest(rec({ dev: { workingDirectory: dir } })).state).toBe("broken");
  });
  test("linked returns the parsed manifest and dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "link-"));
    writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "chat", dev: { start: "bun x" } }));
    const link = readLinkedManifest(rec({ dev: { workingDirectory: dir } }));
    expect(link.state).toBe("linked");
    if (link.state === "linked") expect(link.manifest.dev?.start).toBe("bun x");
  });
});
