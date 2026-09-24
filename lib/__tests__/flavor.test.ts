import { describe, expect, test } from "bun:test";
import { daemonLabelFor, deckLabelFor, otherFlavor, processFlavor } from "../flavor.ts";

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

  test("the test preload strips an ambient MATTSTACK_FLAVOR, so a source run reads dev", () => {
    expect(process.env.MATTSTACK_FLAVOR).toBeUndefined();
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
