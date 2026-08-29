import { $ } from "bun";
import { homedir } from "os";
import { join } from "path";

const binDir = join(homedir(), ".mattstack", "deck", "bin");
const target = join(binDir, "deck");
await $`bun run build`;
await $`bun run build:board`;
// The plist's ProgramArguments[0] is this exact path; kickstart re-execs it
// without re-reading anything else, so the binary must land here (not just
// anywhere on PATH) for the restart below to pick up the new build.
await $`mkdir -p ${binDir}`;
// install truncates-in-place, which can ETXTBSY on macOS against the currently-running
// binary; installing to a temp path in the same dir and renaming over it is atomic and
// leaves the running process holding its old inode.
await $`install -m 0755 dist/deck ${target}.new`;
await $`mv -f ${target}.new ${target}`;
// The self-restart drops the API mid-response; the board tolerates it and re-polls.
await $`deck restart deck`;
