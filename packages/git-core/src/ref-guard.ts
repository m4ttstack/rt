import { rawGitOk } from "./exec.ts";

// A name starting with "-" is not a ref at all once it reaches git's argv:
// git reads it as an option, so e.g. createBranch("-D", { from: "x" }) would
// otherwise run `git branch -D x`, deleting x instead of creating anything.
// This must run before any check-ref-format call, since --branch itself
// misparses a leading dash as its own flag rather than rejecting the value.
function rejectFlagLike(value: string, label: string): void {
  if (value.startsWith("-")) {
    throw new Error(`refusing ${label} that looks like a flag: ${value}`);
  }
}

/** Commit-ish inputs (a sha, HEAD~N, another ref) are not full ref names, so
 *  only the flag-injection check applies to them. */
export function assertSafeCommitish(value: string, label: string): void {
  rejectFlagLike(value, label);
}

// The full-refname form exits 0/1; --branch instead exits 128 on invalid
// names, which rawGitOk treats as a throw and would bypass this message.
export async function assertValidBranchName(dir: string, name: string): Promise<void> {
  rejectFlagLike(name, "branch name");
  if (!(await rawGitOk(dir, ["check-ref-format", `refs/heads/${name}`]))) {
    throw new Error(`invalid branch name: ${name}`);
  }
}

export async function assertValidTagName(dir: string, name: string): Promise<void> {
  rejectFlagLike(name, "tag name");
  if (!(await rawGitOk(dir, ["check-ref-format", `refs/tags/${name}`]))) {
    throw new Error(`invalid tag name: ${name}`);
  }
}
