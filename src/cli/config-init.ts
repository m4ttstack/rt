import { existsSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";

interface Io { out(s: string): void; err(s: string): void }

const NAME_RE = /^[a-z0-9][a-z0-9.-]*$/;

/** Mirrors readDeckManifest's NAME_RE: a raw directory basename ("My App",
    "foo_bar") would otherwise scaffold a manifest `deck register` immediately
    rejects. Collapse anything outside [a-z0-9.-] to a single hyphen and strip
    leading characters until the result can start the pattern. */
function normalizeName(raw: string): string {
  const lowered = raw.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
  return lowered.replace(/^[^a-z0-9]+/, "");
}

function readScripts(dir: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return typeof pkg.scripts === "object" && pkg.scripts ? pkg.scripts : {};
  } catch {
    return {};
  }
}

export function configInit(cwd: string, io: Io): number {
  const target = join(cwd, "mattstack.deck.json");
  if (existsSync(target)) {
    io.err("mattstack.deck.json already exists ... not overwriting");
    return 1;
  }
  const raw = basename(cwd);
  const name = normalizeName(raw);
  if (!NAME_RE.test(name)) {
    io.err(`could not derive a valid app name from ${raw}; pass an explicit name`);
    return 1;
  }
  const scripts = readScripts(cwd);
  const start = scripts.serve ? "bun run serve" : scripts.start ? "bun run start" : "bun run serve";
  const commands: Record<string, string> = { start };
  if (scripts.build) commands.build = "bun run build";
  const manifest = { name, commands };
  writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n");
  io.out(name === raw ? `wrote ${target}` : `wrote ${target} (name normalized to ${name})`);
  return 0;
}
