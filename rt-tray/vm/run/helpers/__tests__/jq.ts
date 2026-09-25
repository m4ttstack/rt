import { join } from "path";

export const GUEST_DIR = join(import.meta.dir, "..", "..", "guest");
export const JQ_DIR = join(GUEST_DIR, "jq");
export const FIXTURES = join(import.meta.dir, "fixtures");

// The guest runs the bundle's jq (deps.lock pins 1.8.x) while the host has
// macOS's 1.7.x; VM_TEST_JQ runs these suites under the bundled one. A missing
// jq fails the suite rather than skipping it.
export function jqBin(): string {
  const bin = process.env.VM_TEST_JQ || Bun.which("jq");
  if (!bin) throw new Error("jq is not on PATH: the guest parsers are jq programs, so these tests need one (macOS ships /usr/bin/jq)");
  return bin;
}

export function runJq(args: string[], stdin = ""): string {
  const r = Bun.spawnSync([jqBin(), ...args], { stdin: Buffer.from(stdin) });
  if (r.exitCode !== 0) throw new Error(`jq ${args.join(" ")} exited ${r.exitCode}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}
