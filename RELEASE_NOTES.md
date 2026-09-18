the polish release. Everything v2.9.0 shipped, plus the app-layer refresh it should have carried: every bundled mattstack app now ships current, including the board half of the gate seam. The mac app window grows find in page, a proper settings window, and a calmer startup.

### The mac app

- find in page: cmd-F searches the mattstack window (#311)
- the settings window is a native tabbed window (General, Permissions, Fast Browser, Team, Uninstall) with the active pane named in the titlebar; the SwiftUI tab pill that collapsed into an overflow chevron on macOS 26 is gone (#312, #319)
- Dev mode is a switch with a confirmation instead of a wordy button; the handoff still quits this flavor and launches the other (#312)
- startup shows a fixed-life splash with a loading indicator and retries the icon fetch; the post-settle hold dropped from 1.0s to 0.3s (#318, #315)

### Bundled apps, refreshed

- board 0.1.4: the board side of the gate seam ships (gates converge on daemon gate:ask, GateForm renders option descriptions and question context) plus peer-board asks over the switchboard (#324)
- chat 0.1.1, console 0.1.1, deck 1.0.4: current app-layer builds; the bundle no longer pins the September 7 fold-in era
- deck logs its own serve output to `~/.mattstack/deck/logs/agent.log`, so a boot failure finally leaves evidence, and a failed port bind now names the process holding the port before exiting for launchd's retry (deck-v1.0.4)
- fast-browser 0.1.3: reads Claude plugin state via `claude plugin list --json` (the old text parser broke on the new synced-plugins section) and knows the current extension id (#313)

### Gates and daemon

- gate:ask reports why the form cap forced a wait instead of silently queueing (#317)
- the daemon auto-accepts EnterWorktree's permission-root relocation prompt for registry-verified trees (#316)
- the executor reconciler expires long-gone executors from the roster (#322)
- a done herd job with a live follow-up round no longer draws the watchdog's close nag (#320)

### Setup

- fastbrowser.setup skips honestly on a host-less machine again: the skip now survives fast-browser's requested-host-absent wording (#308)
- the bundle build prunes `*.iconset` resource dirs from helpers, so a helper shipping icon sources cannot fail the codesign seal (#314)

### Proving it

- the VM walkthrough unlocks the tester keychain before the assert phase, so the state-backup assertions run as a real user session would (#310)
- the release process itself learned from 2.9.0: publish verification includes the draft flip and the public latest pointer, and a pin-freshness step keeps the bundled apps from shipping stale silently (#321, #323)

**Full Changelog**: https://github.com/m4ttstack/rt/compare/v2.9.0...v2.10.0
