import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const REPO = join(import.meta.dir, "..", "..");
const read = (...p: string[]) => readFileSync(join(REPO, ...p), "utf8");

// No unit test exercises build-apps.ts's spawn-heavy buildTreeRows end to
// end, so this wiring is pinned here as a text-level check instead.
test("build.sh lands identity from the bundle's own deps.lock after copying it", () => {
  const build = read("rt-tray", "build.sh");
  const copy = build.indexOf(`cp "$SCRIPT_DIR/deps.lock" "$CONTENTS/Resources/deps.lock"`);
  const land = build.indexOf(
    `bun "$REPO_DIR/scripts/lib/app-identity.ts" land --deps "$DEPS_DIR" --resources "$CONTENTS/Resources" --lock "$SCRIPT_DIR/deps.lock"`,
  );
  expect(copy).toBeGreaterThan(-1);
  expect(land).toBeGreaterThan(copy);
});

test("check-bundle.sh checks identity against the bundle's own deps.lock", () => {
  expect(read("rt-tray", "check-bundle.sh")).toContain(
    `app-identity.ts" check --resources "$app/Contents/Resources" --lock "$app/Contents/Resources/deps.lock"`,
  );
});

test("build-apps.ts stages identity for each tree row via stageIdentity", () => {
  const src = read("scripts", "build-apps.ts");
  const importAt = src.indexOf(`import { stageIdentity } from "./lib/app-identity.ts";`);
  expect(importAt).toBeGreaterThan(-1);
  const callAt = src.indexOf("stageIdentity(app, join(deps, `${row.name}-identity`), row.name)");
  expect(callAt).toBeGreaterThan(importAt);
});
