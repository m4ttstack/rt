import { existsSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";

interface Io { out(s: string): void; err(s: string): void }

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
  const scripts = readScripts(cwd);
  const start = scripts.serve ? "bun run serve" : scripts.start ? "bun run start" : "bun run serve";
  const commands: Record<string, string> = { start };
  if (scripts.build) commands.build = "bun run build";
  const manifest = { name: basename(cwd), commands };
  writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n");
  io.out(`wrote ${target}`);
  return 0;
}
