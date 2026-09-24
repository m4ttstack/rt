import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const SCRIPT = join(import.meta.dir, "..", "..", "rt-tray", "scripts", "render-launchagents.sh");

function render(flavor: "dev" | "prod"): string {
  const out = mkdtempSync(join(tmpdir(), `launchagents-${flavor}-`));
  const r = spawnSync("bash", [SCRIPT, flavor, out], { encoding: "utf8" });
  expect(r.status).toBe(0);
  return out;
}

function envVar(plist: string, name: string): string {
  const r = spawnSync("plutil", ["-extract", `EnvironmentVariables.${name}`, "raw", "-o", "-", plist], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : `<missing: ${r.stderr.trim()}>`;
}

describe("render-launchagents.sh", () => {
  for (const [flavor, suffix] of [["prod", ""], ["dev", ".dev"]] as const) {
    test(`${flavor}: every job the app registers is launched as MATTSTACK_FLAVOR=${flavor}`, () => {
      const out = render(flavor);
      for (const job of ["daemon", "deck"]) {
        const plist = join(out, `com.mattstack.${job}${suffix}.plist`);
        expect(envVar(plist, "MATTSTACK_FLAVOR")).toBe(flavor);
        expect(envVar(plist, "PATH")).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
      }
    });
  }
});
