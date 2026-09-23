import { describe, expect, it } from "bun:test";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient, escapeGitSpecialCharacters } from "../index.ts";

describe("escapeGitSpecialCharacters (GHD gitignore.ts)", () => {
  it("backslash-escapes [ ] ! * # ? and nothing else", () => {
    expect(escapeGitSpecialCharacters("a b/[x]#!*?.txt")).toBe("a b/\\[x\\]\\#\\!\\*\\?.txt");
  });
});

describe("appendIgnoreRule / appendIgnoreFile", () => {
  it("creates a missing root .gitignore", async () => {
    const sb = await makeSandbox();
    try {
      await createGitClient(sb.dir).appendIgnoreRule("*.log");
      expect(await readFile(join(sb.dir, ".gitignore"), "utf8")).toBe("*.log\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("terminates the existing last line before appending", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write(".gitignore", "node_modules");
      await createGitClient(sb.dir).appendIgnoreFile("dist/[x].js");
      expect(await readFile(join(sb.dir, ".gitignore"), "utf8")).toBe("node_modules\ndist/\\[x\\].js\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("with core.autocrlf=false ends the text with CRLF (GHD's own rule)", async () => {
    const sb = await makeSandbox();
    try {
      await sb.git(["config", "core.autocrlf", "false"]);
      await createGitClient(sb.dir).appendIgnoreRule("*.tmp");
      expect(await readFile(join(sb.dir, ".gitignore"), "utf8")).toBe("*.tmp\r\n");
    } finally {
      await sb.cleanup();
    }
  });

  // GHD's formatGitIgnoreContents is called three times end to end here: once
  // for the existing contents and once for the appended text inside
  // appendIgnoreRule, then once more inside saveGitIgnore on that already
  // -formatted result. Its autocrlf+safecrlf branch always appends a fresh
  // trailing CRLF regardless of what the text already ends with, so the
  // third pass adds a second one -- verified against GHD's actual source by
  // running the three calls directly, not by hand.
  it("with core.autocrlf and core.safecrlf both true normalizes every line to CRLF", async () => {
    const sb = await makeSandbox();
    try {
      await sb.git(["config", "core.autocrlf", "true"]);
      await sb.git(["config", "core.safecrlf", "true"]);
      await sb.write(".gitignore", "a\nb\n");
      await createGitClient(sb.dir).appendIgnoreRule("c");
      expect(await readFile(join(sb.dir, ".gitignore"), "utf8")).toBe("a\r\nb\r\n\r\nc\r\n\r\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("refuses a symlinked root .gitignore and leaves its target alone", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("elsewhere.txt", "keep\n");
      await symlink(join(sb.dir, "elsewhere.txt"), join(sb.dir, ".gitignore"));
      await expect(createGitClient(sb.dir).appendIgnoreRule("x")).rejects.toThrow(
        "Cannot use a symbolic link as the root .gitignore file",
      );
      expect(await readFile(join(sb.dir, "elsewhere.txt"), "utf8")).toBe("keep\n");
    } finally {
      await sb.cleanup();
    }
  });
});
