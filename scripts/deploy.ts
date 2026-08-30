import { $ } from "bun";
import { dirname } from "path";
import { deployTarget } from "../src/cli/deploy-target.ts";
import { readApiInfo } from "../src/api/state.ts";

// The plist's ProgramArguments[0], read from deck's own registry record rather
// than hardcoded: kickstart re-execs that exact path, so the new binary must
// land there or the restart below keeps running the stale build.
const target = deployTarget();
await $`bun run build`;
await $`bun run build:board`;
await $`mkdir -p ${dirname(target)}`;
// install truncates-in-place, which can ETXTBSY on macOS against the currently-running
// binary; installing to a temp path in the same dir and renaming over it is atomic and
// leaves the running process holding its old inode.
await $`install -m 0755 dist/deck ${target}.new`;
await $`mv -f ${target}.new ${target}`;
// The self-restart drops the API mid-response, so the CLI's own restart call
// sees a closed socket even when it worked; tolerate that and prove the new
// build is up by health rather than by that call's exit code.
await $`deck restart deck`.nothrow();
const info = readApiInfo();
if (!info) throw new Error("deck api.json missing after restart; run `deck setup`");
const deadline = Date.now() + 20_000;
for (;;) {
  try {
    if ((await fetch(`http://127.0.0.1:${info.port}/healthz`)).ok) break;
  } catch {
    // not listening yet
  }
  if (Date.now() > deadline) throw new Error(`deck did not come back healthy on port ${info.port} within 20s`);
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`deployed: deck healthy on port ${info.port}`);
