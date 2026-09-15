/**
 * rt's own baseline `permissions.allow` set. Lives apart from
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
  "EnterWorktree",
  "Bash(glab *)",
  "Bash(glab mr approve *)",
  "Bash(glab mr note *)",
  "Bash(claude plugin update *)",
  "Bash(rt skills sync *)",
];
