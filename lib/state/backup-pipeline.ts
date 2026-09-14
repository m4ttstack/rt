import { spawn } from "bun";
import { unlink } from "fs/promises";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function resolveZstd(): string {
  const path = Bun.which("zstd", { PATH: process.env.PATH });
  if (!path) throw new Error("zstd not found in PATH. Install with: brew install zstd");
  return path;
}

function resolveAge(): string {
  const path = Bun.which("age", { PATH: process.env.PATH });
  if (!path) throw new Error("age not found in PATH. Install with: brew install age");
  return path;
}

export async function compressFile(src: string, dest: string): Promise<void> {
  const proc = spawn([resolveZstd(), "-19", "-f", "-o", dest, src], {
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env },
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`zstd compression failed (exit ${exitCode}): ${stderr}`);
  }
}

export async function decompressFile(src: string, dest: string): Promise<void> {
  const proc = spawn([resolveZstd(), "-d", "-f", "-o", dest, src], {
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env },
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`zstd decompression failed (exit ${exitCode}): ${stderr}`);
  }
}

export async function encryptFile(
  src: string,
  dest: string,
  recipientsPath: string,
): Promise<void> {
  const age = resolveAge();
  const proc = spawn([age, "-R", recipientsPath, "-o", dest, src], {
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env },
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`age encryption failed (exit ${exitCode}): ${stderr}`);
  }
}

export async function decryptFile(
  src: string,
  dest: string,
  identityPath: string,
): Promise<void> {
  const age = resolveAge();
  const proc = spawn([age, "-d", "-i", identityPath, "-o", dest, src], {
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env },
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`age decryption failed (exit ${exitCode}): ${stderr}`);
  }
}

export async function decryptFileFromStdin(
  src: string,
  dest: string,
  identityKey: string,
): Promise<void> {
  const age = resolveAge();
  const proc = spawn([age, "-d", "-i", "/dev/stdin", "-o", dest, src], {
    stdin: new Blob([identityKey]),
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env },
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`age decryption failed (exit ${exitCode}): ${stderr}`);
  }
}

export async function backupPipeline(
  src: string,
  dest: string,
  recipientsPath: string,
): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "bp-encrypt-"));
  const compressed = join(tmpDir, "snapshot.zst");
  try {
    await compressFile(src, compressed);
    await encryptFile(compressed, dest, recipientsPath);
  } finally {
    await unlink(compressed).catch(() => {});
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  }
}

export async function restorePipeline(
  src: string,
  dest: string,
  identityPath: string,
): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "bp-decrypt-"));
  const compressed = join(tmpDir, "snapshot.zst");
  try {
    await decryptFile(src, compressed, identityPath);
    await decompressFile(compressed, dest);
  } finally {
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  }
}

export async function restorePipelineFromStdin(
  src: string,
  dest: string,
  identityKey: string,
): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "bp-decrypt-"));
  const compressed = join(tmpDir, "snapshot.zst");
  try {
    await decryptFileFromStdin(src, compressed, identityKey);
    await decompressFile(compressed, dest);
  } finally {
    Bun.spawnSync(["rm", "-rf", tmpDir]);
  }
}
