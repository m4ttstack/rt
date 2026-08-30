import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function isolate(): void {
  const dir = mkdtempSync(join(tmpdir(), "deploy-target-"));
  process.env.LOCAL_STATE_DIR = dir;
  process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
  process.env.HOME = dir;
}

beforeEach(isolate);

test("resolves to the self record's supervised program path, whatever it is", async () => {
  const { putRecord, reloadRegistry } = await import("../registry/records.ts");
  const { deployTarget } = await import("./deploy-target.ts");
  reloadRegistry();
  // A hand install under ~/.local/bin, not install.sh's ~/.mattstack/deck/bin:
  // the plist execs this exact path, so deploy must write here.
  putRecord({
    name: "deck", managedBy: "deck", port: 11007, kind: "service", createdAt: "x",
    label: "com.mattstack.deck", command: ["/Users/someone/.local/bin/deck", "serve"],
    workingDirectory: "/Users/someone/.mattstack/deck",
  });
  expect(deployTarget()).toBe("/Users/someone/.local/bin/deck");
});

test("throws when there is no self record to deploy over", async () => {
  const { reloadRegistry } = await import("../registry/records.ts");
  const { deployTarget } = await import("./deploy-target.ts");
  reloadRegistry();
  expect(() => deployTarget()).toThrow(/deck setup/);
});
