import { $ } from "bun";
import { dirname } from "path";
import { deployTarget } from "../src/cli/deploy-target.ts";

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
// The self-restart drops the API mid-response; the board tolerates it and re-polls.
await $`deck restart deck`;
