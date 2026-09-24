/**
 * launchFallback (lib/herdr-launch.ts): the real banner text, not a mock of
 * it. Every launchQueue/launchPreset test elsewhere mocks this function
 * away, so nothing pins what it actually writes to stderr.
 */
import { afterEach, expect, test } from "bun:test";
import { launchFallback, type LaunchItem } from "../herdr-launch.ts";

/** Strips ANSI so assertions read as plain text (matches run-report-save.test.ts's convention). */
// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const REAL_WRITE = process.stderr.write;

afterEach(() => {
  process.stderr.write = REAL_WRITE;
});

test("launchFallback's banner names the caller's reason verbatim, then one line per item", () => {
  const writes: string[] = [];
  process.stderr.write = ((c: string | Uint8Array) => { writes.push(String(c)); return true; }) as typeof process.stderr.write;

  const items: LaunchItem[] = [
    { label: "web → dev", command: "true", cwd: process.cwd() },
    { label: "api → start", command: "true", cwd: process.cwd() },
  ];
  launchFallback(items, "tmux is not on PATH");

  const plainWrites = writes.map(plain);
  expect(plainWrites[0]).toBe("\n  tmux is not on PATH, running sequentially\n\n");
  expect(plainWrites[1]).toBe("  web → dev\n");
  expect(plainWrites[2]).toBe("  api → start\n");
});

test("launchFallback names a non-zero exit against the item's own label", () => {
  const writes: string[] = [];
  process.stderr.write = ((c: string | Uint8Array) => { writes.push(String(c)); return true; }) as typeof process.stderr.write;

  const items: LaunchItem[] = [{ label: "web → dev", command: "exit 7", cwd: process.cwd() }];
  launchFallback(items, "not running in an interactive terminal");

  const joined = plain(writes.join(""));
  expect(joined).toContain("web → dev exited 7");
});
