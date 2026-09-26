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
 * `rt gate`, `rt chat tail` and `rt events wait` are the long waits and the
 * shepherd's CLI-only answer that skills still run in Bash, each in one bare
 * form; everything else a skill runs routinely is a tool on the mattstack
 * server.
 *
 * No git entries, on purpose. An allow rule resolves before the auto-mode
 * classifier, so `Bash(git push *)` would wave through a forced push and
 * `Bash(git rebase *)` a `--exec` of any command; the read-only git forms
 * need no rule in any mode, and a pane in auto mode (the mode
 * `claude-permissions.ts` seeds) gets routine commits and pushes from the
 * classifier itself.
 */
export const BASE_PERMISSIONS: string[] = [
  "mcp__plugin_fast-browser_fast-browser",
  "mcp__plugin_mattstack_mattstack",
  "EnterWorktree",
  "Bash(claude plugin update *)",
  "Bash(rt gate *)",
  "Bash(rt chat tail *)",
  "Bash(rt events wait *)",
];
