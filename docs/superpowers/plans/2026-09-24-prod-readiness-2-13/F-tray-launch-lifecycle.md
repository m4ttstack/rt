# Unit F: tray launch lifecycle (settled re-register, spawn-health heal, answer-gated records) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A prod launch whose daemon (or deck helper) launchd refuses to spawn heals itself with one unregister/register cycle; a re-register runs the sequence that recovered the daemon on 2026-09-25 (synchronous unregister, settle, register, start once); plist hashes and the app version are recorded only after the agents actually answer; and a version change no longer `kickstart -k`s agents bootstrapped on this same launch, and runs `deck restart --managed` only once, after deck has answered and the version record is written, never gating that record on it.

**Architecture:** Every decision is a pure function in `rt-tray/Sources-core/Services` (target `MattstackCore`) with `MattstackCoreChecks` coverage: a `launchctl print` parser (`LaunchdJob.swift`), the heal verdict and a once-per-launch latch (`AgentSpawnHealth.swift`), the bounded answer wait and the settle driver that waits, decides and heals (`LaunchSettle.swift`), and the record rules (`LaunchRecording.swift`: which jobs were bootstrapped this launch, which hashes wait for an answer, when the version is recorded). `AgentReregister.run` gains `settle` and `start` steps. The app target only wires SMAppService, `launchctl`, the daemon ping and `deck list` into those seams: `ServicesRegistrar` (launch pass, version change, probes, records), `DaemonLifecycle` (sync unregister, gated heal), `AppDelegate` (launch Task order).

**Tech Stack:** Swift 5.9 package `rt-tray` (macOS 14), ServiceManagement (`SMAppService`), `launchctl` via the `CommandRunner` seam, the `mattstack-checks` harness.

**Spec:** /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/faramir/docs/superpowers/specs/2026-09-24-prod-readiness-2-13-design.md (section F)

---

## Global Constraints

- **Worktree.** Work in a fresh rt worktree, never in `~/Documents/GitHub/repo-tools` (shared checkout, read only) or `~/Documents/GitHub/mattstack-apps` (read only). Branch: `rt-2-13-f-tray-launch-lifecycle` from `origin/main`. Task 0 sets it up, including the `rt-tray/deps` and `rt-tray/vm/.cache` copies Swift builds need.
- **Worktree Bash guard.** An EnterWorktree session refuses heredocs, `&&` chains, `git -C`, `cd <dir> && ...` and shell loops. Run one plain command per Bash call, from the worktree root. Swift commands take `--package-path rt-tray`. Commit with repeated `-m` flags, never a heredoc.
- **TDD.** Every code task: write the failing check first, run it and see the named failure (for Swift that is usually a compile error naming the missing symbol), write the code, run it green.
- **Targeted verification only.** `swift build --package-path rt-tray` and `swift run --package-path rt-tray mattstack-checks "<filter>"` (the filter is a substring of check names; a filter that matches nothing is itself a failure, see `rt-tray/Tests/MattstackCoreChecks/Harness.swift:84-92`). The last code task runs `swift run --package-path rt-tray mattstack-checks` with no filter (the tray's own suite). Never run `bun run test`, `test:e2e`, `test:pty` or `test:all`; CI runs them. No TypeScript changes in this unit.
- **No live launchd runs.** Never build, sign, install or launch an app bundle from this unit, and never run a built `rt`, deck or app binary except under `env -i HOME=<tmp> ...` (this unit has no reason to run one). Registering a scratch app's agents would clobber the real `com.mattstack.*` labels on Matt's Mac. Never touch `/Applications/*.app` or `rt-tray/mattstack-dev.app`. The real-launchd proof of this unit is unit H's VM check and the release walkthrough.
- **No UI change.** Nothing here renders; the UI-validation rule does not apply. Say so in the PR.
- **Source guard.** `rt-tray/Tests/MattstackCoreChecks/SourceGuardChecks.swift:10` fails any check file that contains `/bin/launchctl`, `launchctl ` (with a trailing space), `pkill`, `tccutil`, `osascript`, `/usr/bin/open` or `SystemCommandRunner(`. Check names, comments and fixtures in check files say "launchd print" or "launchd's control tool", never the tool's name followed by a space. Argv checks assert `exe.hasPrefix("/bin/") && exe.hasSuffix("ctl")` the way `ServicesChecks.swift:34-37` does.
- **Comments.** Clean-code only: a comment states a constraint the code cannot show. No narration, no ticket ids, no decision history. No em or en dashes anywhere (code, comments, commits, PR body). When you rewrite an existing comment that contains one (for example `AppDelegate.swift:222`), remove it.
- **Commits.** One commit per task. The last `-m` is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Lifecycle gate.** Any unregister/register of the daemon, and the deck helper's heal, goes through `DaemonLifecycleGate` (`rt-tray/Sources-core/Services/DaemonLifecycleGate.swift:115`), so a `/daemon/start` herd parks behind it and a flavor retire's latch (`:181-189`) skips it.

## Review Focus

Five failure modes the spec implies that no current test covers. Each is pinned by a check in the task named.

1. **A running job whose print still carries a failure.** A healthy daemon prints `last exit code = 1` from an earlier run, and its coalition blocks repeat `state = active` one tab deeper. The parser must read only the job's own top-level fields, and the heal must never touch a job that has a `pid`. Pinned in Task 1 (healthy capture, nested-block check) and Task 2 (running job left, even with exit 78).
2. **A print shape the parser does not know** (launchctl failing for another reason, a macOS release that renames fields, `last exit code = (never exited)`). It must read as unknown or partial and never produce a heal on a guess. Pinned in Task 1 (unknown shapes) and Task 2 (unknown is left).
3. **BTM says enabled, launchd holds no job.** That is the state `rt flavor takeover`'s plain `launchctl bootout` leaves the other flavor in (`commands/flavor.ts:171-176`). The version-change `kickstart -k` fails on it, the heal must re-register it, and the version must still be recorded once it answers. Pinned in Task 2 (not-loaded heals) and Task 5 (a failed kickstart is forgiven only when that agent was healed).
4. **An agent bootstrapped on this launch** (re-registered for a changed plist, or registered fresh from `notRegistered` after `rt daemon uninstall`). The version change must not `kickstart -k` it (the kill waits out the plist's `ExitTimeOut`, 30s at `rt-tray/LaunchAgent-deck.plist:22-23`), while a failed re-register must still be kickstarted. Pinned in Task 5 (`summarize`, `kickstartLabels`).
5. **A re-register SMAppService reports `enabled` but whose job never answers** (the 2026-09-25 failure: `ServicesRegistrar.swift:71-72` recorded the hash on that report). The hash must stay unrecorded so the next launch tries again, and a heal must run at most once per label per launch however often the settle runs. Pinned in Task 4 (latch across two runs) and Task 5 (held hash).

Also pinned: the order unregister, settle, register, start (Task 3), a failed heal not being waited on (Task 4), the answer budgets staying bounded (Task 4), and the one post-settle `deck restart --managed` running only on a changed version whose deck answered, independent of the version record (Task 5). That restart is the safety net for a binary-only Sparkle update: deck's sweep sees the same argv, cwd and env, reports every served plist `unchanged`, and never kickstarts them, so without it the served apps keep running the deleted old `Helpers` binary.

## Files

| Path | Change | Task |
|---|---|---|
| `rt-tray/Sources-core/Services/LaunchdJob.swift` | new: `LaunchdJobSnapshot`, `LaunchdJobLookup`, `LaunchdPrint` (argv + pure parser) | 1 |
| `rt-tray/Tests/MattstackCoreChecks/LaunchdPrintFixtures.swift` | new: real healthy capture, derived refused-spawn and crashed shapes, not-found text | 1 |
| `rt-tray/Tests/MattstackCoreChecks/AgentSpawnHealthChecks.swift` | new: parser and heal-verdict checks | 1, 2 |
| `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift` | register `agentSpawnHealthChecks`, `launchLifecycleChecks` | 1, 4 |
| `rt-tray/Sources-core/Services/AgentSpawnHealth.swift` | new: `SpawnHealVerdict`, `AgentSpawnHealth.decide`, `SpawnHealLatch` | 2 |
| `rt-tray/Sources-core/Services/AgentPlistRefresh.swift` | `AgentReregister.run` gains `settle` and `start`; `settleNanoseconds` | 3 |
| `rt-tray/Sources-core/Services/ServicePlists.swift` | `StartJob` (3); `DeckProbe` beside the kept `DeckRestart` (6) | 3, 6 |
| `rt-tray/Sources-core/Services/ServiceModels.swift` | `ServicesProviding.start(label:)` | 3 |
| `rt-tray/Sources/DebugStubProviders.swift` | stub `start(label:)` | 3 |
| `rt-tray/Tests/MattstackCoreChecks/TrayRoutesChecks.swift` | `FakeServices.start(label:)` | 3 |
| `rt-tray/Tests/MattstackCoreChecks/AgentPlistRefreshChecks.swift` | reregister checks for the new sequence | 3 |
| `rt-tray/Tests/MattstackCoreChecks/ServicesChecks.swift` | `StartJob` argv (3); `DeckProbe` argv, `DaemonOrigin.spawnHeal` (6) | 3, 6 |
| `rt-tray/Sources/DaemonLifecycle.swift` | sync unregister + settle + start in re-register and the restart fallback (3); `runGated` (6) | 3, 6 |
| `rt-tray/Sources/Services/ServicesRegistrar.swift` | agent re-register sequence, `start(label:)` (3); launch pass, version change, probes, settle, records (6) | 3, 6 |
| `rt-tray/Sources-core/Services/LaunchSettle.swift` | new: `AnswerBudget`, `AgentAnswerWait`, `LaunchAgentProbe`, `LaunchSettleReport`, `LaunchSettleEvent`, `LaunchSettle` | 4 |
| `rt-tray/Tests/MattstackCoreChecks/LaunchLifecycleChecks.swift` | new: settle and record checks | 4, 5 |
| `rt-tray/Sources-core/Services/LaunchRecording.swift` | new: `AgentRole`, `LaunchAgentOutcome`, `LaunchRegistration`, `VersionChangeProgress`, `LaunchRecordPlan`, `LaunchRecording` (including `restartsServedApps`) | 5 |
| `rt-tray/Sources-core/Services/DaemonLifecycleGate.swift` | `DaemonOrigin.spawnHeal` | 6 |
| `rt-tray/Sources/AppDelegate.swift` | launch Task order (`:205-236`), `spawnHealLatch`, `settleAgentsAfterLaunch` (records, then the one post-settle served-app restart) | 6 |

Not changed, by decision (see Contract notes 2 and 3): `rt-tray/Sources-core/Services/DevBuild.swift:160-171` and `lib/release/update-machine.ts` (dev-bundle leg `:531-548`, served-suite leg `:588-597`).

---

### Task 0: Worktree and Swift build inputs

**Files:** none committed.

- [ ] **Step 1: Provision the tree.** Use EnterWorktree in name mode with the name `rt-2-13-f-tray-launch-lifecycle` (the rt hook provisions it through `rt worktree provision`; see the rt:worktree skill). Do not hand-roll `git worktree add`.
- [ ] **Step 2: Put it on the right branch.**

Run: `git branch --show-current`
If it prints anything other than `rt-2-13-f-tray-launch-lifecycle`, run `git fetch origin main`, then `git switch -c rt-2-13-f-tray-launch-lifecycle origin/main`.

Run: `git log --oneline -1`
Expected: the current `origin/main` head (at planning time `a85d65e2e`; a later main is fine).

- [ ] **Step 3: Copy the gitignored Swift inputs from the shared checkout (read only there).**

Run: `cp -R /Users/matt/Documents/GitHub/repo-tools/rt-tray/deps rt-tray/`
Run: `mkdir -p rt-tray/vm/.cache`
Run: `cp -p /Users/matt/Documents/GitHub/repo-tools/rt-tray/vm/.cache/id_ed25519 rt-tray/vm/.cache/`
Run: `cp -p /Users/matt/Documents/GitHub/repo-tools/rt-tray/vm/.cache/id_ed25519.pub rt-tray/vm/.cache/`
Run: `git status --short`
Expected: empty (both dirs are gitignored).

- [ ] **Step 4: Baseline.**

Run: `swift build --package-path rt-tray`
Expected: `Build complete!`

Run: `swift run --package-path rt-tray mattstack-checks`
Expected: `checks: N passed, 0 failed`. Note N; later tasks only add checks.

---

### Task 1: a pure parser for `launchctl print`

**Files:**
- Create: `rt-tray/Sources-core/Services/LaunchdJob.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/LaunchdPrintFixtures.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/AgentSpawnHealthChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift:3`

**Interfaces:**
- Consumes: `CommandOutcome` (`rt-tray/Sources-core/Services/CommandRunner.swift:3-11`).
- Produces:
  - `public struct LaunchdJobSnapshot: Equatable, Sendable { var state: String?; var jobState: String?; var lastExitCode: Int?; var pid: Int?; var properties: [String] }` with `public init(state: String? = nil, jobState: String? = nil, lastExitCode: Int? = nil, pid: Int? = nil, properties: [String] = [])`
  - `public enum LaunchdJobLookup: Equatable, Sendable { case loaded(LaunchdJobSnapshot); case notLoaded; case unknown(String) }`
  - `public enum LaunchdPrint { static let notFoundExitCode: Int32; static func arguments(label: String, uid: uid_t) -> (String, [String]); static func parse(_ outcome: CommandOutcome) -> LaunchdJobLookup }`
  - `enum LaunchdPrintFixtures { static let healthy, refusedSpawn, crashedOnItsOwn, notFound: String }` (check target only)
  - `let agentSpawnHealthChecks: [Check]`

The healthy fixture is a real capture (`print gui/501/com.mattstack.daemon`, prod 2.12.0, 2026-09-24). The broken job's full print was not kept; Matt read four fields off it (`last exit code = 78: EX_CONFIG`, `job state = spawn failed`, `state` not running, `properties` with `needs LWCR update`), so `refusedSpawn` is derived from the real capture by replacing exactly those top-level lines. A check pins that every replacement landed.

- [ ] **Step 1: Write the fixtures.** Create `rt-tray/Tests/MattstackCoreChecks/LaunchdPrintFixtures.swift`:

```swift
import Foundation

/// launchd print output for com.mattstack.daemon. Tabs are escapes because
/// the parser keys on them and an editor may expand real ones.
enum LaunchdPrintFixtures {
    /// A healthy prod 2.12.0 job, captured 2026-09-24. `last exit code = 1`
    /// is left over from an earlier run while the current one is up.
    static let healthy = """
    gui/501/com.mattstack.daemon = {
    \tactive count = 1
    \tpath = (submitted by smd.543)
    \ttype = Submitted
    \tmanaged_by = com.apple.xpc.ServiceManagement
    \tstate = running

    \tprogram identifier = Contents/MacOS/rt (mode: 2)
    \tparent bundle identifier = com.mattstack.app
    \tparent bundle version = 2012000
    \tBTM uuid = E7BBB141-9DDD-4DBB-8EF1-51C7BFB507A9
    \targuments = {
    \t\tContents/MacOS/rt
    \t\t--daemon
    \t}

    \tinherited environment = {
    \t\tSSH_AUTH_SOCK => /var/run/com.apple.launchd.TzpwIuqAEF/Listeners
    \t}

    \tdefault environment = {
    \t\tPATH => /usr/bin:/bin:/usr/sbin:/sbin
    \t}

    \tenvironment = {
    \t\tOSLogRateLimit => 64
    \t\tMATTSTACK_FLAVOR => prod
    \t\tPATH => /usr/bin:/bin:/usr/sbin:/sbin
    \t\tXPC_SERVICE_NAME => com.mattstack.daemon
    \t}

    \tdomain = gui/501 [100057]
    \tasid = 100057
    \tminimum runtime = 10
    \texit timeout = 30
    \truns = 3
    \tpid = 28474
    \timmediate reason = semaphore
    \tforks = 22730
    \texecs = 1
    \tinitialized = 1
    \ttrampolined = 1
    \tstarted suspended = 0
    \tproxy started suspended = 0
    \tchecked allocations = 0 (queried = 1)
    \tchecked allocations reason = no host
    \tchecked allocations flags = 0x0
    \tlast exit code = 1

    \tsemaphores = {
    \t\tsuccessful exit => 0
    \t}

    \tresource coalition = {
    \t\tID = 9275
    \t\ttype = resource
    \t\tstate = active
    \t\tactive count = 1
    \t\tname = com.mattstack.daemon
    \t}

    \tjetsam coalition = {
    \t\tID = 9276
    \t\ttype = jetsam
    \t\tstate = active
    \t\tactive count = 1
    \t\tname = com.mattstack.daemon
    \t}

    \tspawn type = interactive (4)
    \tjetsam priority = 40
    \tjetsam memory limit (active) = (unlimited)
    \tjetsam memory limit (inactive) = (unlimited)
    \tjetsamproperties category = daemon
    \tsubmitted job. ignore execute allowed
    \tjetsam thread limit = 32
    \tcpumon = default
    \tjob state = running

    \tproperties = partial import | runatload | resolve program | has LWCR
    }
    """

    /// The refused-spawn state prod's daemon was left in on 2026-09-25,
    /// rebuilt from `healthy` with the four fields read off the broken job
    /// (its full print was not kept). Every pattern starts at "\n\t" so only
    /// top-level fields change, never the coalition blocks' copies.
    static let refusedSpawn = healthy
        .replacingOccurrences(of: "\n\tactive count = 1\n", with: "\n\tactive count = 0\n")
        .replacingOccurrences(of: "\n\tstate = running\n", with: "\n\tstate = not running\n")
        .replacingOccurrences(of: "\n\tpid = 28474\n", with: "\n")
        .replacingOccurrences(of: "\n\tlast exit code = 1\n", with: "\n\tlast exit code = 78: EX_CONFIG\n")
        .replacingOccurrences(of: "\n\tjob state = running\n", with: "\n\tjob state = spawn failed\n")
        .replacingOccurrences(of: "| has LWCR\n", with: "| needs LWCR update\n")

    /// A job that exited 1 on its own and is waiting out its throttle.
    static let crashedOnItsOwn = healthy
        .replacingOccurrences(of: "\n\tstate = running\n", with: "\n\tstate = not running\n")
        .replacingOccurrences(of: "\n\tpid = 28474\n", with: "\n")
        .replacingOccurrences(of: "\n\tjob state = running\n", with: "\n\tjob state = exited\n")

    static let notFound = "Bad request.\nCould not find service \"com.mattstack.daemon\" in domain for user gui: 501\n"
}
```

- [ ] **Step 2: Write the failing checks.** Create `rt-tray/Tests/MattstackCoreChecks/AgentSpawnHealthChecks.swift`:

```swift
import Foundation
import MattstackCore

func printed(_ stdout: String, exit: Int32 = 0, stderr: String = "") -> LaunchdJobLookup {
    LaunchdPrint.parse(CommandOutcome(exitCode: exit, stdout: stdout, stderr: stderr))
}

let agentSpawnHealthChecks: [Check] = [
    Check("launchd print: argv prints the label in the gui domain") { c in
        let (exe, args) = LaunchdPrint.arguments(label: "com.mattstack.daemon", uid: 501)
        c.expect(exe.hasPrefix("/bin/") && exe.hasSuffix("ctl"), "launchd's control tool, by absolute path")
        c.expectEqual(args, ["print", "gui/501/com.mattstack.daemon"])
    },
    Check("launchd print: the healthy capture reads its top-level fields") { c in
        c.expectEqual(printed(LaunchdPrintFixtures.healthy), .loaded(LaunchdJobSnapshot(
            state: "running", jobState: "running", lastExitCode: 1, pid: 28474,
            properties: ["partial import", "runatload", "resolve program", "has LWCR"])))
    },
    Check("launchd print: the refused-spawn shape reads exit 78, spawn failed and no pid") { c in
        c.expectEqual(printed(LaunchdPrintFixtures.refusedSpawn), .loaded(LaunchdJobSnapshot(
            state: "not running", jobState: "spawn failed", lastExitCode: 78, pid: nil,
            properties: ["partial import", "runatload", "resolve program", "needs LWCR update"])))
    },
    Check("launchd print: a job that crashed on its own reads exited with its code") { c in
        c.expectEqual(printed(LaunchdPrintFixtures.crashedOnItsOwn), .loaded(LaunchdJobSnapshot(
            state: "not running", jobState: "exited", lastExitCode: 1, pid: nil,
            properties: ["partial import", "runatload", "resolve program", "has LWCR"])))
    },
    Check("launchd print: nested blocks never override a top-level field") { c in
        let text = "gui/501/x = {\n\tstate = not running\n\tresource coalition = {\n\t\tstate = active\n\t\tpid = 9\n\t}\n}\n"
        c.expectEqual(printed(text), .loaded(LaunchdJobSnapshot(state: "not running")))
    },
    Check("launchd print: a job that never exited has no exit code") { c in
        let text = "gui/501/x = {\n\tstate = running\n\tlast exit code = (never exited)\n}\n"
        c.expectEqual(printed(text), .loaded(LaunchdJobSnapshot(state: "running")))
    },
    Check("launchd print: a label the domain does not hold reads as not loaded") { c in
        c.expectEqual(printed("", exit: 113, stderr: LaunchdPrintFixtures.notFound), .notLoaded)
        c.expectEqual(printed(LaunchdPrintFixtures.notFound, exit: 1), .notLoaded)
    },
    Check("launchd print: any other failure or an unrecognised shape reads as unknown") { c in
        c.expectEqual(printed("", exit: 5, stderr: "boom"), .unknown("exit 5"))
        c.expectEqual(printed("nothing a job print would contain\n"), .unknown("unrecognised print shape"))
    },
]
```

- [ ] **Step 3: Register the checks.** In `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift:3`, append ` + agentSpawnHealthChecks` after `+ triageChecks` at the end of the `allChecks` expression.

- [ ] **Step 4: Run and see it fail.**

Run: `swift run --package-path rt-tray mattstack-checks "launchd print"`
Expected: the build fails with `cannot find 'LaunchdPrint' in scope` (and `LaunchdJobSnapshot`, `LaunchdJobLookup`).

- [ ] **Step 5: Implement.** Create `rt-tray/Sources-core/Services/LaunchdJob.swift`:

```swift
import Foundation

public struct LaunchdJobSnapshot: Equatable, Sendable {
    public var state: String?
    public var jobState: String?
    public var lastExitCode: Int?
    public var pid: Int?
    public var properties: [String]

    public init(state: String? = nil, jobState: String? = nil, lastExitCode: Int? = nil,
                pid: Int? = nil, properties: [String] = []) {
        self.state = state; self.jobState = jobState; self.lastExitCode = lastExitCode
        self.pid = pid; self.properties = properties
    }
}

public enum LaunchdJobLookup: Equatable, Sendable {
    case loaded(LaunchdJobSnapshot)
    case notLoaded
    case unknown(String)
}

/// `launchctl print` output is not an API: a field it stops printing reads
/// as nil, and output with neither `state` nor `job state` reads as unknown,
/// never as a verdict.
public enum LaunchdPrint {
    public static let notFoundExitCode: Int32 = 113

    public static func arguments(label: String, uid: uid_t) -> (String, [String]) {
        ("/bin/launchctl", ["print", "gui/\(uid)/\(label)"])
    }

    public static func parse(_ outcome: CommandOutcome) -> LaunchdJobLookup {
        if outcome.exitCode == notFoundExitCode
            || (outcome.stdout + outcome.stderr).contains("Could not find service") {
            return .notLoaded
        }
        guard outcome.ok else { return .unknown("exit \(outcome.exitCode)") }
        var job = LaunchdJobSnapshot()
        var recognised = false
        for line in outcome.stdout.split(separator: "\n") {
            // Nested blocks (coalitions, environment) repeat keys such as
            // `state` and `pid` one tab deeper.
            guard line.hasPrefix("\t"), !line.hasPrefix("\t\t"),
                  let separator = line.range(of: " = ") else { continue }
            let key = String(line[line.index(after: line.startIndex)..<separator.lowerBound])
            let value = String(line[separator.upperBound...]).trimmingCharacters(in: .whitespaces)
            switch key {
            case "state": job.state = value; recognised = true
            case "job state": job.jobState = value; recognised = true
            case "pid": job.pid = Int(value)
            case "last exit code": job.lastExitCode = leadingInt(value)
            case "properties":
                job.properties = value.components(separatedBy: " | ")
                    .map { $0.trimmingCharacters(in: .whitespaces) }
            default: continue
            }
        }
        return recognised ? .loaded(job) : .unknown("unrecognised print shape")
    }

    private static func leadingInt(_ value: String) -> Int? {
        Int(value.prefix(while: { $0.isASCII && ($0.isNumber || $0 == "-") }))
    }
}
```

- [ ] **Step 6: Run to pass.**

Run: `swift run --package-path rt-tray mattstack-checks "launchd print"`
Expected: `checks: 8 passed, 0 failed`

Run: `swift run --package-path rt-tray mattstack-checks "checks never name"`
Expected: `checks: 1 passed, 0 failed` (the source guard accepts the new check files).

- [ ] **Step 7: Commit.**

Run: `git add rt-tray/Sources-core/Services/LaunchdJob.swift rt-tray/Tests/MattstackCoreChecks/LaunchdPrintFixtures.swift rt-tray/Tests/MattstackCoreChecks/AgentSpawnHealthChecks.swift rt-tray/Tests/MattstackCoreChecks/AllChecks.swift`
Run: `git commit -m "tray: parse launchd print into a job snapshot" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 2: the spawn-health verdict and a once-per-launch latch

**Files:**
- Create: `rt-tray/Sources-core/Services/AgentSpawnHealth.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AgentSpawnHealthChecks.swift` (append to `agentSpawnHealthChecks`)

**Interfaces:**
- Consumes: `AgentRegistration` (`rt-tray/Sources-core/Services/AgentPlistRefresh.swift:4-6`), `LaunchdJobLookup` (Task 1).
- Produces:
  - `public enum SpawnHealVerdict: Equatable, Sendable { case heal(reason: String); case leave(reason: String) }`
  - `public enum AgentSpawnHealth { static let exConfig: Int; static func decide(registration: AgentRegistration, lookup: LaunchdJobLookup, alreadyAttempted: Bool) -> SpawnHealVerdict }`
  - `public final class SpawnHealLatch: @unchecked Sendable { init(); func attempted(_ label: String) -> Bool; func claim(_ label: String) -> Bool }`

The verdict is only asked about an agent that did not answer within its budget (Task 4 guarantees that). Reason strings are exact; Task 4's checks and the tray log both use them.

- [ ] **Step 1: Write the failing checks.** Append these entries inside the `agentSpawnHealthChecks` array literal in `AgentSpawnHealthChecks.swift`, before its closing `]`:

```swift
    Check("spawn heal: a refused spawn on an enabled agent is healed") { c in
        c.expectEqual(AgentSpawnHealth.decide(registration: .enabled, lookup: printed(LaunchdPrintFixtures.refusedSpawn),
                                              alreadyAttempted: false),
                      .heal(reason: "last exit 78 (EX_CONFIG)"))
    },
    Check("spawn heal: spawn failed, or a pending LWCR, is healed without exit 78") { c in
        c.expectEqual(AgentSpawnHealth.decide(
            registration: .enabled,
            lookup: .loaded(LaunchdJobSnapshot(state: "not running", jobState: "spawn failed", lastExitCode: 0)),
            alreadyAttempted: false), .heal(reason: "job state spawn failed"))
        c.expectEqual(AgentSpawnHealth.decide(
            registration: .enabled,
            lookup: .loaded(LaunchdJobSnapshot(state: "not running", properties: ["needs LWCR update"])),
            alreadyAttempted: false), .heal(reason: "needs LWCR update"))
    },
    Check("spawn heal: an enabled agent launchd holds no job for is healed") { c in
        c.expectEqual(AgentSpawnHealth.decide(registration: .enabled, lookup: .notLoaded, alreadyAttempted: false),
                      .heal(reason: "enabled but launchd holds no job"))
    },
    Check("spawn heal: a running job is left, whatever its last exit code") { c in
        c.expectEqual(AgentSpawnHealth.decide(registration: .enabled, lookup: printed(LaunchdPrintFixtures.healthy),
                                              alreadyAttempted: false),
                      .leave(reason: "job is running"))
        c.expectEqual(AgentSpawnHealth.decide(
            registration: .enabled,
            lookup: .loaded(LaunchdJobSnapshot(state: "running", lastExitCode: 78, pid: 5)),
            alreadyAttempted: false), .leave(reason: "job is running"))
    },
    Check("spawn heal: a job that crashed on its own is left") { c in
        c.expectEqual(AgentSpawnHealth.decide(registration: .enabled, lookup: printed(LaunchdPrintFixtures.crashedOnItsOwn),
                                              alreadyAttempted: false),
                      .leave(reason: "not a refused spawn"))
    },
    Check("spawn heal: an unreadable launchd state is left") { c in
        c.expectEqual(AgentSpawnHealth.decide(registration: .enabled, lookup: .unknown("exit 5"), alreadyAttempted: false),
                      .leave(reason: "launchd state unknown: exit 5"))
    },
    Check("spawn heal: only an enabled registration is healed") { c in
        for registration in [AgentRegistration.notRegistered, .requiresApproval, .notFound] {
            c.expectEqual(AgentSpawnHealth.decide(registration: registration, lookup: .notLoaded, alreadyAttempted: false),
                          .leave(reason: "registration is \(registration)"))
        }
    },
    Check("spawn heal: a second attempt in one launch is left") { c in
        c.expectEqual(AgentSpawnHealth.decide(registration: .enabled, lookup: .notLoaded, alreadyAttempted: true),
                      .leave(reason: "already healed this launch"))
    },
    Check("spawn heal: the latch grants each label once") { c in
        let latch = SpawnHealLatch()
        c.expect(!latch.attempted("a"))
        c.expect(latch.claim("a"))
        c.expect(!latch.claim("a"))
        c.expect(latch.attempted("a"))
        c.expect(latch.claim("b"))
    },
```

- [ ] **Step 2: Run and see it fail.**

Run: `swift run --package-path rt-tray mattstack-checks "spawn heal"`
Expected: the build fails with `cannot find 'AgentSpawnHealth' in scope` and `cannot find 'SpawnHealLatch' in scope`.

- [ ] **Step 3: Implement.** Create `rt-tray/Sources-core/Services/AgentSpawnHealth.swift`:

```swift
import Foundation

public enum SpawnHealVerdict: Equatable, Sendable {
    case heal(reason: String)
    case leave(reason: String)
}

/// Only a job launchd refused to spawn gets the unregister/register cycle:
/// SMAppService's `enabled` is BTM's view, not launchd's, and a job that is
/// running or crashed on its own gets nothing a re-register fixes.
public enum AgentSpawnHealth {
    public static let exConfig = 78

    public static func decide(registration: AgentRegistration, lookup: LaunchdJobLookup,
                              alreadyAttempted: Bool) -> SpawnHealVerdict {
        guard registration == .enabled else { return .leave(reason: "registration is \(registration)") }
        guard !alreadyAttempted else { return .leave(reason: "already healed this launch") }
        switch lookup {
        case .unknown(let detail):
            return .leave(reason: "launchd state unknown: \(detail)")
        case .notLoaded:
            return .heal(reason: "enabled but launchd holds no job")
        case .loaded(let job):
            if job.pid != nil { return .leave(reason: "job is running") }
            if job.lastExitCode == exConfig { return .heal(reason: "last exit 78 (EX_CONFIG)") }
            if job.jobState == "spawn failed" { return .heal(reason: "job state spawn failed") }
            if job.properties.contains("needs LWCR update") { return .heal(reason: "needs LWCR update") }
            return .leave(reason: "not a refused spawn")
        }
    }
}

/// One heal per label per process: a heal that does not take must never
/// become a loop fighting launchd.
public final class SpawnHealLatch: @unchecked Sendable {
    private let lock = NSLock()
    private var claimed: Set<String> = []

    public init() {}

    public func attempted(_ label: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return claimed.contains(label)
    }

    public func claim(_ label: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return claimed.insert(label).inserted
    }
}
```

- [ ] **Step 4: Run to pass.**

Run: `swift run --package-path rt-tray mattstack-checks "spawn heal"`
Expected: `checks: 9 passed, 0 failed`

- [ ] **Step 5: Commit.**

Run: `git add rt-tray/Sources-core/Services/AgentSpawnHealth.swift rt-tray/Tests/MattstackCoreChecks/AgentSpawnHealthChecks.swift`
Run: `git commit -m "tray: decide when an unanswering agent was refused a spawn" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 3: re-register runs sync unregister, settle, register, start once

**Files:**
- Modify: `rt-tray/Sources-core/Services/AgentPlistRefresh.swift:60-80` (`AgentReregister`)
- Modify: `rt-tray/Sources-core/Services/ServicePlists.swift:70-74` (add `StartJob` after `Kickstart`)
- Modify: `rt-tray/Sources-core/Services/ServiceModels.swift:19-24` (protocol)
- Modify: `rt-tray/Sources/DebugStubProviders.swift:10-18`
- Modify: `rt-tray/Tests/MattstackCoreChecks/TrayRoutesChecks.swift:11-26`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AgentPlistRefreshChecks.swift:62-108`
- Modify: `rt-tray/Tests/MattstackCoreChecks/ServicesChecks.swift` (new check after `:41`)
- Modify: `rt-tray/Sources/DaemonLifecycle.swift:157-163` (restart fallback), `:177-202` (re-register)
- Modify: `rt-tray/Sources/Services/ServicesRegistrar.swift:88-109` (agent re-register), new `start(label:)` after `restart(label:)` at `:216-221`

**Interfaces:**
- Consumes: `CommandRunner` (`CommandRunner.swift:16-18`), `ServiceRegisterResult` (`ServiceModels.swift:9-17`).
- Produces:
  - `AgentReregister.settleNanoseconds: UInt64` (1s)
  - `AgentReregister.run(unregister: () async -> Bool, settle: () async -> Void, register: () async -> Bool, beforeRetry: () async -> Void, start: () async -> Void) async -> AgentReregisterOutcome`
  - `public enum StartJob { static func arguments(label: String, uid: uid_t) -> (String, [String]) }`
  - `ServicesProviding.start(label: String) async -> Bool` (new requirement; implemented by `ServicesRegistrar`, `StubServicesProvider`, `FakeServices`)

Today `reregisterDaemonUngated` (`DaemonLifecycle.swift:183-193`) and `ServicesRegistrar.reregister` (`ServicesRegistrar.swift:90-100`) call the async `SMAppService.unregister()` and register at once with no settle and no start. The sequence that brought the daemon back was `/daemon/stop` (sync `service.unregister()`, `DaemonLifecycle.swift:127`), a 500ms gap (`commands/daemon.ts:236`), then `/daemon/start` (register, then kickstart). `start` here is `kickstart` without `-k`: it starts a job that is not running and does not kill one RunAtLoad already started. Its result is only logged; whether the job really came up is the answer wait's job (Task 4).

- [ ] **Step 1: Write the failing checks.** In `AgentPlistRefreshChecks.swift`, replace the four checks from `"reregister: unregister then register once when both succeed"` through `"reregister: a failed unregister never registers over the still-registered job"` (`:62-104`) with:

```swift
    Check("reregister: unregister, settle, register, then start once") { c in
        let log = StepLog()
        let outcome = await AgentReregister.run(
            unregister: { await log.add("unregister"); return true },
            settle: { await log.add("settle") },
            register: { await log.add("register"); return true },
            beforeRetry: { await log.add("pause") },
            start: { await log.add("start") })
        c.expectEqual(outcome, .reregistered)
        c.expectEqual(await log.steps, ["unregister", "settle", "register", "start"])
    },
    Check("reregister: a failed register is retried once, then started") { c in
        let log = StepLog()
        let attempts = StepLog()
        let outcome = await AgentReregister.run(
            unregister: { await log.add("unregister"); return true },
            settle: { await log.add("settle") },
            register: {
                await log.add("register")
                await attempts.add("x")
                return await attempts.steps.count > 1
            },
            beforeRetry: { await log.add("pause") },
            start: { await log.add("start") })
        c.expectEqual(outcome, .reregisteredOnRetry)
        c.expectEqual(await log.steps, ["unregister", "settle", "register", "pause", "register", "start"])
    },
    Check("reregister: a register that fails twice reports it and never starts") { c in
        let log = StepLog()
        let outcome = await AgentReregister.run(
            unregister: { await log.add("unregister"); return true },
            settle: { await log.add("settle") },
            register: { await log.add("register"); return false },
            beforeRetry: { await log.add("pause") },
            start: { await log.add("start") })
        c.expectEqual(outcome, .registerFailed)
        c.expectEqual(await log.steps, ["unregister", "settle", "register", "pause", "register"])
        c.expect(!outcome.succeeded)
    },
    Check("reregister: a failed unregister never registers over the still-registered job") { c in
        let log = StepLog()
        let outcome = await AgentReregister.run(
            unregister: { await log.add("unregister"); return false },
            settle: { await log.add("settle") },
            register: { await log.add("register"); return true },
            beforeRetry: { await log.add("pause") },
            start: { await log.add("start") })
        c.expectEqual(outcome, .unregisterFailed)
        c.expectEqual(await log.steps, ["unregister"])
        c.expect(!outcome.succeeded)
    },
    Check("reregister: the settle is a real gap and shorter than the retry pause") { c in
        c.expect(AgentReregister.settleNanoseconds >= 500_000_000)
        c.expect(AgentReregister.settleNanoseconds < AgentReregister.retryPauseNanoseconds)
    },
```

Leave `"reregister: both success outcomes count as succeeded"` as it is.

In `ServicesChecks.swift`, add after the `"Kickstart and DeckRestart build the exact argv"` check (ends `:41`):

```swift
    Check("StartJob starts a job without killing a running one") { c in
        let (exe, args) = StartJob.arguments(label: "com.mattstack.daemon", uid: 501)
        c.expect(exe.hasPrefix("/bin/") && exe.hasSuffix("ctl"), "launchd's control tool, by absolute path")
        c.expectEqual(args, ["kickstart", "gui/501/com.mattstack.daemon"])
        c.expect(!args.contains("-k"))
    },
```

In `TrayRoutesChecks.swift`, `FakeServices` (`:11-26`): add `var started: [String] = []` beside `var restarted` and, after `restart(label:)`:

```swift
    func start(label: String) async -> Bool { started.append(label); return true }
```

- [ ] **Step 2: Run and see it fail.**

Run: `swift run --package-path rt-tray mattstack-checks "reregister:"`
Expected: the build fails with `extra arguments at positions #2, #5 in call` (or `incorrect argument labels`) for `AgentReregister.run`, and `cannot find 'StartJob' in scope`.

- [ ] **Step 3: Implement the pure sequence.** In `AgentPlistRefresh.swift`, replace `AgentReregister` (`:65-80`) with:

```swift
/// A failed unregister leaves the job registered as it was, so nothing is
/// registered over it. A failed register is retried once: the agent must not
/// be left unregistered by the refresh that meant to renew it. The job is
/// started only once a register has landed.
public enum AgentReregister {
    /// The sequence that recovered a job launchd would not spawn had at least
    /// 500ms between unregister and register; the one that left it so had none.
    public static let settleNanoseconds: UInt64 = 1_000_000_000
    /// An unregistered job can take up to its ExitTimeOut to leave launchd,
    /// and a register racing that exit fails.
    public static let retryPauseNanoseconds: UInt64 = 2_000_000_000

    public static func run(unregister: () async -> Bool, settle: () async -> Void, register: () async -> Bool,
                           beforeRetry: () async -> Void, start: () async -> Void) async -> AgentReregisterOutcome {
        guard await unregister() else { return .unregisterFailed }
        await settle()
        if await register() {
            await start()
            return .reregistered
        }
        await beforeRetry()
        guard await register() else { return .registerFailed }
        await start()
        return .reregisteredOnRetry
    }
}
```

In `ServicePlists.swift`, after `Kickstart` (`:70-74`):

```swift
/// Without -k: a job RunAtLoad already started is left alone, where -k
/// would kill it and can wait out the plist's whole ExitTimeOut.
public enum StartJob {
    public static func arguments(label: String, uid: uid_t) -> (String, [String]) {
        ("/bin/launchctl", ["kickstart", "gui/\(uid)/\(label)"])
    }
}
```

In `ServiceModels.swift`, add to `ServicesProviding` after `restart(label:)`:

```swift
    func start(label: String) async -> Bool
```

In `DebugStubProviders.swift`, add to `StubServicesProvider` after `restart(label:)`:

```swift
    func start(label: String) async -> Bool { true }
```

- [ ] **Step 4: Wire the app target.** In `ServicesRegistrar.swift`, replace `reregister(_:)` (`:88-109`) with:

```swift
    private func reregister(_ agent: AgentPlist) async -> Bool {
        let svc = service(agent)
        let outcome = await AgentReregister.run(
            unregister: { await self.unregister(plists: [agent.fileName]).allSatisfy(\.ok) },
            settle: { try? await Task.sleep(nanoseconds: AgentReregister.settleNanoseconds) },
            register: { await self.register(plists: [agent.fileName]).allSatisfy(\.ok) },
            beforeRetry: { try? await Task.sleep(nanoseconds: AgentReregister.retryPauseNanoseconds) },
            start: { _ = await self.start(label: agent.label) })
        let fields = ["label": agent.label, "outcome": String(describing: outcome),
                      "status": TrayServer.statusName(svc.status)]
        if outcome.succeeded {
            TrayLog.info("agent re-registered", fields)
        } else {
            TrayLog.warn("agent re-register failed", fields)
        }
        return outcome.succeeded
    }
```

(`unregister(plists:)` at `:194-214` already runs the synchronous `svc.unregister()` on the main actor and reports `ok` only when the status reads `notRegistered`.)

After `restart(label:)` (`:216-221`), add:

```swift
    func start(label: String) async -> Bool {
        let (exe, args) = StartJob.arguments(label: label, uid: uid)
        let out = await runner.run(exe, args)
        if !out.ok {
            TrayLog.warn("start after register failed", ["label": label, "exit": Int(out.exitCode), "stderr": out.stderr])
        }
        return out.ok
    }
```

In `DaemonLifecycle.swift`, replace `reregisterDaemonUngated` (`:177-202`) with:

```swift
    private func reregisterDaemonUngated(origin: String) async -> Bool {
        guard let services else {
            TrayLog.error("reregisterDaemon with no services registrar wired", ["label": label, "origin": origin])
            return false
        }
        let plist = plistName
        let label = self.label
        let outcome = await AgentReregister.run(
            unregister: { self.unregisterSynchronously() },
            settle: { try? await Task.sleep(nanoseconds: AgentReregister.settleNanoseconds) },
            register: { await services.register(plists: [plist]).allSatisfy(\.ok) },
            beforeRetry: { try? await Task.sleep(nanoseconds: AgentReregister.retryPauseNanoseconds) },
            start: { _ = await services.start(label: label) })
        let fields = ["label": label, "origin": origin, "outcome": String(describing: outcome),
                      "status": TrayServer.statusName(service.status)]
        if outcome.succeeded {
            TrayLog.info("daemon re-registered", fields)
        } else {
            TrayLog.warn("daemon re-register failed", fields)
        }
        return outcome.succeeded
    }

    /// Not async on purpose: in an async context Swift picks SMAppService's
    /// async `unregister()`, and the sequence that recovered a job launchd
    /// would not spawn used this synchronous form, as `stopDaemonUngated` does.
    private func unregisterSynchronously() -> Bool {
        do {
            try service.unregister()
            return true
        } catch {
            return service.status == .notRegistered
        }
    }
```

In `restartDaemonUngated`, replace the fallback's `try? await service.unregister()` (`:162`) with:

```swift
        _ = unregisterSynchronously()
        try? await Task.sleep(nanoseconds: AgentReregister.settleNanoseconds)
```

- [ ] **Step 5: Run to pass.**

Run: `swift build --package-path rt-tray`
Expected: `Build complete!`

Run: `swift run --package-path rt-tray mattstack-checks "reregister:"`
Expected: `checks: 6 passed, 0 failed`

Run: `swift run --package-path rt-tray mattstack-checks "StartJob"`
Expected: `checks: 1 passed, 0 failed`

Run: `swift run --package-path rt-tray mattstack-checks "/services"`
Expected: all pass (the tray-route checks that drive `FakeServices`, which still conforms).

- [ ] **Step 6: Commit.**

Run: `git add rt-tray/Sources-core/Services/AgentPlistRefresh.swift rt-tray/Sources-core/Services/ServicePlists.swift rt-tray/Sources-core/Services/ServiceModels.swift rt-tray/Sources/DebugStubProviders.swift rt-tray/Sources/DaemonLifecycle.swift rt-tray/Sources/Services/ServicesRegistrar.swift rt-tray/Tests/MattstackCoreChecks/AgentPlistRefreshChecks.swift rt-tray/Tests/MattstackCoreChecks/ServicesChecks.swift rt-tray/Tests/MattstackCoreChecks/TrayRoutesChecks.swift`
Run: `git commit -m "tray: re-register with a sync unregister, a settle and one start" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 4: the bounded answer wait and the settle driver

**Files:**
- Create: `rt-tray/Sources-core/Services/LaunchSettle.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/LaunchLifecycleChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift:3`

**Interfaces:**
- Consumes: `AgentRegistration`, `LaunchdJobLookup`, `LaunchdPrint.parse` (Task 1), `AgentSpawnHealth.decide`, `SpawnHealLatch` (Task 2).
- Produces:
  - `public struct AnswerBudget: Equatable, Sendable { let attempts: Int; let intervalNanoseconds: UInt64; init(attempts:intervalNanoseconds:); static let daemon, deck: AnswerBudget }`
  - `public enum AgentAnswerWait { static func wait(_ budget: AnswerBudget, sleep: (UInt64) async -> Void, probe: () async -> Bool) async -> Bool }`
  - `public struct LaunchAgentProbe: Sendable { let label: String; let budget: AnswerBudget; let answers: @Sendable () async -> Bool; let registration: @Sendable () async -> AgentRegistration; let lookup: @Sendable () async -> LaunchdJobLookup; let heal: @Sendable () async -> Bool }` with a public memberwise-style `init`
  - `public struct LaunchSettleReport: Equatable, Sendable { var answered: [String: Bool]; var healed: Set<String>; init(answered: [String: Bool] = [:], healed: Set<String> = []) }`
  - `public enum LaunchSettleEvent: Equatable, Sendable { case answered(label: String); case left(label: String, reason: String); case healed(label: String, reason: String, reregistered: Bool, answered: Bool) }`
  - `public enum LaunchSettle { static func run(_ probes: [LaunchAgentProbe], latch: SpawnHealLatch, sleep: @escaping @Sendable (UInt64) async -> Void, observer: (@Sendable (LaunchSettleEvent) -> Void)? = nil) async -> LaunchSettleReport }`
  - `let launchLifecycleChecks: [Check]`

Budgets: daemon 30 x 500ms (15s), deck 30 x 1s (30s; each deck probe spawns its CLI). Probes run concurrently, so a launch with both agents down waits about 30s, heals, and waits at most about 30s more.

- [ ] **Step 1: Write the failing checks.** Create `rt-tray/Tests/MattstackCoreChecks/LaunchLifecycleChecks.swift`:

```swift
import Foundation
import MattstackCore

private actor Tally {
    private var counts: [String: Int] = [:]
    func bump(_ key: String) -> Int {
        counts[key, default: 0] += 1
        return counts[key, default: 0]
    }
    func count(_ key: String) -> Int { counts[key, default: 0] }
}

private final class EventLog: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [LaunchSettleEvent] = []
    func add(_ event: LaunchSettleEvent) { lock.lock(); items.append(event); lock.unlock() }
    var events: [LaunchSettleEvent] { lock.lock(); defer { lock.unlock() }; return items }
}

private let quick = AnswerBudget(attempts: 3, intervalNanoseconds: 1)
private let noSleep: @Sendable (UInt64) async -> Void = { _ in }

private func probe(_ label: String, _ tally: Tally, answersOnCall: Int? = nil, answersAfterHeal: Bool = false,
                   registration: AgentRegistration = .enabled, lookup: LaunchdJobLookup = .notLoaded,
                   healOk: Bool = true) -> LaunchAgentProbe {
    LaunchAgentProbe(
        label: label, budget: quick,
        answers: {
            let call = await tally.bump(label + ".answers")
            if answersAfterHeal, await tally.count(label + ".heal") > 0 { return true }
            guard let answersOnCall else { return false }
            return call >= answersOnCall
        },
        registration: { registration },
        lookup: {
            _ = await tally.bump(label + ".lookup")
            return lookup
        },
        heal: {
            _ = await tally.bump(label + ".heal")
            return healOk
        })
}

let launchLifecycleChecks: [Check] = [
    Check("answer wait: probes before sleeping and stops at the first answer") { c in
        let tally = Tally()
        let answered = await AgentAnswerWait.wait(AnswerBudget(attempts: 4, intervalNanoseconds: 1),
                                                  sleep: { _ in _ = await tally.bump("sleep") },
                                                  probe: { await tally.bump("probe") >= 3 })
        c.expect(answered)
        c.expectEqual(await tally.count("probe"), 3)
        c.expectEqual(await tally.count("sleep"), 2)
    },
    Check("answer wait: gives up at the budget with no trailing sleep") { c in
        let tally = Tally()
        let answered = await AgentAnswerWait.wait(AnswerBudget(attempts: 4, intervalNanoseconds: 1),
                                                  sleep: { _ in _ = await tally.bump("sleep") },
                                                  probe: { _ = await tally.bump("probe"); return false })
        c.expect(!answered)
        c.expectEqual(await tally.count("probe"), 4)
        c.expectEqual(await tally.count("sleep"), 3)
    },
    Check("answer wait: the launch budgets are bounded") { c in
        for budget in [AnswerBudget.daemon, .deck] {
            let seconds = Double(budget.attempts) * Double(budget.intervalNanoseconds) / 1_000_000_000
            c.expect(seconds > 0 && seconds <= 30, "\(budget) waits \(seconds)s")
        }
    },
    Check("launch settle: an agent that answers is never inspected or healed") { c in
        let tally = Tally(), log = EventLog()
        let report = await LaunchSettle.run([probe("d", tally, answersOnCall: 2)], latch: SpawnHealLatch(),
                                            sleep: noSleep, observer: { log.add($0) })
        c.expectEqual(report, LaunchSettleReport(answered: ["d": true]))
        c.expectEqual(await tally.count("d.lookup"), 0)
        c.expectEqual(await tally.count("d.heal"), 0)
        c.expectEqual(log.events, [.answered(label: "d")])
    },
    Check("launch settle: a refused spawn is healed once and waited on again") { c in
        let tally = Tally(), log = EventLog()
        let refused = printed(LaunchdPrintFixtures.refusedSpawn)
        let report = await LaunchSettle.run([probe("d", tally, answersAfterHeal: true, lookup: refused)],
                                            latch: SpawnHealLatch(), sleep: noSleep, observer: { log.add($0) })
        c.expectEqual(report, LaunchSettleReport(answered: ["d": true], healed: ["d"]))
        c.expectEqual(await tally.count("d.heal"), 1)
        c.expectEqual(await tally.count("d.answers"), 4)
        c.expectEqual(log.events, [.healed(label: "d", reason: "last exit 78 (EX_CONFIG)", reregistered: true, answered: true)])
    },
    Check("launch settle: a heal that does not bring the agent back leaves it unanswered") { c in
        let tally = Tally(), log = EventLog()
        let report = await LaunchSettle.run([probe("d", tally)], latch: SpawnHealLatch(),
                                            sleep: noSleep, observer: { log.add($0) })
        c.expectEqual(report, LaunchSettleReport(answered: ["d": false], healed: ["d"]))
        c.expectEqual(await tally.count("d.heal"), 1)
        c.expectEqual(await tally.count("d.answers"), 6)
        c.expectEqual(log.events, [.healed(label: "d", reason: "enabled but launchd holds no job",
                                           reregistered: true, answered: false)])
    },
    Check("launch settle: a heal that fails to re-register is not waited on") { c in
        let tally = Tally(), log = EventLog()
        let report = await LaunchSettle.run([probe("d", tally, healOk: false)], latch: SpawnHealLatch(),
                                            sleep: noSleep, observer: { log.add($0) })
        c.expectEqual(report, LaunchSettleReport(answered: ["d": false]))
        c.expectEqual(await tally.count("d.answers"), 3)
        c.expectEqual(log.events, [.healed(label: "d", reason: "enabled but launchd holds no job",
                                           reregistered: false, answered: false)])
    },
    Check("launch settle: one heal per label per launch, however often it runs") { c in
        let tally = Tally(), log = EventLog(), latch = SpawnHealLatch()
        _ = await LaunchSettle.run([probe("d", tally)], latch: latch, sleep: noSleep, observer: { log.add($0) })
        let second = await LaunchSettle.run([probe("d", tally)], latch: latch, sleep: noSleep, observer: { log.add($0) })
        c.expectEqual(second, LaunchSettleReport(answered: ["d": false]))
        c.expectEqual(await tally.count("d.heal"), 1)
        c.expectEqual(log.events.last, .left(label: "d", reason: "already healed this launch"))
    },
    Check("launch settle: a running or unapproved agent is left alone, and every probe is reported") { c in
        let tally = Tally(), log = EventLog()
        let running = printed(LaunchdPrintFixtures.healthy)
        let report = await LaunchSettle.run([probe("slow", tally, lookup: running),
                                             probe("gated", tally, registration: .requiresApproval)],
                                            latch: SpawnHealLatch(), sleep: noSleep, observer: { log.add($0) })
        c.expectEqual(report, LaunchSettleReport(answered: ["slow": false, "gated": false]))
        c.expectEqual(await tally.count("slow.heal") + tally.count("gated.heal"), 0)
        c.expect(log.events.contains(.left(label: "slow", reason: "job is running")))
        c.expect(log.events.contains(.left(label: "gated", reason: "registration is requiresApproval")))
    },
]
```

(`printed` is the internal helper defined in `AgentSpawnHealthChecks.swift` in Task 1; both files are in the `MattstackCoreChecks` target.)

- [ ] **Step 2: Register the checks.** In `AllChecks.swift:3`, append ` + launchLifecycleChecks` after `+ agentSpawnHealthChecks`.

- [ ] **Step 3: Run and see it fail.**

Run: `swift run --package-path rt-tray mattstack-checks "launch settle"`
Expected: the build fails with `cannot find 'AnswerBudget' in scope`, `cannot find 'LaunchSettle' in scope` (and the other new types).

- [ ] **Step 4: Implement.** Create `rt-tray/Sources-core/Services/LaunchSettle.swift`:

```swift
import Foundation

public struct AnswerBudget: Equatable, Sendable {
    public let attempts: Int
    public let intervalNanoseconds: UInt64

    public init(attempts: Int, intervalNanoseconds: UInt64) {
        self.attempts = attempts; self.intervalNanoseconds = intervalNanoseconds
    }

    public static let daemon = AnswerBudget(attempts: 30, intervalNanoseconds: 500_000_000)
    /// Each deck probe spawns its CLI, so it polls half as often.
    public static let deck = AnswerBudget(attempts: 30, intervalNanoseconds: 1_000_000_000)
}

public enum AgentAnswerWait {
    public static func wait(_ budget: AnswerBudget, sleep: (UInt64) async -> Void,
                            probe: () async -> Bool) async -> Bool {
        let attempts = max(budget.attempts, 1)
        for attempt in 1...attempts {
            if await probe() { return true }
            if attempt < attempts { await sleep(budget.intervalNanoseconds) }
        }
        return false
    }
}

public struct LaunchAgentProbe: Sendable {
    public let label: String
    public let budget: AnswerBudget
    public let answers: @Sendable () async -> Bool
    public let registration: @Sendable () async -> AgentRegistration
    public let lookup: @Sendable () async -> LaunchdJobLookup
    public let heal: @Sendable () async -> Bool

    public init(label: String, budget: AnswerBudget, answers: @escaping @Sendable () async -> Bool,
                registration: @escaping @Sendable () async -> AgentRegistration,
                lookup: @escaping @Sendable () async -> LaunchdJobLookup,
                heal: @escaping @Sendable () async -> Bool) {
        self.label = label; self.budget = budget; self.answers = answers
        self.registration = registration; self.lookup = lookup; self.heal = heal
    }
}

public struct LaunchSettleReport: Equatable, Sendable {
    public var answered: [String: Bool]
    /// Agents a heal re-registered, whether or not they answered after it.
    public var healed: Set<String>

    public init(answered: [String: Bool] = [:], healed: Set<String> = []) {
        self.answered = answered; self.healed = healed
    }
}

public enum LaunchSettleEvent: Equatable, Sendable {
    case answered(label: String)
    case left(label: String, reason: String)
    case healed(label: String, reason: String, reregistered: Bool, answered: Bool)
}

/// The launch's only spawn-health heal: an agent that stays silent for its
/// whole budget, and that launchd refused to spawn, gets one re-register and
/// one more budget. The latch, not this call, is what bounds it per launch.
public enum LaunchSettle {
    private struct Outcome: Sendable {
        let label: String
        let answered: Bool
        let healed: Bool
    }

    public static func run(_ probes: [LaunchAgentProbe], latch: SpawnHealLatch,
                           sleep: @escaping @Sendable (UInt64) async -> Void,
                           observer: (@Sendable (LaunchSettleEvent) -> Void)? = nil) async -> LaunchSettleReport {
        await withTaskGroup(of: Outcome.self) { group in
            for probe in probes {
                group.addTask { await settle(probe, latch: latch, sleep: sleep, observer: observer) }
            }
            var report = LaunchSettleReport()
            for await outcome in group {
                report.answered[outcome.label] = outcome.answered
                if outcome.healed { report.healed.insert(outcome.label) }
            }
            return report
        }
    }

    private static func settle(_ probe: LaunchAgentProbe, latch: SpawnHealLatch,
                               sleep: @escaping @Sendable (UInt64) async -> Void,
                               observer: (@Sendable (LaunchSettleEvent) -> Void)?) async -> Outcome {
        if await AgentAnswerWait.wait(probe.budget, sleep: sleep, probe: probe.answers) {
            observer?(.answered(label: probe.label))
            return Outcome(label: probe.label, answered: true, healed: false)
        }
        let registration = await probe.registration()
        let lookup = await probe.lookup()
        let verdict = AgentSpawnHealth.decide(registration: registration, lookup: lookup,
                                              alreadyAttempted: latch.attempted(probe.label))
        guard case .heal(let reason) = verdict, latch.claim(probe.label) else {
            let leftReason: String
            if case .leave(let why) = verdict { leftReason = why } else { leftReason = "already healed this launch" }
            observer?(.left(label: probe.label, reason: leftReason))
            return Outcome(label: probe.label, answered: false, healed: false)
        }
        let reregistered = await probe.heal()
        var answered = false
        if reregistered {
            answered = await AgentAnswerWait.wait(probe.budget, sleep: sleep, probe: probe.answers)
        }
        observer?(.healed(label: probe.label, reason: reason, reregistered: reregistered, answered: answered))
        return Outcome(label: probe.label, answered: answered, healed: reregistered)
    }
}
```

- [ ] **Step 5: Run to pass.**

Run: `swift run --package-path rt-tray mattstack-checks "answer wait"`
Expected: `checks: 3 passed, 0 failed`

Run: `swift run --package-path rt-tray mattstack-checks "launch settle"`
Expected: `checks: 6 passed, 0 failed`

- [ ] **Step 6: Commit.**

Run: `git add rt-tray/Sources-core/Services/LaunchSettle.swift rt-tray/Tests/MattstackCoreChecks/LaunchLifecycleChecks.swift rt-tray/Tests/MattstackCoreChecks/AllChecks.swift`
Run: `git commit -m "tray: wait for launch agents to answer and heal a refused spawn once" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 5: what the launch records, and which agents a version change kickstarts

**Files:**
- Create: `rt-tray/Sources-core/Services/LaunchRecording.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/LaunchLifecycleChecks.swift` (helpers + append to `launchLifecycleChecks`)

**Interfaces:**
- Consumes: `AgentPlist` (`ServicePlists.swift:3-10`), `AgentPlistRefreshAction`, `AgentPlistRefresh.shouldRecordAfterRegister` (`AgentPlistRefresh.swift:19-23, 55-57`), `VersionChange` (`VersionChangeDetector.swift:15-19`), `LaunchSettleReport` (Task 4).
- Produces:
  - `public enum AgentRole: Equatable, Sendable { case daemon, deck, other; static func of(_ agent: AgentPlist, daemonLabel: String) -> AgentRole }`
  - `public struct LaunchAgentOutcome: Equatable, Sendable { let label: String; let action: AgentPlistRefreshAction; let before: AgentRegistration; let reregistered: Bool?; let registerOk: Bool; let after: AgentRegistration }` with a public init taking those labels in that order
  - `public struct LaunchRegistration: Equatable, Sendable { let registeredThisLaunch: Set<String>; let pendingHashes: [String: String]; init(registeredThisLaunch:pendingHashes:) }`
  - `public struct VersionChangeProgress: Equatable, Sendable { let change: VersionChange; let failedRegisters: [String]; let failedKickstarts: [String]; init(change:failedRegisters:failedKickstarts:) }`
  - `public struct LaunchRecordPlan: Equatable, Sendable { let hashes: [String: String]; let heldHashes: [String]; let recordVersion: Bool; init(hashes:heldHashes:recordVersion:) }`
  - `public enum LaunchRecording { static func summarize(_ outcomes: [LaunchAgentOutcome]) -> LaunchRegistration; static func kickstartLabels(_ labels: [String], registeredThisLaunch: Set<String>) -> [String]; static func plan(registration: LaunchRegistration, progress: VersionChangeProgress, report: LaunchSettleReport) -> LaunchRecordPlan; static func restartsServedApps(progress: VersionChangeProgress, report: LaunchSettleReport, deckLabel: String?) -> Bool }`

Rules:
- Bootstrapped this launch: a re-register that succeeded, or an agent that was `notRegistered` before the launch pass and ends registered `enabled`. A failed re-register is not (it may still be the old job, so the version change must kickstart it).
- A hash waits for its agent's answer. An agent with no probe (neither daemon nor deck) keeps the old rule: a successful registration is enough.
- A changed version is recorded when no register failed, every failed kickstart was on an agent the heal re-registered, and every probed agent answered.
- On a changed version whose deck answered the settle, the launch runs `deck restart --managed` once, after the record plan is written. It is decided from the settle report alone and is not an input to `plan`, so it can never hold the version unrecorded.

- [ ] **Step 1: Write the failing checks.** In `LaunchLifecycleChecks.swift`, add these helpers after `probe(...)`:

```swift
private func outcome(_ label: String, _ action: AgentPlistRefreshAction, before: AgentRegistration,
                     reregistered: Bool? = nil, registerOk: Bool = true,
                     after: AgentRegistration = .enabled) -> LaunchAgentOutcome {
    LaunchAgentOutcome(label: label, action: action, before: before, reregistered: reregistered,
                       registerOk: registerOk, after: after)
}

private func progress(_ change: VersionChange, failedRegisters: [String] = [],
                      failedKickstarts: [String] = []) -> VersionChangeProgress {
    VersionChangeProgress(change: change, failedRegisters: failedRegisters, failedKickstarts: failedKickstarts)
}

private let noPending = LaunchRegistration(registeredThisLaunch: [], pendingHashes: [:])
private let bothAnswered = LaunchSettleReport(answered: ["daemon": true, "deck": true])
private let upgrade = VersionChange.changed(from: "2.12.0", to: "2.13.0")
```

Append inside `launchLifecycleChecks`, before its closing `]`:

```swift
    Check("launch record: agent roles come from the daemon label and deck's program") { c in
        c.expectEqual(AgentRole.of(AgentPlist(label: "com.mattstack.daemon", fileName: "a.plist",
                                              bundleProgram: "Contents/MacOS/rt"),
                                   daemonLabel: "com.mattstack.daemon"), .daemon)
        c.expectEqual(AgentRole.of(AgentPlist(label: "com.mattstack.deck.dev", fileName: "b.plist",
                                              bundleProgram: "Contents/Helpers/deck"),
                                   daemonLabel: "com.mattstack.daemon.dev"), .deck)
        c.expectEqual(AgentRole.of(AgentPlist(label: "com.mattstack.other", fileName: "c.plist",
                                              bundleProgram: "Contents/Helpers/other"),
                                   daemonLabel: "com.mattstack.daemon"), .other)
    },
    Check("launch record: a successful re-register is bootstrapped this launch and its hash waits") { c in
        c.expectEqual(LaunchRecording.summarize([outcome("d", .reregister(hash: "h2"), before: .enabled, reregistered: true)]),
                      LaunchRegistration(registeredThisLaunch: ["d"], pendingHashes: ["d": "h2"]))
    },
    Check("launch record: a failed re-register is neither bootstrapped nor pending") { c in
        c.expectEqual(LaunchRecording.summarize([outcome("d", .reregister(hash: "h2"), before: .enabled, reregistered: false)]),
                      noPending)
    },
    Check("launch record: a fresh register from notRegistered is bootstrapped this launch") { c in
        let registration = LaunchRecording.summarize([
            outcome("a", .recordAfterRegister(hash: "h1"), before: .notRegistered),
            outcome("b", .leave, before: .notRegistered),
            outcome("c", .recordAfterRegister(hash: "h3"), before: .notRegistered, after: .requiresApproval),
            outcome("e", .leave, before: .enabled),
        ])
        c.expectEqual(registration, LaunchRegistration(registeredThisLaunch: ["a", "b"], pendingHashes: ["a": "h1"]))
    },
    Check("launch record: a version change kickstarts only agents not bootstrapped this launch, in order") { c in
        c.expectEqual(LaunchRecording.kickstartLabels(["daemon", "deck", "other"], registeredThisLaunch: ["deck"]),
                      ["daemon", "other"])
    },
    Check("launch record: a pending hash is recorded once its agent answers and held otherwise") { c in
        let registration = LaunchRegistration(registeredThisLaunch: [], pendingHashes: ["d": "h1", "k": "h2", "x": "h3"])
        let plan = LaunchRecording.plan(registration: registration, progress: progress(.unchanged),
                                        report: LaunchSettleReport(answered: ["d": true, "k": false]))
        c.expectEqual(plan, LaunchRecordPlan(hashes: ["d": "h1", "x": "h3"], heldHashes: ["k"], recordVersion: false))
    },
    Check("launch record: a changed version is recorded once every probed agent answers") { c in
        c.expect(LaunchRecording.plan(registration: noPending, progress: progress(upgrade), report: bothAnswered).recordVersion)
        c.expect(!LaunchRecording.plan(registration: noPending, progress: progress(upgrade),
                                       report: LaunchSettleReport(answered: ["daemon": true, "deck": false])).recordVersion)
        c.expect(!LaunchRecording.plan(registration: noPending, progress: progress(upgrade),
                                       report: LaunchSettleReport(answered: ["daemon": false, "deck": true])).recordVersion)
    },
    Check("launch record: a failed register, or a failed kickstart the heal did not cover, keeps the version unrecorded") { c in
        c.expect(!LaunchRecording.plan(registration: noPending, progress: progress(upgrade, failedRegisters: ["a.plist"]),
                                       report: bothAnswered).recordVersion)
        c.expect(!LaunchRecording.plan(registration: noPending, progress: progress(upgrade, failedKickstarts: ["daemon"]),
                                       report: bothAnswered).recordVersion)
        c.expect(LaunchRecording.plan(registration: noPending, progress: progress(upgrade, failedKickstarts: ["daemon"]),
                                      report: LaunchSettleReport(answered: ["daemon": true, "deck": true],
                                                                 healed: ["daemon"])).recordVersion)
    },
    Check("launch record: an unchanged or first-launch version is never recorded here") { c in
        for change in [VersionChange.unchanged, .firstLaunch] {
            c.expect(!LaunchRecording.plan(registration: noPending, progress: progress(change),
                                           report: bothAnswered).recordVersion, "\(change)")
        }
    },
    Check("launch record: served apps restart once after a changed version's deck answers, apart from the record") { c in
        c.expect(LaunchRecording.restartsServedApps(progress: progress(upgrade), report: bothAnswered, deckLabel: "deck"))
        c.expect(!LaunchRecording.restartsServedApps(progress: progress(upgrade),
                                                     report: LaunchSettleReport(answered: ["daemon": true, "deck": false]),
                                                     deckLabel: "deck"))
        c.expect(!LaunchRecording.restartsServedApps(progress: progress(upgrade), report: bothAnswered, deckLabel: nil))
        for change in [VersionChange.unchanged, .firstLaunch] {
            c.expect(!LaunchRecording.restartsServedApps(progress: progress(change), report: bothAnswered,
                                                         deckLabel: "deck"), "\(change)")
        }
        let held = progress(upgrade, failedRegisters: ["a.plist"])
        c.expect(!LaunchRecording.plan(registration: noPending, progress: held, report: bothAnswered).recordVersion)
        c.expect(LaunchRecording.restartsServedApps(progress: held, report: bothAnswered, deckLabel: "deck"))
    },
```

- [ ] **Step 2: Run and see it fail.**

Run: `swift run --package-path rt-tray mattstack-checks "launch record"`
Expected: the build fails with `cannot find 'LaunchRecording' in scope` (and `AgentRole`, `LaunchAgentOutcome`, `LaunchRegistration`, `VersionChangeProgress`, `LaunchRecordPlan`).

- [ ] **Step 3: Implement.** Create `rt-tray/Sources-core/Services/LaunchRecording.swift`:

```swift
import Foundation

public enum AgentRole: Equatable, Sendable {
    case daemon, deck, other

    public static func of(_ agent: AgentPlist, daemonLabel: String) -> AgentRole {
        if agent.label == daemonLabel { return .daemon }
        return agent.bundleProgram == "Contents/Helpers/deck" ? .deck : .other
    }
}

public struct LaunchAgentOutcome: Equatable, Sendable {
    public let label: String
    public let action: AgentPlistRefreshAction
    public let before: AgentRegistration
    public let reregistered: Bool?
    public let registerOk: Bool
    public let after: AgentRegistration

    public init(label: String, action: AgentPlistRefreshAction, before: AgentRegistration,
                reregistered: Bool?, registerOk: Bool, after: AgentRegistration) {
        self.label = label; self.action = action; self.before = before
        self.reregistered = reregistered; self.registerOk = registerOk; self.after = after
    }
}

public struct LaunchRegistration: Equatable, Sendable {
    /// RunAtLoad already started these on the current bundle.
    public let registeredThisLaunch: Set<String>
    public let pendingHashes: [String: String]

    public init(registeredThisLaunch: Set<String>, pendingHashes: [String: String]) {
        self.registeredThisLaunch = registeredThisLaunch; self.pendingHashes = pendingHashes
    }
}

public struct VersionChangeProgress: Equatable, Sendable {
    public let change: VersionChange
    public let failedRegisters: [String]
    public let failedKickstarts: [String]

    public init(change: VersionChange, failedRegisters: [String], failedKickstarts: [String]) {
        self.change = change; self.failedRegisters = failedRegisters; self.failedKickstarts = failedKickstarts
    }
}

public struct LaunchRecordPlan: Equatable, Sendable {
    public let hashes: [String: String]
    public let heldHashes: [String]
    /// Only a changed version is recorded here; handleVersionChange records
    /// an unchanged or first-launch version on the spot.
    public let recordVersion: Bool

    public init(hashes: [String: String], heldHashes: [String], recordVersion: Bool) {
        self.hashes = hashes; self.heldHashes = heldHashes; self.recordVersion = recordVersion
    }
}

public enum LaunchRecording {
    /// A failed re-register may have left the old job in place, so it does
    /// not count as bootstrapped even when the pass after it registers.
    public static func summarize(_ outcomes: [LaunchAgentOutcome]) -> LaunchRegistration {
        var fresh: Set<String> = []
        var pending: [String: String] = [:]
        for outcome in outcomes {
            let registeredNow = outcome.registerOk && outcome.after == .enabled
            if outcome.reregistered == true || (outcome.before == .notRegistered && registeredNow) {
                fresh.insert(outcome.label)
            }
            switch outcome.action {
            case .reregister(let hash) where outcome.reregistered == true:
                pending[outcome.label] = hash
            case .recordAfterRegister(let hash)
                where AgentPlistRefresh.shouldRecordAfterRegister(ok: outcome.registerOk, registration: outcome.after):
                pending[outcome.label] = hash
            default:
                break
            }
        }
        return LaunchRegistration(registeredThisLaunch: fresh, pendingHashes: pending)
    }

    /// kickstart -k on a job bootstrapped this launch kills a process that
    /// already runs the new bundle and can wait out its whole ExitTimeOut.
    public static func kickstartLabels(_ labels: [String], registeredThisLaunch: Set<String>) -> [String] {
        labels.filter { !registeredThisLaunch.contains($0) }
    }

    /// A hash recorded for an agent that never answered would stop the next
    /// launch from re-registering it.
    public static func plan(registration: LaunchRegistration, progress: VersionChangeProgress,
                            report: LaunchSettleReport) -> LaunchRecordPlan {
        var hashes: [String: String] = [:]
        var held: [String] = []
        for (label, hash) in registration.pendingHashes {
            if report.answered[label] ?? true { hashes[label] = hash } else { held.append(label) }
        }
        guard case .changed = progress.change else {
            return LaunchRecordPlan(hashes: hashes, heldHashes: held.sorted(), recordVersion: false)
        }
        let recordVersion = progress.failedRegisters.isEmpty
            && Set(progress.failedKickstarts).isSubset(of: report.healed)
            && report.answered.values.allSatisfy { $0 }
        return LaunchRecordPlan(hashes: hashes, heldHashes: held.sorted(), recordVersion: recordVersion)
    }

    /// A Sparkle update swaps `Contents/Helpers/<app>` at the same path, so
    /// deck's sweep finds every served plist unchanged and never restarts the
    /// apps still running the deleted binary.
    public static func restartsServedApps(progress: VersionChangeProgress, report: LaunchSettleReport,
                                          deckLabel: String?) -> Bool {
        guard case .changed = progress.change, let deckLabel else { return false }
        return report.answered[deckLabel] == true
    }
}
```

- [ ] **Step 4: Run to pass.**

Run: `swift run --package-path rt-tray mattstack-checks "launch record"`
Expected: `checks: 10 passed, 0 failed`

- [ ] **Step 5: Commit.**

Run: `git add rt-tray/Sources-core/Services/LaunchRecording.swift rt-tray/Tests/MattstackCoreChecks/LaunchLifecycleChecks.swift`
Run: `git commit -m "tray: record plist hashes and the version only for agents that answered; restart served apps once after deck answers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 6: wire the launch: settled records, no kickstart -k for fresh jobs, one post-settle deck restart --managed

**Files:**
- Modify: `rt-tray/Sources-core/Services/ServicePlists.swift:76-78` (`DeckProbe` added after `DeckRestart`, which stays)
- Modify: `rt-tray/Sources-core/Services/DaemonLifecycleGate.swift:11-17` (`DaemonOrigin.spawnHeal`)
- Modify: `rt-tray/Tests/MattstackCoreChecks/ServicesChecks.swift:34-41`
- Modify: `rt-tray/Sources/DaemonLifecycle.swift` (add `runGated` after `reregisterDaemon`, `:173-175`)
- Modify: `rt-tray/Sources/Services/ServicesRegistrar.swift` (init `:26-41`, `registerAllAtLaunch` `:50-86`, remove `restartAll`/`restartAllChecked` `:223-243`, `handleVersionChange` `:245-269`, new probe/settle/record methods)
- Modify: `rt-tray/Sources/AppDelegate.swift` (property near `:23`, launch Task `:205-236`, new private method)

**Interfaces:**
- Consumes: everything from Tasks 1 to 5; `DaemonClient.isReachable()` (`rt-tray/Sources/DaemonClient.swift:18-21`); `VersionChangeDetector` (`VersionChangeDetector.swift:23-30`).
- Produces:
  - `public enum DeckProbe { static func arguments(deckPath: String) -> (String, [String]) }` (argv `["list"]`, the probe `DevBuild.swift:168` and `update-machine.ts:537` already use)
  - `DaemonOrigin.spawnHeal = "spawn heal"`
  - `DaemonLifecycle.runGated(origin: String, _ body: @escaping @Sendable () async -> Bool) async -> Bool`
  - `ServicesRegistrar.init(bundlePath:runner:probeRunner:uid:)` with `probeRunner` defaulting to `SystemCommandRunner(timeout: 5)`
  - `ServicesRegistrar.registerAllAtLaunch(store:daemonLabel:reregisterDaemon:) async -> LaunchRegistration`
  - `ServicesRegistrar.handleVersionChange(current:store:registeredThisLaunch:) async -> VersionChangeProgress`
  - `ServicesRegistrar.launchProbes(daemonLabel:daemonAnswers:healAgent:) -> [LaunchAgentProbe]`
  - `ServicesRegistrar.reregisterAgent(label:) async -> Bool`, `settleLaunch(_:latch:) async -> LaunchSettleReport`, `recordAfterSettle(_:progress:current:store:)`
  - `ServicesRegistrar.deckLabel(daemonLabel:) -> String?` and `ServicesRegistrar.restartServedApps() async` (one `<bundle>/Contents/Helpers/deck restart --managed` through `probeRunner`, result logged only)
  - Kept: `DeckRestart` (`restartServedApps` is its one caller).
  - Removed: `ServicesRegistrar.restartAll()`, `restartAllChecked()` (their only caller was `handleVersionChange`; grep confirms in Step 6).

New launch order in `AppDelegate`: launch registration pass, then version change (register again, `kickstart -k` only agents not bootstrapped this launch), then `recordAppPath` and first-run Setup (unchanged: Setup must not wait on agents), then settle (answer wait, heal, second wait) and records, then (on a changed version whose deck answered) one `deck restart --managed`, then `refreshStatus` and the notification drain. `startPolling` (`AppDelegate.swift:143`) already refreshes status every 10s while the settle runs. Unit B makes `restartManagedApps` skip rows prod does not serve, so the restart does not fail on an uninstalled label.

- [ ] **Step 1: Write the failing checks.** In `ServicesChecks.swift`, replace the `"Kickstart and DeckRestart build the exact argv"` check (`:34-41`) with:

```swift
    Check("Kickstart, DeckProbe and DeckRestart build the exact argv") { c in
        let (exe, args) = Kickstart.arguments(label: "com.mattstack.daemon.dev", uid: 501)
        c.expect(exe.hasPrefix("/bin/") && exe.hasSuffix("ctl"), "launchd's control tool, by absolute path (name kept out of check sources by the source guard)")
        c.expectEqual(args, ["kickstart", "-k", "gui/501/com.mattstack.daemon.dev"])
        let deck = "/Applications/mattstack.app/Contents/Helpers/deck"
        let (d, dargs) = DeckProbe.arguments(deckPath: deck)
        c.expectEqual(d, deck)
        c.expectEqual(dargs, ["list"])
        let (r, rargs) = DeckRestart.arguments(deckPath: deck)
        c.expectEqual(r, deck)
        c.expectEqual(rargs, ["restart", "--managed"])
    },
    Check("DaemonOrigin names the spawn heal apart from a plist change") { c in
        c.expectEqual(DaemonOrigin.spawnHeal, "spawn heal")
        c.expect(DaemonOrigin.spawnHeal != DaemonOrigin.plistChanged)
    },
```

- [ ] **Step 2: Run and see it fail.**

Run: `swift run --package-path rt-tray mattstack-checks "DeckProbe"`
Expected: the build fails with `cannot find 'DeckProbe' in scope` and `type 'DaemonOrigin' has no member 'spawnHeal'`.

- [ ] **Step 3: Implement the core pieces.** In `ServicePlists.swift`, keep `DeckRestart` (`:76-78`) as it is and add directly after it:

```swift
/// Exits 0 only once deck answers on its API port.
public enum DeckProbe {
    public static func arguments(deckPath: String) -> (String, [String]) { (deckPath, ["list"]) }
}
```

In `DaemonLifecycleGate.swift`, add inside `DaemonOrigin` after `plistChanged` (`:17`):

```swift
    /// Launch re-registering an agent launchd refused to spawn.
    public static let spawnHeal = "spawn heal"
```

In `DaemonLifecycle.swift`, add after `reregisterDaemon(origin:)` (`:173-175`):

```swift
    /// Agent work that must not outlive a flavor retire: once teardown
    /// latches the gate, a parked or later body is skipped.
    @discardableResult
    func runGated(origin: String, _ body: @escaping @Sendable () async -> Bool) async -> Bool {
        await gate.run(.restart, origin: origin, body)
    }
```

- [ ] **Step 4: Rewrite the registrar's launch pass and version change.** In `ServicesRegistrar.swift`:

Add a stored property after `private let runner: CommandRunner` (`:19`):

```swift
    /// Bounded well under an answer budget: one hung `deck list` must not
    /// eat the whole wait.
    private let probeRunner: CommandRunner
```

Change the init signature and body (`:26-29`):

```swift
    init(bundlePath: String, runner: CommandRunner,
         probeRunner: CommandRunner = SystemCommandRunner(timeout: 5), uid: uid_t = getuid()) {
        self.bundlePath = bundlePath
        self.runner = runner
        self.probeRunner = probeRunner
        self.uid = uid
```

(the rest of the init is unchanged).

Replace `registerAllAtLaunch` and its doc comment (`:50-86`) with:

```swift
    /// launchd keeps the definition it bootstrapped, so an agent whose shipped
    /// plist changed is unregistered and registered again first; the daemon
    /// goes through `reregisterDaemon` so its lifecycle gate covers the gap.
    /// `registerAll` then puts back any agent a failed re-register left
    /// unregistered.
    func registerAllAtLaunch(store: KeyValueStore, daemonLabel: String,
                             reregisterDaemon: () async -> Bool) async -> LaunchRegistration {
        let dir = bundlePath + "/Contents/Library/LaunchAgents"
        let before = agents.map { Self.registration(service($0).status) }
        let plan = AgentPlistRefresh.plan(zip(agents, before).map { agent, registration in
            AgentPlistState(label: agent.label,
                            bundleHash: FileManager.default.contents(atPath: dir + "/" + agent.fileName)
                                .map(AgentPlistRefresh.hash),
                            recordedHash: store.string(forKey: AgentPlistRefresh.storeKey(label: agent.label)),
                            registration: registration)
        })
        var reregistered: [String: Bool] = [:]
        for (agent, entry) in zip(agents, plan) {
            guard case .reregister = entry.action else { continue }
            TrayLog.info("agent plist changed; re-registering", ["label": agent.label])
            let ok = agent.label == daemonLabel ? await reregisterDaemon() : await reregister(agent)
            reregistered[agent.label] = ok
            if !ok { TrayLog.warn("agent plist change not applied; retrying next launch", ["label": agent.label]) }
        }
        let results = await registerAll()
        var outcomes: [LaunchAgentOutcome] = []
        for (index, agent) in agents.enumerated() {
            outcomes.append(LaunchAgentOutcome(
                label: agent.label, action: plan[index].action, before: before[index],
                reregistered: reregistered[agent.label],
                registerOk: index < results.count && results[index].ok,
                after: Self.registration(service(agent).status)))
        }
        return LaunchRecording.summarize(outcomes)
    }
```

Delete `restartAll()` and `restartAllChecked()` with their doc comment (`:223-243`).

Replace `handleVersionChange` and its doc comment (`:245-269`) with:

```swift
    /// On a version change, an agent launchd did not bootstrap this launch
    /// may still run the old bundle's inode, so it is kickstarted with -k.
    /// Recording the new version waits for the agents to answer
    /// (`recordAfterSettle`); an unchanged or first-launch version is
    /// recorded here.
    func handleVersionChange(current: String, store: KeyValueStore,
                             registeredThisLaunch: Set<String>) async -> VersionChangeProgress {
        let change = VersionChangeDetector.evaluate(current: current, store: store)
        guard case .changed(let from, let to) = change else {
            VersionChangeDetector.record(current: current, store: store)
            return VersionChangeProgress(change: change, failedRegisters: [], failedKickstarts: [])
        }
        let labels = LaunchRecording.kickstartLabels(agents.map(\.label), registeredThisLaunch: registeredThisLaunch)
        TrayLog.info("app version changed; restarting agents",
                     ["from": from, "to": to, "kickstart": labels.joined(separator: ","),
                      "bootstrappedThisLaunch": registeredThisLaunch.sorted().joined(separator: ",")])
        let failedRegisters = await registerAll().filter { !$0.ok }.map(\.plist)
        var failedKickstarts: [String] = []
        for label in labels {
            if !(await restart(label: label)) { failedKickstarts.append(label) }
        }
        return VersionChangeProgress(change: change, failedRegisters: failedRegisters,
                                     failedKickstarts: failedKickstarts)
    }

    /// Only the daemon and the deck helper can be heard answering; any other
    /// agent is neither waited on nor healed.
    func launchProbes(daemonLabel: String, daemonAnswers: @escaping @Sendable () async -> Bool,
                      healAgent: @escaping @Sendable (String) async -> Bool) -> [LaunchAgentProbe] {
        agents.compactMap { agent -> LaunchAgentProbe? in
            let answers: @Sendable () async -> Bool
            let budget: AnswerBudget
            switch AgentRole.of(agent, daemonLabel: daemonLabel) {
            case .daemon:
                answers = daemonAnswers
                budget = .daemon
            case .deck:
                answers = { await self.deckAnswers() }
                budget = .deck
            case .other:
                return nil
            }
            let label = agent.label
            return LaunchAgentProbe(label: label, budget: budget, answers: answers,
                                    registration: { Self.registration(self.service(agent).status) },
                                    lookup: { await self.launchdLookup(label: label) },
                                    heal: { await healAgent(label) })
        }
    }

    private func deckAnswers() async -> Bool {
        let (exe, args) = DeckProbe.arguments(deckPath: bundlePath + "/Contents/Helpers/deck")
        return await probeRunner.run(exe, args).ok
    }

    func deckLabel(daemonLabel: String) -> String? {
        agents.first { AgentRole.of($0, daemonLabel: daemonLabel) == .deck }?.label
    }

    /// Bounded by the probe runner so a slow restart cannot hold the launch
    /// Task; the outcome is only logged, never recorded.
    func restartServedApps() async {
        let (exe, args) = DeckRestart.arguments(deckPath: bundlePath + "/Contents/Helpers/deck")
        let outcome = await probeRunner.run(exe, args)
        if outcome.ok {
            TrayLog.info("served apps restarted after version change")
        } else {
            TrayLog.warn("served apps restart after version change failed",
                         ["exit": outcome.exitCode, "stderr": outcome.stderr])
        }
    }

    private func launchdLookup(label: String) async -> LaunchdJobLookup {
        let (exe, args) = LaunchdPrint.arguments(label: label, uid: uid)
        return LaunchdPrint.parse(await runner.run(exe, args))
    }

    func reregisterAgent(label: String) async -> Bool {
        guard let agent = agents.first(where: { $0.label == label }) else { return false }
        return await reregister(agent)
    }

    func settleLaunch(_ probes: [LaunchAgentProbe], latch: SpawnHealLatch) async -> LaunchSettleReport {
        await LaunchSettle.run(probes, latch: latch, sleep: { try? await Task.sleep(nanoseconds: $0) }) { event in
            switch event {
            case .answered(let label):
                TrayLog.info("agent answered after launch", ["label": label])
            case .left(let label, let reason):
                TrayLog.warn("agent not answering after launch; no spawn heal", ["label": label, "reason": reason])
            case .healed(let label, let reason, let reregistered, let answered):
                let fields: [String: Any] = ["label": label, "reason": reason,
                                             "reregistered": reregistered, "answered": answered]
                if answered {
                    TrayLog.info("spawn heal brought the agent back", fields)
                } else {
                    TrayLog.warn("spawn heal did not bring the agent back", fields)
                }
            }
        }
    }

    func recordAfterSettle(_ plan: LaunchRecordPlan, progress: VersionChangeProgress,
                           current: String, store: KeyValueStore) {
        for (label, hash) in plan.hashes {
            store.set(hash, forKey: AgentPlistRefresh.storeKey(label: label))
        }
        if !plan.heldHashes.isEmpty {
            TrayLog.warn("agent plist change applied but agent did not answer; retrying next launch",
                         ["labels": plan.heldHashes.joined(separator: ",")])
        }
        guard case .changed(let from, let to) = progress.change else { return }
        if plan.recordVersion {
            VersionChangeDetector.record(current: current, store: store)
            TrayLog.info("app version recorded after agents answered", ["from": from, "to": to])
        } else {
            TrayLog.warn("version-change restart incomplete; leaving version unrecorded for retry",
                         ["from": from, "to": to, "failedRegisters": progress.failedRegisters,
                          "failedKickstarts": progress.failedKickstarts])
        }
    }
```

- [ ] **Step 5: Rewire the launch Task.** In `AppDelegate.swift`, add a stored property after `private let daemonLifecycle = DaemonLifecycle()` (`:23`):

```swift
    private let spawnHealLatch = SpawnHealLatch()
```

Replace the launch Task (`:205-236`, from `Task { @MainActor in` through its closing `}` before `}` of `startNormalOperation`) with:

```swift
        Task { @MainActor in
            setHealth(.starting)
            var launch: (registration: LaunchRegistration, progress: VersionChangeProgress, version: String)?
            if BundleFlavor.isStubActive {
                TrayLog.info("stub mode: skipping real service registration and version-change restart")
            } else {
                let lifecycle = daemonLifecycle
                let registration = await servicesRegistrar.registerAllAtLaunch(store: UserDefaults.standard,
                                                                               daemonLabel: lifecycle.label) {
                    await lifecycle.reregisterDaemon(origin: DaemonOrigin.plistChanged)
                }
                let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
                let progress = await servicesRegistrar.handleVersionChange(
                    current: version, store: UserDefaults.standard,
                    registeredThisLaunch: registration.registeredThisLaunch)
                TrayLog.info("version change evaluated", ["change": String(describing: progress.change)])
                launch = (registration, progress, version)
            }
            await recordAppPath()

            // First-run Setup has no daemon dependency, so it shows before the
            // agent wait below; a genuine first run (daemon not installed yet)
            // would otherwise sit at a blank menu bar for the whole wait.
            if let coordinator, !coordinator.setupIsComplete {
                coordinator.showSetup(step: SetupResume.step(from: CommandLine.arguments))
            }

            if let launch {
                await settleAgentsAfterLaunch(launch.registration, launch.progress, version: launch.version)
            } else {
                for _ in 0..<8 {
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    if await daemonClient.isReachable() { break }
                }
            }
            await refreshStatus()
            await drainPendingNotifications()
        }
```

Add this method directly after `startNormalOperation()` (before `// MARK: - Flavor takeover and stand-down`):

```swift
    @MainActor
    private func settleAgentsAfterLaunch(_ registration: LaunchRegistration, _ progress: VersionChangeProgress,
                                         version: String) async {
        guard let registrar = servicesRegistrar else { return }
        let lifecycle = daemonLifecycle
        let client = daemonClient
        let probes = registrar.launchProbes(
            daemonLabel: lifecycle.label,
            daemonAnswers: { await client.isReachable() },
            healAgent: { label in
                if label == lifecycle.label {
                    return await lifecycle.reregisterDaemon(origin: DaemonOrigin.spawnHeal)
                }
                return await lifecycle.runGated(origin: DaemonOrigin.spawnHeal) {
                    await registrar.reregisterAgent(label: label)
                }
            })
        let report = await registrar.settleLaunch(probes, latch: spawnHealLatch)
        registrar.recordAfterSettle(LaunchRecording.plan(registration: registration, progress: progress, report: report),
                                    progress: progress, current: version, store: UserDefaults.standard)
        if LaunchRecording.restartsServedApps(progress: progress, report: report,
                                              deckLabel: registrar.deckLabel(daemonLabel: lifecycle.label)) {
            await registrar.restartServedApps()
        }
    }
```

- [ ] **Step 6: Build and run the tray suite.**

Run: `swift build --package-path rt-tray`
Expected: `Build complete!` (no errors; existing warnings are fine).

Run: `grep -rn -e restartAll -e restartAllChecked rt-tray/Sources rt-tray/Sources-core rt-tray/Tests`
Expected: no output.

Run: `grep -rn DeckRestart rt-tray/Sources rt-tray/Sources-core`
Expected: exactly two hits, the definition in `ServicePlists.swift` and its one use in `ServicesRegistrar.restartServedApps()`.

Run: `swift run --package-path rt-tray mattstack-checks "DeckProbe"`
Expected: `checks: 1 passed, 0 failed`

Run: `swift run --package-path rt-tray mattstack-checks`
Expected: `checks: M passed, 0 failed`, where M is Task 0's N plus the checks this unit added (8 + 9 + 1 + 1 + 9 + 10 + 1 = 39 new; Task 3 replaced 4 reregister checks with 4 and added 1 more, which is counted in the 39).

Run: `git diff origin/main -- rt-tray`
Expected: read it once; no added line contains an em or en dash, no comment narrates the next line, no ticket id appears.

- [ ] **Step 7: Commit.**

Run: `git add rt-tray/Sources-core/Services/ServicePlists.swift rt-tray/Sources-core/Services/DaemonLifecycleGate.swift rt-tray/Sources/DaemonLifecycle.swift rt-tray/Sources/Services/ServicesRegistrar.swift rt-tray/Sources/AppDelegate.swift rt-tray/Tests/MattstackCoreChecks/ServicesChecks.swift`
Run: `git commit -m "tray: settle launch agents before recording; no -k for fresh jobs, deck restart --managed only after deck answers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 7: push and open the PR

**Files:** a PR body file in the scratchpad (not committed).

- [ ] **Step 1: Final targeted run.**

Run: `swift build --package-path rt-tray`
Expected: `Build complete!`

Run: `swift run --package-path rt-tray mattstack-checks`
Expected: `checks: M passed, 0 failed` (same M as Task 6).

- [ ] **Step 2: Push.**

Run: `git push -u origin rt-2-13-f-tray-launch-lifecycle`

- [ ] **Step 3: Write the PR body** with the Write tool to `<scratchpad>/pr-body-f.md`:

```markdown
## Tray launch lifecycle: settled re-register, spawn-health heal, answer-gated records

Prod 2.12.0's first launch re-registered the daemon, SMAppService said `enabled`, and launchd never spawned it (exit 78, `needs LWCR update`) until a manual `rt daemon uninstall` then `install`. Part of the 2.13.0 prod-readiness release (spec section F; RT-279, RT-283).

### What changed

**Re-register**

- `AgentReregister.run` now runs sync unregister, a 1s settle, register, then one start (`kickstart` without `-k`)
- Used by the daemon's gated re-register, deck's re-register and the gear-menu restart fallback

**Spawn-health heal**

- Pure `launchctl print` parser (`LaunchdPrint`) with a fixture of the real healthy capture and the refused-spawn shape
- `AgentSpawnHealth.decide`: heals an enabled, silent agent whose job shows exit 78, `spawn failed`, `needs LWCR update`, or no job at all; leaves running, crashed or unapproved ones
- `LaunchSettle`: waits for the daemon (15s) and deck (30s), heals once per label per launch, waits again; deck's heal goes through the daemon lifecycle gate so a flavor retire skips it

**Records and version change**

- Plist hashes are recorded only after the agent answers
- A version change no longer `kickstart -k`s agents bootstrapped this launch
- `deck restart --managed` now runs once, after deck answers and the record is written, and never gates the record; it moves served apps off a binary-only update's deleted `Helpers` binaries, which deck's sweep sees as unchanged
- The version is recorded once every probed agent answers; a failed kickstart is forgiven only if the heal re-registered that agent

**Other `restart --managed` callers, kept on purpose**

- `DevBuild.swift` handoff and update-machine's dev-bundle and served-suite legs already wait for deck and gate nothing on the result; they are what move served apps onto a swapped bundle's binaries

### Verification

`swift build` and the full `mattstack-checks` suite green (39 new checks). No live launchd run: registering a scratch app's agents would clobber the real labels on the dev Mac. The real-launchd proof is unit H's VM check and the release walkthrough. No UI change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Open the PR.**

Run: `gh pr create --base main --head rt-2-13-f-tray-launch-lifecycle --title "tray: settled re-register, spawn-health heal, answer-gated records" --body-file <scratchpad>/pr-body-f.md`
Expected: a PR URL. Report it. Review (CodeRabbit or the stand-in) and merge belong to the orchestrator.

---

## Contract notes

1. **Shared contracts 1 to 8 are not touched.** Unit F reads no deps.lock, ships nothing in `Contents/Resources`, and changes no deck code or versions. No refinement needed.
2. **Spec F's "(the sweep covers it)" does not hold for a binary-only update, so F keeps a one-shot restart.** Deck's boot sweep reinstalls a plist only when ProgramArguments, WorkingDirectory or environment differ (unit B reports the rest `unchanged` and never kickstarts them), and a Sparkle update replaces `Contents/Helpers/<app>` at the same path, so the served apps keep running the deleted old binary. `lib/release/update-machine.ts:531-535` records the cost: an app still on the deleted binary loses its privacy grants (EPERM reading `~/Documents`). Unit H's update leg would not catch it (argv0 is the same path and the old process still answers). The old call ran before deck answered and its failure blocked the version record on every launch, so F moves it: after `LaunchSettle` reports deck answered on a changed version, `settleAgentsAfterLaunch` runs `<bundle>/Contents/Helpers/deck restart --managed` once through `probeRunner` (unit B makes it skip not-served rows), logs the result, and records the version first so the restart can never gate it (Task 5 pins the decision, Task 6 wires it). The durable fix is a per-row bundle-version stamp in B's sweep (kickstart a catalog row whose stamp differs at boot); the release runbook files that follow-up ticket.
3. **Other `restart --managed` callers, decided per caller: keep both, change nothing.** `DevBuild.swift:160-171` (dev handoff) and `update-machine.ts` (dev-bundle leg `:531-548`, served-suite leg `:588-597`) already wait for `deck list` before calling it, never gate a version record on it, and are the only things that restart source-served dev apps after a pull or unlinked dev rows after a bundle swap. **Coupling for unit B:** once B uninstalls plists for rows "not served in this flavor", `restartManagedApps` will kickstart those labels, fail, and exit non-zero, which turns update-machine's served-suite leg into an error. B should skip rows with no installed plist (or not-served rows) in `restartManagedApps`.
4. **Heal triggers, refined.** The spec names last exit 78 or `spawn failed`. F also heals `needs LWCR update` on a job that is not running, and an agent SMAppService reports `enabled` while launchd holds no job at all (`launchctl print` exit 113). The second is the state the takeover's plain bootout leaves (`commands/flavor.ts:171-176`), and `kickstart -k` fails on it. Every trigger still requires: registration `enabled`, silent for the whole budget, no `pid`, first attempt this launch.
5. **No `SMAppService.mainApp` escalation.** Commit `6b204bf3c` found agent-level re-register unreliable after a binary swap and used a mainApp unregister/register cycle. The spec asks for one agent-level cycle; the mainApp cycle can drop the app to `requiresApproval` in Login Items. Left out, and logged outcomes ("spawn heal did not bring the agent back") will show whether it is needed.
6. **"Deck answers" means `Contents/Helpers/deck list` exits 0**, the probe `DevBuild.swift:168` and update-machine already use, with a 5s spawn timeout. It is not deck's `/healthz`; unit G's splash probe is separate. If G lands a shared deck readiness helper first, `ServicesRegistrar.deckAnswers()` can switch to it.
7. **Version record for first launch and unchanged versions is unchanged**: recorded on the spot in `handleVersionChange`, as today.

## Depends on

None. Unit F is tray-only and branches from `origin/main`. Merge order: F merges before unit G. F owns `LaunchdJobSnapshot`, `LaunchdJobLookup` and `LaunchdPrint` (Task 1); G consumes them and declares no parser of its own, branching after F merges (or cherry-picking F's Task 1 commit until then), and as the second to merge it runs `swift build` and the full `mattstack-checks` on the rebased tree. G does not edit `AppDelegate.swift`, so the only shared file is the one-line append in `Tests/MattstackCoreChecks/AllChecks.swift`. Contract note 3's coupling (skip not-served rows in `restartManagedApps`) is in unit B's plan, not a merge prerequisite for F.
