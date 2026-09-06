// Writes the client bundle to dist/client/ so `bun build --compile` (see the
// `build` script) can embed it into the standalone binary via text imports in
// src/compiled.ts. Run automatically by `bun run build`.
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { buildClientBundle } from "../src/client-bundle.ts";

const outDir = join(import.meta.dir, "..", "dist", "client");
mkdirSync(outDir, { recursive: true });
const { appJs, appCss } = await buildClientBundle();
// .txt, not .js: tsc treats a REAL .js file on disk as a resolvable module
// and tries to typecheck its exports (the bundle is a bare IIFE with none),
// bypassing the "*.js" ambient wildcard declaration entirely -- that
// fallback only fires when nothing real resolves. .txt has no such special
// handling, so it always falls through to asset-text.d.ts's "*.txt" rule.
writeFileSync(join(outDir, "app.js.txt"), appJs);
writeFileSync(join(outDir, "app.css"), appCss);
console.log(`client bundle written to dist/client/ (js ${appJs.length}b, css ${appCss.length}b)`);
