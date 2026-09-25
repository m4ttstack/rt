The worktree triage and updater release. A new tray panel handles the worktrees left behind after a merge, connecting a forge links you straight to a token with the right scopes, and the app's updater moves to Sparkle 2.10.0.

### Tray and setup

- **Worktrees…** panel: every worktree left behind after its merge request merged, why it is stuck, whether its work is safe elsewhere, and one guarded action per row (dispose, keep, push the branch, review the diff, stop holders, or remove to the 14-day trash); the menu item carries a count and a daily summary notification opens the panel (#429)
- `rt worktree triage [--repo] [--json]` prints the same rows in the terminal (#429)
- dispose now accepts a branch that was rebased into its merged MR (RT-271, #429)
- the Connect sheet links to the forge's new-token page with rt's scopes pre-checked; GitLab owners are now asked for `api`, and a stored token missing a scope reads invalid and names it (RT-276, #433)

### Updates

- Sparkle 2.10.0: fixes temp-file leaks when a delta update fails and re-applies filesystem compression after delta updates on macOS 27; tested both ways in the VM, from 2.11.0's Sparkle 2.9.6 and from the new updater itself (#434)

### Developer tooling

- the dev app caches builds per worktree, so switching back to a tree you already built is instant (#435)
- `rt cd`'s background branch-cache refresh runs in its own session, so a pane reads idle 10 to 15 seconds sooner after `rt cd` (#436)
- `rt release update-machine` reads `deck list`'s real table through the serving bundle's own deck, and fails closed when deck lists no managed apps (RT-274, #430)
- the release workflow caches its dependency downloads, so an upstream outage no longer fails a release that has built before (#432)
- the VM walkthrough dismisses Setup Assistant after boot, and its update leg accepts the `v`-prefixed version CI stamps into rt (#428, #434)

### Documentation

- a Glitter guide on rt.cool covering the board, the checkbox staging model, stash, history, menus, and every key (#431)
- the tray guide covers the Worktrees panel, and the install page lists the token scopes each forge and role needs

**Full Changelog**: https://github.com/m4ttstack/rt/compare/v2.11.0...v2.12.0
