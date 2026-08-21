/** Compare test/.captures against test/baselines pixel-for-pixel. */
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const BASE = join(ROOT, "test/baselines");
const CUR = join(ROOT, "test/.captures");
let failed = false;
for (const file of readdirSync(BASE).filter((f) => f.endsWith(".png"))) {
  const cur = join(CUR, file);
  if (!existsSync(cur)) { console.error(`✗ ${file}: missing from captures`); failed = true; continue; }
  const a = PNG.sync.read(readFileSync(join(BASE, file)));
  const b = PNG.sync.read(readFileSync(cur));
  if (a.width !== b.width || a.height !== b.height) {
    console.error(`✗ ${file}: size ${a.width}x${a.height} → ${b.width}x${b.height}`); failed = true; continue;
  }
  const diff = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0 });
  if (diff > 0) { console.error(`✗ ${file}: ${diff} pixels differ`); failed = true; }
  else console.log(`✓ ${file}`);
}
process.exit(failed ? 1 : 0);
