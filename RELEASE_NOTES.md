the onboarding and agent-tools release. A new teammate reaches Install without a terminal, picks a writing style, and gets a checklist that re-checks in about 3 seconds. Agents get a curated MCP door into rt, and `rt glitter` grows into a GitHub Desktop style git client.

### Setup and onboarding

- onboarding UI pass over every wizard screen: team cards, checklist rows, install progress that scrolls to the running step, Done, and the connect sheet (#377)
- writing style: a `skills.writingStyle` setting, `rt skills writing-style show | list | use | new`, and a setup row that Finish requires and that cannot be skipped, with a picker of the mattstack plugin's presets (#387)
- Install now installs and enables the superpowers plugin; existing installs pick it up from the plugins row's one-click install (#373)
- `rt team join` points a joiner's board at the team's switchboard, and a joiner reaches Install without a terminal when the team declares one (#373, #393)
- `rt home remote set <url>` gives the home repo a remote from setup; the inviter is notified when an invitee replies; the Slack connect error names the real cause (#417)
- Install seeds Claude Code's `permissions.defaultMode: auto` when a config dir has none, so Enterprise and Console-key sessions stop prompting for routine git (#396)
- the baseline Claude permissions allow `rt runs` and `rt gate`, so pipeline skills stop prompting in unattended panes (#395)
- checklist refresh drops from about 14s to about 3s: the Fast Browser rows ask `fast-browser doctor` for only the four checks they read (#407)
- a Chrome Web Store install of the Fast Browser extension now reads ready, and a failing extension row shows doctor's own fix (#407)
- Settings > Fast Browser joins a checklist load already running instead of starting a second one (#406)
- the team screen's restore card is hidden until `rt restore` exists (#414)

### Agents, gates and MCP

- `rt_verb`: a new MCP tool in the mattstack plugin that runs a curated set of agent-safe rt verbs (#378)
- security: compiled rt no longer loads a `bunfig.toml` preload or a `.env` from the caller's working directory (#378)
- the AskUserQuestion hook asks the daemon via `rt gate fork-check`, so a pane's own run gate can be asked as a form (#391)
- unattended panes accept Claude Code's worktree relocation prompt in its current drawing instead of stalling (#394)
- injecting into a Claude pane sets aside anything already typed and restores it afterwards (#408)
- gate notifications: a click opens the surface first (#362), pane-started work returns to its pane (#366), and pane-bound clicks no longer flash the shell window (#369)
- herd escalations collapse into one summary per herd that focuses the shepherd (#388)
- `rt herd spawn` and `rt agent start` default `--account` to the caller's cswap account (#367)
- `rt skills init` scaffolds a team's first skills pack, and `rt skills bind` writes the pack's own fragment (#401)

### Git client (`rt glitter`)

- a GitHub Desktop style board: changes, commit, branches, worktrees and the action segment, built to the design boards (#346, #353, #354)
- History tab (#383), stash with GitHub Desktop's own markers (#399), right-click and ctrl-k context menu (#389)
- live status for the current worktree and animated spinners (#400), hover on every interactive region (#360)
- create branches and provision worktrees from the foldouts, and list worktrees git knows about beyond rt's registry (#357, #365, #368)
- publish a repository with no remote through `gh` (#420)
- polish and follow-ups (#363, #405), plus a whole-binary pty test gate (#356, #392)

### Worktrees

- on-deck worktrees build by cloning a golden donor's installed artifacts instead of a cold install, on replenish and on provision (#359, #364, #370, #371)
- merged worktrees stranded by herds and orphans are disposed (#410)
- missing GitHub tokens and untracked repos no longer silently disable PR state and merge cleanup; rt falls back to the `gh` session (#382)
- the `rt cd` picker groups worktrees by recency and hides disposable trees

### Daemon and project sync

- daemon restarts are pid-verified end to end instead of reporting success early (#361)
- project sync failures are reported to the board (#374), merged and closed MRs come from the index (#375), and `rt.ignoredMrs` keeps deploy-branch MRs out of sync (#381)

### mattstack.app and the dev app

- tab and dock badges for decisions waiting on you (#398)
- dev mode is retired: whoever launches a process sets its flavor, and the app you opened last is the active one (#418); launch agents re-register when their shipped plist changes (#419)
- a hand-installed deck agent is retired on flavor handoff and cleared before the prod deck helper registers (#380, #384)
- the board's scrollbar gutter no longer renders as a black strip (#355)
- the dev app runs deck from a linked checkout (#402) and can rebuild and restart itself from the tray (#411, #403, #404, #421)
- the tray asks flock to focus a pane when flock is running
- `rt run`'s queued launches open a seeded runner board (#390), and the runner board claims the mouse (#412)

### Bundled apps

- board 0.1.5: every gate opens the two-column gate sheet, structured review gates with a full-screen decision queue, edit a drafted reply before it posts, merge refusal reasons, the freshness banner names rt's sync failure, and BOARD-48, BOARD-47 and SKILLS-76 fixes (#427)
- console 0.1.2: one grouped, filterable settings page with explain as a modal, the member-joined notification toggle, and unset notification toggles read on, matching what the daemon sends (#426, #427)
- chat 0.1.2: the Radix colour system and one type ladder (#427)
- deck 1.0.7 (was 1.0.5): the bundle helper owns deck, deploy restarts a source-run deck in the dev app, and app badges reach the shell (#385, #413)
- fast-browser 0.1.5 (was 0.1.3): `doctor --checks`, and Web Store installs pass `extension-installed` (#407)
- every app artifact is now signed with the Developer ID certificate under a stable identifier, so TCC grants survive updates (#347)

### Plugins and tools

- plugin catalog: mattstack 0.20.0 (pack authoring, writing-style presets, Hold at Gate 2 posts nothing) and fast-browser at 0.1.5 (#425)
- bundled tools: age 1.3.2, gh 2.101.0, glab 1.119.0, node 24.21.0, cloudflared 2026.9.3 (#425); Sparkle stays at 2.9.6 for its own release
- release and VM scripts' existence guards no longer invert under pipefail (#425)
- `@mattstack/rt-client` 0.31.1 and `@mattstack/settings-kit` 0.3.0 (#374, #376, #379, #422, #424, #426)

### Release tooling

- `rt release preflight`, `rt release verify` and `rt release update-machine` turn the release checklist's mechanical steps into verbs (#350, #351, #352)
- `rt-tray/vm/run/gatekeeper-check.sh`: a clean-room Gatekeeper assessment for any signed app (#358)

**Full Changelog**: https://github.com/m4ttstack/rt/compare/v2.10.2...v2.11.0
