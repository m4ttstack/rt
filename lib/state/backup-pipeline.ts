import { spawn } from "bun";
import { unlink } from "fs/promises";

function resolveZstd(): string {
  const path = Bun.which("zstd");
  if (!path) throw new Error("zstd not found in PATH. Install with: brew install zstd");
  return path;
}

function resolveAge(): string {
  const path = Bun.which("age");
  if (!path) throw new Error("age not found in PATH. Install with: brew install age");
  return path;
}

export async function compressFile(src: string, dest: string): Promise<void> {
  const proc = spawn([resolveZstd(), "-19", "-f", "-o", dest, src], {
    stdout: "ignore",
    stderr: "pipe",
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
  const compressed = dest.replace(/\.age$/, "");
  try {
    await compressFile(src, compressed);
    await encryptFile(compressed, dest, recipientsPath);
  } finally {
    await unlink(compressed).catch(() => {});
  }
}

export async function restorePipeline(
  src: string,
  dest: string,
  identityPath: string,
): Promise<void> {
  const compressed = src.replace(/\.age$/, "");
  try {
    await decryptFile(src, compressed, identityPath);
    await decompressFile(compressed, dest);
  } finally {
    await unlink(compressed).catch(() => {});
  }
}
