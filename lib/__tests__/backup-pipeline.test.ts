import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "bun";
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
