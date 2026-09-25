// Stages an app repo's launcher identity for the bundle-apps tarball. Runs
// before the app's own recipe so the identity is read from source, not from
// anything the build produced.
import { stageIdentity } from "../lib/app-identity.ts";

if (import.meta.main) {
  const [appDir, outDir, name] = process.argv.slice(2);
  if (!appDir || !outDir || !name) {
    console.error("usage: stage-identity.ts <app-dir> <out-dir> <app-name>");
    process.exit(2);
  }
  try {
    const id = stageIdentity(appDir, outDir, name);
    console.log(id ? `staged identity for ${id.name}` : "no identity declared; nothing staged");
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }
}
