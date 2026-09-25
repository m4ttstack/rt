import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const REPO = join(import.meta.dir, "..", "..");
const read = (...p: string[]) => readFileSync(join(REPO, ...p), "utf8");

// No unit test sees these call sites, and bundle-apps' `[ -d identity-stage ]`
// copy makes a dropped stage step silent, so the wiring is pinned here.
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

test("bundle-apps stages identity before the recipe runs and ships it in the tarball", () => {
  const wf = read(".github", "workflows", "bundle-apps.yml");
  const stageStep = wf.indexOf("- name: Stage app identity");
  const buildStep = wf.indexOf("- name: Build, smoke and stage");
  expect(stageStep).toBeGreaterThan(-1);
  expect(buildStep).toBeGreaterThan(stageStep);
  const stageRun = wf.indexOf(`bun scripts/bundle-ci/stage-identity.ts "$APP_DIR" identity-stage "$APP_NAME"`);
  expect(stageRun).toBeGreaterThan(stageStep);
  expect(stageRun).toBeLessThan(buildStep);
  const shipped = wf.indexOf("cp -R identity-stage stage/identity");
  expect(shipped).toBeGreaterThan(buildStep);
  expect(shipped).toBeLessThan(wf.indexOf("tar czf handoff.tgz -C stage ."));
});
