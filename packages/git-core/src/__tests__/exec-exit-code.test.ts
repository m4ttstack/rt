import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import type { GitExitError } from "../exec.ts";
import { isGitExitCode, rawGit } from "../exec.ts";

describe("rawGit's thrown error carries the exit code", () => {
  it("sets exitCode to the process's real exit code, and to nothing else", async () => {
    const sb = await makeSandbox();
    try {
      let caught: unknown;
      try {
        await rawGit(sb.dir, ["totally-bogus-subcommand"]);
      } catch (error) {
        caught = error;
      }
      expect(isGitExitCode(caught, 1)).toBe(true);
      expect(isGitExitCode(caught, 128)).toBe(false);
    } finally {
      await sb.cleanup();
    }
  });

  it("leaves the message unchanged", async () => {
    const sb = await makeSandbox();
    try {
      await expect(rawGit(sb.dir, ["totally-bogus-subcommand"])).rejects.toThrow(
        /git totally-bogus-subcommand exited 1:/,
      );
    } finally {
      await sb.cleanup();
    }
  });

  it("carries git's stdout and stderr on an exit-code failure", async () => {
    const sb = await makeSandbox();
    try {
      let caught: unknown;
      try {
        await rawGit(sb.dir, ["rev-parse", "--verify", "no-such-ref"]);
      } catch (e) {
        caught = e;
      }
      expect(isGitExitCode(caught, 128)).toBe(true);
      const err = caught as GitExitError;
      expect(err.stderr).toContain("fatal:");
      expect(typeof err.stdout).toBe("string");
    } finally {
      await sb.cleanup();
    }
  });
});
