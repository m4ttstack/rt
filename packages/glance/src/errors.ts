/**
 * Errors this SDK throws that a caller is expected to branch on.
 *
 * Most failures here are transport or forge errors and carry only a message.
 * The ones in this file exist because a caller cannot act correctly on the
 * message alone.
 */

/**
 * A read-back that could not be completed, after a write that had already
 * landed (MAT-169).
 *
 * `createPullRequest`, `updatePullRequest`, and `mergePullRequest` each issue
 * their write and then read the MR back, both to return it and -- for a draft
 * transition -- to confirm the write had the effect it asked for. The write
 * and the read are separate calls to the forge, so a read that fails says
 * nothing about whether the write did. Throwing a bare `Error` left the caller
 * unable to tell "the forge rejected your write" from "your write landed and
 * we cannot describe the result", and the two want opposite handling: the
 * first is worth retrying and surfacing as a failure, the second is a
 * succeeded write that a retry would apply twice.
 *
 * `writeApplied` names which case this is. It is false only where the read had
 * no write in front of it, such as a watcher's poll.
 *
 * This is a plain `Error` subclass, so a caller that does not branch on it
 * keeps the behaviour it already had.
 */
export class ReadBackFailedError extends Error {
  /**
   * True when the forge accepted a write immediately before this read. As far
   * as this SDK knows the MR is in the requested state; what failed is
   * describing it back. A caller should not re-issue the write on this.
   */
  readonly writeApplied: boolean;

  /** SDK operation that gave up, e.g. `"updatePullRequest"`. */
  readonly operation: string;

  /** Project the MR belongs to, as the operation was given it. */
  readonly projectPath: string;

  /** MR/PR number within the project. */
  readonly iid: number;

  constructor(
    message: string,
    details: {
      operation: string;
      projectPath: string;
      iid: number;
      writeApplied: boolean;
      cause?: unknown;
    },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    // Assigned rather than declared as a field initializer: a subclass field
    // would be installed after `super()`, and `name` is read by anything that
    // formats the error during construction.
    this.name = 'ReadBackFailedError';
    this.operation = details.operation;
    this.projectPath = details.projectPath;
    this.iid = details.iid;
    this.writeApplied = details.writeApplied;
  }
}
