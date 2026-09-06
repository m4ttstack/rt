import { writeReviewState, type ReviewStatus, type ReviewOutcome } from "../src/review-state.ts";
import { notifyBoard } from "../src/board-notify.ts";

const VALID_STATUS: ReviewStatus[] = ["queued", "reviewing", "done", "error"];
const VALID_OUTCOME: ReviewOutcome[] = ["comment", "approve"];

/** Parse ARGV into positional args and a --outcome flag. Keeps the shape
    backward-compatible: existing `<path> <status> [message]` still works. */
function parseArgs(argv: string[]): { path?: string; status?: string; message: string; outcome?: string; session?: string } {
  let outcome: string | undefined;
  let session: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--outcome") {
      outcome = argv[++i];
    } else if (a.startsWith("--outcome=")) {
      outcome = a.slice("--outcome=".length);
    } else if (a === "--session") {
      session = argv[++i];
    } else if (a.startsWith("--session=")) {
      session = a.slice("--session=".length);
    } else {
      rest.push(a);
    }
  }
  const [path, status, ...msg] = rest;
  return { path, status, message: msg.join(" ").trim(), outcome, session };
}

const parsed = parseArgs(process.argv.slice(2));

if (!parsed.path || !parsed.status || !VALID_STATUS.includes(parsed.status as ReviewStatus)) {
  console.error(`usage: review-status <statePath> <${VALID_STATUS.join("|")}> [message] [--outcome ${VALID_OUTCOME.join("|")}]`);
  process.exit(1);
}
if (parsed.outcome !== undefined && !VALID_OUTCOME.includes(parsed.outcome as ReviewOutcome)) {
  console.error(`--outcome must be one of ${VALID_OUTCOME.join("|")}`);
  process.exit(1);
}

const status = parsed.status as ReviewStatus;
const outcome = parsed.outcome as ReviewOutcome | undefined;
// The Claude Code session id is exposed to Bash tool commands via env; capture
// it on every write so a resume from the board finds the latest known id.
const sessionId = parsed.session ?? process.env.CLAUDE_CODE_SESSION_ID ?? undefined;
const state = writeReviewState(parsed.path, {
  status,
  ...(parsed.message ? { message: parsed.message } : {}),
  ...(outcome ? { outcome } : {}),
  ...(sessionId ? { sessionId } : {}),
});

await notifyBoard({ mrUrl: state.mrUrl, iid: state.iid, kind: "review", status, outcome });
