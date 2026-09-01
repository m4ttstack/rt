import { $ } from "bun";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { deployTarget } from "../src/cli/deploy-target.ts";
import { logsDir, readApiInfo } from "../src/api/state.ts";

// The plist's ProgramArguments[0], read from deck's own registry record rather
// than hardcoded: kickstart re-execs that exact path, so the new binary must
// land there or the restart below keeps running the stale build.
const target = deployTarget();
await $`bun run build`;
await $`bun run build:board`;
await $`mkdir -p ${dirname(target)}`;
// Keep the outgoing binary so a failed health check can restore it: a fresh
// bun-compiled binary is a new TCC identity, and macOS blocks its first read
// of a protected folder (Documents) behind a user prompt. Unattended, that
// leaves the new build hung with zero output and the old binary already gone.
const backup = `${target}.prev`;
if (existsSync(target)) {
  await $`install -m 0755 ${target} ${backup}`;
}
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

async function healthy(deadlineMs: number): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${info!.port}/healthz`)).ok) return true;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
}

if (await healthy(20_000)) {
  console.log(`deployed: deck healthy on port ${info.port}`);
  process.exit(0);
}

console.error(`deck did not come back healthy on port ${info.port} within 20s.`);
console.error(`If a macOS prompt is asking to allow deck to access Documents, click Allow and re-run the deploy.`);
for (const f of ["deck.err.log", "deck.out.log"]) {
  const p = join(logsDir(), f);
  const tail = await $`tail -5 ${p}`.nothrow().text();
  if (tail.trim()) console.error(`--- ${f} tail:\n${tail.trimEnd()}`);
}

if (existsSync(backup)) {
  console.error(`restoring the previous binary and restarting...`);
  await $`install -m 0755 ${backup} ${target}.new`;
  await $`mv -f ${target}.new ${target}`;
  await $`deck restart deck`.nothrow();
  if (await healthy(20_000)) {
    console.error(`previous build restored: deck healthy on port ${info.port}. The new build was NOT deployed.`);
  } else {
    console.error(`previous build restored but deck is still not healthy; check the logs above and launchctl.`);
  }
} else {
  console.error(`no previous binary to restore (${backup} missing); deck may be down.`);
}
process.exit(1);
