/**
 * `rt cd` runs inside the shell's `$(...)`, which shares the shell's process
 * group, and a warm branch cache kicks off a background revalidation from it.
 * Unless that child leaves the group, it sits in the terminal's foreground
 * group for its whole network round trip, and anything watching the pane's
 * foreground (herdr, flock's launcher) reads the pane as busy until it exits.
 */

import { expect, test } from "bun:test";

import { cacheRefreshSpawnOptions } from "../enrich.ts";

test("the background cache refresh starts in a session of its own", () => {
  const options = cacheRefreshSpawnOptions();
  expect(options.detached).toBe(true);
  expect(options.stdio).toEqual(["ignore", "ignore", "ignore"]);
});
