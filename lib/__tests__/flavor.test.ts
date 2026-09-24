import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
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
