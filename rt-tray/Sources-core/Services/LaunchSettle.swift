import Foundation

public struct AnswerBudget: Equatable, Sendable {
    public let deadline: TimeInterval
    public let interval: TimeInterval

    public init(deadline: TimeInterval, interval: TimeInterval) {
        self.deadline = deadline; self.interval = interval
    }

    public static let daemon = AnswerBudget(deadline: 15, interval: 0.5)
    /// Each deck probe spawns its CLI, so it polls half as often.
    public static let deck = AnswerBudget(deadline: 30, interval: 1)
    /// deck opens /api/apps at most 60s after it boots, sweep or no sweep.
    public static let deckSweep = AnswerBudget(deadline: 60, interval: 1)
}

/// `deck list` answers as soon as deck's API binds, while its boot sweep may
/// still be adopting rows and installing plists; /api/apps answers 200 only
/// once that sweep has finished.
public enum DeckSweep {
    public static let appsURL = "https://deck.mattstack/api/apps"
    /// deck holds /api/apps up to 10s on its sweep, then answers 503.
    public static let requestTimeout: TimeInterval = 12

    public static func finished(status: Int?) -> Bool { status == 200 }
}

/// A restart racing the sweep fails on labels not installed yet and kills
/// apps the sweep just started. One that never sees the sweep finish still
/// runs: deck's cap has opened /api/apps by then, so only an unreachable
/// route gets there, and `deck restart --managed` does not go through it.
public enum ServedAppsRestart {
    public static func run(budget: AnswerBudget = .deckSweep, now: () -> TimeInterval,
                           sleep: (TimeInterval) async -> Void, sweepFinished: () async -> Bool,
                           restart: (_ afterSweep: Bool) async -> Void) async {
        let swept = await AgentAnswerWait.wait(budget, now: now, sleep: sleep, probe: sweepFinished)
        await restart(swept)
    }
}

public enum AgentAnswerWait {
    /// The deadline is read from the clock after every probe, never counted
    /// in polls: a probe can take its whole timeout, so the last one may
    /// overrun the deadline by that much.
    public static func wait(_ budget: AnswerBudget, now: () -> TimeInterval, sleep: (TimeInterval) async -> Void,
                            probe: () async -> Bool) async -> Bool {
        let start = now()
        while true {
            if await probe() { return true }
            let elapsed = now() - start
            if elapsed >= budget.deadline { return false }
            await sleep(min(budget.interval, budget.deadline - elapsed))
        }
    }
}

/// Both flavors' daemons serve the same rt.sock and :9401, so until a
/// takeover has booted the other one out, its answer is not this one's.
public struct DaemonFlavorPing: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let flavor: String?

    public func answers(asFlavor expected: String) -> Bool { ok && flavor == expected }
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
                           now: @escaping @Sendable () -> TimeInterval,
                           sleep: @escaping @Sendable (TimeInterval) async -> Void,
                           observer: (@Sendable (LaunchSettleEvent) -> Void)? = nil) async -> LaunchSettleReport {
        await withTaskGroup(of: Outcome.self) { group in
            for probe in probes {
                group.addTask { await settle(probe, latch: latch, now: now, sleep: sleep, observer: observer) }
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
                               now: @escaping @Sendable () -> TimeInterval,
                               sleep: @escaping @Sendable (TimeInterval) async -> Void,
                               observer: (@Sendable (LaunchSettleEvent) -> Void)?) async -> Outcome {
        if await AgentAnswerWait.wait(probe.budget, now: now, sleep: sleep, probe: probe.answers) {
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
            answered = await AgentAnswerWait.wait(probe.budget, now: now, sleep: sleep, probe: probe.answers)
        }
        observer?(.healed(label: probe.label, reason: reason, reregistered: reregistered, answered: answered))
        return Outcome(label: probe.label, answered: answered, healed: reregistered)
    }
}
