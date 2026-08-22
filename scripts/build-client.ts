// Writes the client bundle to dist/client/ so `bun build --compile` (see the
// `build` script) can embed it into the standalone binary via text imports in
// src/compiled.ts. Run automatically by `bun run build`.
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { buildClientBundle } from "../src/client-bundle.ts";

const outDir = join(import.meta.dir, "..", "dist", "client");
mkdirSync(outDir, { recursive: true });
const { appJs, appCss } = await buildClientBundle();
writeFileSync(join(outDir, "app.js"), appJs);
writeFileSync(join(outDir, "app.css"), appCss);
console.log(`client bundle written to dist/client/ (js ${appJs.length}b, css ${appCss.length}b)`);
