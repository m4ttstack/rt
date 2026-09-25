# Unit G: the window waits for deck (rt-tray) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mattstack window's splash holds until deck's `/healthz` answers and a fresh app catalog has loaded (bounded at 90s), shows a spinner beside the stack mark once its animation has played, and at the deadline shows "Can't reach deck" with Retry and the reason the tray knows. A stale catalog keeps re-fetching until it is fresh, missing icons re-fetch once it is, and a tab whose app answers a main-frame 5xx shows the existing failure overlay with a Retry that actually reloads.

**Architecture:** Every decision is pure and lives in `rt-tray/Sources-core/Window/` (three new files) with `MattstackCoreChecks` coverage: the deck wait loop with an injected clock, sleeper, probe and catalog loader; the deck agent diagnosis built from SMAppService status plus unit F's `LaunchdPrint` parser (`Sources-core/Services/LaunchdJob.swift`, reused, never duplicated); and the window recovery rules (5xx verdict, reload action, active tab after a catalog swap, which icons to re-fetch). The app target (`rt-tray/Sources/Window/`) wires them: a `WindowBackends` value carries the live probe, diagnosis, catalog and favicon URL so a DEBUG `--window-preview` mode can script deck for screenshots without launchd or the network. AppDelegate is not touched.

**Tech Stack:** Swift 5.9, SwiftUI, AppKit, WebKit, ServiceManagement; checks via `swift run --package-path rt-tray mattstack-checks` (XCTest is not available under CLT).

**Spec:** /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/faramir/docs/superpowers/specs/2026-09-24-prod-readiness-2-13-design.md (section G)

---

## Global Constraints

- Repo: `m4ttstack/rt` (repo-tools). Branch `rt-2-13-g-window-waits-for-deck` from `origin/main` after unit F (`rt-2-13-f-tray-launch-lifecycle`) has merged, in a fresh rt worktree (Task 1). This unit consumes F's `LaunchdJobSnapshot`, `LaunchdJobLookup` and `LaunchdPrint` from `Sources-core/Services/LaunchdJob.swift` and declares none of them itself: two `public struct LaunchdJobSnapshot` in the `MattstackCore` module are an invalid redeclaration, and no PR workflow builds Swift, so the clash would surface only in the release build. Never write to or switch branches in `~/Documents/GitHub/repo-tools` (the shared checkout); read it only to copy `rt-tray/deps` and `rt-tray/vm/.cache`.
- The rt worktree Bash guard refuses heredocs, `&&` chains, `git -C` and loops. Run every command below as its own Bash call from the worktree root, and use `--package-path rt-tray` instead of `cd rt-tray`.
- TDD for every core change: write the check file, run it and watch the build fail on the missing symbols, implement, run it green, commit.
- Verification is targeted only: `swift build --package-path rt-tray` and `swift run --package-path rt-tray mattstack-checks "<filter>"` (and the whole `mattstack-checks` run once at the end of each app task). Never run `bun run test` or `bun run test:all`; CI runs them. No TypeScript is touched, so `tsc` and `picker:check` are not relevant here. Tray checks are not in `checks.yml`, so the local run is the only gate: do not skip it.
- **Source guard.** `rt-tray/Tests/MattstackCoreChecks/SourceGuardChecks.swift:10` fails any check file that contains `/bin/launchctl`, `launchctl ` (with a trailing space), `pkill`, `tccutil`, `osascript`, `/usr/bin/open` or `SystemCommandRunner(`. Check names, comments, fixtures and expected strings in check files say "launchd print" or "launchd's control tool", never the tool's name followed by a space, and any product string a check asserts follows the same wording. A filtered run never executes the guard, so run `swift run --package-path rt-tray mattstack-checks "checks never name"` after writing any check file.
- Never run `rt-tray/build.sh` in any mode (it writes `rt-tray/mattstack*.app`, and `install` writes `/Applications`). Never touch `/Applications/*.app` or `rt-tray/mattstack-dev.app` in the shared checkout. The UI validation uses the worktree's own debug build in `--window-preview` mode, under an isolated HOME (`env -i HOME=<tmp> ...`), and nothing else.
- Clean-code comments only: a comment states a constraint the code cannot show. No narration, no decision history, no ticket ids, no review references in code. Rewrite the two comments that record the old "splash waits on nothing" decision (`WindowModel.swift:195-205`, `SplashView.swift:27-28`) so they state the new constraint only.
- No em dashes or en dashes anywhere (code, comments, commits, PR body). After each `git add`, run `git diff --cached | perl -CSD -ne 'print if /^\+.*[\x{2013}\x{2014}]/'`; it must print nothing.
- Commit after every task. Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).
- Coordination with unit F (tray launch lifecycle): F edits `Sources/AppDelegate.swift` (launch ordering), `Sources/Services/ServicesRegistrar.swift`, `Sources/DaemonLifecycle.swift` and `Sources-core/Services/*`, and owns the launchd print parser. This unit edits none of those files; it reads F's parser. The only file both touch is `Tests/MattstackCoreChecks/AllChecks.swift` (one line each appends to). G is the second of the two to merge: before merging, rebase onto `origin/main`, then run `swift build --package-path rt-tray` and the full `swift run --package-path rt-tray mattstack-checks` on the rebased tree (Task 10). Post the file list in the release room over rt chat when you start (`rt chat post <room> ...`), per the `rt:chat` skill.

## Review Focus

Five input classes or failure modes the spec implies that nothing in the tree tests today. Each is pinned by a named check in the owning task.

1. **A 200 that is not deck.** portless owns `deck.mattstack` on :443 whatever deck is doing, so any answer (a proxy page, a future portless status page served as 200) must not end the wait. Only deck's own `/healthz` sets `x-deck-pid` (`mattstack-apps/apps/deck/src/api/server.ts:338-344`). Pinned by Task 2 "deck wait: a 200 without x-deck-pid is not deck".
2. **Slow probes stretching the bound.** Each probe can eat its 2s timeout; a loop that counts polls instead of reading the clock turns "90s" into three minutes. Pinned by Task 2 "deck wait: gives up at the deadline even when each probe is slow".
3. **Deck up, catalog not loading.** `/healthz` answers but `/api/apps` fails (500, or a shape the decoder rejects after a deck update). The wait must not report ready, and at the deadline the reason must name the catalog, not blame the agent. Pinned by Task 2 "deck wait: healthy deck with a stale catalog is not ready and says so at the deadline".
4. **Nested `state` lines in `launchctl print`.** The real output repeats `state = active` two tabs deep inside the coalition blocks; a parser that reads them reports a crashed deck as "active". Pinned by Task 3 "deck agent: nested blocks never override top-level keys", which runs a nested-first print through F's `LaunchdPrint.parse` and this unit's diagnosis together.
5. **Retry that does nothing.** A tab whose first load was cancelled on a 5xx (or failed provisionally) has no committed page, and `WKWebView.reload()` is a no-op then, so the overlay's Retry (`MattstackWindowView.swift:397-400`, `WebViewStore.swift:50`) would silently do nothing. Pinned by Task 4 "window recovery: retry after a failed first load loads the app, not reload()".

## Files

Created:
- `rt-tray/Sources-core/Window/DeckWait.swift`: `DeckProbeResult`, `DeckHealth`, `DeckWaitPhase`, `DeckWaitTuning`, `DeckWaitDeps`, `DeckWait`, `SplashContent`, `SplashPresentation`.
- `rt-tray/Sources-core/Window/DeckAgentDiagnosis.swift`: `DeckAgentDiagnosis` (it reads F's `LaunchdJobLookup`; no parser, argv or exit-code constant of its own).
- `rt-tray/Sources-core/Window/WindowRecovery.swift`: `MainFrameVerdict`, `MainFrameResponse`, `WindowReloadAction`, `WindowReload`, `IconTarget`, `CatalogRefresh`.
- `rt-tray/Tests/MattstackCoreChecks/DeckWaitChecks.swift`, `DeckAgentDiagnosisChecks.swift`, `WindowRecoveryChecks.swift`.
- `rt-tray/Sources/Window/WindowBackends.swift`: `WindowBackends`, `LiveDeckProbe`, `LiveDeckDiagnosis`.
- `rt-tray/Sources/Window/WindowPreview.swift` (DEBUG only).

Modified:
- `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift:3` (append three arrays).
- `rt-tray/Sources/Window/WindowModel.swift` (delegate at 14-98, model state and init at 100-136, catalog at 143-167, splash at 195-216, icons at 284-311).
- `rt-tray/Sources/Window/SplashView.swift` (tuning comment at 27-28, view at 84-104).
- `rt-tray/Sources/Window/MattstackWindowView.swift` (splash mount at 51-55).
- `rt-tray/Sources/Window/WebViewStore.swift` (load at 43, reload at 50).
- `rt-tray/Sources/Window/BadgePoller.swift:29`.
- `rt-tray/Sources/main.swift` (one DEBUG flag beside `--find-bar-preview` at 12-14).

Not touched (unit F owns them): `Sources/AppDelegate.swift`, `Sources/Services/*`, `Sources/DaemonLifecycle.swift`, `Sources-core/Services/*` (read only: `LaunchdJob.swift`'s `LaunchdPrint`, `LaunchdJobLookup` and `LaunchdJobSnapshot`).

---

### Task 1: Worktree and baseline

**Files:** none changed.

**Interfaces:** Consumes unit F's merged `Sources-core/Services/LaunchdJob.swift`. Produces a worktree on branch `rt-2-13-g-window-waits-for-deck` at an `origin/main` that includes F, with `rt-tray/deps` and `rt-tray/vm/.cache` present and a green baseline.

- [ ] **Step 1: Enter a fresh rt worktree.** Load `EnterWorktree` (ToolSearch `select:EnterWorktree`) and call it in name mode with name `rt-2-13-g-window-waits-for-deck` (see the `rt:worktree` skill). Then run, one call each:

```
git fetch origin
git branch --show-current
git log --oneline origin/main..HEAD
git status --short
git log --oneline -1 origin/main -- rt-tray/Sources-core/Services/LaunchdJob.swift
```

Expected: the first log and the status print nothing, and the last command prints F's commit `tray: parse launchd print into a job snapshot`. If the branch is not named `rt-2-13-g-window-waits-for-deck`, run `git branch -m rt-2-13-g-window-waits-for-deck`. If HEAD is behind `origin/main`, run `git merge --ff-only origin/main`.

If the last command prints nothing, F has not merged yet. Do not write a parser of your own: cherry-pick F's Task 1 commit from its branch (`git fetch origin rt-2-13-f-tray-launch-lifecycle`, then `git log --oneline origin/rt-2-13-f-tray-launch-lifecycle -- rt-tray/Sources-core/Services/LaunchdJob.swift` to find it, then `git cherry-pick <sha>`), and before merging this PR rebase onto `origin/main` once F has landed so the cherry-pick drops out.

- [ ] **Step 2: Copy the Swift build inputs from the main checkout** (clonefile copies, read only on the source side):

```
cp -Rc /Users/matt/Documents/GitHub/repo-tools/rt-tray/deps rt-tray/deps
mkdir -p rt-tray/vm
cp -Rc /Users/matt/Documents/GitHub/repo-tools/rt-tray/vm/.cache rt-tray/vm/.cache
```

Both are git-ignored (`.gitignore:34` for `rt-tray/deps/`); `git status --short` must stay empty.

- [ ] **Step 3: Baseline build and checks.**

```
swift build --package-path rt-tray
swift run --package-path rt-tray mattstack-checks
```

Expected: the build succeeds and the checks print `checks: N passed, 0 failed`. Record N. If the baseline is red, stop and report it; do not start Task 2 on a red tree.

- [ ] **Step 4: Announce the file list** to unit F over rt chat (Global Constraints). No commit for this task.

---

### Task 2: Core deck wait loop, health classification and splash presentation

**Files:**
- Create: `rt-tray/Sources-core/Window/DeckWait.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/DeckWaitChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift:3`

**Interfaces:**
- Consumes: nothing new (Foundation only).
- Produces:
  - `public enum DeckProbeResult: Equatable, Sendable { case healthy(pid: String); case answered(status: Int); case unreachable(String) }`
  - `public enum DeckHealth { static let url: String; static func classify(status: Int, deckPid: String?) -> DeckProbeResult }`
  - `public enum DeckWaitPhase: Equatable, Sendable { case waiting, ready, unreachable(reason: String) }`
  - `public enum DeckWaitTuning { static let deadline: TimeInterval /* 90 */; static let pollInterval: TimeInterval /* 1 */; static let probeTimeout: TimeInterval /* 2 */ }`
  - `public struct DeckWaitDeps: Sendable` with `probe`, `loadCatalog`, `diagnoseAgent`, `now`, `sleep` closures (signatures below)
  - `public enum DeckWait { static func run(deadline:pollInterval:deps:) async -> DeckWaitPhase; static func reason(agent: String, lastProbe: DeckProbeResult) -> String }`
  - `public enum SplashContent: Equatable, Sendable { case mark, markWithSpinner, unreachable(reason: String), dismiss }`
  - `public enum SplashPresentation { static func content(animationDone: Bool, phase: DeckWaitPhase) -> SplashContent }`

- [ ] **Step 1: Write the failing checks.** Create `rt-tray/Tests/MattstackCoreChecks/DeckWaitChecks.swift`:

```swift
import Foundation
@testable import MattstackCore

private final class FakeClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: TimeInterval = 0
    func now() -> TimeInterval { lock.lock(); defer { lock.unlock() }; return value }
    func advance(_ by: TimeInterval) { lock.lock(); value += by; lock.unlock() }
}

private final class Tally: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func bump() -> Int { lock.lock(); defer { lock.unlock() }; count += 1; return count }
    var value: Int { lock.lock(); defer { lock.unlock() }; return count }
}

private let crashedAgent =
    "The deck agent (com.mattstack.deck) is not running (launchd state: not running; last exit code 78)."

private func scripted(clock: FakeClock, probeCost: TimeInterval = 0, probes: Tally = Tally(),
                      probe: @escaping @Sendable (Int) -> DeckProbeResult,
                      catalog: @escaping @Sendable () -> Bool = { true }) -> DeckWaitDeps {
    DeckWaitDeps(
        probe: { clock.advance(probeCost); return probe(probes.bump()) },
        loadCatalog: { catalog() },
        diagnoseAgent: { crashedAgent },
        now: { clock.now() },
        sleep: { clock.advance($0) })
}

let deckWaitChecks: [Check] = [
    Check("deck wait: healthz 200 with x-deck-pid is healthy") { c in
        c.expectEqual(DeckHealth.classify(status: 200, deckPid: "4242"), .healthy(pid: "4242"))
    },
    Check("deck wait: a 200 without x-deck-pid is not deck") { c in
        c.expectEqual(DeckHealth.classify(status: 200, deckPid: nil), .answered(status: 200))
        c.expectEqual(DeckHealth.classify(status: 200, deckPid: "  "), .answered(status: 200))
    },
    Check("deck wait: the portless 502 page is not deck") { c in
        c.expectEqual(DeckHealth.classify(status: 502, deckPid: nil), .answered(status: 502))
        c.expectEqual(DeckHealth.classify(status: 502, deckPid: "4242"), .answered(status: 502))
    },
    Check("deck wait: ready on the first healthy probe with a fresh catalog, no sleep") { c in
        let clock = FakeClock()
        let phase = await DeckWait.run(deps: scripted(clock: clock, probe: { _ in .healthy(pid: "1") }))
        c.expectEqual(phase, .ready)
        c.expectEqual(clock.now(), 0)
    },
    Check("deck wait: polls once a second until deck answers") { c in
        let clock = FakeClock()
        let probes = Tally()
        let phase = await DeckWait.run(deps: scripted(clock: clock, probes: probes,
                                                      probe: { $0 < 5 ? .answered(status: 502) : .healthy(pid: "1") }))
        c.expectEqual(phase, .ready)
        c.expectEqual(probes.value, 5)
        c.expectEqual(clock.now(), 4)
    },
    Check("deck wait: healthy deck with a stale catalog is not ready and says so at the deadline") { c in
        let clock = FakeClock()
        let phase = await DeckWait.run(deadline: 10, deps: scripted(clock: clock, probe: { _ in .healthy(pid: "77") },
                                                                    catalog: { false }))
        guard case .unreachable(let reason) = phase else { c.fail("expected unreachable, got \(phase)"); return }
        c.expect(reason.contains("pid 77"), reason)
        c.expect(reason.contains("/api/apps"), reason)
        c.expect(!reason.contains("last exit code"), "a running deck must not be blamed on its agent: \(reason)")
    },
    Check("deck wait: gives up at the deadline even when each probe is slow") { c in
        let clock = FakeClock()
        let probes = Tally()
        let phase = await DeckWait.run(deadline: 90, pollInterval: 1,
                                       deps: scripted(clock: clock, probeCost: 2, probes: probes,
                                                      probe: { _ in .unreachable("The request timed out.") }))
        guard case .unreachable = phase else { c.fail("expected unreachable, got \(phase)"); return }
        c.expect(clock.now() >= 90 && clock.now() < 93, "stopped at \(clock.now())")
        c.expectEqual(probes.value, 31)
    },
    Check("deck wait: the unreachable reason carries the agent diagnosis and the last answer") { c in
        let clock = FakeClock()
        let phase = await DeckWait.run(deadline: 3, deps: scripted(clock: clock, probe: { _ in .answered(status: 502) }))
        guard case .unreachable(let reason) = phase else { c.fail("expected unreachable, got \(phase)"); return }
        c.expect(reason.hasPrefix(crashedAgent), reason)
        c.expect(reason.contains("HTTP 502"), reason)
    },
    Check("deck wait: a wait cancelled mid-poll stops probing") { c in
        let probes = Tally()
        let deps = DeckWaitDeps(
            probe: { _ = probes.bump(); return .answered(status: 502) },
            loadCatalog: { false },
            diagnoseAgent: { crashedAgent },
            now: { 0 },
            sleep: { _ in withUnsafeCurrentTask { $0?.cancel() } })
        let phase = await Task { await DeckWait.run(deps: deps) }.value
        c.expectEqual(phase, .waiting)
        c.expectEqual(probes.value, 1)
    },
    Check("deck wait: splash shows only the mark while the stack animates") { c in
        c.expectEqual(SplashPresentation.content(animationDone: false, phase: .waiting), .mark)
        c.expectEqual(SplashPresentation.content(animationDone: false, phase: .ready), .mark)
    },
    Check("deck wait: the spinner appears only after the animation, while deck is not ready") { c in
        c.expectEqual(SplashPresentation.content(animationDone: true, phase: .waiting), .markWithSpinner)
    },
    Check("deck wait: the splash dismisses once animated and ready") { c in
        c.expectEqual(SplashPresentation.content(animationDone: true, phase: .ready), .dismiss)
    },
    Check("deck wait: unreachable shows its reason") { c in
        c.expectEqual(SplashPresentation.content(animationDone: true, phase: .unreachable(reason: "r")),
                      .unreachable(reason: "r"))
    },
]
```

Append `+ deckWaitChecks` to the end of the `allChecks` expression in `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift:3`.

- [ ] **Step 2: Run it and watch it fail.**

```
swift run --package-path rt-tray mattstack-checks "deck wait:"
```

Expected: the build fails with `cannot find 'DeckHealth' in scope` (and the other new symbols).

- [ ] **Step 3: Implement.** Create `rt-tray/Sources-core/Window/DeckWait.swift`:

```swift
import Foundation

public enum DeckProbeResult: Equatable, Sendable {
    case healthy(pid: String)
    case answered(status: Int)
    case unreachable(String)
}

public enum DeckHealth {
    public static let url = "https://deck.mattstack/healthz"

    /// portless answers for deck.mattstack whether or not deck is listening,
    /// so a status alone never means deck is up; only deck's own /healthz
    /// sets x-deck-pid.
    public static func classify(status: Int, deckPid: String?) -> DeckProbeResult {
        let pid = deckPid?.trimmingCharacters(in: .whitespaces) ?? ""
        guard status == 200, !pid.isEmpty else { return .answered(status: status) }
        return .healthy(pid: pid)
    }
}

public enum DeckWaitPhase: Equatable, Sendable {
    case waiting
    case ready
    case unreachable(reason: String)
}

public enum DeckWaitTuning {
    public static let deadline: TimeInterval = 90
    public static let pollInterval: TimeInterval = 1
    public static let probeTimeout: TimeInterval = 2
}

public struct DeckWaitDeps: Sendable {
    public let probe: @Sendable () async -> DeckProbeResult
    /// True once a fresh catalog is loaded; a cache copy does not count.
    public let loadCatalog: @Sendable () async -> Bool
    public let diagnoseAgent: @Sendable () async -> String
    public let now: @Sendable () -> TimeInterval
    public let sleep: @Sendable (TimeInterval) async -> Void

    public init(probe: @escaping @Sendable () async -> DeckProbeResult,
                loadCatalog: @escaping @Sendable () async -> Bool,
                diagnoseAgent: @escaping @Sendable () async -> String,
                now: @escaping @Sendable () -> TimeInterval,
                sleep: @escaping @Sendable (TimeInterval) async -> Void) {
        self.probe = probe
        self.loadCatalog = loadCatalog
        self.diagnoseAgent = diagnoseAgent
        self.now = now
        self.sleep = sleep
    }
}

public enum DeckWait {
    /// The deadline is read from the clock after every probe, never counted
    /// in polls: a probe can take its whole timeout. A cancelled wait
    /// returns `.waiting` and the caller drops it.
    public static func run(deadline: TimeInterval = DeckWaitTuning.deadline,
                           pollInterval: TimeInterval = DeckWaitTuning.pollInterval,
                           deps: DeckWaitDeps) async -> DeckWaitPhase {
        let start = deps.now()
        while !Task.isCancelled {
            let probe = await deps.probe()
            if case .healthy = probe, await deps.loadCatalog() { return .ready }
            if deps.now() - start >= deadline {
                let agent = await deps.diagnoseAgent()
                return .unreachable(reason: reason(agent: agent, lastProbe: probe))
            }
            await deps.sleep(pollInterval)
        }
        return .waiting
    }

    public static func reason(agent: String, lastProbe: DeckProbeResult) -> String {
        switch lastProbe {
        case .healthy(let pid):
            return "deck is running (pid \(pid)) but its app list (/api/apps) did not load."
        case .answered(let status):
            return "\(agent) deck.mattstack answered HTTP \(status) instead of deck."
        case .unreachable(let error):
            return "\(agent) deck.mattstack did not answer (\(error))."
        }
    }
}

public enum SplashContent: Equatable, Sendable {
    case mark
    case markWithSpinner
    case unreachable(reason: String)
    case dismiss
}

public enum SplashPresentation {
    public static func content(animationDone: Bool, phase: DeckWaitPhase) -> SplashContent {
        switch phase {
        case .unreachable(let reason): return .unreachable(reason: reason)
        case .ready: return animationDone ? .dismiss : .mark
        case .waiting: return animationDone ? .markWithSpinner : .mark
        }
    }
}
```

- [ ] **Step 4: Run it green.**

```
swift run --package-path rt-tray mattstack-checks "deck wait:"
```

Expected: `checks: 13 passed, 0 failed`.

- [ ] **Step 5: Commit.**

```
git add rt-tray/Sources-core/Window/DeckWait.swift rt-tray/Tests/MattstackCoreChecks/DeckWaitChecks.swift rt-tray/Tests/MattstackCoreChecks/AllChecks.swift
git commit -m "tray core: deck wait loop, healthz classification, splash presentation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Core deck agent diagnosis

**Files:**
- Create: `rt-tray/Sources-core/Window/DeckAgentDiagnosis.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/DeckAgentDiagnosisChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift:3`

**Interfaces:**
- Consumes: `AgentRegistration` (`Sources-core/Services/AgentPlistRefresh.swift:4-6`), `CommandOutcome` (`Sources-core/Services/CommandRunner.swift:3-11`), and unit F's `Sources-core/Services/LaunchdJob.swift`: `LaunchdJobSnapshot` (`state`, `jobState`, `lastExitCode: Int?`, `pid`, `properties`), `LaunchdJobLookup` (`.loaded(LaunchdJobSnapshot)`, `.notLoaded`, `.unknown(String)`), `LaunchdPrint.arguments(label:uid:)` and `LaunchdPrint.parse(_:)` (exit 113 or "Could not find service" reads `.notLoaded`; any other failure reads `.unknown("exit N")`; only one-tab-deep keys are read).
- Produces:
  - `public enum DeckAgentDiagnosis { static func label(forDaemonLabel: String) -> String; static func describe(label: String, registration: AgentRegistration, lookup: LaunchdJobLookup?) -> String }` (`lookup` is nil when launchd was not asked, which is every registration but `.enabled`)

This unit declares no `LaunchdJobSnapshot`, print argv or not-found exit code: F owns all three, and a second `public struct LaunchdJobSnapshot` in `MattstackCore` does not compile.

The fixtures below are the real `launchd print gui/501/com.mattstack.deck` capture from 2026-09-24, trimmed (environment blocks and home paths removed), and the same layout with the values a refused spawn reports. The checks feed them through F's `LaunchdPrint.parse`, so they pin the parser and the wording together.

- [ ] **Step 1: Write the failing checks.** Create `rt-tray/Tests/MattstackCoreChecks/DeckAgentDiagnosisChecks.swift`:

```swift
import Foundation
@testable import MattstackCore

private let runningPrint = """
gui/501/com.mattstack.deck = {
\tactive count = 1
\tpath = (submitted by smd.543)
\ttype = Submitted
\tmanaged_by = com.apple.xpc.ServiceManagement
\tstate = running

\tprogram identifier = Contents/Helpers/deck (mode: 2)
\targuments = {
\t\tContents/Helpers/deck
\t\tserve
\t}

\truns = 3
\tpid = 28479
\timmediate reason = non-ipc demand
\tlast exit code = 0

\tresource coalition = {
\t\tID = 9211
\t\ttype = resource
\t\tstate = active
\t\tname = com.mattstack.deck
\t}
}
"""

private let crashedPrint = """
gui/501/com.mattstack.deck = {
\tactive count = 0
\tpath = (submitted by smd.543)
\ttype = Submitted
\tstate = not running

\truns = 4
\tlast exit code = 78: EX_CONFIG

\tjetsam coalition = {
\t\tstate = active
\t}
}
"""

private let nestedFirstPrint = """
gui/501/com.mattstack.deck = {
\tresource coalition = {
\t\tstate = active
\t}
\tstate = not running
\tlast exit code = 78: EX_CONFIG
}
"""

private func printed(_ stdout: String, exit: Int32 = 0, stderr: String = "") -> LaunchdJobLookup {
    LaunchdPrint.parse(CommandOutcome(exitCode: exit, stdout: stdout, stderr: stderr))
}

private func describe(_ registration: AgentRegistration, _ lookup: LaunchdJobLookup?) -> String {
    DeckAgentDiagnosis.describe(label: "com.mattstack.deck", registration: registration, lookup: lookup)
}

private let crashed =
    "The deck agent (com.mattstack.deck) is not running (launchd state: not running; last exit code 78)."

let deckAgentDiagnosisChecks: [Check] = [
    Check("deck agent: label follows build.sh's daemon-to-deck rename") { c in
        c.expectEqual(DeckAgentDiagnosis.label(forDaemonLabel: "com.mattstack.daemon"), "com.mattstack.deck")
        c.expectEqual(DeckAgentDiagnosis.label(forDaemonLabel: "com.mattstack.daemon.dev"), "com.mattstack.deck.dev")
    },
    Check("deck agent: nested blocks never override top-level keys") { c in
        c.expectEqual(describe(.enabled, printed(nestedFirstPrint)), crashed)
    },
    Check("deck agent: a crashed job names its exit code") { c in
        c.expectEqual(describe(.enabled, printed(crashedPrint)), crashed)
    },
    Check("deck agent: a running job names its pid") { c in
        c.expectEqual(describe(.enabled, printed(runningPrint)),
                      "The deck agent (com.mattstack.deck) is running (pid 28479).")
    },
    Check("deck agent: registration problems are named without asking launchd") { c in
        c.expectEqual(describe(.notRegistered, nil), "The deck agent (com.mattstack.deck) is not registered.")
        c.expectEqual(describe(.requiresApproval, nil),
                      "The deck agent (com.mattstack.deck) is waiting for approval in System Settings > General > Login Items.")
        c.expectEqual(describe(.notFound, nil), "This app has no deck agent (com.mattstack.deck) to start.")
        c.expectEqual(describe(.enabled, nil), "The deck agent (com.mattstack.deck) is registered.")
    },
    Check("deck agent: an enabled agent launchd has not loaded") { c in
        let lookup = printed("", exit: 113,
                             stderr: "Could not find service \"com.mattstack.deck\" in domain for user gui: 501")
        c.expectEqual(lookup, .notLoaded)
        c.expectEqual(describe(.enabled, lookup),
                      "The deck agent (com.mattstack.deck) is registered but launchd has not loaded it.")
    },
    Check("deck agent: a failed launchd print is reported with its exit") { c in
        c.expectEqual(describe(.enabled, printed("", exit: 5, stderr: "boom")),
                      "The deck agent (com.mattstack.deck) is registered; launchd print failed (exit 5).")
    },
]
```

Append `+ deckAgentDiagnosisChecks` to `AllChecks.swift:3`.

- [ ] **Step 2: Run it and watch it fail.**

```
swift run --package-path rt-tray mattstack-checks "deck agent:"
```

Expected: build error `cannot find 'DeckAgentDiagnosis' in scope`. (If it instead says `cannot find 'LaunchdPrint' in scope`, F's parser is not on this branch: go back to Task 1 Step 1.)

- [ ] **Step 3: Implement.** Create `rt-tray/Sources-core/Window/DeckAgentDiagnosis.swift`:

```swift
import Foundation

public enum DeckAgentDiagnosis {
    /// Mirrors build.sh's `${DAEMON_LABEL/daemon/deck}`, which names the deck
    /// agent's label and its plist file after the daemon's.
    public static func label(forDaemonLabel daemonLabel: String) -> String {
        guard let range = daemonLabel.range(of: "daemon") else { return daemonLabel }
        return daemonLabel.replacingCharacters(in: range, with: "deck")
    }

    /// `lookup` is nil when launchd was not asked; only an enabled agent is.
    public static func describe(label: String, registration: AgentRegistration,
                                lookup: LaunchdJobLookup?) -> String {
        let agent = "The deck agent (\(label))"
        switch registration {
        case .notRegistered: return "\(agent) is not registered."
        case .requiresApproval: return "\(agent) is waiting for approval in System Settings > General > Login Items."
        case .notFound: return "This app has no deck agent (\(label)) to start."
        case .enabled: break
        }
        guard let lookup else { return "\(agent) is registered." }
        switch lookup {
        case .notLoaded:
            return "\(agent) is registered but launchd has not loaded it."
        case .unknown(let reason):
            return "\(agent) is registered; launchd print failed (\(reason))."
        case .loaded(let job):
            if job.state == "running", let pid = job.pid { return "\(agent) is running (pid \(pid))." }
            var detail = "launchd state: \(job.state ?? "unknown")"
            if let exit = job.lastExitCode { detail += "; last exit code \(exit)" }
            return "\(agent) is not running (\(detail))."
        }
    }
}
```

- [ ] **Step 4: Run it green.**

```
swift run --package-path rt-tray mattstack-checks "deck agent:"
```

Expected: `checks: 7 passed, 0 failed`.

- [ ] **Step 5: Run the source guard.** A filtered run never executes it, and this task added a check file.

```
swift run --package-path rt-tray mattstack-checks "checks never name"
```

Expected: `checks: 1 passed, 0 failed`. A failure names the check file and the forbidden needle; reword the check file (never the guard).

- [ ] **Step 6: Commit.**

```
git add rt-tray/Sources-core/Window/DeckAgentDiagnosis.swift rt-tray/Tests/MattstackCoreChecks/DeckAgentDiagnosisChecks.swift rt-tray/Tests/MattstackCoreChecks/AllChecks.swift
git commit -m "tray core: deck agent diagnosis from SMAppService status and the shared launchd print parser" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Core window recovery rules

**Files:**
- Create: `rt-tray/Sources-core/Window/WindowRecovery.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/WindowRecoveryChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift:3`

**Interfaces:**
- Consumes: `DiscoveryApp` (`Sources-core/Launch/OpenLink.swift:13-26`).
- Produces:
  - `public enum MainFrameVerdict: Equatable, Sendable { case allow, fail(status: Int) }`
  - `public enum MainFrameResponse { static func verdict(isMainFrame: Bool, status: Int?) -> MainFrameVerdict }`
  - `public enum WindowReloadAction: Equatable, Sendable { case reload, load(URL), nothing }`
  - `public enum WindowReload { static func action(failedURL: URL?, hasCommittedPage: Bool, home: URL?) -> WindowReloadAction }`
  - `public struct IconTarget: Equatable, Sendable { name: String; url: String; init(name:url:) }`
  - `public enum CatalogRefresh { static func activeApp(current: String, apps: [DiscoveryApp], deckName: String, currentIsFallback: Bool) -> String; static func iconTargets(apps: [DiscoveryApp], deck: IconTarget, loaded: Set<String>, inFlight: Set<String>) -> [IconTarget] }`

- [ ] **Step 1: Write the failing checks.** Create `rt-tray/Tests/MattstackCoreChecks/WindowRecoveryChecks.swift`:

```swift
import Foundation
@testable import MattstackCore

private func app(_ name: String, icon: String? = nil) -> DiscoveryApp {
    DiscoveryApp(name: name, displayName: name.capitalized, description: nil,
                 url: "https://\(name).mattstack", icon: icon)
}

private let deckIcon = IconTarget(name: "deck", url: "https://deck.mattstack/favicon.svg")

let windowRecoveryChecks: [Check] = [
    Check("window recovery: a main-frame 5xx fails the tab") { c in
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: 502), .fail(status: 502))
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: 500), .fail(status: 500))
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: 599), .fail(status: 599))
    },
    Check("window recovery: subframe 5xx, 4xx, 2xx and non-HTTP responses pass through") { c in
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: false, status: 502), .allow)
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: 404), .allow)
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: 200), .allow)
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: 600), .allow)
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: nil), .allow)
    },
    Check("window recovery: retry after a failed first load loads the app, not reload()") { c in
        let home = URL(string: "https://board.mattstack")!
        c.expectEqual(WindowReload.action(failedURL: nil, hasCommittedPage: false, home: home), .load(home))
    },
    Check("window recovery: retry loads the URL that failed, not the last good page") { c in
        let failed = URL(string: "https://board.mattstack/mrs/42")!
        c.expectEqual(WindowReload.action(failedURL: failed, hasCommittedPage: true,
                                          home: URL(string: "https://board.mattstack")), .load(failed))
    },
    Check("window recovery: a healthy page reloads in place") { c in
        c.expectEqual(WindowReload.action(failedURL: nil, hasCommittedPage: true, home: nil), .reload)
        c.expectEqual(WindowReload.action(failedURL: nil, hasCommittedPage: false, home: nil), .nothing)
    },
    Check("window recovery: an app gone from the fresh catalog moves the active tab") { c in
        c.expectEqual(CatalogRefresh.activeApp(current: "gitq", apps: [app("board"), app("chat")], deckName: "deck",
                                               currentIsFallback: false), "board")
        c.expectEqual(CatalogRefresh.activeApp(current: "gitq", apps: [], deckName: "deck",
                                               currentIsFallback: false), "deck")
    },
    Check("window recovery: an active tab still in the catalog, or a chosen deck, stays put") { c in
        c.expectEqual(CatalogRefresh.activeApp(current: "chat", apps: [app("board"), app("chat")], deckName: "deck",
                                               currentIsFallback: false), "chat")
        c.expectEqual(CatalogRefresh.activeApp(current: "deck", apps: [app("board")], deckName: "deck",
                                               currentIsFallback: false), "deck")
        c.expectEqual(CatalogRefresh.activeApp(current: "", apps: [app("board")], deckName: "deck",
                                               currentIsFallback: false), "board")
    },
    Check("window recovery: deck shown only because the catalog was empty gives way to the first fresh app") { c in
        c.expectEqual(CatalogRefresh.activeApp(current: "deck", apps: [app("board"), app("chat")], deckName: "deck",
                                               currentIsFallback: true), "board")
        c.expectEqual(CatalogRefresh.activeApp(current: "deck", apps: [], deckName: "deck",
                                               currentIsFallback: true), "deck")
    },
    Check("window recovery: a fresh catalog re-fetches only missing icons, deck's included") { c in
        let apps = [app("board", icon: "https://deck.mattstack/api/apps/board/icon"),
                    app("chat", icon: "https://deck.mattstack/api/apps/chat/icon"),
                    app("console")]
        let targets = CatalogRefresh.iconTargets(apps: apps, deck: deckIcon, loaded: ["board"], inFlight: [])
        c.expectEqual(targets.map(\.name), ["chat", "deck"])
    },
    Check("window recovery: an icon fetch already in flight is not doubled") { c in
        let apps = [app("board", icon: "https://deck.mattstack/api/apps/board/icon")]
        c.expectEqual(CatalogRefresh.iconTargets(apps: apps, deck: deckIcon, loaded: [], inFlight: ["board", "deck"]), [])
    },
]
```

Append `+ windowRecoveryChecks` to `AllChecks.swift:3`.

- [ ] **Step 2: Run it and watch it fail.**

```
swift run --package-path rt-tray mattstack-checks "window recovery:"
```

Expected: build error `cannot find 'MainFrameResponse' in scope`.

- [ ] **Step 3: Implement.** Create `rt-tray/Sources-core/Window/WindowRecovery.swift`:

```swift
import Foundation

public enum MainFrameVerdict: Equatable, Sendable {
    case allow
    case fail(status: Int)
}

public enum MainFrameResponse {
    /// Main frame only: a subframe or a background fetch answering 5xx must
    /// not cover a page that drew fine.
    public static func verdict(isMainFrame: Bool, status: Int?) -> MainFrameVerdict {
        guard isMainFrame, let status, (500...599).contains(status) else { return .allow }
        return .fail(status: status)
    }
}

public enum WindowReloadAction: Equatable, Sendable {
    case reload
    case load(URL)
    case nothing
}

public enum WindowReload {
    /// WKWebView.reload() does nothing without a committed page, which is the
    /// state a tab is left in when its first load failed or was cancelled.
    public static func action(failedURL: URL?, hasCommittedPage: Bool, home: URL?) -> WindowReloadAction {
        if let failedURL { return .load(failedURL) }
        if hasCommittedPage { return .reload }
        if let home { return .load(home) }
        return .nothing
    }
}

public struct IconTarget: Equatable, Sendable {
    public let name: String
    public let url: String
    public init(name: String, url: String) {
        self.name = name
        self.url = url
    }
}

public enum CatalogRefresh {
    /// `currentIsFallback` is true when deck was shown only because the
    /// catalog was empty (a clean install before deck answered), not because
    /// anyone picked it.
    public static func activeApp(current: String, apps: [DiscoveryApp], deckName: String,
                                 currentIsFallback: Bool) -> String {
        if currentIsFallback { return apps.first?.name ?? deckName }
        if current == deckName || apps.contains(where: { $0.name == current }) { return current }
        return apps.first?.name ?? deckName
    }

    public static func iconTargets(apps: [DiscoveryApp], deck: IconTarget, loaded: Set<String>,
                                   inFlight: Set<String>) -> [IconTarget] {
        let candidates = apps.compactMap { app in app.icon.map { IconTarget(name: app.name, url: $0) } } + [deck]
        return candidates.filter { !loaded.contains($0.name) && !inFlight.contains($0.name) }
    }
}
```

- [ ] **Step 4: Run it green.**

```
swift run --package-path rt-tray mattstack-checks "window recovery:"
```

Expected: `checks: 10 passed, 0 failed`.

- [ ] **Step 5: Commit.**

```
git add rt-tray/Sources-core/Window/WindowRecovery.swift rt-tray/Tests/MattstackCoreChecks/WindowRecoveryChecks.swift rt-tray/Tests/MattstackCoreChecks/AllChecks.swift
git commit -m "tray core: 5xx verdict, reload action, catalog refresh rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: WindowModel waits for deck and refreshes a stale catalog

**Files:**
- Create: `rt-tray/Sources/Window/WindowBackends.swift`
- Modify: `rt-tray/Sources/Window/WindowModel.swift:100-216, 284-302`
- Modify: `rt-tray/Sources/Window/BadgePoller.swift:29`
- Modify: `rt-tray/Sources/Window/SplashView.swift:27-28` (comment only)

**Interfaces:**
- Consumes: everything Task 2 and Task 4 produce (`DeckWait`, `DeckWaitDeps`, `DeckWaitPhase`, `DeckWaitTuning`, `DeckHealth`, `SplashPresentation`, `SplashContent`, `CatalogRefresh`, `IconTarget`), Task 3's `DeckAgentDiagnosis`, F's `LaunchdPrint.arguments(label:uid:)` and `LaunchdPrint.parse(_:)`, `ServicesRegistrar.registration(_:)` (`Sources/Services/ServicesRegistrar.swift:111-119`), `BundleFlavor.daemonLabel` (`Sources/BundleFlavor.swift:23-28`), `SystemCommandRunner(timeout:)` (`Sources-core/Services/CommandRunner.swift:222-236`), `AppCatalog` (`Sources-core/Window/AppCatalog.swift:21-44`).
- Produces (app target):
  - `struct WindowBackends { var catalog: AppCatalog; var deckFaviconURL: String; var deckProbe: @Sendable () async -> DeckProbeResult; var diagnoseDeckAgent: @Sendable () async -> String; var deckWaitDeadline: TimeInterval; static func live() -> WindowBackends }`
  - `WindowModel.init(store: WebViewStore? = nil, backends: WindowBackends = .live())` (AppDelegate's `WindowModel()` at `AppDelegate.swift:502` compiles unchanged)
  - `@Published private(set) var deckWait: DeckWaitPhase`, `@Published private(set) var splashAnimationDone: Bool`, `var splashContent: SplashContent`
  - `func retryDeckWait()`
  - `@discardableResult func refreshCatalogIfStale() async -> Bool`

No new check here: every decision this task wires is pinned in Tasks 2 to 4, and the app target has no harness (`Tests/` imports only `MattstackCore`, `Package.swift:55-59`). Task 9 exercises it on screen.

- [ ] **Step 1: Add the backends.** Create `rt-tray/Sources/Window/WindowBackends.swift`:

```swift
import Foundation
import MattstackCore
import ServiceManagement

/// Everything the window reads from outside the process, so the preview
/// harness can script deck with no network and no launchd job.
struct WindowBackends {
    var catalog: AppCatalog
    var deckFaviconURL: String
    var deckProbe: @Sendable () async -> DeckProbeResult
    var diagnoseDeckAgent: @Sendable () async -> String
    var deckWaitDeadline: TimeInterval

    static func live() -> WindowBackends {
        WindowBackends(
            catalog: AppCatalog(fetcher: URLSessionAppListFetcher(),
                                cachePath: AppHome.current + "/.mattstack/rt/window-apps-cache.json"),
            deckFaviconURL: "https://deck.mattstack/favicon.svg",
            deckProbe: { await LiveDeckProbe.probe() },
            diagnoseDeckAgent: { await LiveDeckDiagnosis.describe() },
            deckWaitDeadline: DeckWaitTuning.deadline)
    }
}

enum LiveDeckProbe {
    static func probe() async -> DeckProbeResult {
        var request = URLRequest(url: URL(string: DeckHealth.url)!, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: DeckWaitTuning.probeTimeout)
        request.httpMethod = "GET"
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .unreachable("no HTTP response") }
            return DeckHealth.classify(status: http.statusCode, deckPid: http.value(forHTTPHeaderField: "x-deck-pid"))
        } catch {
            return .unreachable(error.localizedDescription)
        }
    }
}

enum LiveDeckDiagnosis {
    static func describe() async -> String {
        let label = DeckAgentDiagnosis.label(forDaemonLabel: BundleFlavor.daemonLabel)
        let registration = ServicesRegistrar.registration(SMAppService.agent(plistName: label + ".plist").status)
        guard registration == .enabled else {
            return DeckAgentDiagnosis.describe(label: label, registration: registration, lookup: nil)
        }
        let (exe, args) = LaunchdPrint.arguments(label: label, uid: getuid())
        let printed = await SystemCommandRunner(timeout: 5).run(exe, args)
        return DeckAgentDiagnosis.describe(label: label, registration: registration,
                                           lookup: LaunchdPrint.parse(printed))
    }
}
```

- [ ] **Step 2: Model state and init.** In `WindowModel.swift`, add after `splashOpacity` (line 114):

```swift
    @Published private(set) var deckWait: DeckWaitPhase = .waiting
    @Published private(set) var splashAnimationDone = false
```

Replace lines 120-122 (`catalog`, `catalogLoadTask`, `navigationDelegates`) with:

```swift
    private let backends: WindowBackends
    private let catalog: AppCatalog
    private var catalogLoadTask: Task<Void, Never>?
    private var catalogRefreshTask: Task<Bool, Never>?
    private var navigationDelegates: [String: WindowNavigationDelegate] = [:]
    private var iconFetchesInFlight: Set<String> = []
    private var deckWaitTask: Task<Void, Never>?
    private var deckWaitGeneration = 0
    private var activeAppIsFallback = false
```

In `ensureCatalogLoaded()`, replace line 162 (`if self.activeApp.isEmpty { self.activeApp = result.apps.first?.name ?? Self.deckApp.name }`) with:

```swift
            if self.activeApp.isEmpty {
                self.activeApp = result.apps.first?.name ?? Self.deckApp.name
                self.activeAppIsFallback = result.apps.isEmpty
            }
```

Replace `select(_:)` (lines 181-183) with:

```swift
    func select(_ name: String) {
        activeApp = name
        activeAppIsFallback = false
    }
```

Replace the init at lines 131-136 with:

```swift
    init(store: WebViewStore? = nil, backends: WindowBackends = .live()) {
        self.store = store ?? WebViewStore()
        self.backends = backends
        self.catalog = backends.catalog
        fetchIcon(url: backends.deckFaviconURL, into: Self.deckApp.name)
    }

    var splashContent: SplashContent {
        SplashPresentation.content(animationDone: splashAnimationDone, phase: deckWait)
    }
```

- [ ] **Step 3: Stale catalog refresh.** Insert after `ensureCatalogLoaded()` (after line 167):

```swift
    /// While the catalog is a cache copy, every call fetches again; the first
    /// fresh load replaces the tabs and fetches the icons the stale period
    /// left missing. Concurrent callers share one fetch.
    @discardableResult
    func refreshCatalogIfStale() async -> Bool {
        await ensureCatalogLoaded()
        if catalogFresh { return true }
        if let inFlight = catalogRefreshTask { return await inFlight.value }
        let task = Task { [weak self] () -> Bool in
            guard let self else { return false }
            let result = await self.catalog.load()
            guard result.fresh else { return false }
            self.applyFreshCatalog(result.apps)
            return true
        }
        catalogRefreshTask = task
        let fresh = await task.value
        if catalogRefreshTask == task { catalogRefreshTask = nil }
        return fresh
    }

    private func applyFreshCatalog(_ fresh: [DiscoveryApp]) {
        apps = fresh
        catalogFresh = true
        activeApp = CatalogRefresh.activeApp(current: activeApp, apps: fresh, deckName: Self.deckApp.name,
                                             currentIsFallback: activeAppIsFallback)
        activeAppIsFallback = fresh.isEmpty
        TrayLog.info("window catalog refreshed", ["apps": fresh.map(\.name).joined(separator: ",")])
        let deck = IconTarget(name: Self.deckApp.name, url: backends.deckFaviconURL)
        for target in CatalogRefresh.iconTargets(apps: fresh, deck: deck, loaded: Set(icons.keys),
                                                 inFlight: iconFetchesInFlight) {
            fetchIcon(url: target.url, into: target.name)
        }
    }
```

- [ ] **Step 4: The splash waits for deck.** Replace lines 195-216 (the doc comment and `presentSplashIfNeeded()`) with the block below. The doc comment states only the new constraint; the old "waits on nothing" rationale goes.

```swift
    /// The splash covers the whole window until its own animation has played
    /// and deck is ready (/healthz answered and a fresh catalog loaded), or
    /// until the deck wait gives up and the splash says why. It plays once
    /// per process; re-shows of the window never replay it.
    func presentSplashIfNeeded() {
        guard !Self.hasShownSplash else { return }
        Self.hasShownSplash = true
        splashVisible = true

        let visibleNanoseconds = UInt64(SplashTuning.minimumVisibleDuration * 1_000_000_000)
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: visibleNanoseconds)
            self?.splashAnimationDone = true
            self?.dismissSplashIfReady()
        }
        startDeckWait()
    }

    func retryDeckWait() {
        deckWait = .waiting
        startDeckWait()
    }

    /// A Retry starts a new wait while the old one may still be sleeping, so
    /// only the latest generation may publish its result.
    private func startDeckWait() {
        deckWaitTask?.cancel()
        deckWaitGeneration += 1
        let generation = deckWaitGeneration
        let backends = backends
        let deps = DeckWaitDeps(
            probe: backends.deckProbe,
            loadCatalog: { [weak self] in await self?.refreshCatalogIfStale() ?? false },
            diagnoseAgent: backends.diagnoseDeckAgent,
            now: { ProcessInfo.processInfo.systemUptime },
            sleep: { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) })
        let started = ProcessInfo.processInfo.systemUptime
        deckWaitTask = Task { [weak self] in
            let phase = await DeckWait.run(deadline: backends.deckWaitDeadline, deps: deps)
            guard let self, generation == self.deckWaitGeneration, phase != .waiting else { return }
            self.finishDeckWait(phase, seconds: ProcessInfo.processInfo.systemUptime - started)
        }
    }

    private func finishDeckWait(_ phase: DeckWaitPhase, seconds: TimeInterval) {
        deckWait = phase
        switch phase {
        case .ready:
            TrayLog.info("window: deck ready", ["seconds": Int(seconds)])
            reloadFailedTabs()
        case .unreachable(let reason):
            TrayLog.warn("window: deck unreachable", ["seconds": Int(seconds), "reason": reason])
        case .waiting:
            break
        }
        dismissSplashIfReady()
    }

    private func dismissSplashIfReady() {
        if splashContent == .dismiss { dismissSplash() }
    }

    /// Tabs mount under the splash, so one can fail against an app that
    /// was still starting before deck was ready.
    private func reloadFailedTabs() {
        for (name, failed) in loadFailures where failed { store.reload(name) }
    }
```

`dismissSplash()` (lines 218-238) stays as it is.

- [ ] **Step 5: Icons track in-flight fetches.** Replace lines 284-302 (the doc comment and `fetchIcon`) with:

```swift
    /// A failure is retried, and what came back is logged well enough to
    /// name the culprit: a byte count alone said only that it was not an
    /// image. A fresh catalog after a stale one asks again for any icon
    /// still missing, so one name is never fetched twice at once.
    private func fetchIcon(url urlString: String?, into name: String) {
        guard icons[name] == nil, !iconFetchesInFlight.contains(name),
              let urlString, let url = URL(string: urlString) else { return }
        iconFetchesInFlight.insert(name)
        Task { [weak self] in
            defer { self?.iconFetchesInFlight.remove(name) }
            for attempt in 1...Self.iconFetchAttempts {
                if let image = await Self.loadIcon(url: url, app: name, attempt: attempt) {
                    self?.icons[name] = image
                    return
                }
                guard attempt < Self.iconFetchAttempts else { return }
                try? await Task.sleep(nanoseconds: UInt64(Self.iconRetryDelay(attempt) * 1_000_000_000))
            }
        }
    }
```

- [ ] **Step 6: The badge poller keeps a stale catalog fetching.** In `BadgePoller.swift:29` replace `await model.ensureCatalogLoaded()` with `await model.refreshCatalogIfStale()`.

- [ ] **Step 7: Rewrite the tuning comment.** In `SplashView.swift` replace lines 27-28:

```swift
    // How long the splash is on screen, full stop: WindowModel dismisses on
    // this alone and waits on nothing else.
```

with:

```swift
    // The shortest time the splash is on screen: the animation's own length.
    // WindowModel holds it past this until deck is ready.
```

- [ ] **Step 8: Build and run every check.**

```
swift build --package-path rt-tray
swift run --package-path rt-tray mattstack-checks
```

Expected: build succeeds; `checks: <N + 30> passed, 0 failed` (N from Task 1: 13 deck wait, 7 deck agent, 10 window recovery). This full run executes the source guard over the three new check files.

- [ ] **Step 9: Commit.**

```
git add rt-tray/Sources/Window/WindowBackends.swift rt-tray/Sources/Window/WindowModel.swift rt-tray/Sources/Window/BadgePoller.swift rt-tray/Sources/Window/SplashView.swift
git commit -m "window: splash waits for deck healthz and a fresh catalog; stale catalog and icons re-fetch" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Splash spinner and "Can't reach deck"

**Files:**
- Modify: `rt-tray/Sources/Window/SplashView.swift:84-104`
- Modify: `rt-tray/Sources/Window/MattstackWindowView.swift:51-55`

**Interfaces:**
- Consumes: `SplashContent` (Task 2), `WindowModel.splashContent` and `retryDeckWait()` (Task 5).
- Produces: `SplashView(content: SplashContent, retry: @escaping () -> Void)`.

No new check: `SplashPresentation.content` (Task 2) decides what shows; this task only draws it. Task 9 is the check for how it reads.

- [ ] **Step 1: Draw the states.** In `SplashView.swift`, add below `glyphStrokeWidth` (line 55):

```swift
private let spinnerLead: CGFloat = 30
private let unreachableGap: CGFloat = 28
private let unreachableWidth: CGFloat = 420
```

Replace `struct SplashView` from its declaration through `body` (lines 84-104) with the block below; `layersGlyph` and `layer(_:delay:startOffset:)` (lines 106-129) stay as they are:

```swift
struct SplashView: View {
    let content: SplashContent
    let retry: () -> Void
    @State private var play = false

    private var markColor: Color { BundleFlavor.isDevBuild ? devMarkColor : prodMarkColor }
    private var strokeStyle: StrokeStyle { StrokeStyle(lineWidth: glyphStrokeWidth, lineCap: .round, lineJoin: .round) }

    var body: some View {
        ZStack {
            splashBackground.ignoresSafeArea()
            VStack(spacing: unreachableGap) {
                mark
                if case .unreachable(let reason) = content {
                    UnreachablePanel(reason: reason, retry: retry)
                        .frame(width: unreachableWidth)
                        .transition(.opacity)
                }
            }
            .animation(.easeOut(duration: 0.2), value: content)
        }
        // The background is the same dark in both appearances, so the
        // spinner and the Retry button need their dark variants.
        .environment(\.colorScheme, .dark)
        .onAppear { play = true }
    }

    /// The spinner rides in an overlay so its arrival never moves the mark.
    private var mark: some View {
        HStack(spacing: markGap) {
            // make-icon.swift draws "m" in a monospace font (SF
            // Mono / Menlo fallback), not the system UI font.
            Text("m")
                .font(.system(size: markFontSize, weight: .regular, design: .monospaced))
                .foregroundColor(markColor)
            layersGlyph
        }
        .overlay(alignment: .trailing) {
            if content == .markWithSpinner {
                ProgressView()
                    .controlSize(.small)
                    .offset(x: spinnerLead)
                    .transition(.opacity)
            }
        }
    }
```

Add after the closing brace of `SplashView` (end of file):

```swift
private struct UnreachablePanel: View {
    let reason: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text("Can't reach deck")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
            Text(reason)
                .font(.system(size: 12))
                .foregroundColor(.white.opacity(0.7))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            Button("Retry", action: retry)
                .keyboardShortcut(.defaultAction)
                .padding(.top, 4)
        }
    }
}
```

- [ ] **Step 2: Mount it.** In `MattstackWindowView.swift` replace line 52 `SplashView()` with:

```swift
                SplashView(content: model.splashContent, retry: { model.retryDeckWait() })
```

- [ ] **Step 3: Build and run every check.**

```
swift build --package-path rt-tray
swift run --package-path rt-tray mattstack-checks
```

Expected: build succeeds, 0 failed.

- [ ] **Step 4: Commit.**

```
git add rt-tray/Sources/Window/SplashView.swift rt-tray/Sources/Window/MattstackWindowView.swift
git commit -m "splash: spinner beside the mark while deck starts; can't-reach panel with reason and Retry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: A main-frame 5xx shows the failure overlay, and Retry reloads

**Files:**
- Modify: `rt-tray/Sources/Window/WindowModel.swift:14-46` (`WindowNavigationDelegate`)
- Modify: `rt-tray/Sources/Window/WebViewStore.swift:16-17, 43, 50`

**Interfaces:**
- Consumes: `MainFrameResponse.verdict`, `WindowReload.action` (Task 4); `TrayLog.warn` (`Sources/TrayLog.swift:16`).
- Produces: `WebViewStore.noteFailedLoad(_ name: String, url: URL?)`, `WebViewStore.noteLoaded(_ name: String)`, `WebViewStore.reload(_ name: String)` (same signature, new behavior); `WindowNavigationDelegate.webView(_:decidePolicyFor:decisionHandler:)` for `WKNavigationResponse`.

Pinned by Task 4's "window recovery" checks (Review Focus 5 and the subframe check).

- [ ] **Step 1: The store remembers what failed and where home is.** In `WebViewStore.swift`, after line 17 add:

```swift
    private var homeURLs: [String: URL] = [:]
    private var failedURLs: [String: URL] = [:]
```

Replace line 43 (`if let url = URL(string: app.url) { view.load(URLRequest(url: url)) }`) with:

```swift
        if let url = URL(string: app.url) {
            homeURLs[app.name] = url
            view.load(URLRequest(url: url))
        }
```

Replace line 50 (`func reload(_ name: String) { views[name]?.reload() }`) with:

```swift
    func noteFailedLoad(_ name: String, url: URL?) {
        if let url { failedURLs[name] = url }
    }

    func noteLoaded(_ name: String) { failedURLs[name] = nil }

    func reload(_ name: String) {
        guard let view = views[name] else { return }
        switch WindowReload.action(failedURL: failedURLs.removeValue(forKey: name),
                                   hasCommittedPage: view.backForwardList.currentItem != nil,
                                   home: homeURLs[name]) {
        case .reload: view.reload()
        case .load(let url): view.load(URLRequest(url: url))
        case .nothing: break
        }
    }
```

- [ ] **Step 2: The delegate fails the tab on a main-frame 5xx.** In `WindowModel.swift`, update the class doc comment's first sentence (line 14) to read `/// Reports a webview's failed navigation (a transport error or a main-frame` and `/// 5xx) back into the model keyed by app name, and intercepts cross-app links`, keeping the rest of the comment. Replace the two handlers at lines 30-33 and 43-46 with:

```swift
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        model?.store.noteFailedLoad(appName, url: (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL)
        model?.loadFailures[appName] = true
        model?.loadingApps.remove(appName)
    }
```

```swift
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        model?.store.noteLoaded(appName)
        model?.loadFailures[appName] = false
        model?.loadingApps.remove(appName)
    }

    /// WebKit treats any HTTP answer as a finished navigation, so without
    /// this a portless 502 page for an app that is not up yet sits in the
    /// tab with no overlay and no retry.
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let http = navigationResponse.response as? HTTPURLResponse
        guard case .fail(let status) = MainFrameResponse.verdict(isMainFrame: navigationResponse.isForMainFrame,
                                                                  status: http?.statusCode) else {
            decisionHandler(.allow)
            return
        }
        TrayLog.warn("window main-frame 5xx", [
            "app": appName, "status": status,
            "url": http?.url?.absoluteString ?? "(none)",
            "server": http?.value(forHTTPHeaderField: "Server") ?? "(none)",
        ])
        model?.store.noteFailedLoad(appName, url: http?.url)
        model?.loadFailures[appName] = true
        model?.loadingApps.remove(appName)
        decisionHandler(.cancel)
    }
```

The cancel makes WebKit report a provisional failure as well; the handler above sets the same state, so the order does not matter.

- [ ] **Step 3: Build and run every check.**

```
swift build --package-path rt-tray
swift run --package-path rt-tray mattstack-checks
```

Expected: build succeeds, 0 failed.

- [ ] **Step 4: Commit.**

```
git add rt-tray/Sources/Window/WindowModel.swift rt-tray/Sources/Window/WebViewStore.swift
git commit -m "window: main-frame 5xx shows the failure overlay and is logged; Retry reloads the failed URL" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: DEBUG `--window-preview` harness

**Files:**
- Create: `rt-tray/Sources/Window/WindowPreview.swift`
- Modify: `rt-tray/Sources/main.swift:12-14`

**Interfaces:**
- Consumes: `WindowBackends` memberwise init and `WindowModel.init(backends:)` (Task 5), `MattstackWindowView` (unchanged signature), `DeckAgentDiagnosis.describe` (Task 3), F's `LaunchdPrint.parse`, `SplashTuning.minimumVisibleDuration`.
- Produces: `rt-tray --window-preview <waiting|ready|tab-5xx> --port <n> [--appearance dark|light] [--deadline <seconds>] [--capture-dir <dir>]` in DEBUG builds only. With `--capture-dir` it writes `<scenario>-<state>-<appearance>.png` files and exits; without it the window stays open until ⌘Q.

A scratch build of the whole app cannot be used to look at this: it shares the dev bundle id and launchd labels, and on a Mac another flavor owns it stands down or takes over (the same reason `FindBarPreview.swift:9-14` exists). This mode boots none of the tray and never touches a launchd job.

- [ ] **Step 1: Write the harness.** Create `rt-tray/Sources/Window/WindowPreview.swift`:

```swift
#if DEBUG
import AppKit
import MattstackCore
import SwiftUI

/// `rt-tray --window-preview <waiting|ready|tab-5xx> --port <n>
/// [--appearance dark|light] [--deadline <seconds>] [--capture-dir <dir>]`
///
/// The real window view and model against a scripted deck, for looking at
/// the splash states and the tab failure overlay. A scratch build of the app
/// cannot open a second mattstack window on a Mac another flavor owns, and
/// the real app registers launchd jobs, so this mode boots none of the tray.
/// Apps come from a local server on `--port` answering /ok with a page,
/// /fail with a 502 and /icon.svg with an icon.
@MainActor
enum WindowPreview {
    private static var window: NSWindow!
    private static var model: WindowModel!

    private struct Options {
        var scenario = "waiting"
        var appearance = "dark"
        var port = 18777
        var deadline: TimeInterval = 20
        var captureDir: String?

        init(_ args: [String]) {
            func value(_ flag: String) -> String? {
                guard let i = args.firstIndex(of: flag), args.indices.contains(i + 1) else { return nil }
                return args[i + 1]
            }
            scenario = value("--window-preview") ?? scenario
            appearance = value("--appearance") ?? appearance
            port = value("--port").flatMap { Int($0) } ?? port
            deadline = value("--deadline").flatMap { TimeInterval($0) } ?? deadline
            captureDir = value("--capture-dir")
        }
    }

    private struct ScriptedFetcher: AppListFetching {
        let json: Data
        let deckUp: @Sendable () -> Bool
        func fetchAppsJSON() async throws -> Data {
            guard deckUp() else { throw URLError(.badServerResponse) }
            return json
        }
    }

    private static let crashedPrint = "\tstate = not running\n\tlast exit code = 78: EX_CONFIG\n"

    static func run(arguments: [String]) -> Never {
        let options = Options(arguments)
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        app.appearance = NSAppearance(named: options.appearance == "light" ? .aqua : .darkAqua)
        installMenu()

        let started = ProcessInfo.processInfo.systemUptime
        let readyAfter: TimeInterval = options.scenario == "waiting" ? .infinity : 4
        let deckUp: @Sendable () -> Bool = { ProcessInfo.processInfo.systemUptime - started >= readyAfter }
        let base = "http://127.0.0.1:\(options.port)"
        let rtDir = AppHome.current + "/.mattstack/rt"
        let cachePath = rtDir + "/window-apps-cache.json"
        let json = appsJSON(base: base, failFirst: options.scenario == "tab-5xx")
        try? FileManager.default.createDirectory(atPath: rtDir, withIntermediateDirectories: true)
        // Seeded so the first active tab is a scripted app: an empty catalog
        // falls back to the deck tab, which would load this Mac's real deck.
        try? json.write(to: URL(fileURLWithPath: cachePath))

        model = WindowModel(backends: WindowBackends(
            catalog: AppCatalog(fetcher: ScriptedFetcher(json: json, deckUp: deckUp), cachePath: cachePath),
            deckFaviconURL: base + "/icon.svg",
            deckProbe: { deckUp() ? .healthy(pid: "preview") : .answered(status: 502) },
            diagnoseDeckAgent: {
                DeckAgentDiagnosis.describe(label: "com.mattstack.deck", registration: .enabled,
                                            lookup: LaunchdPrint.parse(CommandOutcome(exitCode: 0, stdout: crashedPrint,
                                                                                      stderr: "")))
            },
            deckWaitDeadline: options.deadline))

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.contentViewController = NSHostingController(rootView: MattstackWindowView(model: model))
        // Re-applied after the hosting controller collapses the window to its
        // content's fitting size (the trap MattstackWindowController notes).
        window.setContentSize(NSSize(width: 1280, height: 820))
        window.center()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        model.presentSplashIfNeeded()
        Task { await model.ensureCatalogLoaded() }
        Task { if await capture(options) { exit(0) } }
        app.run()
        exit(0)
    }

    private static func appsJSON(base: String, failFirst: Bool) -> Data {
        let ok = #"{"name":"board","displayName":"Board","description":null,"url":"\#(base)/ok","icon":"\#(base)/icon.svg"}"#
        let fail = #"{"name":"chat","displayName":"Chat","description":null,"url":"\#(base)/fail","icon":"\#(base)/icon.svg"}"#
        let apps = failFirst ? [fail, ok] : [ok, fail]
        return Data(#"{"apps":[\#(apps.joined(separator: ","))]}"#.utf8)
    }

    private static func capture(_ options: Options) async -> Bool {
        guard let dir = options.captureDir else { return false }
        func shoot(_ state: String) {
            let path = "\(dir)/\(options.scenario)-\(state)-\(options.appearance).png"
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            process.arguments = ["-x", "-o", "-l", String(window.windowNumber), path]
            try? process.run()
            process.waitUntilExit()
            print("captured \(path) exit \(process.terminationStatus)")
            fflush(stdout)
        }
        switch options.scenario {
        case "waiting":
            await pause(0.5)
            shoot("splash")
            await pause(SplashTuning.minimumVisibleDuration + 1)
            shoot("spinner")
            await waitFor { if case .unreachable = model.deckWait { return true } else { return false } }
            await pause(0.6)
            shoot("cant-reach")
        default:
            await waitFor { model.deckWait == .ready }
            await pause(3)
            shoot(options.scenario == "tab-5xx" ? "failure" : "loaded")
        }
        return true
    }

    private static func pause(_ seconds: TimeInterval) async {
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }

    private static func waitFor(_ condition: () -> Bool) async {
        var polls = 0
        while !condition(), polls < 1200 {
            await pause(0.1)
            polls += 1
        }
    }

    private static func installMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = main
    }
}
#endif
```

- [ ] **Step 2: Route the flag.** In `main.swift`, after the `--find-bar-preview` block (after line 14, still inside `#if DEBUG`), add:

```swift
if CommandLine.arguments.contains("--window-preview") {
    MainActor.assumeIsolated { WindowPreview.run(arguments: CommandLine.arguments) }
}
```

- [ ] **Step 3: Build a release config too, to prove the harness is DEBUG only.**

```
swift build --package-path rt-tray
swift build --package-path rt-tray -c release --product rt-tray
swift run --package-path rt-tray mattstack-checks
```

Expected: both builds succeed; 0 failed.

- [ ] **Step 4: Commit.**

```
git add rt-tray/Sources/Window/WindowPreview.swift rt-tray/Sources/main.swift
git commit -m "tray: DEBUG --window-preview harness for the splash states and the 5xx overlay" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: UI validation in both appearances

**Files:** none committed. Scratch files live in your session scratchpad directory, written below as `<scratch>` (use the absolute path).

**Interfaces:** Consumes the debug binary `rt-tray/.build/debug/rt-tray` from Task 8. Produces ten PNGs and an honest notes block for the PR body.

- [ ] **Step 1: Write the app server.** With the Write tool, create `<scratch>/preview-server.py`:

```python
import http.server
import sys

ICON = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="#ff6b9d"/></svg>'
PAGE = b"<html><body style='font:16px -apple-system;padding:40px'><h1>preview app</h1><p>Loaded.</p></body></html>"
FAIL = b"<html><body>502 Bad Gateway</body></html>"


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/icon.svg":
            self.send(200, "image/svg+xml", ICON)
        elif self.path.startswith("/fail"):
            self.send(502, "text/html", FAIL)
        else:
            self.send(200, "text/html", PAGE)

    def send(self, code, content_type, body):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
```

Start it with Bash `run_in_background: true`: `python3 <scratch>/preview-server.py 18777`. (Plain http to 127.0.0.1 from an unbundled binary was checked on this Mac on 2026-09-24 and is not blocked by ATS.)

- [ ] **Step 2: Make the isolated HOME and output dir.**

```
mkdir -p <scratch>/g-preview-home
mkdir -p <scratch>/g-shots
```

- [ ] **Step 3: Capture six runs**, each as its own Bash call with a 120000ms timeout. Every run exits by itself once its captures are written:

```
env -i HOME=<scratch>/g-preview-home PATH=/usr/bin:/bin rt-tray/.build/debug/rt-tray --window-preview waiting --appearance dark --port 18777 --deadline 20 --capture-dir <scratch>/g-shots
env -i HOME=<scratch>/g-preview-home PATH=/usr/bin:/bin rt-tray/.build/debug/rt-tray --window-preview waiting --appearance light --port 18777 --deadline 20 --capture-dir <scratch>/g-shots
env -i HOME=<scratch>/g-preview-home PATH=/usr/bin:/bin rt-tray/.build/debug/rt-tray --window-preview ready --appearance dark --port 18777 --capture-dir <scratch>/g-shots
env -i HOME=<scratch>/g-preview-home PATH=/usr/bin:/bin rt-tray/.build/debug/rt-tray --window-preview ready --appearance light --port 18777 --capture-dir <scratch>/g-shots
env -i HOME=<scratch>/g-preview-home PATH=/usr/bin:/bin rt-tray/.build/debug/rt-tray --window-preview tab-5xx --appearance dark --port 18777 --capture-dir <scratch>/g-shots
env -i HOME=<scratch>/g-preview-home PATH=/usr/bin:/bin rt-tray/.build/debug/rt-tray --window-preview tab-5xx --appearance light --port 18777 --capture-dir <scratch>/g-shots
```

Expected per run: `captured <path> exit 0` lines (3 for waiting, 1 otherwise), ten PNGs in total. If a PNG shows only the desktop or is blank, the terminal lacks Screen Recording permission: stop and report it; do not work around it.

- [ ] **Step 4: Confirm the 5xx log line** landed in the isolated HOME, not the real one:

```
grep -rh "window main-frame 5xx" <scratch>/g-preview-home/.mattstack/rt/logs
```

Expected: at least two lines naming `chat` and status `502` (one per tab-5xx run, plus the reload when deck turns ready).

- [ ] **Step 5: Look at every PNG** with the Read tool and write one honest line each, saying plainly what looks wrong, not only what works. At minimum answer:
  - `waiting-splash-*`: mark centered, no spinner.
  - `waiting-spinner-*`: spinner right of the layers glyph; the mark sits where it did in `waiting-splash-*`; the spinner is visible in the light run.
  - `waiting-cant-reach-*`: headline, reason wraps inside ~420pt and names `last exit code 78` and `HTTP 502`; the Retry button reads in both runs; how far the mark jumped up when the panel appeared.
  - `ready-loaded-*`: tab icons are the pink squares (not letters), the deck mini dot is green, the Board page shows.
  - `tab-5xx-failure-*`: "Can't reach Chat" with Retry over the tab; what is behind the card (blank white in light?).
  If something reads wrong and the fix is a spacing or color constant in `SplashView.swift` or `MattstackWindowView.swift`, fix it, rebuild (`swift build --package-path rt-tray`), recapture the affected runs, commit with message `splash: <what changed>` plus the trailer, and keep the before and after lines in the notes.

- [ ] **Step 6: Stop the server** (`pkill -f preview-server.py`) and keep the PNG paths for the PR body and the final report.

---

### Task 10: Push and open the PR

**Files:** none.

- [ ] **Step 1: Final gates, on the tree rebased onto a main that holds F.** No PR workflow builds Swift (`checks.yml` has no swift step; only `release.yml` builds the tray), so this local run is the only thing that catches a clash with F before the release build does.

```
git fetch origin
git rebase origin/main
git log --oneline -1 origin/main -- rt-tray/Sources-core/Services/LaunchdJob.swift
swift build --package-path rt-tray
swift run --package-path rt-tray mattstack-checks
git status --short
```

Expected: the rebase applies cleanly (keep both appends if `AllChecks.swift` conflicts; if Task 1 cherry-picked F's commit, the rebase drops it as already applied), the log names F's commit, the build succeeds, the checks print 0 failed (the full run includes the source guard), and the tree is clean. Also run the dash check over the whole branch: `git diff origin/main -- rt-tray > <scratch>/g-diff.txt`, then `perl -CSD -ne 'print if /^\+.*[\x{2013}\x{2014}]/' <scratch>/g-diff.txt` must print nothing. If the rebase changed anything after a push, push again with `git push --force-with-lease`.

- [ ] **Step 2: Push.** `git push -u origin rt-2-13-g-window-waits-for-deck`

- [ ] **Step 3: Write the PR body** with the Write tool to `<scratch>/g-pr-body.md`:

```markdown
## Window waits for deck (RT-283, spec section G)

The splash now holds until deck's /healthz answers and a fresh catalog loads, bounded at 90s, and a tab that gets a main-frame 5xx shows the failure overlay instead of the portless 502 page.

### What changed

**Core** (`rt-tray/Sources-core/Window/`)

- `DeckWait.swift`: the wait loop (clock-read deadline, injected probe and catalog), healthz classification keyed on `x-deck-pid`, splash presentation.
- `DeckAgentDiagnosis.swift`: the Can't-reach reason from SMAppService status and the launchd print parser unit F added (`LaunchdPrint`), with no second parser.
- `WindowRecovery.swift`: 5xx verdict, reload action, active tab after a catalog swap, icon re-fetch targets.

**Window** (`rt-tray/Sources/Window/`)

- `WindowModel` waits for deck, refreshes a stale catalog, re-fetches missing icons once it is fresh, reloads failed tabs when deck turns ready.
- `SplashView` shows a spinner beside the mark after the animation and a Can't-reach panel with the reason and Retry.
- `WindowNavigationDelegate` fails the tab on a main-frame 5xx and logs `window main-frame 5xx`; Retry now loads the failed URL.
- DEBUG `--window-preview` harness for screenshots without launchd.

AppDelegate is untouched (unit F owns launch ordering).

### UI validation

<one line per screenshot from Task 9 Step 5, including what looks wrong>

Screenshots: `<scratch>/g-shots/` (ten PNGs, dark and light).

### Tests

- 30 new checks across `DeckWaitChecks`, `DeckAgentDiagnosisChecks`, `WindowRecoveryChecks`; `swift build` and the full `mattstack-checks` green on the tree rebased onto main with unit F.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Fill the UI validation lines from Task 9; the last line of the body must stay exactly the Generated-with line.

- [ ] **Step 4: Open the PR.**

```
gh pr create --base main --head rt-2-13-g-window-waits-for-deck --title "tray: window waits for deck, 5xx tabs show the failure overlay (RT-283)" --body-file <scratch>/g-pr-body.md
```

- [ ] **Step 5: Review loop.** Wait for CodeRabbit (or, if it is rate limited, run an Opus review) and CI; address every actionable finding with a commit per fix, then report the PR URL, the check counts and the screenshot paths. Merge follows the release authority in the spec.

---

## Contract notes

- **Shared contracts 1 to 6 and 8 are not consumed here.** Unit G reads nothing from deps.lock, `Contents/Resources`, the bundle catalog or deck's registry. Its only contract with deck is `/healthz` answering 200 with `x-deck-pid` (`mattstack-apps/apps/deck/src/api/server.ts:338-344`) and the unchanged `/api/apps` shape. Unit B must keep that header; if it drops it, the splash waits the full 90s on every launch.
- **Contract 6 has a visible effect here:** once unit B hides not-served rows from `/api/apps`, the stale-then-fresh refresh drops them live (the dev cache's `gitq` tab disappears without a relaunch). `CatalogRefresh.activeApp` moves the active tab off a removed app; pinned in Task 4.
- **Contract 7:** branch `rt-2-13-g-window-waits-for-deck`, one PR.
- **"Scratch dev build" refined:** the screenshots come from the worktree's debug build in `--window-preview` mode, not from a scratch `mattstack-dev.app`. A scratch dev bundle has the blessed dev app's bundle id and launchd labels, so launching it either stands down against the live flavor or registers agents over Matt's; `FindBarPreview.swift:9-14` records the same trap.
- **Clean install lands on the first app, not deck:** today an empty catalog makes the deck tab active for the whole session (`WindowModel.swift:162`). The spec's success line wants each app tab showing on first launch, so a deck tab chosen only by that fallback gives way to the first app once a fresh catalog arrives; a deck tab the user picked stays. Pinned in Task 4.
- **Deadline start:** the 90s runs from the window's first show (the splash only exists then), not from app launch. A window opened after deck is up passes the wait on the first probe and behaves as today.
- **Deep links:** `open(_:)` still resolves from `ensureCatalogLoaded()` alone, so the tray.sock `/window/open` 300ms budget (`AppDelegate.swift:505-508`) is unaffected; the splash then covers the deep-linked tab until deck is ready.
- **Overlap with unit F, settled:** F owns the launchd print parser (`LaunchdJobSnapshot`, `LaunchdJobLookup`, `LaunchdPrint` in `Sources-core/Services/LaunchdJob.swift`, F Task 1). G reuses it for the deck agent diagnosis and declares no parser, argv or exit-113 constant of its own (the repo's "lift, don't duplicate" rule; two `public struct LaunchdJobSnapshot` in `MattstackCore` would not compile). The reason string therefore renders F's `lastExitCode: Int` (`last exit code 78`, without the `: EX_CONFIG` suffix). `DeckHealth.classify` stays here: F's deck probe is `deck list`, not `/healthz`.

**Depends on:** unit F merged (or, until it lands, F's Task 1 commit cherry-picked; see Task 1 Step 1). G merges after F, and as the second of the two it runs `swift build` and the full `mattstack-checks` on the tree rebased onto that main before merging (Task 10 Step 1). The one-line append in `Tests/MattstackCoreChecks/AllChecks.swift` keeps both on conflict.
