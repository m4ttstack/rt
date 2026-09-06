import { test, expect } from "bun:test";
import { join } from "path";
import { homedir } from "os";
import { agentsDir } from "../../core/discover.ts";

test("agentsDir() defaults to ~/Library/LaunchAgents when LOCAL_AGENTS_DIR is unset", () => {
  const saved = process.env.LOCAL_AGENTS_DIR;
  delete process.env.LOCAL_AGENTS_DIR;
  try {
    expect(agentsDir()).toBe(join(homedir(), "Library", "LaunchAgents"));
  } finally {
    if (saved === undefined) delete process.env.LOCAL_AGENTS_DIR;
    else process.env.LOCAL_AGENTS_DIR = saved;
  }
});
