import { writeRespondState, type RespondStatus } from "../src/respond-state.ts";
import { respondOutcome } from "../src/respond-outcome.ts";
import { notifyBoard } from "../src/board-notify.ts";

const VALID: RespondStatus[] = ["queued", "triaging", "implementing", "drafting", "done", "error"];

interface Parsed {
  path?: string;
  status?: string;
  message: string;
  session?: string;
  posted?: string;
  threads?: string;
}

/** Same shape as review-status: positional <path> <status> [message] plus
    optional flags in either `--flag value` or `--flag=value` form. Backward
    compatible with existing invocations. */
function parseArgs(argv: string[]): Parsed {
  const NAMES = ["session", "posted", "threads"];
  const flags: Record<string, string | undefined> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const name = NAMES.find((n) => a === `--${n}` || a.startsWith(`--${n}=`));
    if (!name) {
      rest.push(a);
      continue;
    }
    flags[name] = a === `--${name}` ? argv[++i] : a.slice(name.length + 3);
  }
  const [path, status, ...msg] = rest;
  return { path, status, message: msg.join(" ").trim(), session: flags.session, posted: flags.posted, threads: flags.threads };
}

/** undefined when the flag was absent, null when it was present but unusable,
    so a typo fails loudly instead of silently degrading the badge. */
function parseCount(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.path || !parsed.status || !VALID.includes(parsed.status as RespondStatus)) {
  console.error(`usage: respond-status <statePath> <${VALID.join("|")}> [message] [--posted <n>] [--threads <n>] [--session <id>]`);
  process.exit(1);
}

const posted = parseCount(parsed.posted);
const threads = parseCount(parsed.threads);
if (posted === null || threads === null) {
  console.error("--posted and --threads must be non-negative integers");
  process.exit(1);
}
// A numerator with no denominator is uninterpretable, so it fails rather than
// deriving to "unknown" and quietly losing the count the run bothered to report.
if (posted !== undefined && threads === undefined) {
  console.error("--posted requires --threads");
  process.exit(1);
}

const sessionId = parsed.session ?? process.env.CLAUDE_CODE_SESSION_ID ?? undefined;
const state = writeRespondState(parsed.path, {
  status: parsed.status as RespondStatus,
  ...(parsed.message ? { message: parsed.message } : {}),
  ...(posted !== undefined ? { posted } : {}),
  ...(threads !== undefined ? { threads } : {}),
  ...(sessionId ? { sessionId } : {}),
});

await notifyBoard({
  mrUrl: state.mrUrl,
  iid: state.iid,
  kind: "respond",
  status: parsed.status,
  outcome: respondOutcome(state.posted, state.threads),
});
