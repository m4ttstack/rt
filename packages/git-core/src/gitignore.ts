import { constants as FS_CONSTANTS } from "node:fs";
import { lstat, open, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { ClientContext } from "./client.ts";
import { rawGit } from "./exec.ts";

const SYMBOLIC_LINK_ERROR_MESSAGE = "Cannot use a symbolic link as the root .gitignore file";

function createSymbolicLinkError(): Error {
  return new Error(SYMBOLIC_LINK_ERROR_MESSAGE);
}

// GHD errno-exception.ts's isErrnoException also checks `syscall`; the task
// brief narrows that to this shape for the port.
function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function ensureGitIgnoreIsNotSymbolicLink(ignorePath: string): Promise<void> {
  try {
    const stats = await lstat(ignorePath);
    if (stats.isSymbolicLink()) {
      throw createSymbolicLinkError();
    }
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function openExistingGitIgnore(ignorePath: string, flags: number): Promise<FileHandle | null> {
  let file: FileHandle;
  try {
    file = await open(ignorePath, flags | FS_CONSTANTS.O_NOFOLLOW);
  } catch (error) {
    if (isErrnoException(error)) {
      if (error.code === "ENOENT") {
        await ensureGitIgnoreIsNotSymbolicLink(ignorePath);
        return null;
      }
      if (error.code === "ELOOP") {
        throw createSymbolicLinkError();
      }
    }
    throw error;
  }

  try {
    const [fileStats, pathStats] = await Promise.all([file.stat(), lstat(ignorePath)]);
    if (pathStats.isSymbolicLink() || fileStats.dev !== pathStats.dev || fileStats.ino !== pathStats.ino) {
      throw createSymbolicLinkError();
    }
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

/** GHD readGitIgnoreAtRoot: null when the repository has no root .gitignore. */
export async function readGitIgnoreAtRoot(ctx: ClientContext): Promise<string | null> {
  const ignorePath = join(ctx.dir, ".gitignore");
  const file = await openExistingGitIgnore(ignorePath, FS_CONSTANTS.O_RDONLY);
  if (file === null) return null;
  try {
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}

/** GHD saveGitIgnore: creates the root .gitignore if absent, else overwrites it; empty text deletes it. */
export async function saveGitIgnore(ctx: ClientContext, text: string): Promise<void> {
  const ignorePath = join(ctx.dir, ".gitignore");

  if (text === "") {
    await ensureGitIgnoreIsNotSymbolicLink(ignorePath);
    await unlink(ignorePath);
    return;
  }

  const fileContents = await formatGitIgnoreContents(text, ctx);
  const file =
    (await openExistingGitIgnore(ignorePath, FS_CONSTANTS.O_WRONLY)) ??
    (await open(
      ignorePath,
      FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL | FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_NOFOLLOW,
    ));

  try {
    await file.truncate(0);
    await file.writeFile(fileContents);
  } finally {
    await file.close();
  }
}

/** GHD appendIgnoreRule: patterns appended verbatim to the root .gitignore. */
export async function appendIgnoreRule(ctx: ClientContext, patterns: string | string[]): Promise<void> {
  const text = (await readGitIgnoreAtRoot(ctx)) || "";
  const currentContents = await formatGitIgnoreContents(text, ctx);
  const newPatternText = Array.isArray(patterns) ? patterns.join("\n") : patterns;
  const newText = await formatGitIgnoreContents(`${currentContents}${newPatternText}`, ctx);
  await saveGitIgnore(ctx, newText);
}

/** GHD appendIgnoreFile: paths escaped (escapeGitSpecialCharacters) then appended. */
export async function appendIgnoreFile(ctx: ClientContext, filePath: string | string[]): Promise<void> {
  if (Array.isArray(filePath)) {
    const escapedFilePaths = filePath.map((path) => escapeGitSpecialCharacters(path));
    return appendIgnoreRule(ctx, escapedFilePaths);
  }
  const escapedFilePath = escapeGitSpecialCharacters(filePath);
  return appendIgnoreRule(ctx, escapedFilePath);
}

/** GHD escapeGitSpecialCharacters: backslash-escapes gitignore glob metacharacters. */
export function escapeGitSpecialCharacters(pattern: string): string {
  const specialCharacters = /[[\]!*#?]/g;
  return pattern.replaceAll(specialCharacters, (match) => "\\" + match);
}

async function getConfigValue(ctx: ClientContext, key: string): Promise<string | null> {
  const out = (await rawGit(ctx.dir, ["config", "--get", key], { okCodes: [1] })).trim();
  return out === "" ? null : out;
}

// GHD gitignore.ts formatGitIgnoreContents, byte for byte: the autocrlf+safecrlf
// branch normalizes every existing line break and then unconditionally appends
// one more -- it is not idempotent, so calling it again on its own output (as
// saveGitIgnore does on top of appendIgnoreRule's own two calls) grows another
// trailing CRLF each time.
async function formatGitIgnoreContents(text: string, ctx: ClientContext): Promise<string> {
  const autocrlf = await getConfigValue(ctx, "core.autocrlf");
  const safecrlf = await getConfigValue(ctx, "core.safecrlf");

  if (autocrlf === "true" && safecrlf === "true") {
    const normalizedText = text.replace(/\r\n|\n\r|\n|\r/g, "\r\n");
    return normalizedText + "\r\n";
  }

  if (text === "" || text.endsWith("\n")) {
    return text;
  }

  if (autocrlf == null) {
    return `${text}\n`;
  }

  const linesEndInCRLF = autocrlf === "true";
  return linesEndInCRLF ? `${text}\n` : `${text}\r\n`;
}
