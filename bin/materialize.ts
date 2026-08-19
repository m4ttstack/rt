// On-demand team-config materialize (BOARD-16): re-reads the mattstack team
// zone and rewrites config.json's team-owned fields without waiting for a
// board restart. `bun run materialize`.
//
// Simplest thing that works -- a script, not an endpoint. This does NOT
// change what a running board sees: config.json loads once at boot
// (src/server.ts materializeTeamConfigAtBoot), so the change lands on the
// board's next restart, not live.
import { CONFIG_PATH } from "../src/config.ts";
import { materializeOnDemand } from "../src/team-zone.ts";

const result = materializeOnDemand(CONFIG_PATH);
if (!result.ok) {
  console.error(`materialize: ${result.reason}`);
  process.exit(1);
}
console.log(result.changed ? `materialize: updated ${result.fields.join(", ")}` : "materialize: current");
console.log("materialize: a running board picks this up on its next restart (config loads once at boot)");
