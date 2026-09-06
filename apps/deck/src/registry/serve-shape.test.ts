import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { bundleBinaryPath, dataDir, readLinkedManifest, serveShape } from "./serve-shape.ts";
import { putRecord, getRecord, reloadRegistry } from "./records.ts";
import type { AppRecord } from "./records.ts";

function rec(over: Partial<AppRecord>): AppRecord {
  return { name: "chat", managedBy: "rt", port: 11002, kind: "service", createdAt: "2026-08-31", ...over };
}

const registryDir = mkdtempSync(join(tmpdir(), "local-registry-"));
process.env.LOCAL_REGISTRY_PATH = join(registryDir, "registry.json");

afterAll(() => rmSync(registryDir, { recursive: true, force: true }));
beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  reloadRegistry();
});

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

function linkedDir(manifest: object): string {
  const dir = mkdtempSync(join(tmpdir(), "src-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify(manifest));
  return dir;
}
const CHAT_DEV = { name: "chat", dev: { start: "bun src/server/index.ts", build: "bun run build" } };

describe("serveShape matrix", () => {
  test("user row: record shape, any mode", () => {
    const r = rec({ managedBy: "user", command: ["node", "s.js"], workingDirectory: "/x" });
    putRecord(r);
    expect(serveShape(r, { devMode: () => true })).toEqual({ command: ["node", "s.js"], cwd: "/x" });
  });

  test("legacy managed row (stored non-bundle command, no dev link): no shape, loud issue naming re-register", () => {
    const r = rec({ command: ["bun", "src/server.ts"], workingDirectory: "/data/gitq" });
    putRecord(r);
    expect(serveShape(r, { devMode: () => true, helpersDir: null })).toBeNull();
    const issue = getRecord("chat")?.issues?.[0];
    expect(issue?.source).toBe("dev-link");
    expect(issue?.message).toContain("deck register");
  });

  test("legacy stored command with a bundle installed: serves the derived bundle, still flags the legacy command", () => {
    const helpers = mkdtempSync(join(tmpdir(), "helpers-"));
    writeFileSync(join(helpers, "chat"), "");
    const r = rec({ command: ["bun", "src/server.ts"], workingDirectory: "/data/chat" });
    putRecord(r);
    expect(serveShape(r, { devMode: () => false, helpersDir: helpers })).toEqual({
      command: [join(helpers, "chat")], cwd: dataDir("chat"),
    });
    expect(getRecord("chat")?.issues?.[0]?.message).toContain("legacy");
  });

  test("dev + linked valid: source", () => {
    const dir = linkedDir(CHAT_DEV);
    const r = rec({ dev: { workingDirectory: dir } });
    putRecord(r);
    expect(serveShape(r, { devMode: () => true, helpersDir: null })).toEqual({
      command: ["bun", "src/server/index.ts"], cwd: dir,
    });
    expect(getRecord("chat")?.issues).toBeUndefined();
  });

  test("prod + linked + bundle installed: bundle, clean", () => {
    const helpers = mkdtempSync(join(tmpdir(), "helpers-"));
    writeFileSync(join(helpers, "chat"), "");
    const r = rec({ dev: { workingDirectory: linkedDir(CHAT_DEV) } });
    putRecord(r);
    expect(serveShape(r, { devMode: () => false, helpersDir: helpers })).toEqual({
      command: [join(helpers, "chat")], cwd: dataDir("chat"),
    });
    expect(getRecord("chat")?.issues).toBeUndefined();
  });

  test("unlinked managed row: dev mode, bundle installed: bundle, clean", () => {
    const helpers = mkdtempSync(join(tmpdir(), "helpers-"));
    writeFileSync(join(helpers, "chat"), "");
    const r = rec({});
    putRecord(r);
    expect(serveShape(r, { devMode: () => true, helpersDir: helpers })).toEqual({
      command: [join(helpers, "chat")], cwd: dataDir("chat"),
    });
    expect(getRecord("chat")?.issues).toBeUndefined();
  });

  test("never a phantom bundle: prod, source linked, no bundle: serves source loudly", () => {
    const dir = linkedDir(CHAT_DEV);
    const r = rec({ dev: { workingDirectory: dir } });
    putRecord(r);
    expect(serveShape(r, { devMode: () => false, helpersDir: null })?.cwd).toBe(dir);
    expect(getRecord("chat")?.issues?.[0]?.message).toContain("not installed");
  });

  test("dev-link issue clears when the bundle appears, same record across two resolves", () => {
    const dir = linkedDir(CHAT_DEV);
    const r = rec({ dev: { workingDirectory: dir } });
    putRecord(r);

    expect(serveShape(r, { devMode: () => false, helpersDir: null })?.cwd).toBe(dir);
    expect(getRecord("chat")?.issues?.[0]?.message).toContain("not installed");

    const helpers = mkdtempSync(join(tmpdir(), "helpers-"));
    writeFileSync(join(helpers, "chat"), "");
    expect(serveShape(r, { devMode: () => false, helpersDir: helpers })).toEqual({
      command: [join(helpers, "chat")], cwd: dataDir("chat"),
    });
    expect(getRecord("chat")?.issues).toBeUndefined();
  });

  test("dev + broken link + bundle: bundle with loud issue; issue clears on next clean resolve", () => {
    const helpers = mkdtempSync(join(tmpdir(), "helpers-"));
    writeFileSync(join(helpers, "chat"), "");
    const r = rec({ dev: { workingDirectory: "/nonexistent/chat" } });
    putRecord(r);
    expect(serveShape(r, { devMode: () => true, helpersDir: helpers })?.command).toEqual([join(helpers, "chat")]);
    expect(getRecord("chat")?.issues?.[0]?.source).toBe("dev-link");
    const fixed = rec({ dev: { workingDirectory: linkedDir(CHAT_DEV) } });
    putRecord(fixed);
    serveShape(fixed, { devMode: () => true, helpersDir: helpers });
    expect(getRecord("chat")?.issues).toBeUndefined();
  });

  test("neither bundle nor valid source: null with loud issue", () => {
    const r = rec({ dev: { workingDirectory: "/nonexistent/chat" } });
    putRecord(r);
    expect(serveShape(r, { devMode: () => true, helpersDir: null })).toBeNull();
    expect(getRecord("chat")?.issues?.[0]?.message).toContain("no runnable shape");
  });

  test("dev.start absent is not broken: deck-style manifest resolves to bundle cleanly", () => {
    const helpers = mkdtempSync(join(tmpdir(), "helpers-"));
    writeFileSync(join(helpers, "chat"), "");
    const dir = linkedDir({ name: "chat", dev: { deploy: "bun run deploy" } });
    const r = rec({ dev: { workingDirectory: dir } });
    putRecord(r);
    expect(serveShape(r, { devMode: () => true, helpersDir: helpers })?.command).toEqual([join(helpers, "chat")]);
    expect(getRecord("chat")?.issues).toBeUndefined();
  });

  test("linked fresh-install row: a stored command inside the helpers dir is the bundle shape, args kept", () => {
    const helpers = mkdtempSync(join(tmpdir(), "helpers-"));
    const bin = join(helpers, "chat");
    writeFileSync(bin, "");
    const dir = linkedDir(CHAT_DEV);
    const r = rec({ command: [bin, "board"], workingDirectory: "/data/chat", dev: { workingDirectory: dir } });
    putRecord(r);
    expect(serveShape(r, { devMode: () => false, helpersDir: helpers })).toEqual({ command: [bin, "board"], cwd: "/data/chat" });
    expect(serveShape(r, { devMode: () => true, helpersDir: helpers })?.cwd).toBe(dir);
  });

  test("linked row: a stored command OUTSIDE the helpers dir is never the bundle shape", () => {
    const dir = linkedDir(CHAT_DEV);
    const r = rec({ command: ["bun", "board"], workingDirectory: "/data/chat", dev: { workingDirectory: dir } });
    putRecord(r);
    // dev mode: the valid source serves; the stored PATH-relative command never resurfaces
    expect(serveShape(r, { devMode: () => true, helpersDir: null })?.cwd).toBe(dir);
    // prod mode, no bundle: source serves loudly rather than the legacy command
    expect(serveShape(r, { devMode: () => false, helpersDir: null })?.cwd).toBe(dir);
  });
});
