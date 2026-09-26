/**
 * `git log`'s machine format and the parser for it.
 *
 * The separators are ASCII RS/US rather than a printable delimiter: a commit
 * subject is arbitrary user text and can contain any punctuation someone
 * might otherwise reach for, but git strips newlines from `%s` and no commit
 * in a pack repo carries control characters. Format and parser live in one
 * file so a change to either cannot silently outrun the other.
 */

const RS = '\x1e';
const US = '\x1f';

/** Trailing `%x1f` closes the field run so `--name-only`'s file list lands in
    a tail field instead of being glued onto the subject. */
export const GIT_LOG_FORMAT = `${RS}%H${US}%h${US}%aI${US}%an${US}%s${US}`;

export interface GitCommit {
  sha: string;
  shortSha: string;
  /** ISO-8601 with the author's offset, as `%aI` writes it. */
  authoredAt: string;
  author: string;
  subject: string;
  /** Paths git printed under `--name-only`, which are relative to the
      REPOSITORY ROOT -- not to the directory `-C` scoped the command to. */
  files: string[];
}

/**
 * Parses the output of `git log --format=GIT_LOG_FORMAT --name-only`.
 *
 * A record that does not carry all five fields is dropped rather than
 * half-filled: a commit row missing its sha or date is worse than one fewer
 * row, and there is no shape of git output that produces a partial record
 * except a truncated read.
 */
export function parseGitLog(stdout: string): GitCommit[] {
  const commits: GitCommit[] = [];

  for (const record of stdout.split(RS)) {
    if (!record.trim()) continue;

    const fields = record.split(US);
    // Five fields plus the file-list tail. A subject containing US would
    // split into more, so the subject is rejoined from everything between
    // the fixed head and that tail.
    if (fields.length < 6) continue;

    const [sha, shortSha, authoredAt, author] = fields;
    if (!sha || !shortSha || !authoredAt) continue;

    const subject = fields.slice(4, -1).join(US);
    const files = fields[fields.length - 1]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    commits.push({ sha, shortSha, authoredAt, author, subject, files });
  }

  return commits;
}
