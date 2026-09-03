/** The board's non-server entry points, reachable both from `bin/board` in a
    checkout and as subcommands of the compiled binary.

    They exist as subcommands because the board hands a status writer to agents
    it launches in another repo's cwd, and a compiled board has no source tree
    for a `bin/*.ts` path to point at (see statusBinPath). The import
    specifiers stay literal so `bun build --compile` can see and bundle them. */

const VERBS: Record<string, () => Promise<unknown>> = {
  "review-status": () => import("../bin/review-status.ts"),
  "respond-status": () => import("../bin/respond-status.ts"),
  "doctor-status": () => import("../bin/doctor-status.ts"),
  "doctor-draft": () => import("../bin/doctor-draft.ts"),
  triage: () => import("../bin/triage.ts"),
  gate: () => import("../bin/gate.ts"),
};

export const SUBCOMMANDS = Object.keys(VERBS);

/** Domain skills ship in version-pinned plugin caches, not symlinks, so a board
    newer than the skill invoking it still receives the pre-subcommand argv
    (`<status-bin> <state> <status>`, `<draft-bin> <mrUrl> <iid> ...`). The verb
    it omits is recoverable: status writers are addressed by a state path whose
    directory names the lane, and the draft writer leads with an MR URL. */
const LANE_DIRS: Record<string, string> = {
  reviews: "review-status",
  responds: "respond-status",
  doctors: "doctor-status",
};

function legacyVerb(argv: string[]): string | null {
  const first = argv[2];
  if (!first) return null;
  if (/^https?:\/\//.test(first)) return "doctor-draft";
  const lane = first.split("/").at(-2);
  return (lane && LANE_DIRS[lane]) ?? null;
}

/** Runs argv's subcommand and reports whether it owned it. The scripts behind
    these verbs execute on import and read `process.argv.slice(2)`, so the verb
    is stripped first and they see the argv they were written for. */
export async function runSubcommand(argv: string[]): Promise<boolean> {
  const named = argv[2] && Object.hasOwn(VERBS, argv[2]) ? argv[2] : null;
  const verb = named ?? legacyVerb(argv);
  if (!verb) return false;
  // The legacy form carries no verb to strip, so its argv passes through whole.
  process.argv = named ? [argv[0]!, argv[1]!, ...argv.slice(3)] : argv;
  await VERBS[verb]!();
  return true;
}
