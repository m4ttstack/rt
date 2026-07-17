import { writeRespondState, type RespondStatus } from "../src/respond-state.ts";

const VALID: RespondStatus[] = ["queued", "triaging", "implementing", "drafting", "done", "error"];

/** Same shape as review-status: positional <path> <status> [message] plus an
    optional `--session <id>` (falls back to $CLAUDE_SESSION_ID). Backward
    compatible with existing invocations. */
function parseArgs(argv: string[]): { path?: string; status?: string; message: string; session?: string } {
  let session: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--session") session = argv[++i];
    else if (a.startsWith("--session=")) session = a.slice("--session=".length);
    else rest.push(a);
  }
  const [path, status, ...msg] = rest;
  return { path, status, message: msg.join(" ").trim(), session };
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.path || !parsed.status || !VALID.includes(parsed.status as RespondStatus)) {
  console.error(`usage: respond-status <statePath> <${VALID.join("|")}> [message] [--session <id>]`);
  process.exit(1);
}
const sessionId = parsed.session ?? process.env.CLAUDE_CODE_SESSION_ID ?? undefined;
writeRespondState(parsed.path, {
  status: parsed.status as RespondStatus,
  ...(parsed.message ? { message: parsed.message } : {}),
  ...(sessionId ? { sessionId } : {}),
});
