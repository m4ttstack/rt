import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { __resetCapturedFlavor, captureProcessFlavor, daemonLabelFor, deckLabelFor, otherFlavor, processFlavor } from "../flavor.ts";

describe("processFlavor", () => {
  test("MATTSTACK_FLAVOR set by the launcher wins", () => {
    expect(processFlavor({ MATTSTACK_FLAVOR: "prod" }, "dev")).toBe("prod");
    expect(processFlavor({ MATTSTACK_FLAVOR: "dev" }, "prod")).toBe("dev");
  });

  test("unset falls back to the build: a compiled rt is prod, source is dev", () => {
    expect(processFlavor({}, "prod")).toBe("prod");
    expect(processFlavor({}, "dev")).toBe("dev");
  });

  test("an unrecognized value is ignored, not trusted", () => {
    expect(processFlavor({ MATTSTACK_FLAVOR: "staging" }, "prod")).toBe("prod");
    expect(processFlavor({ MATTSTACK_FLAVOR: "" }, "dev")).toBe("dev");
  });

  test("the test preload pins prod whatever the ambient environment says", () => {
    expect(process.env.MATTSTACK_FLAVOR).toBe("prod");
    expect(processFlavor()).toBe("prod");
  });
});

describe("captureProcessFlavor", () => {
  afterEach(() => {
    __resetCapturedFlavor();
    process.env.MATTSTACK_FLAVOR = "prod";
  });

  test("reads the launcher's value once, then keeps it out of every child's environment", () => {
    process.env.MATTSTACK_FLAVOR = "dev";

    expect(captureProcessFlavor()).toBe("dev");

    expect(process.env.MATTSTACK_FLAVOR).toBeUndefined();
    const child = spawnSync("/usr/bin/printenv", ["MATTSTACK_FLAVOR"], { encoding: "utf8", env: process.env });
    expect(child.stdout.trim()).toBe("");
    expect(processFlavor()).toBe("dev");
  });

  test("a process launched as dev keeps it out of a Bun.spawnSync child only through childEnv()", () => {
    const dir = mkdtempSync(join(tmpdir(), "flavor-leak-"));
    const script = join(dir, "probe.ts");
    const lib = join(import.meta.dir, "..");
    writeFileSync(script, [
      `import { captureProcessFlavor } from ${JSON.stringify(join(lib, "flavor.ts"))};`,
      `import { childEnv } from ${JSON.stringify(join(lib, "subprocess.ts"))};`,
      `const flavor = captureProcessFlavor();`,
      `const read = (r: { stdout: Uint8Array }) => new TextDecoder().decode(r.stdout).trim();`,
      `const plain = read(Bun.spawnSync(["/usr/bin/printenv", "MATTSTACK_FLAVOR"]));`,
      `const passed = read(Bun.spawnSync(["/usr/bin/printenv", "MATTSTACK_FLAVOR"], { env: childEnv() }));`,
      `console.log(JSON.stringify({ flavor, plain, passed }));`,
    ].join("\n"));
    try {
      const run = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, MATTSTACK_FLAVOR: "dev" } });
      const seen = JSON.parse(run.stdout.trim());
      expect(seen.flavor).toBe("dev");
      expect(seen.passed).toBe("");
      // Bun hands an env-less child the environment the parent started with,
      // which no delete can reach: why lib/__tests__/spawn-env.test.ts
      // requires env on every call.
      expect(seen.plain).toBe("dev");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a later change to the environment does not move a captured process", () => {
    process.env.MATTSTACK_FLAVOR = "dev";
    captureProcessFlavor();
    process.env.MATTSTACK_FLAVOR = "prod";
    expect(processFlavor()).toBe("dev");
  });
});

describe("labels", () => {
  test("each flavor names its own launchd jobs", () => {
    expect(daemonLabelFor("prod")).toBe("com.mattstack.daemon");
    expect(daemonLabelFor("dev")).toBe("com.mattstack.daemon.dev");
    expect(deckLabelFor("prod")).toBe("com.mattstack.deck");
    expect(deckLabelFor("dev")).toBe("com.mattstack.deck.dev");
  });

  test("otherFlavor flips", () => {
    expect(otherFlavor("dev")).toBe("prod");
    expect(otherFlavor("prod")).toBe("dev");
  });
});
