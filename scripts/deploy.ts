import { $ } from "bun";
import { homedir } from "os";
import { join } from "path";

const target = join(homedir(), ".local", "bin", "deck");
await $`bun run build`;
await $`bun run build:board`;
await $`install -m 0755 dist/deck ${target}`;
// The self-restart drops the API mid-response; the board tolerates it and re-polls.
await $`deck restart deck`;
