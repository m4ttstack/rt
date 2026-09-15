/**
 * Where rt clones the team's repos. Two render conditions, not one: the join
 * intent covers a joiner whose team clone (and so whose tracked-repo list)
 * does not exist until team.join runs inside Install, and the snapshot covers
 * a machine whose setup is done and has no intent left.
 */
import { getSetting } from "../../settings/resolve.ts";
import { row, type Action, type Row, type TeamRef } from "../contract.ts";
import type { Probes } from "../probes.ts";
import { checkRepoRoot, detectCandidate, readStagedRepoRoot } from "../repo-root.ts";
import type { TeamSnapshot } from "../team-settings.ts";

const CLI_HINT = "or run rt setup repo-root set <folder>";

function chooseAction(startAt: string | null): Action {
  return { type: "choose-folder", label: "Choose folder…", startAt };
}

/** An authored `${repoRoot}` makes this key's resolution throw. Unguarded, that reaches buildGroup's catch, which replaces every tools row with one required error row whose only action re-runs this same read. */
function configuredRoot(): string | null {
  try {
    return getSetting<string[]>("rt.repoRoots").value?.[0] ?? null;
  } catch {
    return null;
  }
}

export function repoRootRow(
  p: Pick<Probes, "home" | "exists" | "statPath" | "readFile">,
  team: TeamRef,
  snapshot: TeamSnapshot,
): Row | null {
  if (team.mode !== "join" && snapshot.trackingIdentities.length === 0) return null;

  const base = {
    id: "repos.root",
    kind: "tool" as const,
    title: "Repo folder",
    why: "Where rt clones your team's repos. rt does not pick this for you.",
    required: true,
    recheck: "on-activate" as const,
  };

  // The store cannot hold this before Install (its file lives inside the home
  // repo), so a pre-Install answer lives in the staging file and the row must
  // read both or it would report needs-you against a question already answered.
  const chosen = configuredRoot() ?? readStagedRepoRoot(p);
  if (!chosen) {
    return row({ ...base, status: "needs-you", detail: `choose where rt should clone your team's repos (${CLI_HINT})`, action: chooseAction(detectCandidate(p)) });
  }

  const check = checkRepoRoot(p, chosen);
  if (!check.ok) {
    return row({ ...base, status: "needs-you", detail: `${check.detail} (${CLI_HINT})`, action: chooseAction(detectCandidate(p)) });
  }
  return row({ ...base, status: "ready", detail: check.tccWarning ? `${check.path} ... ${check.tccWarning}` : check.path });
}
