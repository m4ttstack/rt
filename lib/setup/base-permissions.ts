/**
 * rt's own baseline `permissions.allow` set. Plugin MCP servers are allowed
 * at server level under their REAL namespace, `mcp__plugin_<marketplace>_<plugin>`,
 * never a guessed `mcp__<name>`: the first tool call of a default-mode pane
 * otherwise raises a per-tool, per-directory prompt that strands unattended
 * workers in every fresh worktree. Lives apart from
 * `steps/claude-permissions.ts` for the same reason `base-plugins.ts` lives
 * apart from `steps/plugins.ts`: a future validator can watch exactly what
 * `claude.permissions` unions in without importing a step, and there is
 * never a second copy of the list to drift from this one.
 *
 * `Bash(glab *)` already subsumes the two narrower `glab mr` entries below
 * it; they stay anyway, deliberately, so a future narrowing of the wildcard
 * doesn't silently drop them.
 */
export const BASE_PERMISSIONS: string[] = [
  "mcp__plugin_fast-browser_fast-browser",
  "mcp__plugin_mattstack_mattstack",
  "EnterWorktree",
  "Bash(glab *)",
  "Bash(glab mr approve *)",
  "Bash(glab mr note *)",
  "Bash(claude plugin update *)",
  "Bash(rt skills sync *)",
];
