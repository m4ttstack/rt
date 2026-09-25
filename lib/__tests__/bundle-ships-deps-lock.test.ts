import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { DEPS_LOCK_BUNDLE_PATH } from "../bundle-layout.ts";

const RT_TRAY = join(import.meta.dir, "..", "..", "rt-tray");

// Deck reads the served-app catalog from this exact bundle path, and
// check-bundle.sh is the only gate that sees the built bundle.
test("build.sh ships deps.lock where deck and rt read it, and check-bundle.sh compares it", () => {
  expect(DEPS_LOCK_BUNDLE_PATH).toBe("Contents/Resources/deps.lock");
  const build = readFileSync(join(RT_TRAY, "build.sh"), "utf8");
  expect(build).toContain(`cp "$SCRIPT_DIR/deps.lock" "$CONTENTS/Resources/deps.lock"`);
  const check = readFileSync(join(RT_TRAY, "check-bundle.sh"), "utf8");
  expect(check).toContain(`cmp -s "$SCRIPT_DIR/deps.lock" "$app/Contents/Resources/deps.lock"`);
});
