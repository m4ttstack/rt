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
 *
 * `rt runs` and `rt gate` are the pipeline skills' run bookkeeping and
 * decision surface, called from Bash in board-launched panes nobody watches;
 * without them every such call prompts on a fresh Mac. Both write only the
 * caller's own run and gates, and the mattstack MCP server (allowed above)
 * already exposes the gate verbs, so they add no reach.
 *
 * The git entries are the verbs the compiled team packs run from Bash in
 * those same panes (ship pushes and rebases, receive-review pushes before
 * a Fixed reply, every stage reads status, diff and log). A pane in a mode
 * stricter than auto prompts on each without them. No reset, clean,
 * branch -D or push --force: force-with-lease is the strongest push a pack
 * issues.
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
  "Bash(rt runs *)",
  "Bash(rt gate *)",
  "Bash(git commit *)",
  "Bash(git push *)",
  "Bash(git fetch *)",
  "Bash(git rebase *)",
  "Bash(git status *)",
  "Bash(git diff *)",
  "Bash(git log *)",
];
