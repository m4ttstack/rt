import { getRecord } from "../registry/records.ts";

/**
 * Where a deploy must write deck's new binary: the path the platform's own
 * launchd plist execs. bootstrapSelf bakes that absolute path into the self
 * record's command, so it differs per machine (install.sh puts it under
 * ~/.mattstack/deck/bin, a hand install may use ~/.local/bin). `deck restart
 * deck` is `launchctl kickstart -k`, which re-execs the plist's existing
 * program path without re-reading anything, so a binary written anywhere else
 * leaves the restart running the stale build. Reading the record instead of
 * hardcoding either directory keeps deploy correct on every install shape.
 */
export function deployTarget(): string {
  const self = getRecord("deck");
  const program = self?.command?.[0];
  if (!program) {
    throw new Error(
      "deck self record has no supervised command; run `deck setup` before `bun run deploy`",
    );
  }
  return program;
}
