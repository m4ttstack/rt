// Stages an app repo's launcher identity for the bundle-apps tarball. Runs
// before the app's bundle recipe, so nothing the recipe writes can reach the
// staged identity.
import { readFileSync } from "fs";
import { join } from "path";
import { lockServes, stageIdentity } from "../lib/app-identity.ts";

const USAGE = "usage: stage-identity.ts <app-dir> <out-dir> <app-name> [--lock <deps.lock>]";

if (import.meta.main) {
  const args = process.argv.slice(2);
  let lockPath = join(import.meta.dir, "..", "..", "rt-tray", "deps.lock");
  const lockAt = args.indexOf("--lock");
  if (lockAt >= 0) {
    const value = args[lockAt + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(USAGE);
      process.exit(2);
    }
    lockPath = value;
    args.splice(lockAt, 2);
  }
  const [appDir, outDir, name] = args;
  if (!appDir || !outDir || !name || args.length !== 3) {
    console.error(USAGE);
    process.exit(2);
  }
  try {
    // A served app with no identity would pass here and fail only at the next
    // rt release, after this app's release is already immutable.
    const served = lockServes(readFileSync(lockPath, "utf8"), name);
    const id = stageIdentity(appDir, outDir, name);
    if (id) {
      console.log(`staged identity for ${id.name}`);
    } else if (served) {
      throw new Error(`${name} is served in deps.lock but ${join(appDir, "mattstack.deck.json")} declares no displayName and icon`);
    } else {
      console.log("no identity declared; nothing staged");
    }
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }
}
