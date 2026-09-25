/**
 * `rt cd` runs inside the shell's `$(...)`, which shares the shell's process
 * group, and a warm branch cache kicks off a background revalidation from it.
 * Unless that child leaves the group, it sits in the terminal's foreground
 * group for its whole network round trip, and anything watching the pane's
 * foreground (herdr, flock's launcher) reads the pane as busy until it exits.
 */

import { expect, test } from "bun:test";

import { CACHE_REFRESH_SPAWN_FLAGS } from "../enrich.ts";

test("the background cache refresh starts in a session of its own", () => {
  expect(CACHE_REFRESH_SPAWN_FLAGS.detached).toBe(true);
  expect(CACHE_REFRESH_SPAWN_FLAGS.stdio).toEqual(["ignore", "ignore", "ignore"]);
});
