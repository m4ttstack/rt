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
]
