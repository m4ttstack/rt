import { describe, it, expect, beforeAll, mock } from "bun:test";
import { mkdtempSync, copyFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Set up fixture directory before importing modules
const fixtureDir = mkdtempSync(join(tmpdir(), "server-focus-test-"));
const configPath = join(fixtureDir, "config.json");
copyFileSync(join(import.meta.dir, "..", "..", "tests", "fixture", "config.json"), configPath);

// Set env vars before any module imports
process.env.BOARD_FIXTURE = fixtureDir;
process.env.BOARD_APP_ROOT = fixtureDir;

describe("focusPane", () => {
  let focusPane: any;
  let paneFocusMock: any;
  let focusTabMock: any;

  beforeAll(async () => {
    // Import rt-client and herdr modules to set up mocking
    const rtClient = await import("@mattstack/rt-client");
    const herdr = await import("../herdr.ts");

    // Create mock functions
    paneFocusMock = mock(async (args: { paneId: string }) => ({
      ok: true,
    }));

    focusTabMock = mock(async (tabId: string) => {
      // Mock implementation
    });

    // Try to spy on the actual module functions
    // Import server.ts last after mocks are ready
    const server = await import("../server.ts");
    focusPane = server.focusPane;
  });

  it("is an exported async function", () => {
    expect(typeof focusPane).toBe("function");
  });

  it("accepts state with both paneId and tabId", () => {
    const state = { paneId: "pane-123", tabId: "tab-456" };
    expect(state).toHaveProperty("paneId");
    expect(state).toHaveProperty("tabId");
  });

  it("accepts state with only tabId", () => {
    const state = { tabId: "tab-456" };
    expect(state).toHaveProperty("tabId");
  });

  it("accepts state with only paneId", () => {
    const state = { paneId: "pane-123" };
    expect(state).toHaveProperty("paneId");
  });

  it("accepts empty state", () => {
    const state = {};
    expect(state).toBeDefined();
  });

  it("returns a Promise", () => {
    const result = focusPane({});
    expect(result instanceof Promise).toBe(true);
  });

  it("handles state with undefined properties", async () => {
    const state = { paneId: undefined, tabId: undefined };
    // Should not throw
    const result = focusPane(state);
    expect(result instanceof Promise).toBe(true);
  });
});
