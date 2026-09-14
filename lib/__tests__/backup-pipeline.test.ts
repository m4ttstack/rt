import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "bun";
import { __test__ as bundleLayoutTest, DEPS_LOCK_BUNDLE_PATH, HELPERS_DIR } from "../bundle-layout.ts";
import { setSetting } from "../settings/write.ts";
import {
  compressFile,
  decompressFile,
  encryptFile,
  decryptFile,
  backupPipeline,
  restorePipeline,
} from "../state/backup-pipeline";

describe("backup-pipeline", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "bp-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("compressFile / decompressFile", () => {
    it("round-trips a file through zstd", async () => {
      const src = join(tmp, "input.db");
      const compressed = join(tmp, "input.db.zst");
      const restored = join(tmp, "output.db");

      const content = Buffer.alloc(4096, "abcdefghij");
      writeFileSync(src, content);

      await compressFile(src, compressed);
      expect(Bun.file(compressed).size).toBeLessThan(content.length);

      await decompressFile(compressed, restored);
      expect(readFileSync(restored)).toEqual(content);
    });

    it("rejects when source does not exist", async () => {
      await expect(
        compressFile(join(tmp, "nope"), join(tmp, "out.zst")),
      ).rejects.toThrow();
    });
  });

  describe("encryptFile / decryptFile", () => {
    it("round-trips a file through age", async () => {
      const src = join(tmp, "plain.txt");
      const encrypted = join(tmp, "plain.txt.age");
      const decrypted = join(tmp, "restored.txt");
      const keyFile = join(tmp, "key.txt");
      const recipientsFile = join(tmp, "recipients.txt");

      const content = "secret state data";
      writeFileSync(src, content);

      // Generate a throwaway age key pair
      const keygen = spawn(["age-keygen"], { stdout: "pipe", stderr: "pipe" });
      const keyOutput = await new Response(keygen.stdout).text();
      await keygen.exited;
      writeFileSync(keyFile, keyOutput);

      // Extract public key from comment line
      const pubKey = keyOutput
        .split("\n")
        .find((l: string) => l.startsWith("# public key:"))
        ?.replace("# public key: ", "")
        .trim();
      expect(pubKey).toBeTruthy();
      writeFileSync(recipientsFile, pubKey! + "\n");

      await encryptFile(src, encrypted, recipientsFile);
      const encryptedContent = readFileSync(encrypted);
      expect(encryptedContent.toString()).not.toContain(content);

      await decryptFile(encrypted, decrypted, keyFile);
      expect(readFileSync(decrypted, "utf-8")).toBe(content);
    });
  });

  // The pipeline itself, not just the resolver underneath it: a bundled copy
  // is what a fresh Mac has, and the daemon's launchd PATH would never reach a
  // Homebrew one.
  describe("tool resolution", () => {
    const origHome = process.env.HOME;
    let home: string;

    beforeEach(() => {
      bundleLayoutTest.resetBundleLayoutMemo();
      home = realpathSync(mkdtempSync(join(tmpdir(), "bp-bundle-home-")));
      process.env.HOME = home;
    });

    afterEach(() => {
      process.env.HOME = origHome;
      rmSync(home, { recursive: true, force: true });
      bundleLayoutTest.resetBundleLayoutMemo();
    });

    /** A bundle whose zstd is a shim: it records that it ran, then hands off to the real one. */
    function bundleWithZstdShim(marker: string, realZstd: string): void {
      const appRoot = join(home, "Applications", "mattstack.app");
      mkdirSync(join(appRoot, "Contents", "Resources"), { recursive: true });
      mkdirSync(join(appRoot, HELPERS_DIR), { recursive: true });
      writeFileSync(join(appRoot, DEPS_LOCK_BUNDLE_PATH), JSON.stringify({
        schema: 1,
        arch: "arm64",
        tools: [{
          name: "zstd", version: "1.5.7", license: "BSD-3-Clause",
          url: "https://example.com/zstd.tar.gz", sha256: "a".repeat(64),
          archive: "make-src", extract: "zstd-1.5.7",
          bundlePath: `${HELPERS_DIR}/zstd`, exec: [`${HELPERS_DIR}/zstd`],
          exposeByDefault: false, entitlements: "none", status: "bundled", kind: "helper",
        }],
      }));
      const shim = join(appRoot, HELPERS_DIR, "zstd");
      writeFileSync(shim, `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\nexec ${JSON.stringify(realZstd)} "$@"\n`);
      chmodSync(shim, 0o755);
      setSetting("mattstack.appPath", appRoot, "machine");
    }

    it("compresses through the bundled zstd rather than the one on PATH", async () => {
      const realZstd = Bun.which("zstd");
      expect(realZstd, "zstd must be on PATH for this test's shim to hand off to").toBeTruthy();
      const marker = join(home, "zstd-ran");
      bundleWithZstdShim(marker, realZstd!);

      const src = join(tmp, "bundled.db");
      writeFileSync(src, Buffer.alloc(2048, "bundled"));
      await compressFile(src, join(tmp, "bundled.db.zst"));

      expect(existsSync(marker)).toBe(true);
    });

    it("falls back to PATH when no bundle carries the tool", async () => {
      const src = join(tmp, "path.db");
      const out = join(tmp, "path.db.zst");
      writeFileSync(src, Buffer.alloc(2048, "path"));
      await compressFile(src, out);
      expect(existsSync(out)).toBe(true);
    });
  });

  describe("backupPipeline / restorePipeline", () => {
    it("compress+encrypt then decrypt+decompress round-trips", async () => {
      const src = join(tmp, "state.db");
      const encrypted = join(tmp, "state.db.zst.age");
      const restored = join(tmp, "restored.db");
      const keyFile = join(tmp, "key.txt");
      const recipientsFile = join(tmp, "recipients.txt");

      const content = Buffer.alloc(8192, "statedata");
      writeFileSync(src, content);

      const keygen = spawn(["age-keygen"], { stdout: "pipe", stderr: "pipe" });
      const keyOutput = await new Response(keygen.stdout).text();
      await keygen.exited;
      writeFileSync(keyFile, keyOutput);

      const pubKey = keyOutput
        .split("\n")
        .find((l: string) => l.startsWith("# public key:"))
        ?.replace("# public key: ", "")
        .trim();
      writeFileSync(recipientsFile, pubKey! + "\n");

      await backupPipeline(src, encrypted, recipientsFile);
      expect(Bun.file(encrypted).size).toBeLessThan(content.length);

      await restorePipeline(encrypted, restored, keyFile);
      expect(readFileSync(restored)).toEqual(content);
    });
  });
});
