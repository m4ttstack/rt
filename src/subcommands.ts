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
};

export const SUBCOMMANDS = Object.keys(VERBS);

/** Runs argv's subcommand and reports whether it owned it. The scripts behind
    these verbs execute on import and read `process.argv.slice(2)`, so the verb
    is stripped first and they see the argv they were written for. */
export async function runSubcommand(argv: string[]): Promise<boolean> {
  const verb = argv[2];
  if (!verb || !Object.hasOwn(VERBS, verb)) return false;
  process.argv = [argv[0]!, argv[1]!, ...argv.slice(3)];
  await VERBS[verb]!();
  return true;
}
